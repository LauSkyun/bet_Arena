import assert from 'node:assert/strict';
import { test } from 'node:test';
import { damageTiebreakRules, replayFor } from './battle.mjs';
import { advance, newSession, placeBet, saveRoundDurations, timeline, view } from './round.mjs';
import { upgradeSession } from './storage.mjs';

const newGame = () => newSession('timing', 0, [], 3);

test('saves a separate next-round configuration and uses the locked timeline and battle duration through settlement', () => {
  const start = newGame();
  start.round.combatRules = damageTiebreakRules;
  const original = { lock: 60_000, battle: 62_000, finish: 102_000, next: 107_000 };
  assert.deepEqual(timeline(start.round), original);
  const request = { sessionId: start.id, roundNumber: 1, side: 'red', amount: 30, requestId: 'before-close' };
  const bet = placeBet(start, 1_000, request).session;
  const saved = saveRoundDurations(bet, 10_000, 12, 18).session;
  const restored = upgradeSession(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(timeline(restored.round), original);
  assert.equal(view(restored, 10_000).remainingMs, 50_000);
  assert.equal(view(advance(restored, 59_999), 59_999).phase, 'bet');
  assert.ok(placeBet(restored, 60_000, { ...request, requestId: 'after-close' }).error);
  const inBattle = advance(restored, 82_000);
  assert.deepEqual(view(inBattle, 82_000), { phase: 'battle', elapsedMs: 20_000, remainingMs: 20_000, progress: 0.5 });
  assert.equal(advance(inBattle, 101_999).round.result, null);
  const result = advance(inBattle, 102_000).round.result;
  assert.deepEqual(result.scores, replayFor(inBattle.round.snapshot.battle, 40_000, inBattle.round.board, inBattle.round.combatRules).result.scores);
  assert.equal(result.settledAt, 102_000);
  const next = advance(restored, 107_000);
  assert.equal(next.round.number, 2);
  assert.deepEqual(timeline(next.round), { lock: 119_000, battle: 121_000, finish: 139_000, next: 144_000 });
  assert.equal(next.balance, result.balanceAfter);
});

test('offline recovery uses the configured span and saving at rollover targets only the next round', () => {
  const saved = saveRoundDurations(newGame(), 1_000, 12, 18).session;
  const recovered = advance(JSON.parse(JSON.stringify(saved)), 107_000 + 4 * 37_000 + 15_000);
  assert.equal(recovered.round.number, 6);
  assert.equal(recovered.round.startedAt, 255_000);
  assert.equal(recovered.previous.round, 5);
  assert.equal(view(recovered, 270_000).remainingMs, 17_000);
  const atBoundary = saveRoundDurations(saved, 107_000, 9, 10).session;
  assert.equal(atBoundary.round.number, 2);
  assert.deepEqual(atBoundary.round.durations, { betMs: 12_000, battleMs: 18_000 });
  assert.deepEqual(advance(atBoundary, 144_000).round.durations, { betMs: 9_000, battleMs: 10_000 });
});

test('invalid input preserves the prior settings and legacy sessions keep current round timestamps', () => {
  const start = newGame();
  for (const [bet, battle] of [[0, 40], [1.5, 40], [60, 301], [60, NaN]]) {
    assert.ok(saveRoundDurations(start, 1_000, bet, battle).error);
    assert.equal(saveRoundDurations(start, 1_000, bet, battle).session, start);
  }
  const legacy = { ...start, version: 3, balance: 9_930 };
  delete legacy.nextDurations;
  legacy.round = { ...legacy.round };
  delete legacy.round.durations;
  const recovered = upgradeSession(legacy);
  assert.deepEqual(timeline(recovered.round), { lock: 20_000, battle: 22_000, finish: 47_000, next: 52_000 });
  const next = advance(recovered, 52_000);
  assert.equal(next.balance, 9_930);
  assert.deepEqual(next.round.durations, { betMs: 60_000, battleMs: 40_000 });
});
