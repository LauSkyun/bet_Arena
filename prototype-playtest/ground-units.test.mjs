import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groundUnits, drawGroundUnit } from './ground-units.mjs';
import { barracksLabel, glyphFor } from './board-display.mjs';
import { groundProfile } from './profiles.mjs';
import { advance, newSession, placeBet, timeline } from './round.mjs';
import { battleDataFor } from './battle-data.mjs';
import { groundAreaRules, groundHealingRules, groundProductionRules, simulateBattle } from './battle.mjs';
import { upgradeSession } from './storage.mjs';
import { themes, unitStats } from './roster.mjs';

function start(seed) {
  return newSession('ground', 0, [], seed, undefined, undefined, groundProfile);
}
function bet(s, amount) {
  return placeBet(s, 1, { sessionId: s.id, roundNumber: 1, side: 'red', amount, requestId: String(s.round.receipts.length) }).session;
}

test('normal wagers draw all 19 ground barracks; first barracks and same-name upgrades keep their identity', () => {
  const seen = new Set();
  const firstNames = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const first = bet(start(seed), 100);
    firstNames.add(first.round.teams.red.roster.barracks[0].unit.name);
    const paid = bet(first, 4400);
    for (const b of paid.round.teams.red.roster.barracks) {
      seen.add(b.unit.unitId);
      assert.equal(b.level, 3);
      const sealed = unitStats(b);
      assert.equal(sealed.hp, Math.floor(b.unit.hp * 1.4 + 1e-8));
      assert.equal(sealed.spawnMs, b.unit.spawnMs);
      assert.equal(sealed.limit, b.unit.limit);
      assert.equal(barracksLabel(b.unit.name), b.unit.label);
      assert.equal(glyphFor(b.unit.name), b.unit.glyph);
    }
  }
  assert.deepEqual([...firstNames].sort(), ['狂热者','陆战队员','秃鹰车','小狗','蟑螂'].sort());
  assert.deepEqual([...seen].sort((a,b)=>a-b), [2,3,4,5,6,7,10,12,13,14,15,16,17,22,23,25,26,27,28]);
  assert.equal(drawGroundUnit('人族', false, 0.99, 0).quality, '紫');
  for (const race of themes) assert.equal(drawGroundUnit(race, false, 0, 0).quality, '绿');
});

test('each isolated ground barracks produces its first batch at its configured beat and free exit', () => {
  for (const unit of groundUnits) {
    const session = bet(start(1), 100);
    session.round.teams.red.roster.barracks[0].unit = unit;
    const sealed = advance(session, timeline(session.round).lock);
    const data = battleDataFor(sealed.round, []);
    const replay = simulateBattle(data.loadout, unit.spawnMs, data.board, data.combatRules, data.fireRevision);
    assert.notEqual(replay.result.winner, 'void', unit.name);
    assert.equal(replay.frames.at(-2).units.length, 0);
    const batch = replay.frames.at(-1).units;
    assert.equal(batch.length, unit.spawnCount);
    assert.ok(batch.every(u => u.name === unit.name && u.hp === unit.hp));
    for (const u of batch) assert.deepEqual(u.at, data.loadout.red.barracks[0].exit);
  }
});

test('a sealed, exported V2.1 battle replays identically after serialization and settlement', () => {
  const paid = bet(start(9), 2100);
  const sealed = advance(paid, timeline(paid.round).lock);
  const end = advance(sealed, timeline(sealed.round).finish);
  const data = battleDataFor(end.round, end.reference);
  const simulate = d => simulateBattle(d.loadout, d.durations.battleMs, d.board, d.combatRules, d.fireRevision);
  const replay = simulate(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(replay, simulate(data));
  assert.notEqual(replay.result.winner, 'void');
  assert.equal(data.profile, groundProfile);
  assert.equal(data.combatRules, groundAreaRules);
  assert.equal(replay.result.winner, data.result.winner);
  assert.deepEqual(replay.result.scores, data.result.scores);
});

test('normal ground wagers produce a medic that heals, and v13 keeps its locked rules and threshold', () => {
  const current = start(24);
  current.round.combatRules = groundHealingRules;
  const stake = (session, side) => placeBet(session, 1, {
    sessionId: session.id, roundNumber: 1, side, amount: 500, requestId: side,
  }).session;
  const wagered = stake(stake(current, 'red'), 'blue');
  const lock = timeline(wagered.round).lock;
  const locked = advance(wagered, lock);
  const round = battleDataFor(locked.round, []);
  const replay = simulateBattle(round.loadout, round.durations.battleMs, round.board, round.combatRules, round.fireRevision);
  const first = replay.frames.find(({ shots }) => shots.some(({ effect }) => effect === 'heal'));
  assert.equal(first.elapsed, 10_000);
  assert.deepEqual(first.shots.filter(({ effect }) => effect === 'heal').map(({ targetName, power, before, after }) =>
    [targetName, power, before, after]), [['小狗', 12, 39, 39]]);
  assert.equal(advance(locked, timeline(locked.round).finish).round.result.winner, replay.result.winner);

  const old = { ...locked, version: 13, nextThreshold: 125, round: { ...locked.round, combatRules: groundProductionRules } };
  const migrated = upgradeSession(old);
  assert.deepEqual(migrated, { ...old, version: current.version });
  const oldReplay = simulateBattle(round.loadout, round.durations.battleMs, round.board, migrated.round.combatRules, round.fireRevision);
  assert.ok(oldReplay.frames.every(({ shots }) => shots.every(({ effect }) => effect !== 'heal')));
  const next = advance(migrated, timeline(migrated.round).next);
  assert.equal(next.previous.battleData.combatRules, groundProductionRules);
  assert.equal(next.round.combatRules, groundAreaRules);
  assert.equal(next.round.threshold, 125);

  const healingSave = { ...locked, version: 14, nextThreshold: 135 };
  const migratedHealing = upgradeSession(healingSave);
  assert.deepEqual(migratedHealing, { ...healingSave, version: current.version });
  const nextAfterHealing = advance(migratedHealing, timeline(migratedHealing.round).next);
  assert.equal(nextAfterHealing.previous.battleData.combatRules, groundHealingRules);
  assert.equal(nextAfterHealing.round.combatRules, groundAreaRules);
  assert.equal(nextAfterHealing.round.threshold, 135);
});
