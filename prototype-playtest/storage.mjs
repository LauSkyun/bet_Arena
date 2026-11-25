import { groundProfile } from './profiles.mjs';
import { previousCombatRules } from './battle.mjs';
import { legacyBoard } from './roster.mjs';
import { defaultDurations, legacyDurations } from './timing.mjs';
import { betting, stakesFor } from './betting.mjs';
import { advance, newSession, placeBet, sessionVersion, timeline } from './round.mjs';
import { adjustTestBalance } from './test-wallet.mjs';
import { battleDataFor, battleDataReport } from './battle-data.mjs';
import { archiveTransaction, prefixRange, requestResult } from './archive-db.mjs';
import { betDataReport, newRoundArchive, recordBattleFrames, recoverBetEntries, saveBattleSnapshot } from './round-archive.mjs';

export const sessionKey = 'bet-arena.prototype.sc-ground-v21.v1';

function legacyRates(red, blue) {
  return { red: red > 0 ? 200 : null, blue: blue > 0 ? 200 : null };
}

function migrateResult(result, rates) {
  if (!result) return null;
  const { support, stake, ...fields } = result;
  const stakes = fields.stakes ?? { red: support === 'red' ? stake : 0, blue: support === 'blue' ? stake : 0 };
  return { ...fields, stake, stakes, rates: rates ?? legacyRates(stakes.red, stakes.blue) };
}

export function upgradeSession(saved) {
  if (!saved || saved.version === sessionVersion) return saved;
  if (Number.isInteger(saved.version) && saved.version >= 13 && saved.version <= 17) return { ...saved, version: sessionVersion };
  // Sessions through v12 used a fixed 10-point threshold for every wager in the open round.
  saved = { ...saved, round: { ...saved.round, threshold: 10 }, nextThreshold: betting.threshold };
  // Older tabs reject this version before they can settle a round with newer rules.
  if (Number.isInteger(saved.version) && saved.version >= 6 && saved.version <= 12) return { ...saved, version: sessionVersion };
  if (saved.version === 5) return { ...saved, version: sessionVersion, round: { ...saved.round, combatRules: previousCombatRules } };
  if (saved.version === 4) return { ...saved, version: sessionVersion, round: { ...saved.round, board: legacyBoard, combatRules: previousCombatRules } };
  if (saved.version === 3) return { ...saved, version: sessionVersion, nextDurations: defaultDurations,
    round: { ...saved.round, board: legacyBoard, combatRules: previousCombatRules, durations: legacyDurations } };
  if (saved.version !== 1 && saved.version !== 2) throw Error('试玩记录版本不受支持');
  const { support: _support, stake: _stake, snapshot, result, ...round } = saved.round;
  let sealed = null;
  if (snapshot) {
    const { support: _side, stake: _total, ...fields } = snapshot;
    const { red, blue } = snapshot.teams;
    // A round sealed under the fixed multiplier keeps that multiplier through recovery.
    sealed = { ...fields, stakes: fields.stakes ?? stakesFor(snapshot.teams), rates: legacyRates(red.total, blue.total) };
  }
  return { ...saved, version: sessionVersion, nextDurations: defaultDurations, previous: migrateResult(saved.previous),
    round: { ...round, board: legacyBoard, combatRules: previousCombatRules, durations: legacyDurations, snapshot: sealed, result: migrateResult(result, sealed?.rates) } };
}

const primary = 'current';
const changes = typeof window === 'undefined' ? null : new BroadcastChannel(`${sessionKey}.archive`);
const read = (store, key) => requestResult(store.get(key));

export function observeSessionChange(listener) {
  changes?.addEventListener('message', listener);
}

function loggedBet(record, request) {
  return record?.bet_log.entries.find((item) => item.source === 'player' && item.requestId === request.requestId);
}

function playerEntry(record, request, response, now) {
  return { source: 'player', requestId: request.requestId, elapsedMs: record.startedAt == null ? null : Math.max(0, now - record.startedAt),
    side: request.side, amount: request.amount, requestedRoundNumber: request.roundNumber, accepted: Boolean(response.receipt), error: response.error ?? null,
    receipt: response.receipt ?? null, effects: response.receipt?.effects ?? [] };
}

function observeRounds() {
  const entries = new Map();
  const finishedRounds = [];
  return {
    entries, finishedRounds,
    reference(round, event, index) {
      const list = entries.get(round.number) ?? [];
      list.push({ source: 'system', requestId: `system-${index}`, elapsedMs: event.elapsed,
        side: event.side, amount: event.amount, accepted: true, effects: round.lastEffects });
      entries.set(round.number, list);
    },
    finished(round) { finishedRounds.push(round); },
  };
}

async function importLegacy(session, rounds, frames) {
  const previous = session.previous;
  if (previous?.battleData) {
    const data = previous.battleData;
    const endedAtMs = previous.endedAtMs ?? data.durations.battleMs;
    const battleStartedAt = Number.isFinite(previous.settledAt) ? previous.settledAt - endedAtMs : null;
    const startedAt = battleStartedAt == null ? null : battleStartedAt - data.durations.betMs - 2_000;
    const record = newRoundArchive(session, data.number, startedAt, false);
    record.bet_log.entries = recoverBetEntries(previous.receipts, (data.reference ?? []).filter((event) => event.elapsed < data.durations.betMs), startedAt);
    record.battle_data = battleDataReport({ ...data, result: null, seed: session.seed, startedAt,
      lockedAt: startedAt == null ? null : startedAt + data.durations.betMs, battleStartedAt }, 'lock', data.durations.betMs);
    const { receipts: _receipts, battleData: _data, ...settlement } = previous;
    recordBattleFrames(record, Infinity, settlement, (frame) => frames.put(frame, [session.id, data.number, frame.elapsed]));
    rounds.put(record);
  }
  const { round } = session;
  const record = newRoundArchive(session, round.number, round.startedAt, false);
  record.bet_log.entries = recoverBetEntries(round.receipts, session.reference.slice(0, round.referenceIndex), round.startedAt);
  rounds.put(record);
}

async function syncRound(rounds, frames, session, round, now, entries = []) {
  const existing = await read(rounds, [session.id, round.number]);
  const record = existing ?? newRoundArchive(session, round.number, round.startedAt);
  const wasSealed = Boolean(record.battle_data);
  record.bet_log.entries.push(...entries);
  saveBattleSnapshot(record, session, round);
  let advanced = false;
  if (record.battle_data && !record.log?.complete) {
    const cutoff = round.result ? Infinity : now - record.battle_data.round.battleStartedAt;
    const settlement = round.result ? battleDataFor(round, session.reference).result : null;
    advanced = recordBattleFrames(record, cutoff, settlement, (frame) => frames.put(frame, [session.id, round.number, frame.elapsed]));
  }
  if (!existing || entries.length || advanced || wasSealed !== Boolean(record.battle_data)) rounds.put(record);
}

function fenceLegacy() {
  const stored = JSON.parse(localStorage.getItem(sessionKey));
  if (stored?.storage === 'indexeddb') return stored.legacy ?? null;
  // Older pages reject v18 under this same lock. Retain the migration source until commit.
  localStorage.setItem(sessionKey, JSON.stringify({ version: sessionVersion, storage: 'indexeddb', ...(stored ? { legacy: stored } : {}) }));
  return stored;
}

export function updateSession(action = null) {
  return navigator.locks.request(sessionKey, async () => {
    const now = Date.now();
    const legacy = fenceLegacy();
    let sessionChanged = false;
    const outcome = await archiveTransaction('readwrite', async (sessions, rounds, frames) => {
      const stored = await read(sessions, primary);
      const source = upgradeSession(stored ?? legacy);
      const session = source ?? newSession(crypto.randomUUID(), now, undefined, undefined, undefined, undefined, groundProfile);
      if (!stored && source) await importLegacy(session, rounds, frames);
      const observe = observeRounds();
      const update = action ? await action(session, now, observe, rounds) : { session: advance(session, now, observe) };
      const next = update.session;
      if (next.id !== session.id) {
        rounds.clear();
        frames.clear();
      } else {
        for (const round of observe.finishedRounds) await syncRound(rounds, frames, session, round, now, observe.entries.get(round.number));
      }
      await syncRound(rounds, frames, next, next.round, now, observe.entries.get(next.round.number));
      sessionChanged = next !== stored;
      if (sessionChanged) sessions.put(next, primary);
      return { ...update, now };
    });
    if (legacy) {
      try { localStorage.setItem(sessionKey, JSON.stringify({ version: sessionVersion, storage: 'indexeddb' })); } catch { /* Keep the migration source if cleanup fails. */ }
    }
    if (sessionChanged) changes?.postMessage(null);
    return outcome;
  });
}

export function submitArchivedBet(request) {
  return updateSession(async (session, now, observe, rounds) => {
    const sameSession = request.sessionId === session.id;
    const requestedNumber = Number.isSafeInteger(request.roundNumber) ? request.roundNumber : session.round.number;
    const record = sameSession ? await read(rounds, [session.id, requestedNumber]) : null;
    const previous = loggedBet(record, request);
    if (previous) {
      const current = advance(session, now, observe);
      if (previous.amount !== request.amount || previous.side !== request.side) return { session: current, error: '该请求已有不同的确认记录。' };
      return { session: current, receipt: previous.receipt, error: previous.error, replayed: true };
    }
    const response = placeBet(session, now, request, observe);
    if (sameSession) {
      const target = record ?? newRoundArchive(session, session.round.number, session.round.startedAt);
      const entry = playerEntry(target, request, response, now);
      const pending = observe.entries.get(target.roundNumber) ?? [];
      observe.entries.set(target.roundNumber, [...pending, entry]);
      const beingSynced = target.roundNumber === response.session.round.number || observe.finishedRounds.some((round) => round.number === target.roundNumber);
      if (!beingSynced) {
        target.bet_log.entries.push(entry);
        rounds.put(target);
      }
    }
    return response;
  });
}

export function archivedBetResult(request) {
  return archiveTransaction('readonly', async (_sessions, rounds) => {
    const key = [request.sessionId, request.roundNumber];
    return loggedBet(await read(rounds, key), request);
  });
}

export function resetSession() {
  return updateSession((session, now) => ({ session: newSession(crypto.randomUUID(), now, undefined, undefined, session.nextDurations, undefined, session.nextProfile, session.nextThreshold) }));
}

export function updateTestBalance(request) {
  return updateSession((session, now, observe) => adjustTestBalance(advance(session, now, observe), request));
}

export function archiveRoundNumbers(sessionId) {
  return archiveTransaction('readonly', async (_sessions, rounds) => {
    const keys = await requestResult(rounds.getAllKeys(prefixRange(sessionId)));
    return keys.map(([, number]) => number);
  });
}

export function exportArchivedRound(sessionId, roundNumber) {
  return archiveTransaction('readonly', async (_sessions, rounds, frames) => {
    const record = await read(rounds, [sessionId, roundNumber]);
    if (!record) return null;
    const deltas = record.log ? await requestResult(frames.getAll(prefixRange(sessionId, roundNumber))) : [];
    return betDataReport(record, deltas);
  });
}
