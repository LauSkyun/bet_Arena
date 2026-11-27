import { returnsFor } from './returns.mjs';
import { playerPoolRules, poolRatesFor } from './settlement-pool.mjs';
import { battleLoadout, enhanceRoster, isRosterFull, newRoster } from './roster.mjs';

export const betting = Object.freeze({ initialBalance: 10_000, threshold: 100 });
export const legacyReference = Object.freeze([
  Object.freeze({ elapsed: 4_000, side: 'red', amount: 10 }),
  Object.freeze({ elapsed: 8_000, side: 'blue', amount: 10 }),
]);
export function referenceForRound(round, fallback = legacyReference) {
  return round.reference ?? fallback;
}

// Keep percentage arithmetic exact even while only one side has received its system contribution.
export const maxReferenceThreshold = Math.floor(Number.MAX_SAFE_INTEGER / 280);

export function defaultRoundReference(threshold) {
  const amount = threshold <= maxReferenceThreshold ? threshold : legacyReference[0].amount;
  return legacyReference.map((event) => ({ ...event, amount }));
}

export function isLegacyReference(reference) {
  return reference?.length === legacyReference.length && reference.every((event, index) => {
    const original = legacyReference[index];
    return event.side === original.side && event.elapsed === original.elapsed && event.amount === original.amount;
  });
}

export const sides = Object.freeze(['red', 'blue']);

const emptyTeam = (side, seed) => ({ total: 0, player: 0, system: 0, roster: newRoster(side, seed) });
export function initialBetting(redSeed, blueSeed) {
  const teams = { red: emptyTeam('red', redSeed), blue: emptyTeam('blue', blueSeed) };
  return { teams, receipts: [], referenceIndex: 0, lastEffects: [], snapshot: null };
}

export function isFull(team, board) {
  return isRosterFull(team.roster, board);
}

function invest(round, side, amount, source) {
  const team = round.teams[side];
  const total = team.total + amount;
  let roster = team.roster;
  const effects = [];
  const lastStep = Math.floor(total / round.threshold);
  for (let step = Math.floor(team.total / round.threshold) + 1; step <= lastStep; step++) {
    const result = enhanceRoster(roster, round.board, round.profile);
    roster = result.roster;
    effects.push({ side, level: step, label: result.label, at: result.at ?? null, kind: result.kind ?? null });
    if (result.kind == null) {
      effects.at(-1).count = lastStep - step + 1;
      break;
    }
  }
  return {
    ...round,
    teams: { ...round.teams, [side]: { ...team, total, [source]: team[source] + amount, roster } },
    lastEffects: effects,
  };
}

// 把系统参照事件与额外事件（如 GM 陪练）合并成按计划时点排序的单一事件流。
// 两类事件都走 invest，强化等级归属只取决于 invest 的先后顺序；连续推进与补跑因此一致。
// extraEvents: [{ requestId, side, amount, elapsedMs }]；observeExtra(updatedRound, event) 供调用方落库回执。
export function advanceBetting(round, reference, lockAt, now, observeReference, extraEvents = [], observeExtra) {
  if (round.snapshot) return round;
  let updated = round;
  const system = reference.slice(updated.referenceIndex).map((event, offset) => ({
    elapsed: event.elapsed, side: event.side, amount: event.amount,
    source: 'system', refIndex: updated.referenceIndex + offset, event,
  }));
  const extra = extraEvents.map((event) => ({
    elapsed: event.elapsedMs, side: event.side, amount: event.amount,
    source: 'player', requestId: event.requestId, event,
  }));
  const timeline = [...system, ...extra].sort((a, b) => {
    if (a.elapsed !== b.elapsed) return a.elapsed - b.elapsed;
    if (a.source !== b.source) return a.source === 'system' ? -1 : 1;
    return a.source === 'system' ? a.refIndex - b.refIndex : String(a.requestId).localeCompare(String(b.requestId));
  });
  for (const item of timeline) {
    const at = round.startedAt + item.elapsed;
    if (at > now || at >= lockAt) break;
    if (item.source === 'player') {
      // 与真人在 arena.bet 相同的公共总投闸门。
      const total = updated.teams.red.total + updated.teams.blue.total;
      if (item.amount > maxReferenceThreshold - total) continue;
    }
    updated = invest(updated, item.side, item.amount, item.source);
    if (item.source === 'system') {
      updated = { ...updated, referenceIndex: item.refIndex + 1 };
      observeReference?.(updated, item.event, updated.referenceIndex);
    } else {
      observeExtra?.(updated, item.event);
    }
  }
  if (now < lockAt) return updated;
  const snapshot = {
    roundNumber: updated.number,
    stakes: stakesFor(updated.teams),
    rates: updated.settlementRules === playerPoolRules ? poolRatesFor(updated.teams) : returnsFor(updated.teams),
    teams: updated.teams,
    battle: { red: battleLoadout(updated.teams.red.roster, updated.board, updated.combatRules), blue: battleLoadout(updated.teams.blue.roster, updated.board, updated.combatRules) },
    receipts: updated.receipts,
    lockedAt: lockAt,
    ...(updated.settlementRules === undefined ? {} : { settlementRules: updated.settlementRules }),
  };
  return { ...updated, snapshot };
}

export const stakesFor = (teams) => ({ red: teams.red.player, blue: teams.blue.player });

export function checkBet(session, side, amount) {
  if (!sides.includes(side)) return '请选择有效的队伍。';
  if (!Number.isSafeInteger(amount) || amount <= 0) return '请输入正整数点数。';
  if (session.balance < amount) return '测试积分不足。';
  return null;
}

export function findReceipt(session, { sessionId, roundNumber, requestId }) {
  if (session.id !== sessionId) return null;
  const receipts = session.round.number === roundNumber ? session.round.receipts
    : session.previous?.round === roundNumber ? session.previous.receipts : [];
  return receipts.find((receipt) => receipt.requestId === requestId) ?? null;
}

export function confirmBet(session, now, request) {
  const { side, amount, requestId } = request;
  const seen = findReceipt(session, request);
  if (seen) {
    if (seen.amount !== amount || seen.side !== side) return { session, error: '该请求已有不同的确认记录。' };
    return { session, receipt: seen, replayed: true };
  }
  if (session.id !== request.sessionId || session.round.number !== request.roundNumber || session.round.snapshot) {
    return { session, error: '本轮下注已截止，积分未扣除。' };
  }
  if (typeof requestId !== 'string' || !requestId) return { session, error: '提交记录无法识别，积分未扣除。' };
  const error = checkBet(session, side, amount);
  if (error) return { session, error };
  const updated = invest(session.round, side, amount, 'player');
  const receipt = { requestId, side, amount, confirmedAt: now, effects: updated.lastEffects };
  const round = { ...updated, receipts: [...updated.receipts, receipt] };
  return { session: { ...session, balance: session.balance - amount, round }, receipt };
}
