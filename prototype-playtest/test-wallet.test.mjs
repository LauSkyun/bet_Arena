import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, newSession, placeBet, timeline } from './round.mjs';
import { adjustTestBalance, previewTestBalance } from './test-wallet.mjs';
import { upgradeSession } from './storage.mjs';

const start = () => newSession('wallet', 0, [], 1);
const requestFor = (session, fields = {}) => ({ sessionId: session.id, requestId: 'adjustment', direction: 'add', amount: 200, ...fields });

test('test balance preview and writes use positive safe integers, reject overdrafts and allow zero', () => {
  const startSession = start();
  for (const amount of [0, -10, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(previewTestBalance(startSession, 'add', amount).error);
    const rejected = adjustTestBalance(startSession, requestFor(startSession, { amount }));
    assert.equal(rejected.session, startSession);
    assert.ok(rejected.error);
  }
  assert.ok(previewTestBalance(startSession, 'add', Number.MAX_SAFE_INTEGER).error);
  assert.equal(previewTestBalance(startSession, 'subtract', 10_001).error, '测试积分不足。');
  assert.equal(previewTestBalance(startSession, 'subtract', 10_000).balance, 0);
  assert.equal(adjustTestBalance(startSession, requestFor(startSession, { direction: 'subtract', amount: 10_000 })).session.balance, 0);
  assert.equal(previewTestBalance(startSession, 'add', 200).balance, 10_200);
});

test('successful or insufficient adjustments replay across reload with no change to balance', () => {
  const initial = start();
  const credit = requestFor(initial);
  const accepted = adjustTestBalance(initial, credit);
  assert.equal(accepted.session.balance, 10_200);
  const reloaded = JSON.parse(JSON.stringify(accepted.session));
  const replayed = adjustTestBalance(reloaded, credit);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.session, reloaded);
  assert.equal(replayed.receipt.balanceAfter, 10_200);
  assert.ok(adjustTestBalance(reloaded, { ...credit, amount: 100 }).error);

  const largeDebit = requestFor(reloaded, { requestId: 'too-large', direction: 'subtract', amount: 10_201 });
  const rejected = adjustTestBalance(reloaded, largeDebit);
  assert.equal(rejected.session.balance, 10_200);
  const funded = adjustTestBalance(rejected.session, requestFor(initial, { requestId: 'second-credit' })).session;
  assert.equal(funded.balance, 10_400);
  const retry = adjustTestBalance(funded, largeDebit);
  assert.equal(retry.error, '测试积分不足。');
  assert.equal(retry.session, funded);
  assert.equal(adjustTestBalance({ ...funded, id: 'new-wallet' }, credit).error, '试玩会话已切换，请核对当前余额后重试。');
});

test('wallet adjustment preserves past settlement, sealed snapshot and wager receipts, through migration and next round', () => {
  const initial = start();
  const wager = placeBet(initial, 1, { sessionId: initial.id, roundNumber: 1, side: 'red', amount: 200, requestId: 'stake' }).session;
  const locked = advance(wager, timeline(wager.round).lock);
  const migrated = upgradeSession({ ...locked, version: 16 });
  assert.equal(migrated.round, locked.round);
  const topUp = adjustTestBalance(migrated, requestFor(migrated));
  assert.equal(topUp.session.balance, 10_000);
  assert.equal(topUp.session.round, locked.round);
  const finishedAt = timeline(locked.round).finish;
  const baseline = advance(locked, finishedAt);
  const settled = advance(topUp.session, finishedAt);
  assert.deepEqual(settled.round.result, { ...baseline.round.result, balanceAfter: baseline.balance + 200 });

  const next = advance(settled, timeline(settled.round).next);
  const updated = adjustTestBalance(next, requestFor(next, { requestId: 'second', direction: 'subtract', amount: 10 })).session;
  assert.equal(updated.balance, next.balance - 10);
  assert.equal(updated.previous, next.previous);
  assert.equal(updated.round, next.round);
  assert.equal(adjustTestBalance(updated, requestFor(updated)).session, updated);
});
