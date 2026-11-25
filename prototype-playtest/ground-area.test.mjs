import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groundHealingRules } from './battle.mjs';
import { addBuilding, addSoldier, mirrorScenario, newScenario, runScenario } from './gm-scenario.mjs';
import { boardColumns, boardRows } from './roster.mjs';

function hits(round, effect) {
  return runScenario(round).frames[0].shots.filter((shot) => shot.effect === effect);
}

function assertMirroredHits(round, effect, expected) {
  const flip = ([r, c]) => [boardRows(round.board) + 1 - r, boardColumns + 1 - c];
  for (const [setup, mirrored] of [[round, false], [mirrorScenario(round), true]]) {
    const shots = hits(setup, effect);
    assert.equal(new Set(shots.map(({ targetId }) => targetId)).size, shots.length);
    assert.deepEqual(shots.map(({ to, power, primary, before, after }) =>
      [mirrored ? flip(to) : to, power, primary, before - after]), expected);
  }
}

test('Firebat hits the three forward neighbours once each, excluding friends and the rear', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 4], 3, 1);
  addSoldier(round, 'red', [6, 5], 10, 1);
  for (const at of [[7, 5], [6, 5], [8, 5], [7, 3]]) addSoldier(round, 'blue', at, 25, 1);
  assertMirroredHits(round, 'fan', [
    [[7, 5], 39, true, 39], [[6, 5], 39, false, 39], [[8, 5], 39, false, 39],
  ]);
});

test('Colossus hits all three line hexes, leaves off-line units alone, and mirrors directional ties', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 4], 17, 1);
  for (const at of [[7, 5], [7, 6], [7, 7], [8, 5]]) addSoldier(round, 'blue', at, 25, 1);
  assertMirroredHits(round, 'line', [
    [[7, 5], 30, true, 30], [[7, 6], 30, false, 30], [[7, 7], 30, false, 30],
  ]);

  round.loadout.blue.startingUnits = [];
  for (const at of [[8, 5], [9, 5], [10, 6], [9, 6]]) addSoldier(round, 'blue', at, 25, 1);
  assertMirroredHits(round, 'line', [
    [[8, 5], 30, true, 30], [[9, 5], 30, false, 30], [[10, 6], 30, false, 30],
  ]);

  round.loadout.blue.startingUnits = [];
  for (const at of [[8, 6], [7, 6], [7, 7], [9, 5]]) addSoldier(round, 'blue', at, 25, 1);
  assertMirroredHits(round, 'line', [
    [[8, 6], 30, true, 30], [[7, 6], 30, false, 30], [[7, 7], 30, false, 30],
  ]);
});

test('Reaver and Archon splash same and adjacent hexes, with integer half damage and ground filtering', () => {
  for (const [unitId, level, direct, splash] of [[16, 1, 100, 50], [15, 1, 16, 8], [15, 2, 19, 9]]) {
    const round = newScenario();
    addSoldier(round, 'red', [7, 3], unitId, level);
    addSoldier(round, 'red', [7, 6], 10, 1);
    for (const at of [[7, 4], [7, 5], [7, 5], [7, 6], [7, 7], [8, 5]]) addSoldier(round, 'blue', at, 25, 1);
    const enemies = round.loadout.blue.startingUnits;
    enemies[0].layer = 'air';
    enemies.at(-1).layer = 'air';
    assertMirroredHits(round, 'splash', [
      [[7, 5], direct, true, direct], [[7, 5], splash, false, splash], [[7, 6], splash, false, splash],
    ]);
  }
});

test('splash damages only the targeted building and falls back to a single hit under rule 10', () => {
  const round = newScenario();
  addSoldier(round, 'red', [10, 4], 16, 1);
  addBuilding(round, 'blue', [13, 4], 22);
  addBuilding(round, 'blue', [13, 3], 22);
  const frame = runScenario(round).frames[0];
  const splash = frame.shots.filter(({ effect }) => effect === 'splash');
  assert.deepEqual(splash.map(({ to, power, applied, before, after }) => [to, power, applied, before, after]), [
    [[13, 4], 100, 100, 120, 20],
  ]);
  assert.equal(frame.buildings.find(({ at }) => String(at) === '13,3').hp, 120);
  assert.equal(frame.buildings.find(({ at }) => String(at) === '14,4').hp, 240);

  addSoldier(round, 'blue', [11, 4], 25, 1);
  addSoldier(round, 'blue', [11, 5], 25, 1);
  const old = runScenario({ ...round, combatRules: groundHealingRules }).frames[0];
  const legacyHits = old.shots.filter(({ name }) => name === '金甲虫');
  assert.equal(legacyHits.length, 1);
  assert.equal(legacyHits[0].power, 100);
  assert.equal(legacyHits[0].effect, undefined);
});

test('secondary damage and treatment share a beat and report effective damage after overkill', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 3], 16, 1);
  addSoldier(round, 'blue', [7, 5], 25, 1, 30);
  addSoldier(round, 'blue', [7, 6], 2, 1, 45);
  addSoldier(round, 'blue', [7, 7], 10, 1);
  const frame = runScenario(round).frames[0];
  assert.deepEqual(frame.shots.filter(({ effect }) => effect === 'splash').map(({ primary, power, applied, before, after }) =>
    [primary, power, applied, before, after]), [[true, 100, 42, 30, 0], [false, 50, 45, 45, 0]]);
  const heal = frame.shots.find(({ effect }) => effect === 'heal');
  assert.equal(heal.targetName, '猛犸');
  assert.equal(heal.power, 12);

  round.loadout.blue.startingUnits[0].currentHp = 280;
  const rescued = runScenario(round).frames[0];
  assert.deepEqual(rescued.shots.filter(({ effect }) => effect === 'splash').map(({ after }) => after), [180, 7]);
  assert.equal(rescued.shots.find(({ effect }) => effect === 'heal').targetName, '陆战队员');
});
