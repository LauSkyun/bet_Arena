// Versioned level-one production profile. Intervals are in milliseconds.
export const groundUnits = Object.freeze([
  { unitId: 2, origin: '人族', name: '陆战队员', label: '陆战', glyph: '陆', quality: '绿', effect: 'single',
    hp: 100, damage: 9, range: 3, attackMs: 500, moveMs: 1000, spawnMs: 3000, spawnCount: 1, limit: 8 },
  { unitId: 3, origin: '人族', name: '火蝠', label: '火蝠', glyph: '蝠', quality: '蓝', effect: 'fan',
    hp: 145, damage: 39, range: 1, attackMs: 1000, moveMs: 1500, spawnMs: 5000, spawnCount: 1, limit: 4 },
  { unitId: 4, origin: '人族', name: '幽灵', label: '幽灵', glyph: '幽', quality: '紫', effect: 'single',
    hp: 60, damage: 88, range: 5, attackMs: 2000, moveMs: 1000, spawnMs: 13000, spawnCount: 1, limit: 3 },
  { unitId: 5, origin: '人族', name: '秃鹰车', label: '秃鹰', glyph: '鹰', quality: '绿', effect: 'single',
    hp: 80, damage: 15, range: 3, attackMs: 1000, moveMs: 500, spawnMs: 3000, spawnCount: 1, limit: 6 },
  { unitId: 6, origin: '人族', name: '攻城坦克', label: '攻城', glyph: '城', quality: '蓝', effect: 'single',
    hp: 155, damage: 30, range: 3, attackMs: 1000, moveMs: 1000, spawnMs: 6000, spawnCount: 1, limit: 4 },
  { unitId: 7, origin: '人族', name: '歌利亚', label: '歌利', glyph: '歌', quality: '紫', effect: 'single',
    hp: 150, damage: 27, range: 5, attackMs: 1000, moveMs: 1500, spawnMs: 7000, spawnCount: 1, limit: 3 },
  { unitId: 10, origin: '人族', name: '医疗兵', label: '医疗', glyph: '医', quality: '紫', effect: 'heal',
    hp: 75, damage: 0, healing: 12, range: 3, attackMs: 1000, moveMs: 1000, spawnMs: 5000, spawnCount: 1, limit: 3 },
  { unitId: 12, origin: '神族', name: '狂热者', label: '狂热', glyph: '狂', quality: '绿', effect: 'single',
    hp: 100, damage: 24, range: 1, attackMs: 1000, moveMs: 1000, spawnMs: 4000, spawnCount: 1, limit: 6 },
  { unitId: 13, origin: '神族', name: '追猎者', label: '追猎', glyph: '追', quality: '蓝', effect: 'single',
    hp: 100, damage: 19, range: 3, attackMs: 1000, moveMs: 500, spawnMs: 4000, spawnCount: 1, limit: 5 },
  { unitId: 14, origin: '神族', name: '黑暗圣堂武士', label: '圣堂', glyph: '圣', quality: '紫', effect: 'single',
    hp: 90, damage: 65, range: 1, attackMs: 2000, moveMs: 1000, spawnMs: 6000, spawnCount: 1, limit: 4 },
  { unitId: 15, origin: '神族', name: '执政官', label: '执政', glyph: '执', quality: '金', effect: 'splash',
    hp: 165, damage: 16, range: 3, attackMs: 500, moveMs: 1000, spawnMs: 8000, spawnCount: 1, limit: 3 },
  { unitId: 16, origin: '神族', name: '金甲虫', label: '金甲', glyph: '甲', quality: '蓝', effect: 'splash',
    hp: 74, damage: 100, range: 5, attackMs: 3000, moveMs: 1500, spawnMs: 10000, spawnCount: 1, limit: 2 },
  { unitId: 17, origin: '神族', name: '巨像', label: '巨像', glyph: '巨', quality: '金', effect: 'line',
    hp: 200, damage: 30, range: 3, attackMs: 1000, moveMs: 1000, spawnMs: 9000, spawnCount: 1, limit: 2 },
  { unitId: 22, origin: '虫族', name: '小狗', label: '小狗', glyph: '狗', quality: '绿', effect: 'single',
    hp: 75, damage: 6, range: 1, attackMs: 500, moveMs: 500, spawnMs: 3000, spawnCount: 2, limit: 10 },
  { unitId: 23, origin: '虫族', name: '刺蛇', label: '刺蛇', glyph: '刺', quality: '蓝', effect: 'single',
    hp: 80, damage: 10, range: 3, attackMs: 500, moveMs: 1500, spawnMs: 4000, spawnCount: 1, limit: 5 },
  { unitId: 25, origin: '虫族', name: '猛犸', label: '猛犸', glyph: '犸', quality: '金', effect: 'single',
    hp: 280, damage: 28, range: 1, attackMs: 500, moveMs: 500, spawnMs: 14000, spawnCount: 1, limit: 2 },
  { unitId: 26, origin: '虫族', name: '蟑螂', label: '蟑螂', glyph: '蟑', quality: '绿', effect: 'single',
    hp: 105, damage: 15, range: 3, attackMs: 1000, moveMs: 1000, spawnMs: 4000, spawnCount: 1, limit: 6 },
  { unitId: 27, origin: '虫族', name: '爆虫', label: '爆虫', glyph: '爆', quality: '蓝', effect: 'self-destruct',
    hp: 30, damage: 68, range: 1, attackMs: 0, moveMs: 500, spawnMs: 4500, spawnCount: 1, limit: 5 },
  { unitId: 28, origin: '虫族', name: '遁地兽', label: '遁地', glyph: '遁', quality: '紫', effect: 'single',
    hp: 110, damage: 30, range: 3, attackMs: 1000, moveMs: 1000, spawnMs: 6000, spawnCount: 1, limit: 3 },
].map(unit => Object.freeze({ ...unit, sense: Math.max(4, unit.range) })));

const weights = { 绿: 45, 蓝: 35, 紫: 15, 金: 5 };
export function drawGroundUnit(origin, first, qualityRoll, memberRoll) {
  const pool = groundUnits.filter(unit => unit.origin === origin);
  const groups = Object.entries(weights).map(([quality, weight]) => ({ weight,
    units: pool.filter(unit => unit.quality === quality && (!first || quality === '绿')),
  })).filter(group => group.units.length);
  let cursor = qualityRoll * groups.reduce((sum, group) => sum + group.weight, 0);
  for (const { weight, units } of groups) {
    if (cursor < weight) return units[Math.floor(memberRoll * units.length)];
    cursor -= weight;
  }
  throw Error('兵种抽取值超出范围');
}
