import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, newSession, placeBet, timeline } from './round.mjs';
import { returnsFor, winningCredit } from './returns.mjs';

const rate = (red, blue) => returnsFor({ red: { total: red }, blue: { total: blue } });

test('reference sample, empty teams, lower bound and integer rounding', () => {
  assert.deepEqual(rate(350, 70), { red: 110, blue: 460 });
  assert.deepEqual(rate(0, 0), { red: null, blue: null });
  assert.deepEqual(rate(30, 0), { red: 163, blue: null });
  assert.deepEqual(rate(191, 61), { red: 110, blue: 335 });
  assert.equal(winningCredit(3, 163), 4);
  assert.equal(winningCredit(0, null), 0);
});

test('rates include reference bets, then stay fixed across storage, deadline and result', () => {
  const start = newSession('rate-test', 0, [
    { side: 'red', elapsed: 4_000, amount: 10 },
    { side: 'blue', elapsed: 8_000, amount: 10 },
    { side: 'red', elapsed: 60_000, amount: 500 },
  ], 3);
  const request = (side, amount) => ({ sessionId: start.id, roundNumber: 1, side, amount, requestId: side });
  const a = placeBet(start, 1000, request('red', 100)).session;
  const b = placeBet(a, 2000, request('blue', 500)).session;
  assert.deepEqual(returnsFor(b.round.teams), { red: 448, blue: 110 });
  const time = timeline(b.round);
  const locked = advance(b, time.lock);
  assert.deepEqual(locked.round.snapshot.rates, { red: 420, blue: 110 });
  assert.deepEqual(locked.round.snapshot.stakes, { red: 100, blue: 500 });
  assert.deepEqual([locked.round.snapshot.teams.red.total, locked.round.snapshot.teams.blue.total], [110, 510]);
  const finish = timeline(locked.round).finish;
  const restored = JSON.parse(JSON.stringify(locked));
  assert.equal(placeBet(restored, time.battle, request('blue', 500)).replayed, true);
  assert.deepEqual(advance(restored, finish).round.result.rates, locked.round.snapshot.rates);
  const settled = advance(restored, finish);
  assert.equal(advance(settled, finish + 1), settled);
});
