import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addBuilding, addSoldier, legalSites, mirrorScenario, newScenario, runScenario, setBuildingLevel, setHealth } from './gm-scenario.mjs';
import { groundProductionRules, simulateBattle } from './battle.mjs';

const treatments = (frame) => frame.shots.filter(({ effect }) => effect === 'heal');

test('GM uses legal sites, explicit unit IDs, preserved health and reproducible mirrored exits', () => {
  const r = newScenario();
  addBuilding(r, 'red', [2,4], 22);
  const b = r.loadout.red.barracks[0];
  b.hp = setHealth(10, b.maxHp);
  setBuildingLevel(b, 2);
  assert.equal(b.unit.hp, 90);
  assert.throws(()=>setBuildingLevel(b, 4));
  assert.throws(()=>setHealth(121, b.maxHp));
  assert.equal(b.hp, 10);
  assert.throws(()=>addSoldier(r, 'red', b.at, 22, 1));
  assert.throws(()=>addBuilding(r, 'red', r.loadout.blue.base, 22));
  const next = legalSites(r,'red')[0].at;
  addSoldier(r, 'red', next, 2, 1, 45);
  assert.ok(legalSites(r,'red').every(s=>String(s.at)!==String(next)));
  const mirror=mirrorScenario(r);
  assert.deepEqual(mirrorScenario(mirror),r);
  assert.equal(mirror.loadout.blue.barracks[0].hp,10);
  for(const setup of [r,mirror]) {
    const replay=runScenario(setup);
    const batch = replay.frames.find(f => f.elapsed === 3000).units.filter(u => u.name === '小狗');
    assert.equal(batch.length, 2);
    assert.ok(batch.every(u => u.maxHp === 90 && u.level === 2));
    assert.deepEqual(runScenario(JSON.parse(JSON.stringify(setup))),replay);
  }
});

test('GM shares simultaneous combat, logs dead targets and replays from frozen initial health', () => {
  const r = newScenario();
  addSoldier(r,'red',[7,4],2,1,45);
  addSoldier(r,'blue',[8,4],2,1,6);
  const before=JSON.stringify(r);
  const battle=runScenario(r);
  const first=battle.frames[0];
  assert.equal(first.shots.length,2);
  assert.equal(first.units.length,1);
  assert.equal(first.units[0].hp,36);
  assert.equal(first.shots.find(s=>s.side==='red').before,6);
  assert.equal(first.shots.find(s=>s.side==='red').targetName,'陆战队员');
  assert.equal(JSON.stringify(r),before);
  assert.deepEqual(runScenario(r),battle);
  assert.equal(simulateBattle(r.loadout,40000,r.board,r.combatRules,r.fireRevision).result.winner,'void');
});

test('medics prioritize remaining HP percentage over absolute HP, and mirror the same result', () => {
  const round = newScenario();
  addBuilding(round, 'red', [2, 4], 22);
  round.loadout.red.barracks[0].hp = 10;
  addSoldier(round, 'red', [7, 4], 10, 1);
  addSoldier(round, 'red', [7, 2], 2, 1, 45);
  addSoldier(round, 'red', [7, 6], 25, 1, 84);
  for (const setup of [round, mirrorScenario(round)]) {
    const replay = runScenario(setup);
    const first = replay.frames[0];
    assert.deepEqual(treatments(first).map(({ targetName, power, before, after }) =>
      [targetName, power, before, after]), [['猛犸', 12, 84, 96]]);
    assert.equal(first.units.find(({ name }) => name === '陆战队员').hp, 45);
    assert.equal(first.buildings.find(({ kind }) => kind === 'barracks').hp, 10);
    assert.deepEqual(runScenario(JSON.parse(JSON.stringify(setup))), replay);
  }
  const old = runScenario({ ...round, combatRules: groundProductionRules });
  assert.ok(old.frames.every((frame) => treatments(frame).length === 0));
  assert.equal(old.frames[0].units.find(({ name }) => name === '猛犸').hp, 84);
});

test('tied health ratios use distance, then spawn order, with a strict three-hex cast range', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 3], 10, 1);
  addSoldier(round, 'red', [7, 7], 7, 1, 1);
  addSoldier(round, 'red', [7, 6], 2, 1, 45);
  addSoldier(round, 'red', [7, 2], 2, 1, 45);
  addSoldier(round, 'red', [7, 4], 2, 1, 45);
  assert.deepEqual(treatments(runScenario(round).frames[0])[0].to, [7, 2]);
  round.loadout.red.startingUnits.splice(-2);
  assert.deepEqual(treatments(runScenario(round).frames[0])[0].to, [7, 6]);
  round.loadout.red.startingUnits.pop();
  const replay = runScenario(round);
  assert.equal(treatments(replay.frames[0]).length, 0);
  assert.equal(treatments(replay.frames[1]).length, 0);
  assert.deepEqual(treatments(replay.frames[2])[0].to, [7, 7]);
});

test('healing caps at missing HP, ignores enemies, buildings, full health and the medic itself', () => {
  const round = newScenario();
  round.loadout.red.hp = 1;
  addBuilding(round, 'red', [2, 4], 22);
  round.loadout.red.barracks[0].hp = 1;
  addSoldier(round, 'red', [3, 4], 10, 1, 10);
  addSoldier(round, 'red', [3, 5], 2, 1, 99);
  addSoldier(round, 'red', [4, 4], 2, 1);
  addSoldier(round, 'blue', [5, 5], 27, 1, 1);
  const replay = runScenario(round);
  assert.deepEqual(treatments(replay.frames[0]).map(({ power, before, after }) => [power, before, after]), [[1, 99, 100]]);
  assert.equal(treatments(replay.frames[1]).length, 0);
  assert.equal(treatments(replay.frames[2]).length, 0);
  assert.deepEqual(replay.frames[2].units.find(({ name }) => name === '医疗兵').at, [3, 4]);
});

test('same-beat damage and healing resolve together before death, with a one-second cooldown', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 4], 10, 1);
  addSoldier(round, 'red', [7, 5], 2, 1, 70);
  addSoldier(round, 'blue', [7, 7], 23, 1);
  const [first, half, second] = runScenario(round).frames;
  assert.deepEqual(treatments(first).map(({ power, before, after }) => [power, before, after]), [[12, 70, 72]]);
  assert.equal(treatments(half).length, 0);
  assert.equal(half.units.find(({ name }) => name === '陆战队员').hp, 62);
  assert.deepEqual(treatments(second).map(({ power, before, after }) => [power, before, after]), [[12, 62, 64]]);
  round.loadout.red.startingUnits[1].currentHp = 5;
  assert.equal(runScenario(round).frames[0].units.find(({ name }) => name === '陆战队员').hp, 7);
  round.loadout.red.startingUnits[1].currentHp = 100;
  const [full, wounded] = runScenario(round).frames;
  assert.equal(treatments(full).length, 0);
  assert.deepEqual(treatments(wounded).map(({ power, before, after }) => [power, before, after]), [[12, 90, 92]]);
});

test('two medics respect the shared healing cap and can each heal another medic', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 4], 10, 2, 88);
  addSoldier(round, 'red', [7, 5], 10, 3, 104);
  addSoldier(round, 'red', [7, 6], 25, 1, 260);
  const first = runScenario(round).frames[0];
  assert.deepEqual(treatments(first).map(({ power, before, after }) => [power, before, after]), [[14, 260, 280], [6, 260, 280]]);
  round.loadout.red.startingUnits.pop();
  const withoutMammoth = runScenario(round).frames[0];
  assert.deepEqual(treatments(withoutMammoth).map(({ power, before, after }) => [power, before, after]), [[1, 104, 105], [2, 88, 90]]);
});
