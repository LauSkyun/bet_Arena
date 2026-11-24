import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glyphFor, troopsByTile } from './board-display.mjs';
import { advanceBattle } from './battle.mjs';

test('glyphs are unique across the two unit pools, and counts stay within one side and type', () => {
  const names = ['基础卒','巡地兵','护阵步兵','长弩手','闪步卫','石环卫','棱光射手','掘行虫','扣甲虫','脊弩虫','跳虫','狂热者','机枪兵'];
  assert.equal(new Set(names.map(glyphFor)).size, names.length);
  assert.ok(names.every(name => name.includes(glyphFor(name))));
  const units = [['red','机枪兵'],['red','机枪兵'],['red','跳虫'],['blue','机枪兵'],['blue',undefined]]
    .map(([side, name]) => ({side, name, at:[7,4], range:name === '机枪兵' ? 5 : 1}));
  const groups = [...troopsByTile(units).get('7-4').values()];
  assert.deepEqual(groups.map(g => [g.side,g.glyph,g.count]), [['red','枪',2],['red','跳',1],['blue','枪',1],['blue','卒',1]]);
});

test('the impact trace includes mutually lethal hits and excludes targets outside range or under cooldown', () => {
  const unit = (side, id, at, range, nextAttack = 0) => ({ side, id, at, range, nextAttack, hp: 10, damage: 10, attackMs: 1000 });
  for (const [range, blueAt, ready, hits] of [[1,[7,4],0,2],[3,[7,7],0,2],[2,[7,7],0,0],[3,[7,7],1000,0]]) {
    const from = [7,4];
    const state = { terrain:{'7-4':'ground','7-7':'ground'}, owners:{}, buildings:[],
      units:[unit('red',1,from,range,ready),unit('blue',2,blueAt,range,ready)] };
    advanceBattle(state,0);
    assert.equal(state.shots.length,hits);
    if (hits) {
      assert.deepEqual(state.shots.map(s=>[s.side,s.from,s.to,s.range]),[['red',from,blueAt,range],['blue',blueAt,from,range]]);
      assert.equal(state.units.length,0);
    }
  }
});
