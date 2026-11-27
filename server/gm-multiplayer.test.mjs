import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { timeline } from '../prototype-playtest/round.mjs';
import { botPlan, defaultGmConfig, validateGmConfig } from './gm-bots.mjs';
import { advanceBetting, maxReferenceThreshold } from '../prototype-playtest/betting.mjs';
import { newRoster } from '../prototype-playtest/roster.mjs';
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


test('legacy settlement mode survives reopen; next new round keeps legacy, not flipped to pool', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-legacy-'));
  const file = join(dir, 'arena.sqlite');
  const nowRef = { value: 100_000 };
  const options = opts(nowRef);
  let arena = openArena(file, options);
  t.after(() => { try { arena.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });
  const legacy = { settlementMode: 1, botEnabled: true, botCount: 3, minAmount: 100, maxAmount: 100 };
  arena.configure('gm-secret', legacy);
  const human = arena.login('Legacy');
  const first = arena.state(human.token).session.round;
  nowRef.value = timeline(first).next + 1;
  arena.tick();
  const second = arena.state(human.token).session.round;
  assert.equal(second.gmConfig.settlementMode, 1);
  assert.equal(second.settlementRules, undefined);
  // reopen and advance into round 3: must still be legacy
  nowRef.value = timeline(second).next + 1;
  arena.close();
  arena = openArena(file, options);
  const third = arena.state(human.token).session.round;
  assert.equal(third.gmConfig.settlementMode, 1);
  assert.equal(third.settlementRules, undefined, 'reopen must not flip GM-set legacy to pool');
});

test('legacy mode credits winning bots by frozen multiplier and refunds on draw', () => {
  const nowRef = { value: 100_000 };
  const arena = openArena(':memory:', opts(nowRef));
  try {
    const legacy = { settlementMode: 1, botEnabled: true, botCount: 3, minAmount: 100, maxAmount: 100 };
    arena.configure('gm-secret', legacy);
    const human = arena.login('Legacy Bot');
    const first = arena.state(human.token).session.round;
    nowRef.value = timeline(first).next + 1;
    arena.tick();
    const r2 = arena.state(human.token).session.round;
    arena.bet(human.token, { sessionId: human.account.uid, roundNumber: 2, side: 'blue', requestId: 'h', amount: 93 });
    const lock = timeline(r2).lock;
    nowRef.value = lock + 1;
    arena.tick();
    const sealed = arena.state(human.token).session.round;
    const rates = sealed.snapshot.rates;
    nowRef.value = timeline(sealed).finish;
    const result = arena.state(human.token).session.round.result;
    const sim = arena.archive(human.token, 2).archive.sim;
    assert.equal(result.settlementRules, undefined);
    for (const bot of sim) {
      if (result.winner === 'draw' || result.winner === 'void') {
        assert.equal(bot.credit, bot.amount, 'draw/void refunds each bot principal');
      } else if (bot.side === result.winner) {
        assert.equal(bot.credit, Math.floor(bot.amount * rates[bot.side] / 100), 'winning bot uses frozen multiplier');
      } else {
        assert.equal(bot.credit, 0);
      }
    }
  } finally { arena.close(); }
});

test('cross-round catch-up applies each round bots before sealing (continuous == jump)', () => {
  function run(jump) {
    const nowRef = { value: 100_000 };
    const arena = openArena(':memory:', opts(nowRef));
    try {
      arena.configure('gm-secret', config);
      const human = arena.login('Catchup');
      const first = arena.state(human.token).session.round;
      nowRef.value = timeline(first).next + 1;
      arena.tick();
      const r2 = arena.state(human.token).session.round;
      if (jump) {
        nowRef.value = r2.startedAt + 80_000;
        arena.tick();
      } else {
        for (const t of [timeline(r2).lock + 1, timeline(r2).finish + 1, timeline(r2).next + 1]) { nowRef.value = t; arena.tick(); }
        nowRef.value = r2.startedAt + 80_000;
        arena.tick();
      }
      const st = arena.state(human.token).session;
      const arch3 = arena.archive(human.token, st.round.number).archive;
      return { number: st.round.number, sealed: Boolean(st.round.snapshot), bots: arch3 ? arch3.bet_log.entries.filter((e) => e.source === 'bot').length : -1 };
    } finally { arena.close(); }
  }
  const continuous = run(false);
  const jump = run(true);
  assert.equal(continuous.sealed, true);
  assert.deepEqual(jump, continuous, 'jump path must apply the same per-round bot events');
  assert.equal(jump.bots, 3);
});

test('bot public entries carry no personal receipt', () => {
  const nowRef = { value: 100_000 };
  const arena = openArena(':memory:', opts(nowRef));
  try {
    arena.configure('gm-secret', config);
    const human = arena.login('Receipt');
    const first = arena.state(human.token).session.round;
    nowRef.value = timeline(first).next + 1;
    arena.tick();
    const r2 = arena.state(human.token).session.round;
    arena.bet(human.token, { sessionId: human.account.uid, roundNumber: 2, side: 'red', requestId: 'h', amount: 100 });
    nowRef.value = timeline(r2).lock + 1;
    arena.tick();
    const entries = arena.archive(human.token, 2).archive.bet_log.entries;
    const bots = entries.filter((e) => e.source === 'bot');
    assert.equal(bots.length, 3);
    assert.ok(bots.every((e) => !('receipt' in e) && e.effects && e.elapsedMs != null && e.amount === 100));
    assert.ok(entries.filter((e) => e.source === 'player').every((e) => 'receipt' in e));
  } finally { arena.close(); }
});


test('bots obey the public total-investment gate (maxReferenceThreshold)', () => {
  // A bot event whose amount would push the public total past the cap must be skipped.
  const round = {
    number: 2, snapshot: null, startedAt: 0, lockAt: 10_000, referenceIndex: 0,
    threshold: 1_000_000, board: 'hex-14', profile: 'ground', combatRules: 12,
    reference: [], receipts: [], settlementRules: 2,
    teams: {
      red: { total: maxReferenceThreshold - 50, player: 0, system: maxReferenceThreshold - 50, roster: newRoster('red', 1) },
      blue: { total: 0, player: 0, system: 0, roster: newRoster('blue', 2) },
    },
  };
  const stored = [];
  const extra = [{ requestId: 'bot:2:0', side: 'red', amount: 100, elapsedMs: 1000 }];
  const sealed = advanceBetting(round, [], 10_000, 10_000, undefined, extra,
    (r, event) => stored.push(event.requestId));
  assert.equal(stored.length, 0, 'bot bet over the public total gate is skipped');
  assert.equal(sealed.teams.red.total, maxReferenceThreshold - 50, 'skipped bot did not invest');
  // A within-cap bot does invest and fire observeExtra.
  const extra2 = [{ requestId: 'bot:2:1', side: 'blue', amount: 50, elapsedMs: 1000 }];
  advanceBetting(round, [], 10_000, 10_000, undefined, extra2, (r, event) => stored.push(event.requestId));
  assert.deepEqual(stored, ['bot:2:1']);
});


test('mid-round upgrade: newly saved config does not apply bots to the current old round', (t) => {
  // Use an arena with no gmConfig (as created by the develop baseline) and configure mid-round.
  const dir = mkdtempSync(join(tmpdir(), 'gm-upgrade-'));
  const file = join(dir, 'arena.sqlite');
  const nowRef = { value: 100_000 };
  const options = opts(nowRef);
  const arena = openArena(file, options);
  t.after(() => { arena.close(); rmSync(dir, { recursive: true, force: true }); });
  const human = arena.login('Upgrade');
  // Simulate a baseline DB: strip gmConfig from the stored state like develop did.
  const db = new DatabaseSync(file);
  const row = JSON.parse(db.prepare('SELECT data FROM arena WHERE id=1').get().data);
  delete row.gmConfig;
  delete row.round.gmConfig;
  db.prepare('UPDATE arena SET data=? WHERE id=1').run(JSON.stringify(row));
  db.close();
  // Configure bots (reported as round 2 effective) while the current round is still open.
  assert.equal(arena.configure('gm-secret', config).roundNumber, 2);
  const round1 = arena.state(human.token).session.round;
  // The current round was frozen before any gmConfig existed, so it has no bot config.
  assert.equal(round1.gmConfig, undefined);
  nowRef.value = round1.startedAt + 9_500;
  const archive = arena.archive(human.token, 1).archive;
  assert.equal(archive.bet_log.entries.filter((e) => e.source === 'bot').length, 0,
    'current round without frozen config stays as-is');
});

test('per-event effect attribution is identical for continuous ticks and jump catch-up', () => {
  function run(jump) {
    const nowRef = { value: 100_000 };
    const arena = openArena(':memory:', opts(nowRef));
    try {
      arena.configure('gm-secret', config);
      const human = arena.login('Trace');
      const first = arena.state(human.token).session.round;
      nowRef.value = timeline(first).next + 1;
      arena.tick();
      const r2 = arena.state(human.token).session.round;
      arena.bet(human.token, { sessionId: human.account.uid, roundNumber: 2, side: 'red', requestId: 'hr', amount: 81 });
      arena.bet(human.token, { sessionId: human.account.uid, roundNumber: 2, side: 'blue', requestId: 'hb', amount: 93 });
      if (jump) {
        nowRef.value = r2.startedAt + 80_000;
        arena.tick();
      } else {
        for (let t = r2.startedAt; t <= r2.startedAt + 80_000; t += 100) { nowRef.value = t; arena.tick(); }
      }
      const st = arena.state(human.token).session;
      const arch = arena.archive(human.token, 2).archive;
      const seq = arch.bet_log.entries.filter((e) => e.source === 'system' || e.source === 'bot')
        .map((e) => [e.source, e.elapsedMs, (e.effects || []).map((x) => x.level).join(',')]);
      return { seq, roster: JSON.stringify(st.round.snapshot?.battle) };
    } finally { arena.close(); }
  }
  assert.deepEqual(run(true), run(false), 'continuous and catch-up must interleave events identically');
});
