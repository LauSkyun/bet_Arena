import { battleFrameDelta } from './battle-log.mjs';
import { battleRules, fireRevisionFor, replayFor } from './battle.mjs';
import { battleDataFor, battleDataReport } from './battle-data.mjs';
import { timeline } from './round.mjs';

export function newRoundArchive(session, roundNumber, startedAt, complete = true) {
  return { sessionId: session.id, roundNumber, startedAt, bet_log: { version: 1, complete, entries: [] }, battle_data: null, log: null };
}

export function recoverBetEntries(receipts = [], reference = [], startedAt = null) {
  return [
    ...receipts.map((receipt) => ({ source: 'player', requestId: receipt.requestId, elapsedMs: startedAt == null ? null : receipt.confirmedAt - startedAt,
      side: receipt.side, amount: receipt.amount, accepted: true, receipt, effects: receipt.effects ?? null })),
    ...reference.map((event, index) => ({ source: 'system', requestId: `system-${index + 1}`, elapsedMs: event.elapsed,
      side: event.side, amount: event.amount, accepted: true, effects: null })),
  ].sort((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0));
}

export function saveBattleSnapshot(record, session, round) {
  if (!round.snapshot || record.battle_data) return;
  const data = battleDataFor(round, session.reference);
  record.battle_data = battleDataReport({ ...data, result: null, seed: session.seed, startedAt: round.startedAt,
    lockedAt: round.snapshot.lockedAt, battleStartedAt: timeline(round).battle }, 'lock', round.durations.betMs);
}

export function recordBattleFrames(record, cutoff, settlement, storeFrame) {
  if (!record.battle_data || cutoff < 0 || record.log?.complete) return false;
  const round = record.battle_data.round;
  const replay = replayFor(round.loadout, round.durations.battleMs, round.board, round.combatRules, fireRevisionFor(round), true);
  const firstRead = !record.log;
  if (firstRead) record.log = {
    format: 'bet-arena/battle_log', version: 1, sessionId: record.sessionId, roundNumber: record.roundNumber,
    board: round.board, combatRules: round.combatRules, fireRevision: round.fireRevision ?? 1,
    initialFrame: replay.frames[0] ?? null, recordedThroughMs: replay.frames[0]?.elapsed ?? null,
    complete: false, result: null, settlement: null,
  };
  const log = record.log;
  // The database stores only subsequent deltas. The initial frame is in the log header.
  let changed = firstRead;
  for (let index = Math.floor((log.recordedThroughMs ?? 0) / battleRules.stepMs) + 1; index < replay.frames.length; index++) {
    const frame = replay.frames[index];
    if (frame.elapsed > cutoff) break;
    const delta = battleFrameDelta(replay.frames[index - 1], frame);
    storeFrame(delta);
    log.recordedThroughMs = frame.elapsed;
    changed = true;
  }
  if (settlement) {
    log.complete = true;
    log.result = replay.result;
    log.settlement = settlement;
    changed = true;
  }
  return changed;
}

export function betDataReport(record, frames) {
  return {
    format: 'bet-arena/bet_data', version: 1, sessionId: record.sessionId, roundNumber: record.roundNumber,
    bet_log: record.bet_log, battle_data: record.battle_data,
    battle_log: record.log ? { ...record.log, frames } : null,
  };
}
