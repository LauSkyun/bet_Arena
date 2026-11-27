import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { replayFromReport } from '../prototype-playtest/replay-import.mjs';
import { timeline } from '../prototype-playtest/round.mjs';
import { winningCredit } from '../prototype-playtest/returns.mjs';
import { openArena } from './shared-arena.mjs';

test('one SQLite arena settles each account, keeps requests replayable, and resumes after reopening', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shared-arena-'));
  const file = join(directory, 'arena.sqlite');
  let now = 100_000;
  const options = { clock: () => now, durations: { betMs: 10_000, battleMs: 3_000 } };
  let arena = openArena(file, options);
  t.after(() => { arena.close(); rmSync(directory, { recursive: true, force: true }); });
  const login = arena.login('  Ａlice  ');
  const same = arena.login('alice');
  const bob = arena.login('玩家 乙');
  const guest = arena.login('观众');
  assert.deepEqual(login.account, same.account);
  assert.notEqual(login.account.uid, bob.account.uid);
  assert.equal(arena.login('!!!'), null);
  const request = (account, side, amount, requestId) => ({ sessionId: account.account.uid, roundNumber: 1, side, amount, requestId });
  const first = request(login, 'red', 9900, 'both-use-this-id');
  const second = request(bob, 'blue', 300, 'both-use-this-id');
  assert.equal(arena.bet(login.token, first).session.balance, 100);
  assert.equal(arena.bet(same.token, first).replayed, true);
  assert.match(arena.bet(same.token, { ...first, amount: 10 }).error, /不同/);
  now += 125;
  const rejected = request(login, 'blue', 110, 'insufficient');
  assert.match(arena.bet(same.token, rejected).error, /不足/);
  now += 125;
  assert.equal(arena.bet(login.token, rejected).replayed, true);
  const currentLog = arena.archive(login.token, 1).archive.bet_log;
  assert.equal(currentLog.complete, true);
  assert.deepEqual(currentLog.entries[1], { source: 'player', requestId: 'insufficient', side: 'blue', amount: 110,
    requestedRoundNumber: 1, elapsedMs: 125, accepted: false, error: '测试积分不足。', receipt: null, effects: [] });
  assert.equal(arena.bet(same.token, request(login, 'blue', 100, 'last')).session.balance, 0);
  assert.equal(arena.bet(bob.token, second).session.balance, 9700);
  assert.equal(arena.state(login.token).session.round.teams.blue.player, 100);
  assert.equal(arena.state(bob.token).session.round.teams.blue.player, 300);
  assert.equal(arena.state(bob.token).session.round.teams.red.total, 9900);
  now = 110_000;
  const sealed = arena.state(bob.token).session.round;
  assert.equal(sealed.snapshot.teams.red.total, 10_000);
  assert.equal(sealed.snapshot.teams.blue.total, 500);
  assert.deepEqual(sealed.snapshot.rates, arena.state(login.token).session.round.snapshot.rates);
  assert.match(arena.bet(bob.token, request(bob, 'blue', 1, 'late')).error, /截止/);
  assert.equal(arena.bet(bob.token, second).replayed, true);
  arena.close();
  arena = openArena(file, options);
  assert.deepEqual(arena.state(login.token).session.round.snapshot.battle, sealed.snapshot.battle);
  now = timeline(sealed).battle + 500;
  const partial = replayFromReport(arena.archive(bob.token, 1).archive);
  assert.equal(partial.recordedThroughMs, 500);
  assert.equal(partial.result, null);
  now = timeline(sealed).finish;
  const aliceResult = arena.state(login.token).session.round.result;
  const bobResult = arena.state(bob.token).session.round.result;
  assert.equal(aliceResult.winner, bobResult.winner);
  for (const result of [aliceResult, bobResult]) {
    const credit = ['void', 'draw'].includes(result.winner) ? result.stake : winningCredit(result.stakes[result.winner], result.rates[result.winner]);
    assert.equal(result.credit, credit);
    assert.equal(result.balanceAfter, 10_000 - result.stake + credit);
  }
  const settledLog = arena.archive(bob.token, 1).archive.battle_log;
  const spectator = arena.archive(guest.token, 1).archive.battle_log.settlement;
  assert.deepEqual([spectator.stake, spectator.credit, spectator.balanceAfter], [0, 0, 10_000]);
  now = timeline(sealed).next;
  arena.tick();
  arena.close();
  arena = openArena(file, options);
  assert.equal(arena.state(login.token).session.balance, aliceResult.balanceAfter);
  assert.equal(arena.state(bob.token).session.round.number, 2);
  assert.deepEqual(arena.history(bob.token).entries, [bobResult]);
  assert.deepEqual(arena.history(guest.token).entries, []);
  assert.equal(arena.archive(guest.token, 1).archive, null);
  const archive = arena.archive(bob.token, 1).archive;
  assert.deepEqual(archive.battle_log, settledLog);
  assert.equal(archive.bet_log.complete, true);
  assert.deepEqual(archive.bet_log.entries.filter(({ source }) => source === 'player').map(({ requestId, elapsedMs, accepted }) =>
    [requestId, elapsedMs, accepted]), [['both-use-this-id', 250, true], ['late', 10_000, false]]);
  assert.ok(archive.bet_log.entries.filter(({ source }) => source === 'system').every(({ effects }) => effects.length > 0));
  assert.equal(arena.bet(login.token, rejected).replayed, true);
  assert.equal(arena.archive(login.token, 1).archive.bet_log.entries.filter(({ requestId }) => requestId === 'insufficient').length, 1);
  assert.equal(replayFromReport(archive).result.winner, bobResult.winner);
  assert.equal(arena.bet(bob.token, second).replayed, true);
  arena.logout(login.token);
  assert.equal(arena.state(login.token), null);
  assert.equal(arena.state(same.token).session.balance, aliceResult.balanceAfter);
});


test('personal history uses a round cursor without losing or repeating entries', () => {
  let now = 0;
  const arena = openArena(':memory:', { clock: () => now, durations: { betMs: 1000, battleMs: 500 } });
  try {
    const account = arena.login('History');
    for (let roundNumber = 1; roundNumber <= 22; roundNumber++) {
      const request = { sessionId: account.account.uid, roundNumber, requestId: 'wager', side: 'red', amount: 1 };
      const bet = arena.bet(account.token, request);
      assert.ok(bet.receipt);
      now = timeline(bet.session.round).next;
      arena.tick();
    }
    const first = arena.history(account.token);
    assert.deepEqual(first.entries.map(({ round }) => round), Array.from({ length: 20 }, (_, i) => 22 - i));
    assert.equal(first.next, 3);
    const second = arena.history(account.token, first.next);
    assert.deepEqual(second.entries.map(({ round }) => round), [2, 1]);
    assert.equal(second.next, null);
  } finally { arena.close(); }
});


test('older SQLite rows keep receipts and rejections with truthful missing timestamps', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shared-arena-legacy-'));
  const file = join(directory, 'arena.sqlite');
  let now = 100;
  const options = { clock: () => now };
  let arena = openArena(file, options);
  t.after(() => { arena.close(); rmSync(directory, { recursive: true, force: true }); });
  const { account, token } = arena.login('Legacy');
  const bet = (requestId, amount) => ({ sessionId: account.uid, roundNumber: 1, side: 'red', requestId, amount });
  now += 100;
  assert.ok(arena.bet(token, bet('accepted', 200)).receipt);
  assert.match(arena.bet(token, bet('rejected', 10_000)).error, /不足/);
  arena.close();
  const old = new DatabaseSync(file);
  old.exec("UPDATE bets SET data = json_remove(data, '$.requestedAt')");
  old.close();
  now += 200;
  arena = openArena(file, options);
  assert.equal(arena.bet(token, bet('rejected', 10_000)).replayed, true);
  const { bet_log: log } = arena.archive(token, 1).archive;
  assert.equal(log.complete, false);
  assert.deepEqual(log.entries.map(({ requestId, elapsedMs, accepted }) => [requestId, elapsedMs, accepted]),
    [['accepted', 100, true], ['rejected', null, false]]);
  assert.match(log.entries[1].error, /不足/);
  assert.equal(arena.state(token).session.balance, 9800);
});


test('new rounds use the player prize pool: two accounts get 195, one account both sides nets -5', () => {
  let now = 100_000;
  const options = { clock: () => now, durations: { betMs: 10_000, battleMs: 40_000 }, seed: 1 };
  const arena = openArena(':memory:', options);
  try {
    const a = arena.login('Pool A');
    const b = arena.login('Pool B');
    const req = (acct, side, amount, id = 'w') => ({ sessionId: acct.account.uid, roundNumber: 1, side, amount, requestId: id });
    arena.bet(a.token, req(a, 'red', 100));
    arena.bet(b.token, req(b, 'blue', 100));
    now = timeline(arena.state(a.token).session.round).lock + 1;
    const sealed = arena.state(a.token).session.round;
    assert.equal(sealed.snapshot.settlementRules, 2);
    now = timeline(sealed).finish;
    const ra = arena.state(a.token).session.round.result;
    const rb = arena.state(b.token).session.round.result;
    assert.equal(ra.settlementRules, 2);
    assert.deepEqual([ra.pool.red, ra.pool.blue, ra.pool.rake, ra.pool.distributable], [100, 100, 5, 95]);
    const winner = ra.winner;
    assert.ok(['red', 'blue'].includes(winner), `decisive winner expected, got ${winner}`);
    const winnerCredit = winner === 'red' ? ra.credit : rb.credit;
    const loserCredit = winner === 'red' ? rb.credit : ra.credit;
    assert.equal(winnerCredit, 195);
    assert.equal(loserCredit, 0);
    // history carries the pool rule detail.
    const entry = arena.history(a.token).entries[0];
    assert.equal(entry.settlementRules, 2);
    assert.equal(entry.pool.rake, 5);
  } finally { arena.close(); }
});

test('one account bets both sides: decisive round credits 195 with net -5', () => {
  let now = 100_000;
  const arena = openArena(':memory:', { clock: () => now, durations: { betMs: 10_000, battleMs: 40_000 } });
  try {
    const solo = arena.login('Solo');
    const req = (side, id) => ({ sessionId: solo.account.uid, roundNumber: 1, side, amount: 100, requestId: id });
    arena.bet(solo.token, req('red', 'r'));
    arena.bet(solo.token, req('blue', 'b'));
    now = timeline(arena.state(solo.token).session.round).lock + 1;
    const sealed = arena.state(solo.token).session.round;
    now = timeline(sealed).finish;
    const result = arena.state(solo.token).session.round.result;
    if (result.winner === 'draw' || result.winner === 'void') {
      assert.equal(result.credit, 200);
    } else {
      assert.equal(result.credit, 195);
      assert.equal(result.net, -5);
    }
    assert.equal(result.settlementRules, 2);
  } finally { arena.close(); }
});


test('new rounds seal player-stake pool rates; single side shows pending (null rate)', () => {
  let now = 100_000;
  const arena = openArena(':memory:', { clock: () => now, durations: { betMs: 10_000, battleMs: 40_000 } });
  try {
    const a = arena.login('Rate A');
    const b = arena.login('Rate B');
    const req = (acct, side) => ({ sessionId: acct.account.uid, roundNumber: 1, side, requestId: 'r', amount: 100 });
    arena.bet(a.token, req(a, 'red'));
    arena.bet(b.token, req(b, 'blue'));
    now = timeline(arena.state(a.token).session.round).lock + 1;
    const sealed = arena.state(a.token).session.round;
    // player stakes only (100/100) -> each side would return 195 if it wins; system stakes excluded.
    assert.deepEqual(sealed.snapshot.rates, { red: 195, blue: 195 });
  } finally { arena.close(); }
});

test('spectators see zero personal principal and share; refund keeps refund with zero share', () => {
  let now = 100_000;
  const arena = openArena(':memory:', { clock: () => now, durations: { betMs: 10_000, battleMs: 40_000 }, seed: 1 });
  try {
    const a = arena.login('Detail A');
    const b = arena.login('Detail B');
    const watch = arena.login('Detail Watch');
    const req = (acct, side) => ({ sessionId: acct.account.uid, roundNumber: 1, side, requestId: 'd', amount: 100 });
    arena.bet(a.token, req(a, 'red'));
    arena.bet(b.token, req(b, 'blue'));
    now = timeline(arena.state(a.token).session.round).lock + 1;
    const sealed = arena.state(a.token).session.round;
    now = timeline(sealed).finish;
    const viewer = arena.state(watch.token).session.round.result;
    assert.equal(viewer.credit, 0);
    assert.equal(viewer.pool.principal, 0);
    assert.equal(viewer.pool.share, 0);
    assert.equal(viewer.pool.distributable, 95);
  } finally { arena.close(); }
});
