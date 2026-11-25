import { distance, keyAt, neighbours } from './roster.mjs';

export const groundAreaLabels = Object.freeze({ fan: '扇扫', line: '直线扫射', splash: '溅射' });
export const isGroundTarget = (target) => (target.layer ?? 'ground') === 'ground';

// In the staggered grid, adjacent steps have equal length in (x, sqrt(3) * row).
const horizontal = ([row, col]) => 2 * col + (row & 1);

function directionToward(attacker, target, adjacent) {
  const dx = horizontal(target) - horizontal(attacker);
  const dy = target[0] - attacker[0];
  const alignment = (at) => dx * (horizontal(at) - horizontal(attacker)) + 3 * dy * (at[0] - attacker[0]);
  // Strict comparison preserves the mirrored neighbour order on a tie.
  return adjacent.reduce((best, at) => alignment(at) > alignment(best) ? at : best);
}

export function secondaryGroundTargets(unit, primary, units, board) {
  const enemies = units.filter((target) => target.id !== primary.id && target.side !== unit.side && isGroundTarget(target));
  if (unit.effect === 'splash') return enemies.filter((target) => distance(target.at, primary.at, board) <= 1);

  const adjacent = neighbours(unit.at, unit.side, board);
  const forward = directionToward(unit.at, primary.at, adjacent);
  const cells = unit.effect === 'fan' ? adjacent.filter((at) => distance(at, forward, board) <= 1) : [];
  if (unit.effect === 'line') {
    const dx = horizontal(forward) - horizontal(unit.at);
    const dy = forward[0] - unit.at[0];
    for (let step = 1; step <= unit.range; step++) {
      const row = unit.at[0] + dy * step;
      cells.push([row, (horizontal(unit.at) + dx * step - (row & 1)) / 2]);
    }
  }
  const covered = new Set(cells.map(keyAt));
  return enemies.filter((target) => covered.has(keyAt(target.at)));
}
