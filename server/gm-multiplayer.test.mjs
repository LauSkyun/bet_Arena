import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { timeline } from '../prototype-playtest/round.mjs';
import { botPlan, defaultGmConfig, validateGmConfig } from './gm-bots.mjs';
import { openArena } from './shared-arena.mjs';

const config = { settlementMode: 2, botEnabled: true, botCount: 3, minAmount: 100, maxAmount: 100 };
const opts = (nowRef, gmKey = 'gm-secret') => ({ clock: () => nowRef.value, durations: { betMs: 10_000, battleMs: 40_000 }, seed: 42, gmKey });

function toRound2(arena, human, nowRef) {
  const first = arena.state(human.token).session.round;
  nowRef.value = timeline(first).next + 1;
  arena.tick();
  return arena.state(human.token).session.round;
}

test('GM config validation and permission', () => {
  assert.ok(validateGmConfig(config));
  assert.equal(validateGmConfig({ ...config, botCount: 9 }), null);
  assert.equal(validateGmConfig({ ...config, minAmount: 5, maxAmount: 1 }), null);
  assert.deepEqual(defaultGmConfig.botEnabled, false);
  const nowRef = { value: 100_000 };
  const arena = openArena(':memory:', opts(nowRef));
  try {
    assert.match(arena.configure('wrong', config).error, /无权/);
    assert.equal(arena.gmConfig().botEnabled, false);
    const result = arena.configure('gm-secret', config);
    assert.equal(result.roundNumber, 2);
    assert.equal(arena.gmConfig().botEnabled, true);
  } finally { arena.close(); }
});

test('bot plan is deterministic from seed, round and config', () => {
  const round = { number: 2, snapshot: null, durations: { betMs: 10_000 } };
  const a = botPlan(round, config, 42);
  const b = botPlan(round, config, 42);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.ok(a.every((p) => p.amount === 100 && ['red', 'blue'].includes(p.side)));
  assert.ok(a.every((p) => p.elapsedMs >= 1000 && p.elapsedMs <= 8000));
});

test('bots enter the pool; human balance and history stay isolated; download marks bot source', () => {
  const nowRef = { value: 100_000 };
  const arena = openArena(':memory:', opts(nowRef));
  try {
    arena.configure('gm-secret', config);
    const human = arena.login('Human');
    // round 1 keeps the default config (bots off): next-round effective.
    assert.equal(arena.state(human.token).session.round.gmConfig.botEnabled, false);
    const round2 = toRound2(arena, human, nowRef);
    assert.equal(round2.gmConfig.botEnabled, true);
    arena.bet(human.token, { sessionId: human.account.uid, roundNumber: 2, side: 'red', requestId: 'h', amount: 100 });
    const lock = timeline(round2).lock;
    nowRef.value = lock + 1;
    arena.tick();
    const sealed = arena.state(human.token).session.round;
    // public totals include system (100 each): red = human100+bot100+sys100, blue = bot200+sys100.
    assert.equal(sealed.snapshot.teams.red.total, 300);
    assert.equal(sealed.snapshot.teams.blue.total, 300);
    nowRef.value = timeline(sealed).finish;
    const result = arena.state(human.token).session.round.result;
    assert.equal(result.settlementRules, 2);
    // player pool (system excluded): red 200 (human+1 bot), blue 200 (2 bots).
    assert.deepEqual({ red: result.pool.red, blue: result.pool.blue }, { red: 200, blue: 200 });
    if (result.winner === 'red') {
      // human red 100, bots red 100 blue 200 (seed 42): winner pool 200, loser 200, rake 10, share 95.
      assert.equal(result.credit, 195);
      assert.equal(result.net, 95);
    }
    const archive = arena.archive(human.token, 2).archive;
    const bots = archive.bet_log.entries.filter((e) => e.source === 'bot');
    assert.equal(bots.length, 3);
    assert.ok(bots.every((e) => e.accepted && e.effects));
    assert.ok(Array.isArray(archive.sim));
    assert.equal(archive.sim.length, 3);
    // personal history: only the human, one entry, no bot identity.
    const entries = arena.history(human.token).entries;
    assert.equal(entries.length, 1);
    assert.equal(JSON.stringify(entries).includes('bot:2:'), false);
  } finally { arena.close(); }
});

test('restart across seal processes all pre-seal bot events once, no backfill after seal', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-restart-'));
  const file = join(dir, 'arena.sqlite');
  const nowRef = { value: 100_000 };
  const options = opts(nowRef);
  let arena = openArena(file, options);
  t.after(() => { try { arena.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });
  arena.configure('gm-secret', config);
  const human = arena.login('Restart');
  const first = arena.state(human.token).session.round;
  nowRef.value = timeline(first).next + 1;
  arena.tick();
  const round2 = arena.state(human.token).session.round;
  arena.bet(human.token, { sessionId: human.account.uid, roundNumber: 2, side: 'red', requestId: 'h', amount: 100 });
  // process a couple of bots before seal, then stop
  nowRef.value = timeline(round2).lock - 2000;
  arena.tick();
  const db1 = new DatabaseSync(file);
  const before = db1.prepare('SELECT COUNT(*) c FROM bot_bets').get().c;
  db1.close();
  arena.close();
  // restart after seal: all pre-seal due events processed, sealed snapshot forbids backfill
  nowRef.value = timeline(round2).finish;
  arena = openArena(file, options);
  const result = arena.state(human.token).session.round.result;
  const db2 = new DatabaseSync(file);
  const after = db2.prepare('SELECT COUNT(*) c FROM bot_bets').get().c;
  db2.close();
  assert.ok(before <= 3);
  assert.equal(after, 3, 'sealed round holds all three pre-seal bot bets');
  assert.equal(arena.state(human.token).session.balance, 10_000 - 100 + result.credit);
  arena.tick(); arena.tick();
  const db3 = new DatabaseSync(file);
  assert.equal(db3.prepare('SELECT COUNT(*) c FROM bot_bets').get().c, 3);
  db3.close();
});
