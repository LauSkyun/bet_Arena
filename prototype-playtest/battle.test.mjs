import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceBattle, applyOccupancy, currentCombatRules, baseVictoryRules, countGround, damageTiebreakRules, frameAt, replayFor, simulateBattle } from './battle.mjs';
import { battleLoadout, drawUnit, keyAt, mapFor, newRoster, priorBoard, validBuilds } from './roster.mjs';
import { advance, newSession, placeBet, timeline } from './round.mjs';
import { upgradeSession } from './storage.mjs';

const toLoadout = (rules) => ({ red: battleLoadout(newRoster('red', 73), undefined, rules), blue: battleLoadout(newRoster('blue', 22), undefined, rules) });
const walking = (id, side, at, hp = 40) => ({ id, side, at, hp, damage: 6, range: 1, attackMs: 1000, target: null, nextAttack: 0 });

function tinyState(owners, buildings, units) {
  const terrain = Object.fromEntries(Object.keys(owners).map((key) => [key, 'ground']));
  for (const building of buildings) terrain[building.at.join('-')] = building.kind;
  return { owners, terrain, buildings, units, sequence: 200 };
}

test('arrival ownership persists, can flip back, excludes special tiles and preserves ties', () => {
  const owners = { '5-5': 'blue', '5-6': 'red' };
  applyOccupancy(owners, [{ side: 'red', at: [5, 5] }, { side: 'red', at: [1, 4] }]);
  assert.deepEqual(owners, { '5-5': 'red', '5-6': 'red' });
  applyOccupancy(owners, []);
  assert.equal(owners['5-5'], 'red');
  applyOccupancy(owners, [{ side: 'red', at: [5, 5] }, { side: 'blue', at: [5, 5] }]);
  assert.equal(owners['5-5'], 'red');
  applyOccupancy(owners, [{ side: 'blue', at: [5, 5] }]);
  assert.equal(owners['5-5'], 'blue');
});

test('moves resolve before attacks and mutual lethal blows take effect together', () => {
  const state = tinyState({ '6-3': 'red', '6-4': 'blue', '6-5': 'blue' }, [], [
    walking(1, 'red', [6, 3], 6), walking(2, 'blue', [6, 5], 6),
  ]);
  advanceBattle(state, 500);
  assert.equal(state.units.length, 0);
  assert.equal(state.owners['6-4'], 'blue');
});

test('each of two vacancies restarts its barracks replenishment on the full half-second cadence', () => {
  const unit = drawUnit('人族', 0, 0);
  const building = { id: 1, kind: 'barracks', side: 'red', at: [1, 3], exit: [1, 2], hp: 120, nextSpawn: null, unit };
  const state = tinyState({ '1-2': 'red' }, [building], Array.from({ length: 10 }, (_, i) => ({ ...walking(i + 2, 'red', [1, 2]), source: 1 })));
  state.units[0].hp = 0;
  state.units[1].hp = 0;
  advanceBattle(state, 1000);
  assert.equal(state.units.length, 8);
  assert.equal(building.nextSpawn, 1500);
  advanceBattle(state, 1500);
  assert.equal(state.units.length, 9);
  advanceBattle(state, 2000);
  assert.equal(state.units.length, 10);
  assert.equal(building.nextSpawn, null);
});

test('damage destroys a barracks before its due spawn and living soldiers remain', () => {
  const building = { id: 1, kind: 'barracks', side: 'red', at: [1, 3], exit: [1, 2], hp: 6, nextSpawn: 500, unit: drawUnit('人族', 0, 0) };
  const state = tinyState({ '1-2': 'red', '1-4': 'blue' }, [building], [
    { ...walking(2, 'red', [1, 2]), source: 1 }, walking(3, 'blue', [1, 4]),
  ]);
  advanceBattle(state, 500);
  assert.equal(state.terrain['1-3'], 'ruins');
  assert.equal(state.buildings.length, 0);
  assert.equal(state.units.filter(({ source }) => source === 1).length, 1);
  assert.equal(state.owners['1-3'], 'red');
});

test('a blocked exit retries and an occupied accessible exit allows another unit', () => {
  const building = { id: 1, kind: 'barracks', side: 'red', at: [1, 3], exit: [1, 2], hp: 120, nextSpawn: 500, unit: drawUnit('人族', 0, 0) };
  const state = tinyState({ '1-2': 'red' }, [building], []);
  state.terrain['1-2'] = 'plot';
  advanceBattle(state, 500, priorBoard);
  assert.equal(state.units.length, 0);
  state.terrain['1-2'] = 'ground';
  state.units.push(walking(2, 'red', [1, 2]));
  advanceBattle(state, 1000, priorBoard);
  assert.equal(state.units.length, 2);
  assert.deepEqual(state.units.map(({ at }) => at), [[1, 2], [1, 2]]);
});

test('same roster reproduces the frame sequence, with a tie and frozen final scores on a symmetric board', () => {
  const loadout = toLoadout();
  const first = simulateBattle(loadout, 25_000);
  const restored = simulateBattle(JSON.parse(JSON.stringify(loadout)), 25_000);
  assert.deepEqual(first, restored);
  assert.equal(first.result.winner, 'draw');
  assert.equal(first.frames.length, 51);
  assert.deepEqual(first.frames[0].scores, { red: 28, blue: 28 });
  assert.ok(first.frames.every(({ scores }) => scores.red + scores.blue === 56));
  assert.equal(frameAt(first, 999).elapsed, 500);
  assert.deepEqual(frameAt(first, 25_000).scores, first.result.scores);
  assert.equal(frameAt(first, 25_001).elapsed, 25_000);
  assert.equal(Object.hasOwn(first.frames[0].owners, keyAt(mapFor('red').base)), false);
  assert.ok(mapFor('red').plots.every(({ at }) => first.frames[0].owners[keyAt(at)] === 'red'));
});

test('the game continues after the main base falls and favors the side with more final ground', () => {
  const loadout = toLoadout(damageTiebreakRules);
  loadout.red.startingUnits = loadout.red.startingUnits.map((unit) => ({ ...unit, damage: 300, hp: 1000, range: 3 }));
  const battle = simulateBattle(loadout, 25_000, undefined, damageTiebreakRules);
  const destroyed = battle.frames.find((frame) => frame.terrain['14-4'] === 'ruins');
  assert.ok(destroyed && destroyed.elapsed < 25_000);
  assert.equal(Object.hasOwn(destroyed.owners, '14-4'), false);
  assert.ok(battle.frames.every(({ scores }) => scores.red + scores.blue === 56));
  assert.equal(battle.frames.at(-1).elapsed, 25_000);
  assert.ok(battle.result.scores.red > battle.result.scores.blue);
  assert.equal(battle.result.winner, 'red');
});

test('an invalid battle returns a void result and settlement refunds the stake', () => {
  const session = newSession('void', 0, [], 73);
  const active = placeBet(session, 1, { sessionId: 'void', roundNumber: 1, requestId: 'bet', side: 'red', amount: 10 }).session;
  const { lock, finish } = timeline(active.round);
  const sealed = advance(active, lock);
  const invalid = structuredClone(sealed);
  invalid.round.snapshot.battle.red.base = [0, 0];
  const returned = advance(invalid, finish);
  assert.deepEqual(returned.round.result.scores, null);
  assert.equal(returned.round.result.winner, 'void');
  assert.equal(returned.balance, 10000);
});

test('a real sealed round transfers each captured scoring tile and settles the same final battle', () => {
  const session = newSession('capture', 0, undefined, 2, undefined, priorBoard);
  session.round.combatRules = damageTiebreakRules;
  const red = placeBet(session, 1_000, { sessionId: session.id, roundNumber: 1, side: 'red', amount: 340, requestId: 'red' }).session;
  const both = placeBet(red, 2_000, { sessionId: session.id, roundNumber: 1, side: 'blue', amount: 60, requestId: 'blue' }).session;
  const time = timeline(both.round);
  const locked = advance(both, time.lock);
  const replay = simulateBattle(locked.round.snapshot.battle, 40_000, locked.round.board, locked.round.combatRules);
  const first = replay.frames[0];
  const before = frameAt(replay, 4_500);
  const after = frameAt(replay, 5_000);
  assert.deepEqual(first.scores, { red: 28, blue: 28 });
  assert.equal(before.owners['6-4'], 'blue');
  assert.equal(after.owners['6-4'], 'red');
  assert.deepEqual(after.scores, { red: before.scores.red + 1, blue: before.scores.blue - 1 });
  assert.ok(replay.frames.every(({ scores }) => scores.red + scores.blue === 56));
  const settled = advance(JSON.parse(JSON.stringify(locked)), time.finish);
  assert.deepEqual(settled.round.result.scores, replay.result.scores);
  assert.equal(settled.round.result.credit, 374);
  assert.equal(settled.balance, 9_974);
});

test('the recorded diagonal pursuit gets into range while older rounds retain their replay', () => {
  const start = newSession('recorded-reversal', 0, undefined, 0, undefined, priorBoard);
  start.round.combatRules = baseVictoryRules;
  const times = timeline(start.round);
  const { round } = advance(start, times.lock);
  assert.deepEqual(round.snapshot.battle.red.barracks.map(({ at, unit }) => [at, unit.tier]), [[[1, 5], '中型']]);
  assert.deepEqual(round.snapshot.battle.blue.barracks.map(({ at, unit }) => [at, unit.tier]), [[[9, 4], '中型']]);
  const old = JSON.parse(JSON.stringify({ ...start, version: 5, round }));
  delete old.round.combatRules;
  const restored = upgradeSession(old);
  const replay = (round) => replayFor(round.snapshot.battle, round.durations.battleMs, round.board, round.combatRules);
  const before = replay(restored.round);
  const fixed = replay({ ...round, combatRules: baseVictoryRules });
  const positions = (frame) => frame.units.map(({ id, at }) => [id, at]);
  assert.deepEqual(positions(frameAt(before, 37_500)), positions(frameAt(before, 38_500)));
  assert.notDeepEqual(positions(frameAt(before, 37_500)), positions(frameAt(before, 38_000)));
  assert.ok(fixed.frames.slice(-6).every(({ units }) =>
    units.some(({ side, at }) => side === 'red' && keyAt(at) === '5-5') &&
    units.some(({ side, at }) => side === 'blue' && keyAt(at) === '6-5')));
  const health = ({ units }) => units.reduce((sum, unit) => sum + unit.hp, 0);
  assert.ok(health(frameAt(fixed, 37_500)) < health(frameAt(fixed, 37_000)));
  assert.deepEqual(advance(restored, times.finish).round.result.scores, before.result.scores);
  assert.equal(advance(restored, times.next).round.combatRules, currentCombatRules);
});

test('an enemy soldier recolors a traversable building plot without changing the territory score', () => {
  const setup = (side, target, tier) => {
    const roster = newRoster(side, 0);
    const { at, exit } = validBuilds(roster).find(({ at }) => keyAt(at) === target);
    roster.barracks = [{ at, exit, side, unit: drawUnit('人族', 0, tier), level: 1 }];
    return battleLoadout(roster, undefined, baseVictoryRules);
  };
  const loadout = { red: setup('red', '2-5', .85), blue: setup('blue', '14-5', .5) };
  const before = simulateBattle(loadout, 60_000, undefined, damageTiebreakRules);
  const after = simulateBattle(loadout, 60_000, undefined, baseVictoryRules);
  const tile = '7-5';
  assert.equal(frameAt(before, 6500).terrain[tile], 'plot');
  assert.equal(frameAt(before, 6500).owners[tile], undefined);
  assert.equal(frameAt(after, 6000).owners[tile], 'red');
  const captured = frameAt(after, 6500);
  assert.equal(captured.owners[tile], 'blue');
  assert.ok(captured.units.some(({ side, at }) => side === 'blue' && keyAt(at) === tile));
  assert.deepEqual(captured.scores, { red: 28, blue: 28 });
  assert.ok(after.frames.every(({ scores }) => scores.red + scores.blue === 56));
});

test('single-team survivors take a contested tile and a ruin separately from scoring', () => {
  const ground = walking(1, 'blue', [6, 2]);
  const ruin = walking(2, 'blue', [8, 2]);
  const contested = walking(3, 'red', [6, 2]);
  const state = tinyState({ '6-2': 'red', '8-2': 'red' }, [], [ground, ruin, contested]);
  state.terrain['8-2'] = 'ruins';
  advanceBattle(state, 0);
  assert.equal(state.owners['6-2'], 'red');
  assert.equal(state.owners['8-2'], 'blue');
  assert.deepEqual(countGround(state.owners, state.terrain), { red: 1, blue: 0 });
  state.units.pop();
  advanceBattle(state, 500);
  assert.equal(state.owners['6-2'], 'blue');
  assert.deepEqual(countGround(state.owners, state.terrain), { red: 0, blue: 1 });
});

test('main base destruction settles at the actual tick and starts the next round five seconds later', () => {
  const session = newSession('base-win', 0, undefined, 10);
  session.round.combatRules = baseVictoryRules;
  const paid = placeBet(session, 1, { sessionId: session.id, roundNumber: 1, requestId: 'bet', side: 'red', amount: 200 }).session;
  const sealed = advance(paid, 60_000);
  const time = timeline(sealed.round);
  assert.equal(time.finish, 80_500);
  assert.equal(time.next, 85_500);
  assert.equal(advance(sealed, 80_499).balance, 9800);
  const ended = advance(sealed, 80_500);
  assert.equal(ended.balance, 10_020);
  assert.deepEqual(ended.round.result.fallenBases, ['blue']);
  assert.equal(ended.round.result.decidedBy, 'base');
  assert.equal(ended.round.result.endedAtMs, 18_500);
  assert.equal(ended.round.result.damage, undefined);
  const restored = advance(JSON.parse(JSON.stringify(ended)), 85_500);
  assert.equal(restored.round.startedAt, 85_500);
  assert.equal(restored.round.number, 2);
  assert.equal(restored.balance, 10_020);
  assert.equal(restored.previous.battleData.result.decidedBy, 'base');
});

test('base defense checks range after movement, keeps a legal lock and shares the simultaneous damage phase', () => {
  const base = { id: 1, side: 'red', at: [7,4], kind: 'base', hp: 240, name: '人族基地',
    nextAttack: 0, weapon: { damage: 12, range: 3, attackMs: 1000 } };
  const distant = { ...walking(2, 'blue', [7,1], 30), nextAttack: 10000 };
  const closer = { ...walking(3, 'blue', [7,5], 30), nextAttack: 10000 };
  const ally = walking(4, 'red', [7,5]);
  ally.nextAttack = 10000;
  const board = tinyState({ '7-1':'blue','7-5':'blue' }, [base], [distant, ally]);
  advanceBattle(board, 0);
  assert.equal(distant.hp, 18);
  assert.equal(board.shots[0].sourceKind, 'base');
  board.units.push(closer);
  advanceBattle(board, 500);
  assert.equal(board.shots.length, 0);
  advanceBattle(board, 1000);
  assert.equal(distant.hp, 6);
  assert.equal(closer.hp, 30);
  distant.at = [1,1];
  board.units = board.units.filter(u => u !== ally);
  base.hp = 6;
  closer.nextAttack = 0;
  closer.hp = 12;
  advanceBattle(board, 2000);
  assert.equal(board.buildings.length, 0);
  assert.equal(board.units.includes(closer), false);
  assert.equal(distant.hp, 6);
  assert.equal(ally.hp, 40);
  assert.equal(board.shots.filter(s => s.sourceKind === 'base').length, 1);
  advanceBattle(board, 3000);
  assert.equal(board.shots.filter(s => s.sourceKind === 'base').length, 0);
});

test('v11 keeps its passive base, then the new round seals and exports its own weapon values', () => {
  const old = newSession('old-base', 0, [], 4);
  old.version = 11;
  old.round.combatRules = 7;
  const migrated = upgradeSession(JSON.parse(JSON.stringify(old)));
  const first = advance(migrated, timeline(migrated.round).lock);
  assert.equal(first.round.snapshot.battle.red.baseAttack, undefined);
  const next = advance(first, timeline(first.round).next);
  const sealed = advance(next, timeline(next.round).lock);
  assert.equal(sealed.round.combatRules, 8);
  for (const side of ['red','blue']) {
    assert.deepEqual(sealed.round.snapshot.battle[side].baseAttack, {damage:12, range:3, attackMs:1000});
  }
  const replay = simulateBattle(sealed.round.snapshot.battle, 2000, sealed.round.board, 8);
  assert.ok(replay.frames.every(f => !f.units.length && !f.shots.length));
  assert.equal(replay.result.winner, 'draw');
});
