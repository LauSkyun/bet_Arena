import { groundUnits } from './ground-units.mjs';
import { keyAt } from './roster.mjs';

// Each entry pairs the barracks' two-character label with its soldier's glyph.
const labels = new Map(Object.entries({
  巡地兵: ['巡地', '巡'], 护阵步兵: ['护阵', '护'], 长弩手: ['长弩', '弩'],
  闪步卫: ['闪步', '闪'], 石环卫: ['石环', '石'], 棱光射手: ['棱光', '棱'],
  掘行虫: ['掘行', '掘'], 扣甲虫: ['扣甲', '甲'], 脊弩虫: ['脊弩', '脊'],
  跳虫: ['跳虫', '跳'], 狂热者: ['狂热', '狂'], 机枪兵: ['机枪', '枪'],
}));
for (const { name, label, glyph } of groundUnits) labels.set(name, [label, glyph]);
export const barracksLabel = (name) => labels.get(name)?.[0] ?? Array.from(name).slice(0, 2).join('');
export const glyphFor = (name) => labels.get(name)?.[1] ?? (!name || name === '基础卒' ? '卒' : Array.from(name)[0]);
export const unitName = (name) => name || '基础卒';

export function battleResultReason({ winner, scores, fallenBases, decidedBy, damage }) {
  if (winner === 'void' || !scores) return '';
  const fallen = Array.isArray(fallenBases) ? fallenBases.filter((side) => side === 'red' || side === 'blue') : [];
  if (fallen.includes('red') && fallen.includes('blue')) return '双方主基地同拍被摧毁，按占格判定';
  const defeatedSide = fallen[0] ?? (decidedBy === 'base' ? { red: 'blue', blue: 'red' }[winner] : undefined);
  if (defeatedSide) return `${defeatedSide === 'red' ? '红队' : '蓝队'}主基地被摧毁`;
  if (decidedBy === 'damage' || (damage && scores.red === scores.blue)) {
    return Number.isFinite(damage?.red) && Number.isFinite(damage?.blue)
      ? `占格相同，比较有效伤害 · 红 ${damage.red}／蓝 ${damage.blue}`
      : '占格相同，按有效伤害判胜';
  }
  return winner === 'draw' ? '战斗到时，双方占格相同' : '战斗到时，按占格判胜';
}

export function troopsByTile(units) {
  const tiles = new Map();
  for (const { at, side, name, range } of units) {
    const tile = keyAt(at);
    if (!tiles.has(tile)) tiles.set(tile, new Map());
    const groups = tiles.get(tile);
    const key = `${side}/${unitName(name)}/${range}`;
    if (!groups.has(key)) groups.set(key, { side, name: unitName(name), glyph: glyphFor(name), range, count: 0 });
    groups.get(key).count++;
  }
  return tiles;
}

// Use the actual rendered centers for both square and staggered hex boards.
export function drawShots(canvas, shots, cells) {
  const bounds = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const centers = new Map();
  function center(at) {
    const key = keyAt(at);
    if (!centers.has(key)) {
      const box = cells.get(key).getBoundingClientRect();
      centers.set(key, [box.left - bounds.left + box.width / 2, box.top - bounds.top + box.height / 2]);
    }
    return centers.get(key);
  }
  const drawn = new Set();
  for (const { from, to, side, effect } of shots) {
    const key = `${side}/${from}/${to}/${effect ?? 'attack'}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const [x, y] = center(from), [tx, ty] = center(to);
    const angle = Math.atan2(ty - y, tx - x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const healing = effect === 'heal';
    ctx.strokeStyle = ctx.fillStyle = healing ? '#85f0ac' : side === 'red' ? '#ff99ac' : '#94d7ff';
    if (healing) ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const length = Math.hypot(tx - x, ty - y);
    if (length === 0) {
      ctx.arc(0, 0, side === 'red' ? 8 : 11, 0, 2 * Math.PI);
      ctx.stroke();
    } else {
      ctx.moveTo(6, -4);
      ctx.lineTo(length - 9, -4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(length - 4, -4);
      ctx.lineTo(length - 12, -8);
      ctx.lineTo(length - 12, 0);
      ctx.fill();
    }
    ctx.restore();
  }
}
