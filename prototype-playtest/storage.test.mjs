import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, newSession, placeBet, timeline } from './round.mjs';
import { upgradeSession } from './storage.mjs';
import { legacyDurations } from './timing.mjs';
import { legacyBoard } from './roster.mjs';

test('legacy active and settled records preserve balance, sealed stakes and receipts on migration', () => {
  const session = newSession('legacy', 0, [], 3, legacyDurations);
  session.round.board = legacyBoard;
  const bet = placeBet(session, 1, { sessionId: 'legacy', roundNumber: 1, side: 'red', amount: 30, requestId: 'paid' }).session;
  const time = timeline(bet.round);
  const active = advance(bet, time.lock);
  const finished = advance(active, time.finish);
  for (const current of [active, finished]) {
    const legacy = structuredClone(current);
    legacy.version = 1;
    legacy.balance -= 9900;
    const snapshot = legacy.round.snapshot;
    delete snapshot.stakes;
    delete snapshot.rates;
    snapshot.support = 'red'; snapshot.stake = 30;
    if (legacy.round.result) {
      delete legacy.round.result.stakes;
      legacy.round.result.support = 'red';
      delete legacy.round.result.rates;
      legacy.round.result.credit = 60;
      legacy.round.result.net = 30;
      legacy.round.result.balanceAfter = 130;
      legacy.balance = 130;
    }
    const restored = upgradeSession(legacy);
    assert.equal(restored.balance, legacy.balance);
    assert.deepEqual(restored.round.snapshot.stakes, { red: 30, blue: 0 });
    assert.deepEqual(restored.round.receipts, legacy.round.receipts);
    assert.equal(advance(restored, time.finish).balance, 130);
  }
});

test('v2 sealed round honors its former multiplier while an open round locks the new rate', () => {
  const session = newSession('legacy-v2', 0, [], 3, legacyDurations);
  session.round.board = legacyBoard;
  const wager = placeBet(session, 1, { sessionId: session.id, roundNumber: 1, side: 'red', amount: 30, requestId: 'paid' }).session;
  const time = timeline(wager.round);
  const sealed = structuredClone(advance(wager, time.lock));
  sealed.version = 2;
  delete sealed.round.snapshot.rates;
  const recovered = upgradeSession(sealed);
  assert.equal(recovered.balance, 9970);
  assert.deepEqual(recovered.round.snapshot.rates, { red: 200, blue: null });
  assert.equal(advance(recovered, time.finish).balance, 10030);
  const migratedOpen = upgradeSession({ ...wager, version: 2 });
  assert.deepEqual(advance(migratedOpen, time.lock).round.snapshot.rates, { red: 163, blue: null });
  assert.equal(advance(migratedOpen, time.finish).balance, 10018);
});

test('an old roster retains its coordinates and result until the 10-row layout begins next round', () => {
  const start = newSession('legacy-board', 0, undefined, 0);
  const old = { ...start, version: 4 };
  delete old.round.board;
  const recovered = upgradeSession(old);
  const place = (session, side, amount, at) => placeBet(session, at, {
    sessionId: session.id, roundNumber: 1, side, amount, requestId: side,
  }).session;
  const loaded = place(place(recovered, 'red', 340, 1000), 'blue', 60, 2000);
  const time = timeline(loaded.round);
  const sealed = advance(loaded, time.lock);
  assert.deepEqual(sealed.round.snapshot.battle.blue.base, [11, 4]);
  assert.ok(sealed.round.snapshot.battle.blue.barracks.some(({ at }) => at[0] === 11));
  const settled = advance(JSON.parse(JSON.stringify(sealed)), time.finish);
  assert.equal(settled.round.result.winner, 'red');
  assert.equal(settled.balance, 9_974);
  const next = advance(settled, time.next);
  assert.equal(next.round.board, 'square-10');
  assert.equal(next.previous.balanceAfter, settled.balance);
});
