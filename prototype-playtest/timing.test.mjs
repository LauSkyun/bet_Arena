import assert from 'node:assert/strict';
import { test } from 'node:test';
import { damageTiebreakRules, replayFor } from './battle.mjs';
import { advance, newSession, placeBet, saveRoundDurations, timeline, view } from './round.mjs';
import { battleDataFor } from './battle-data.mjs';
import { legacyReference, maxReferenceThreshold } from './betting.mjs';
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

test('a threshold edit applies on rollover only, including after restore of a v12 round', () => {
  const start = newGame();
  assert.equal(start.round.threshold, 100);
  const saved = saveRoundDurations(start, 0, 60, 40, undefined, 25).session;
  for (const amount of [0, -1, 1.5, NaN, Infinity]) {
    assert.equal(saveRoundDurations(saved, 0, 60, 40, undefined, amount).session, saved);
  }
  const ticket = { sessionId: saved.id, roundNumber: 1, requestId: 'a', side: 'red', amount: 99 };
  const first = placeBet(saved, 1, ticket);
  assert.equal(first.receipt.effects.length, 0);
  const paid = placeBet(first.session, 2, { ...ticket, requestId: 'b', amount: 201 });
  assert.equal(paid.receipt.effects.length, 3);
  const sealed = advance(paid.session, timeline(paid.session.round).lock);
  const next = advance(JSON.parse(JSON.stringify(sealed)), timeline(sealed.round).next);
  assert.equal(next.previous.battleData.threshold, 100);
  assert.equal(next.round.threshold, 25);
  assert.equal(placeBet(next, next.round.startedAt, { ...ticket, roundNumber: 2, amount: 50 }).receipt.effects.length, 2);
  const legacy = { ...start, version: 12 };
  delete legacy.round.threshold;
  delete legacy.nextThreshold;
  const restored = upgradeSession(legacy);
  assert.equal(placeBet(restored, 1, { ...ticket, amount: 10 }).receipt.effects.length, 1);
  assert.equal(advance(restored, timeline(restored.round).next).round.threshold, 100);
});


test('legacy default contributions stay frozen through settlement and the next round uses the saved threshold', () => {
  const original = newSession('reference-migration', 0, undefined, 0);
  const legacy = { ...original, version: 18, reference: legacyReference, nextThreshold: 35 };
  delete legacy.round.reference;
  const inProgress = advance(legacy, 4_000);
  const recovered = upgradeSession(JSON.parse(JSON.stringify(inProgress)));
  const observed = [];
  const observe = { reference: (_, event) => observed.push(event.amount), finished() {} };
  const sealed = advance(recovered, 60_000, observe);
  assert.deepEqual(observed, [10]);
  assert.deepEqual(battleDataFor(sealed.round).reference.map(({ amount }) => amount), [10, 10]);
  const nextAt = timeline(sealed.round).next;
  const next = advance(sealed, nextAt + 8_000, observe);
  assert.deepEqual(next.previous.battleData.reference.map(({ amount }) => amount), [10, 10]);
  assert.deepEqual(next.round.reference.map(({ amount }) => amount), [35, 35]);
  assert.deepEqual(observed, [10, 35, 35]);
  for (const team of Object.values(next.round.teams)) {
    assert.equal(team.system, 35);
    assert.equal(team.roster.barracks.length, 1);
  }
  assert.equal(next.balance, 10_000);
});

test('saving a new contribution preserves this round and an event at cutoff is excluded', () => {
  const start = newSession('next-reference', 0, undefined, 0);
  const saved = saveRoundDurations(start, 0, 8, 5, undefined, 25).session;
  assert.equal(saveRoundDurations(start, 0, 8, 5, undefined, maxReferenceThreshold + 1).session, start);
  const current = advance(saved, 8_000);
  assert.deepEqual(Object.values(current.round.teams).map(({ system }) => system), [100, 100]);
  const nextAt = timeline(advance(current, 60_000).round).next;
  const next = advance(advance(current, 60_000), nextAt + 8_000);
  assert.deepEqual(Object.values(next.round.teams).map(({ system }) => system), [25, 0]);
  assert.equal(next.round.snapshot.battle.red.barracks.length, 1);
  assert.equal(next.round.snapshot.battle.blue.barracks.length, 0);
});
