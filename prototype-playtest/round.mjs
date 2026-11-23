import { battleDataFor } from './battle-data.mjs';
import { currentBoard } from './roster.mjs';
import { defaultDurations, durationsFromSeconds, secondsLimit } from './timing.mjs';
import { settleSession } from './settlement.mjs';
import { currentCombatRules, replayFor } from './battle.mjs';
import { betting, initialBetting, defaultReference, advanceBetting, confirmBet } from './betting.mjs';

const lockMs = 2_000;
const resultMs = 5_000;
const roundSpan = ({ betMs, battleMs }) => betMs + lockMs + battleMs + resultMs;

export function newSession(id, now, reference = defaultReference, seed = crypto.getRandomValues(new Uint32Array(1))[0], durations = defaultDurations, board = currentBoard) {
  return { version: 6, id, seed, reference, nextDurations: durations, balance: betting.initialBalance,
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

export function timeline(round) {
  const lock = round.startedAt + round.durations.betMs;
  const battle = lock + lockMs;
  const finish = battle + round.durations.battleMs;
  return { lock, battle, finish, next: finish + resultMs };
}

export function advance(session, now) {
  const time = timeline(session.round);
  const sealed = advanceBetting(session.round, session.reference, time.lock, now);
  if (sealed !== session.round) session = { ...session, round: sealed };
  if (now < time.finish) return session;

  if (!session.round.result) {
    const { result } = replayFor(sealed.snapshot.battle, sealed.durations.battleMs, sealed.board, sealed.combatRules);
    session = settleSession(session, result, time.finish, now);
  }
  if (now < time.next) return session;

  const { round, nextDurations } = session;

  // Any skipped later rounds have no player stake, so they contribute no balance changes.
  const span = roundSpan(nextDurations);
  const skipped = Math.floor((now - time.next) / span);
  const current = newRound(round.number + 1 + skipped, time.next + skipped * span, session.seed, nextDurations);
  const lastSkipped = skipped > 0 ? newRound(current.number - 1, current.startedAt - span, session.seed, nextDurations) : null;
  let lastFinished = round;
  if (lastSkipped) {
    const previousTime = timeline(lastSkipped);
    const previousRound = advanceBetting(lastSkipped, session.reference, previousTime.lock, previousTime.finish);
    const { result } = replayFor(previousRound.snapshot.battle, previousRound.durations.battleMs, previousRound.board, previousRound.combatRules);
    lastFinished = settleSession({ ...session, round: previousRound }, result, previousTime.finish, now).round;
  }
  const previous = { ...lastFinished.result, battleData: battleDataFor(lastFinished, session.reference) };
  const next = { ...session, round: current, previous };
  return advance(next, now);
}

export function view(session, now) {
  const { round } = session;
  const time = timeline(round);
  if (round.result) return { phase: 'result', remainingMs: Math.max(0, time.next - now) };
  if (now < time.lock) return { phase: 'bet', remainingMs: time.lock - now };
  if (now < time.battle) return { phase: 'lock', remainingMs: time.battle - now };
  if (now < time.finish) {
    return { phase: 'battle', remainingMs: time.finish - now, elapsedMs: now - time.battle, progress: (now - time.battle) / round.durations.battleMs };
  }
  return { phase: 'settling', remainingMs: 0 };
}

export function placeBet(session, now, request) {
  return confirmBet(advance(session, now), now, request);
}

export function saveRoundDurations(session, now, betSeconds, battleSeconds) {
  const current = advance(session, now);
  const durations = durationsFromSeconds(betSeconds, battleSeconds);
  if (!durations) return { session: current, error: `下注和战斗时长均须为 1–${secondsLimit} 秒的整数。` };
  return { session: { ...current, nextDurations: durations } };
}
