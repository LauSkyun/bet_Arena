import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settlePlayerPool } from './settlement-pool.mjs';

test('two accounts bet 100 each: winner takes principal plus loser pool minus 5%', () => {
  const { byUid, detail } = settlePlayerPool([{ uid: 'a', red: 100, blue: 0 }, { uid: 'b', red: 0, blue: 100 }], 'red');
  assert.equal(byUid.get('a'), 195);
  assert.equal(byUid.get('b'), 0);
  assert.deepEqual(detail, { red: 100, blue: 100, winnerPool: 100, loserPool: 100, rake: 5, distributable: 95 });
});

test('one account bets both sides: both sides funded settles normally, net -5', () => {
  const { byUid } = settlePlayerPool([{ uid: 'solo', red: 100, blue: 100 }], 'red');
  assert.equal(byUid.get('solo'), 195);
  const staked = 100 + 100;
  assert.equal(byUid.get('solo') - staked, -5);
});

test('single side with system reference on the other side refunds in full', () => {
  const { byUid, detail } = settlePlayerPool([{ uid: 'solo', red: 100, blue: 0 }], 'red');
  assert.equal(byUid.get('solo'), 100);
  assert.equal(detail.rake, 0);
});

test('draw and void refund every confirmed stake', () => {
  for (const winner of ['draw', 'void']) {
    const { byUid } = settlePlayerPool([{ uid: 'a', red: 30, blue: 20 }, { uid: 'b', red: 0, blue: 50 }], winner);
    assert.equal(byUid.get('a'), 50);
    assert.equal(byUid.get('b'), 50);
  }
});

test('non-divisible split conserves total and orders remainders by size then confirm order', () => {
  // winner pool red = 300 (100/100/100); loser pool blue = 100 -> rake 5, distributable 95.
  const accounts = [
    { uid: 'a', red: 100, blue: 0 },
    { uid: 'b', red: 100, blue: 0 },
    { uid: 'c', red: 100, blue: 0 },
    { uid: 'd', red: 0, blue: 100 },
  ];
  const { byUid, detail } = settlePlayerPool(accounts, 'red');
  assert.equal(detail.rake, 5);
  assert.equal(detail.distributable, 95);
  // each base floor(95*100/300)=31 -> 93, leftover 2 -> a,b get +1 by confirm order (equal remainders)
  assert.deepEqual([byUid.get('a'), byUid.get('b'), byUid.get('c')], [132, 132, 131]);
  const credits = [...byUid.values()].reduce((sum, c) => sum + c, 0);
  assert.equal(credits + detail.rake, 400);
});

test('remainder favors larger fraction before earlier confirm order', () => {
  // winner pool red = 3; loser pool blue = 2 -> rake 0, distributable 2.
  // shares: a 2*1/3 floor0 rem2 ; b 2*2/3 floor1 rem1 -> leftover 1 goes to a (larger remainder).
  const accounts = [{ uid: 'a', red: 1, blue: 0 }, { uid: 'b', red: 2, blue: 0 }, { uid: 'c', red: 0, blue: 2 }];
  const { byUid } = settlePlayerPool(accounts, 'red');
  // a: principal 1 + base 0 + largest-remainder bonus 1 = 2; b: principal 2 + base 1 = 3.
  assert.deepEqual([byUid.get('a'), byUid.get('b')], [2, 3]);
});

test('rake rounds down', () => {
  // loser pool 3 -> floor(3*5/100)=0
  const { detail } = settlePlayerPool([{ uid: 'a', red: 7, blue: 0 }, { uid: 'b', red: 0, blue: 3 }], 'red');
  assert.equal(detail.rake, 0);
  assert.equal(detail.distributable, 3);
});


test('refund detail keeps refund amount with zero principal and share', () => {
  // mirror settlement.mjs pool-detail assembly for a single-side refund
  const accounts = [{ uid: 'solo', red: 100, blue: 0 }];
  for (const winner of ['red', 'draw']) {
    const { byUid, detail } = settlePlayerPool(accounts, winner);
    const credit = byUid.get('solo');
    const refunded = winner === 'draw' || detail.winnerPool === 0 || detail.loserPool === 0;
    const principal = refunded ? 0 : accounts[0][winner];
    const share = refunded ? 0 : Math.max(0, credit - principal);
    const refund = refunded ? credit : 0;
    assert.equal(refund, 100);
    assert.equal(principal, 0);
    assert.equal(share, 0);
  }
});

test('pool rates use player stakes only and go null on a single side', () => {
  const both = { red: { player: 100 }, blue: { player: 100 } };
  // poolRatesFor is imported lazily below to keep the pure-module contract clear
  return import('./settlement-pool.mjs').then(({ poolRatesFor, poolPending }) => {
    assert.deepEqual(poolRatesFor(both), { red: 195, blue: 195 });
    assert.equal(poolPending(both), false);
    const one = { red: { player: 100 }, blue: { player: 0 } };
    assert.deepEqual(poolRatesFor(one), { red: null, blue: null });
    assert.equal(poolPending(one), true);
  });
});
