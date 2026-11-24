import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceBattle, currentCombatRules, fireRevisionFor, simulateBattle } from './battle.mjs';
import { arenaProfile, profileUnit, scProfile, scRangeProfile } from './profiles.mjs';
import { battleDataFor } from './battle-data.mjs';
import { drawUnit } from './roster.mjs';
import { advance, newSession, placeBet, saveRoundDurations, timeline } from './round.mjs';
import { upgradeSession } from './storage.mjs';

const unit = (id, side, at, attrs = {}) => ({ id, side, at, hp: 120, range: 1, damage: 20, attackMs: 1000, nextAttack: 0, ...attrs });
function state(units, buildings = [], tiles = []) {
  const terrain = Object.fromEntries([...units.map(u => u.at), ...tiles].map(at => [at.join('-'), 'ground']));
  for (const b of buildings) terrain[b.at.join('-')] = b.kind;
  return { units, buildings, terrain, owners: Object.fromEntries(Object.keys(terrain).map(k => [k, 'red'])), sequence: 100 };
}

test('light prefers enemy scoring ground only on equal shortest routes', () => {
  for (const contested of [true, false]) {
    const light = unit(1, 'red', [7, 4], { tier: '轻型' });
    const board = state([light], [{id: 2, kind: 'base', side: 'blue', at: [10, 4], hp: 240}], [[8,4],[8,5],[9,4]]);
    if (contested) board.owners['8-5'] = 'blue';
    advanceBattle(board, 500);
    assert.deepEqual(light.at, contested ? [8,5] : [8,4]);
    assert.equal(board.owners['8-5'], 'red');
  }
});

test('medium keeps an available same-priority threat, and releases it when fully covered', () => {
  for (const hp of [20, 21]) {
    const guard = unit(2,'red',[7,4],{tier:'中型',target:5});
    const squad = [unit(1,'red',[7,4],{target:5}), guard, unit(3,'red',[7,5],{tier:'重型',range:3}),
      unit(4,'blue',[8,4]), unit(5,'blue',[9,4],{hp})];
    advanceBattle(state(squad),500);
    assert.equal(guard.target, hp === 20 ? 4 : 5);
  }
  const guard = unit(1,'red',[7,4],{tier:'中型',target:3});
  const board = state([guard, unit(2,'red',[7,6],{tier:'重型',range:2}), unit(3,'blue',[7,3]), unit(4,'blue',[7,5])]);
  advanceBattle(board,500);
  assert.equal(guard.target,4);
});

test('heavy holds position for a building, then switches to a soldier and keeps a legal lock', () => {
  const gun = unit(1,'red',[7,4],{tier:'重型',range:3,attackMs:500});
  const base = {id:2,side:'blue',kind:'base',hp:240,at:[7,6]};
  const rival = unit(3,'blue',[7,1],{damage:1});
  const board=state([gun],[base]);
  advanceBattle(board,500);
  assert.deepEqual(gun.at,[7,4]); assert.equal(base.hp,220);
  board.units.push(rival, unit(4,'blue',[7,3],{damage:1}));
  gun.target=3;
  advanceBattle(board,1000); assert.equal(gun.hit,3); assert.equal(base.hp,220);
  board.units=board.units.filter(u=>u!==rival);
  advanceBattle(board,1500); assert.equal(gun.hit,4); assert.deepEqual(gun.at,[7,4]);
});

test('SC profile preserves attack frequency, capped batch production, and direct damage after upgrades', () => {
  const light = profileUnit(scProfile, drawUnit('人族',0,0));
  const ranged = profileUnit(scRangeProfile, drawUnit('人族',0,.95));
  assert.deepEqual([ranged.range,ranged.sense,ranged.damage,ranged.attackMs],[6,5,9,625]);
  const gun = unit(1,'red',[7,4],{...ranged,damage:12});
  const base = {id:2,side:'blue',kind:'base',hp:240,at:[7,5]};
  const barracks = {id:3,side:'red',kind:'barracks',hp:120,at:[1,4],exit:[1,5],unit:{...light,limit:3},nextSpawn:3000};
  const board=state([gun],[base,barracks],[[1,5]]);
  const hitTimes=[];
  for(let t=0;t<=6000;t+=500){
    advanceBattle(board,t);
    if(gun.hit===2) hitTimes.push(t);
    const expected=t<3000?0:t<6000?2:3;
    assert.equal(board.units.filter(u=>u.source===3).length, expected);
  }
  assert.deepEqual(hitTimes,[0,1000,1500,2000,2500,3500,4000,4500,5000,6000]);
  assert.equal(base.hp,240-10*10);
});

test('configuration switch persists across old-round refresh, sealing, replay and single settlement',()=>{
  const original=newSession('old',0,[],2,{betMs:5000,battleMs:5000});
  original.version=8; original.round.combatRules=4; delete original.round.profile; delete original.nextProfile;
  const migrated=upgradeSession(original);
  const saved=saveRoundDurations(migrated,1,5,5,scProfile).session;
  assert.equal(saved.round.combatRules,4);
  assert.equal(saveRoundDurations(saved,2,5,5,'unknown').session,saved);
  const first=advance(saved,timeline(saved.round).lock);
  const next=advance(JSON.parse(JSON.stringify(first)),timeline(first.round).next);
  assert.equal(next.round.profile,scProfile); assert.equal(next.round.combatRules,currentCombatRules);
  const ticket={sessionId:'old',roundNumber:2,side:'blue',requestId:'one',amount:100};
  const paid=placeBet(next,next.round.startedAt+1,ticket).session;
  const queued=saveRoundDurations(paid,next.round.startedAt+2,5,5,arenaProfile).session;
  const lock=advance(queued,timeline(queued.round).lock);
  const data=battleDataFor(lock.round,[]); assert.equal(data.profile,scProfile);
  assert.ok(data.loadout.blue.barracks.length>0); assert.ok(data.loadout.blue.barracks.every(b=>b.unit.spawnMs>=3000));
  const replay=simulateBattle(data.loadout,5000,data.board,data.combatRules);
  const ended=advance(JSON.parse(JSON.stringify(lock)),timeline(lock.round).finish);
  assert.equal(replay.result.winner,ended.round.result.winner);
  assert.equal(advance(ended,timeline(ended.round).finish+1).balance,ended.balance);
  const third=advance(ended,timeline(ended.round).next); assert.equal(third.round.profile,arenaProfile);
  assert.deepEqual(third.previous.battleData.loadout,data.loadout);
});

test('covered enemies free later soldiers to advance, wait behind obstacles, then reconsider', () => {
  for (const hasPath of [true, false]) {
    const follower = unit(2, 'red', [7, 4]);
    const rival = unit(3, 'blue', [7, 5], { hp: 20, nextAttack: 5000 });
    const leader = unit(1, 'red', [7, 4], { nextAttack: 5000 });
    follower.nextAttack = 5000;
    const base = { id: 4, kind: 'base', side: 'blue', at: [10, 4], hp: 240 };
    const board = state([leader, follower, rival], [base], hasPath ? [[8, 4], [9, 4]] : []);
    advanceBattle(board, 500);
    assert.equal(leader.target, rival.id);
    assert.deepEqual(follower.at, hasPath ? [8, 4] : [7, 4]);
    assert.equal(follower.plannedTarget, hasPath ? base.id : null);
    rival.hp = 21;
    advanceBattle(board, 1000);
    assert.equal(follower.plannedTarget, rival.id);
  }
});

test('only full-role heavy fire may switch from a reachable lock to an enemy already in range', () => {
  for (const rules of [4, 5, 6]) {
    for (const tier of [undefined, '轻型', '中型', '重型']) {
      const shooter = unit(1, 'red', [7, 4], { tier, target: 2, damage: 6 });
      const locked = unit(2, 'blue', [7, 7], { hp: 100, nextAttack: 1000 });
      const closer = unit(3, 'blue', [7, 5], { hp: 100, nextAttack: 1000 });
      const board = state([shooter, locked, closer], [], [[7, 6]]);
      advanceBattle(board, 0, undefined, rules);
      const heavyFire = rules === 6 && tier === '重型';
      assert.equal(closer.hp, heavyFire ? 94 : 100);
      assert.equal(locked.hp, 100);
      if (!heavyFire) {
        assert.equal(shooter.target, locked.id);
        assert.equal(shooter.nextAttack, 0);
        board.units = [shooter, closer];
        advanceBattle(board, 0, undefined, rules);
        assert.equal(shooter.target, closer.id);
        assert.equal(closer.hp, 94);
      }
    }
  }
});

test('upgrading a candidate keeps its firing revision for the open round and its export', () => {
  const old = newSession('v9', 0, [], 4, { betMs: 1000, battleMs: 2000 });
  old.version = 9;
  delete old.round.fireRevision;
  const saved = upgradeSession(old);
  assert.equal(fireRevisionFor(saved.round), 1);
  const rolled = advance(saved, timeline(saved.round).next);
  assert.equal(fireRevisionFor(rolled.previous.battleData), 1);
  assert.equal(fireRevisionFor(battleDataFor(rolled.round, [])), 2);
});
