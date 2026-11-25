import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groundProductionRules, groundHealingRules, groundAreaRules } from './battle.mjs';
import { addBuilding, addSoldier, mirrorScenario, newScenario, runScenario } from './gm-scenario.mjs';
import { boardColumns, boardRows } from './roster.mjs';

const blasts = (frame) => frame.shots.filter(({ effect }) => effect === 'self-destruct');

test('the blast hits its target, other ground enemies on its hex and the adjacent ring, then consumes the attacker', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 3], 27, 1);
  addSoldier(round, 'red', [7, 4], 10, 1);
  Object.assign(round.loadout.red.startingUnits[1], { hp: 200, currentHp: 200 });
  for (const at of [[7, 4], [7, 4], [7, 5], [7, 6], [8, 4]]) addSoldier(round, 'blue', at, 25, 1);
  round.loadout.blue.startingUnits.at(-1).layer = 'air';
  for (const [setup, mirrored] of [[round, false], [mirrorScenario(round), true]]) {
    const replay = runScenario(setup);
    const first = replay.frames[0];
    const side = mirrored ? 'blue' : 'red';
    const shots = blasts(first);
    const originalHex = ([r, c]) => mirrored ? [boardRows(round.board) + 1 - r, boardColumns + 1 - c] : [r, c];
    assert.deepEqual(shots.map(({ to, primary, applied, before, after }) => [originalHex(to), primary, applied, before, after]), [
      [[7, 4], true, 68, 280, 212], [[7, 4], false, 34, 280, 246], [[7, 5], false, 34, 280, 246],
    ]);
    assert.equal(new Set(shots.map(({ targetId }) => targetId)).size, shots.length);
    assert.equal(first.units.filter((unit) => unit.side !== side && unit.hp === 280).length, 2);
    const friend = first.units.find((unit) => unit.side === side && unit.name === '医疗兵');
    assert.ok(friend);
    assert.ok(shots.every((shot) => shot.targetId !== friend.id));
    assert.ok(!first.units.some(({ name }) => name === '爆虫'));
    assert.ok(replay.frames.slice(1).every((frame) => blasts(frame).length === 0));
    assert.deepEqual(runScenario(JSON.parse(JSON.stringify(setup))), replay);
  }
  for (const combatRules of [groundProductionRules, groundHealingRules, groundAreaRules]) {
    const first = runScenario({ ...round, combatRules }).frames[0];
    assert.equal(blasts(first).length, 0);
    assert.ok(first.units.some(({ name }) => name === '爆虫'));
  }
});

test('distance two waits, then advancing to a ground enemy at distance one triggers exactly once', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 3], 27, 1);
  addSoldier(round, 'blue', [7, 4], 10, 1);
  round.loadout.blue.startingUnits[0].layer = 'air';
  addSoldier(round, 'blue', [7, 5], 10, 1);
  const replay = runScenario(round);
  const [first, next] = replay.frames;
  assert.equal(blasts(first).length, 0);
  assert.ok(first.units.some(({ name }) => name === '爆虫'));
  assert.deepEqual(blasts(next).map(({ from, to, after }) => [from, to, after]), [[[7, 4], [7, 5], 7]]);
  assert.ok(!next.units.some(({ name }) => name === '爆虫'));
  assert.ok(replay.frames.slice(2).every((frame) => blasts(frame).length === 0));
});

test('an attack before contact prevents later detonation; mutual lethal damage still resolves on the trigger beat', () => {
  const beforeContact = newScenario();
  addSoldier(beforeContact, 'red', [7, 3], 27, 1);
  addSoldier(beforeContact, 'blue', [7, 5], 4, 1);
  const killed = runScenario(beforeContact);
  assert.ok(!killed.frames[0].units.some(({ name }) => name === '爆虫'));
  assert.ok(killed.frames.every((frame) => blasts(frame).length === 0));

  const simultaneous = newScenario();
  addSoldier(simultaneous, 'red', [7, 3], 27, 1, 10);
  addSoldier(simultaneous, 'red', [7, 2], 10, 1);
  addSoldier(simultaneous, 'blue', [7, 4], 4, 1);
  const replay = runScenario(simultaneous);
  const first = replay.frames[0];
  assert.equal(blasts(first)[0].power, 68);
  assert.ok(first.shots.some(({ name, targetName, after }) => name === '幽灵' && targetName === '爆虫' && after === 0));
  assert.ok(first.shots.some(({ effect, targetName, after }) => effect === 'heal' && targetName === '爆虫' && after === 0));
  assert.deepEqual(first.units.map(({ name }) => name), ['医疗兵']);
  assert.ok(replay.frames.slice(1).every((frame) => blasts(frame).length === 0));

  simultaneous.loadout.blue.startingUnits[0].damage = 1;
  const healed = runScenario(simultaneous).frames[0];
  assert.equal(healed.shots.find(({ effect }) => effect === 'heal').after, 0);
  assert.ok(!healed.units.some(({ name }) => name === '爆虫'));
});

test('a building can trigger a direct hit while adjacent buildings take no secondary damage', () => {
  const round = newScenario();
  addBuilding(round, 'blue', [13, 4], 22);
  addBuilding(round, 'blue', [13, 3], 22);
  round.loadout.blue.barracks[0].hp = 65;
  addSoldier(round, 'red', [12, 4], 27, 1);
  const first = runScenario(round).frames[0];
  assert.deepEqual(blasts(first).map(({ to, primary, power, applied, after }) => [to, primary, power, applied, after]), [
    [[13, 4], true, 68, 65, 0],
  ]);
  assert.equal(first.terrain['13-4'], 'ruins');
  assert.equal(first.buildings.find(({ at }) => String(at) === '13,3').hp, 120);
  assert.equal(first.buildings.find(({ at }) => String(at) === '14,4').hp, 240);
});
