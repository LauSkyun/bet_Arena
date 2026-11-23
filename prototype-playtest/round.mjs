import { battleDataFor } from './battle-data.mjs';
import { currentBoard } from './roster.mjs';
import { defaultDurations, durationsFromSeconds, secondsLimit } from './timing.mjs';
import { settleSession } from './settlement.mjs';
import { baseVictoryRules, currentCombatRules, replayFor } from './battle.mjs';
import { betting, initialBetting, defaultReference, advanceBetting, confirmBet } from './betting.mjs';

export const sessionVersion = 8;

const lockMs = 2_000;
const resultMs = 5_000;
const catchUpBatch = 32;

export function newSession(id, now, reference = defaultReference, seed = crypto.getRandomValues(new Uint32Array(1))[0], durations = defaultDurations, board = currentBoard) {
  return { version: sessionVersion, id, seed, reference, nextDurations: durations, balance: betting.initialBalance,
    round: newRound(1, now, seed, durations, board), previous: null };
}

function seedFor(seed, number, side) {
  let value = (seed ^ Math.imul(number, 0x9e3779b1) ^ side) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function newRound(number, startedAt, seed, durations, board = currentBoard) {
  return {
    number,
    board,
    combatRules: currentCombatRules,
    startedAt,
    durations,
    ...initialBetting(seedFor(seed, number, 0), seedFor(seed, number, 1)),
    result: null,
  };
}

function replayForRound(round) {
  return replayFor(round.snapshot.battle, round.durations.battleMs, round.board, round.combatRules);
}

export function timeline(round) {
  const lock = round.startedAt + round.durations.betMs;
  const battle = lock + lockMs;
  const earlyEnd = round.combatRules >= baseVictoryRules && round.snapshot
    ? round.result?.endedAtMs ?? replayForRound(round).result.endedAtMs : undefined;
  const finish = battle + (earlyEnd ?? round.durations.battleMs);
  return { lock, battle, finish, next: finish + resultMs };
}

export function advance(session, now) {
  let lastFinished = null;
  for (let processed = 0; processed < catchUpBatch; processed++) {
    const round = session.round;
    const lock = round.startedAt + round.durations.betMs;
    const sealed = advanceBetting(round, session.reference, lock, now);
    if (sealed !== round) session = { ...session, round: sealed };
    if (now < lock + lockMs) break;
    const time = timeline(sealed);
    if (now < time.finish) break;

    if (!sealed.result) session = settleSession(session, replayForRound(sealed).result, time.finish, now);
    if (now < time.next) break;

    lastFinished = session.round;
    session = { ...session, round: newRound(sealed.number + 1, time.next, session.seed, session.nextDurations) };
  }
  if (!lastFinished) return session;
  const previous = { ...lastFinished.result, battleData: battleDataFor(lastFinished, session.reference) };
  return { ...session, previous };
}

export function view(session, now) {
  const { round } = session;
  const time = timeline(round);
  if (round.result) return { phase: 'result', remainingMs: Math.max(0, time.next - now) };
  if (now < time.lock) return { phase: 'bet', remainingMs: time.lock - now };
  if (now < time.battle) return { phase: 'lock', remainingMs: time.battle - now };
  if (now < time.finish) {
    const elapsedMs = now - time.battle;
    return { phase: 'battle', remainingMs: round.durations.battleMs - elapsedMs, elapsedMs, progress: elapsedMs / round.durations.battleMs };
  }
  return { phase: 'settling', remainingMs: 0 };
}

export function placeBet(session, now, request) {
  const current = advance(session, now);
  if (!current.round.snapshot && now >= current.round.startedAt + current.round.durations.betMs) {
    return { session: current, error: '正在恢复轮次，请稍后下注。' };
  }
  return confirmBet(current, now, request);
}

export function saveRoundDurations(session, now, betSeconds, battleSeconds) {
  const current = advance(session, now);
  if (now >= timeline(current.round).next) return { session: current, error: '正在恢复轮次，请稍后保存。' };
  const durations = durationsFromSeconds(betSeconds, battleSeconds);
  if (!durations) return { session: current, error: `下注和战斗时长均须为 1–${secondsLimit} 秒的整数。` };
  return { session: { ...current, nextDurations: durations } };
}
