import { keyAt } from './roster.mjs';

const glyphs = new Map(Object.entries({
  基础卒: '卒', 巡地兵: '巡', 护阵步兵: '护', 长弩手: '弩',
  闪步卫: '闪', 石环卫: '石', 棱光射手: '棱',
  掘行虫: '掘', 扣甲虫: '甲', 脊弩虫: '脊',
  跳虫: '跳', 狂热者: '狂', 机枪兵: '枪',
}));
export const glyphFor = (name) => glyphs.get(name) ?? Array.from(name || '卒')[0];
export const unitName = (name) => name || '基础卒';

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
  for (const { from, to, side } of shots) {
    const key = `${side}/${from}/${to}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const [x, y] = center(from), [tx, ty] = center(to);
    const angle = Math.atan2(ty - y, tx - x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = ctx.fillStyle = side === 'red' ? '#ff99ac' : '#94d7ff';
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
