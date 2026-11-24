import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addBuilding, addSoldier, legalSites, mirrorScenario, newScenario, runScenario, setBuildingLevel, setHealth } from './gm-scenario.mjs';
import { simulateBattle } from './battle.mjs';

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
