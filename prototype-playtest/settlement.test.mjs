import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleSession } from './settlement.mjs';
import { advance, newSession, placeBet, timeline, view } from './round.mjs';

const at = 47_000;
const startingState = (support = 'red', stake = 30) => ({
  balance: 100 - stake,
  round: { number: 1, result: null, snapshot: { roundNumber: 1, stakes: { red: support === 'red' ? stake : 0, blue: support === 'blue' ? stake : 0 }, rates: { red: 163, blue: null }, receipts: [] } },
});

for (const [name, winner, support, stake, credit, balance] of [
  ['win', 'red', 'red', 30, 48, 118],
  ['loss', 'blue', 'red', 30, 0, 70],
  ['draw', 'draw', 'red', 30, 30, 100],
  ['void', 'void', 'red', 30, 30, 100],
  ['spectator', 'red', null, 0, 0, 100],
]) {
  test(`${name} settles after the round, returns the required result fields and is idempotent`, () => {
    const scores = winner === 'void' ? null : winner === 'draw' ? { red: 15, blue: 15 }
      : winner === 'red' ? { red: 16, blue: 15 } : { red: 15, blue: 16 };
    const session = startingState(support, stake);
    assert.equal(settleSession(session, { winner, scores }, at, at - 1), session);
    const settled = settleSession(session, { winner, scores }, at, at);
    assert.equal(settled.balance, balance);
    assert.deepEqual(settled.round.result, {
      round: 1, status: 'settled', winner, scores, stakes: { red: support === 'red' ? stake : 0, blue: support === 'blue' ? stake : 0 }, stake,
        rates: { red: 163, blue: null }, credit, net: credit - stake, balanceAfter: balance, settledAt: at, receipts: [],
    });
    const loaded = JSON.parse(JSON.stringify(settled));
    assert.equal(settleSession(loaded, { winner, scores }, at, at + 1000), loaded);
  });
}

test('two confirmed contributions settle from the sealed amount when returning after playback', () => {
  const start = newSession('two-bets', 0, [], 3);
  const ticket = { sessionId: start.id, roundNumber: 1, side: 'red' };
  const first = placeBet(start, 1, { ...ticket, requestId: 'first', amount: 10 }).session;
  const second = placeBet(first, 2, { ...ticket, requestId: 'second', amount: 20 }).session;
  const time = timeline(second.round);
  const beforeFinish = advance(second, time.finish - 1);
  assert.equal(beforeFinish.balance, 9970);
  assert.equal(beforeFinish.round.result, null);
  const restored = advance(JSON.parse(JSON.stringify(beforeFinish)), time.finish + 2000);
  assert.equal(view(restored, time.finish + 2000).remainingMs, 3000);
  assert.equal(restored.round.result.winner, 'red');
  assert.equal(restored.round.result.stake, 30);
  assert.equal(restored.round.result.credit, 48);
  assert.equal(restored.balance, 10018);
  const next = advance(restored, time.next);
  assert.equal(next.round.number, 2);
  assert.equal(next.balance, 10018);
  assert.equal(next.previous.balanceAfter, 10018);
  assert.equal(next.round.teams.red.player, 0);
});

test('settlement uses only the winning side of two stakes or refunds both on draw', () => {
  const state = { balance: 9400, round: { result: null, snapshot: { roundNumber: 1, stakes: { red: 100, blue: 500 }, rates: { red: 448, blue: 110 }, receipts: [] } } };
  const red = settleSession(state, { winner: 'red', scores: { red: 25, blue: 20 } }, at, at);
  const blue = settleSession(state, { winner: 'blue', scores: { red: 20, blue: 25 } }, at, at);
  const draw = settleSession(state, { winner: 'draw', scores: { red: 20, blue: 20 } }, at, at);
  assert.deepEqual([red.balance, blue.balance, draw.balance], [9848, 9950, 10000]);
  assert.deepEqual([red.round.result.net, blue.round.result.net, draw.round.result.net], [-152, -50, 0]);
});
