import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
  assert.match(arena.bet(same.token, request(login, 'blue', 110, 'insufficient')).error, /不足/);
  assert.equal(arena.bet(same.token, request(login, 'blue', 100, 'last')).session.balance, 0);
  assert.equal(arena.bet(bob.token, second).session.balance, 9700);
  assert.equal(arena.state(login.token).session.round.teams.blue.player, 100);
  assert.equal(arena.state(bob.token).session.round.teams.blue.player, 300);
  assert.equal(arena.state(bob.token).session.round.teams.red.total, 9900);
  now += 10_000;
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
  assert.equal(archive.bet_log.entries.filter(({ source }) => source === 'player').length, 1);
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
