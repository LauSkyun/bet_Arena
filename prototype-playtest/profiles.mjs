import scUnits from './sc-units-v1.json' with { type: 'json' };

export const arenaProfile = 'arena-v1';
export const scProfile = 'sc-sample-v1';
export const scRangeProfile = 'sc-range-v1';
export const profiles = Object.freeze({
  [arenaProfile]: '竞技场基准',
  [scProfile]: 'SC 基础数值',
  [scRangeProfile]: 'SC 数值 · 机枪兵射程强化',
});

export function profileUnit(profile, unit) {
  if (profile !== scProfile && profile !== scRangeProfile) return unit;
  const source = scUnits[unit.tier];
  const range = Math.max(1, Math.round(source.range));
  const enhanced = profile === scRangeProfile && unit.tier === '重型';
  return { ...unit, name: source.name, hp: source.hp, damage: source.damage,
    range: range + Number(enhanced), sense: Math.max(4, range),
    attackMs: Math.round(1000 / source.attacksPerSecond),
    spawnMs: Math.ceil(source.productionSeconds * 2) * 500, spawnCount: source.spawnCount,
    ...(enhanced ? { skill: 'range-tradeoff', directDamagePercent: 80 } : {}),
  };
}
