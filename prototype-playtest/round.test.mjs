import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findReceipt, stakesFor } from './betting.mjs';
import { advance, newSession, placeBet, timeline, view } from './round.mjs';

const start = 1_000_000;
const fresh = (reference = []) => newSession('session-a', start, reference, 73);
const request = (session, id, side = 'red', amount = 10) => ({ sessionId: session.id, roundNumber: session.round.number, requestId: id, side, amount });
const place = (session, id, side = 'red', amount = 10, now = start) => placeBet(session, now, request(session, id, side, amount));

test('phases retain a single timeline and results wait for settlement confirmation', () => {
  let session = fresh();
  const time = timeline(session.round);
  for (const [at, phase] of [
    [start, 'bet'], [time.lock - 1, 'bet'], [time.lock, 'lock'], [time.battle, 'battle'],
    [time.finish, 'result'],
    [time.next - 1, 'result'], [time.next, 'bet'],
  ]) {
    session = advance(session, at);
    assert.equal(view(session, at).phase, phase);
  }
  assert.equal(session.round.number, 2);
  assert.equal(session.balance, 10000);
  assert.equal(session.previous.net, 0);
});

test('same round accepts both teams and rejects only invalid points or insufficient balance', () => {
  const first = place(fresh(), 'first', 'red', 100).session;
  assert.equal(first.balance, 9900);
  const second = place(first, 'second', 'blue', 500).session;
  assert.equal(second.balance, 9400);
  assert.deepEqual(stakesFor(second.round.teams), { red: 100, blue: 500 });
  for (const [id, side, amount] of [['bad-side', 'other', 10], ['over', 'red', 9401], ['zero', 'red', 0], ['negative', 'red', -10], ['fraction', 'red', 1.25]]) {
    const rejected = place(second, id, side, amount);
    assert.ok(rejected.error);
    assert.equal(rejected.session, second);
  }
  const all = place(second, 'remainder', 'red', 9400).session;
  assert.equal(all.balance, 0);
  assert.deepEqual(stakesFor(all.round.teams), { red: 9500, blue: 500 });
  assert.match(place(all, 'empty', 'blue', 1).error, /不足/);
});

test('one request id is charged once and a conflicting resubmission cannot change the receipt', () => {
  const session = fresh();
  const ticket = request(session, 'idempotent');
  const first = placeBet(session, start, ticket);
  const stored = JSON.parse(JSON.stringify(first.session));
  const duplicate = placeBet(stored, start + 1, ticket);
  assert.equal(duplicate.replayed, true);
  assert.deepEqual(duplicate.receipt, first.receipt);
  assert.equal(duplicate.session.round.teams.red.total, 10);
  assert.equal(duplicate.session.balance, 9990);
  assert.ok(placeBet(stored, start + 1, { ...ticket, amount: 20 }).error);
});

test('several thresholds apply in order, using the layout left by each effect', () => {
  const session = fresh();
  const once = place(session, 'once', 'red', 30);
  assert.deepEqual(once.receipt.effects.map((effect) => effect.level), [1, 2, 3]);
  assert.ok(once.session.round.teams.red.roster.barracks.length >= 1);
  const split = place(place(session, 'first').session, 'second', 'red', 20);
  assert.deepEqual(split.session.round.teams, once.session.round.teams);
  assert.equal(split.session.balance, once.session.balance);
});

test('scheduled red and blue reference bets apply once and share the player threshold', () => {
  let session = newSession('session-a', start);
  assert.equal(advance(session, start + 3999).round.teams.red.total, 0);
  session = advance(session, start + 4000);
  assert.equal(session.round.teams.red.system, 10);
  assert.equal(session.balance, 10000);
  const player = place(session, 'contribution', 'red', 10, start + 5000);
  assert.equal(player.receipt.effects[0].level, 2);
  session = advance(player.session, start + 8000);
  const { total, player: points, system } = session.round.teams.red;
  assert.deepEqual({ total, points, system }, { total: 20, points: 10, system: 10 });
  assert.equal(session.round.teams.blue.system, 10);
  assert.equal(session.balance, 9990);
  assert.equal(advance(session, start + 8200), session);
});

test('late acknowledgment recovers the original receipt and cannot change the sealed snapshot', () => {
  const session = fresh();
  const time = timeline(session.round);
  const ticket = request(session, 'at-edge', 'red', 20);
  const confirmed = placeBet(session, time.lock - 1, ticket);
  const locked = advance(confirmed.session, time.lock);
  const snapshot = locked.round.snapshot;
  const restored = JSON.parse(JSON.stringify(locked));
  const late = placeBet(restored, time.battle, ticket);
  assert.equal(late.replayed, true);
  assert.equal(late.receipt.confirmedAt, time.lock - 1);
  assert.deepEqual(findReceipt(restored, ticket), late.receipt);
  assert.deepEqual(late.session.round.snapshot, snapshot);
  assert.deepEqual(snapshot.stakes, { red: 20, blue: 0 });
  assert.equal(snapshot.battle.red.barracks.length, snapshot.teams.red.roster.barracks.length);
  assert.equal(snapshot.battle.red.startingUnits.length, 3);
  const rejected = place(locked, 'late', 'red', 10, time.lock);
  assert.ok(rejected.error);
  assert.equal(rejected.session, locked);
});

test('older and reset-session requests never debit the current round', () => {
  const session = fresh();
  const time = timeline(session.round);
  const ticket = request(session, 'stale');
  const stale = placeBet(session, time.next, ticket);
  assert.ok(stale.error);
  assert.equal(stale.session.round.number, 2);
  assert.equal(stale.session.balance, 10000);
  const reset = newSession('session-b', start, [], 73);
  assert.equal(placeBet(reset, start, ticket).session, reset);
});

test('snapshot settles exactly once and next round resets betting records', () => {
  const invested = place(newSession('session-a', start, [], 3), 'win', 'red', 30).session;
  const time = timeline(invested.round);
  let session = advance(invested, time.finish);
  assert.equal(session.balance, 10018);
  assert.equal(session.round.result.net, 18);
  session = JSON.parse(JSON.stringify(session));
  assert.equal(advance(session, time.finish + 1).balance, 10018);
  session = advance(session, time.next);
  assert.equal(session.balance, 10018);
  assert.deepEqual(stakesFor(session.round.teams), { red: 0, blue: 0 });
  assert.equal(session.round.snapshot, null);
  assert.deepEqual(session.round.receipts, []);
  assert.equal(findReceipt(session, request(invested, 'win')).amount, 30);
});

test('catch-up freezes the right round and credit persists across rounds without player input', () => {
  const first = place(newSession('session-a', start, undefined, 73), 'win', 'red', 10).session;
  const time = timeline(first.round);
  const at = start + 7 * (time.next - start) + (time.battle - start) + 3140;
  const resumed = advance(JSON.parse(JSON.stringify(first)), at);
  assert.equal(resumed.balance, advance(first, time.finish).balance);
  assert.equal(resumed.round.number, 8);
  assert.equal(resumed.previous.round, 7);
  assert.equal(resumed.round.snapshot.teams.red.system, 10);
  assert.equal(resumed.round.snapshot.teams.blue.system, 10);
  assert.equal(view(resumed, at).remainingMs, 36_860);
});
