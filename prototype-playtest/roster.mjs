export const themes = Object.freeze(['人族', '神族', '虫族']);
export const currentBoard = 'square-14';
export const priorBoard = 'square-10';
export const legacyBoard = 'square-11';
export const boardRows = (board = currentBoard) => board === legacyBoard ? 11 : board === priorBoard ? 10 : 14;
export const boardColumns = 7;

export const hasExpansion = (board = currentBoard) => board === currentBoard;
export const onBoard = ([row, col], board) => row >= 1 && row <= boardRows(board) && col >= 1 && col <= boardColumns;
export const distance = ([row, col], [otherRow, otherCol]) => Math.abs(row - otherRow) + Math.abs(col - otherCol);
export function neighbours([row, col], side) {
  const vertical = side === 'blue' ? 1 : -1;
  return [[row, col - 1], [row, col + 1], [row + vertical, col], [row - vertical, col]];
}

export function openingOwner(row, board) {
  if (board === legacyBoard) return row <= 3 ? 'red' : row >= 9 ? 'blue' : null;
  return row <= boardRows(board) / 2 ? 'red' : 'blue';
}
const redMap = {
  base: [1, 4],
  plots: [
    { at: [1, 3], exit: [1, 2] }, { at: [1, 5], exit: [1, 6] },
    { at: [2, 3], exit: [2, 2] }, { at: [2, 4], exit: [3, 4] },
    { at: [2, 5], exit: [2, 6] }, { at: [3, 5], exit: [4, 5] },
  ],
  starts: [[3, 2], [3, 3], [3, 6]],
};
const expansionPlots = [
  [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7],
  [2, 2], [2, 4], [2, 5], [2, 6], [2, 7],
  [3, 4], [3, 5], [4, 4], [4, 5],
  [5, 2], [5, 3], [5, 4], [5, 5], [5, 6],
];
export const barracksLimit = 15;
const names = {
  人族: ['巡地兵', '护阵步兵', '长弩手'],
  神族: ['闪步卫', '石环卫', '棱光射手'],
  虫族: ['掘行虫', '扣甲虫', '脊弩虫'],
};
const stats = [
  { tier: '轻型', limit: 10, hp: 40, damage: 6, range: 1, attackMs: 1000 },
  { tier: '中型', limit: 5, hp: 80, damage: 12, range: 1, attackMs: 1000 },
  { tier: '重型', limit: 3, hp: 90, damage: 20, range: 3, attackMs: 1000 },
];
const levelScale = [0, 100, 120, 140];
export const maxLevel = 3;
export const keyAt = ([row, col]) => `${row}-${col}`;

export function mapFor(side, board = currentBoard) {
  const toSide = ([row, col]) => [side === 'blue' ? boardRows(board) + 1 - row : row, col];
  return {
    base: toSide(redMap.base),
    plots: hasExpansion(board) ? expansionPlots.map((at) => ({ at: toSide(at) }))
      : redMap.plots.map(({ at, exit }) => ({ at: toSide(at), exit: toSide(exit) })),
    starts: redMap.starts.map(toSide),
  };
}

export function stepRandom(seed) {
  const nextSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { seed: nextSeed, value: nextSeed / 2 ** 32 };
}

export function newRoster(side, seed) {
  const { seed: nextSeed, value } = stepRandom(seed);
  return { side, seed: nextSeed, theme: themes[Math.floor(value * themes.length)], barracks: [] };
}

export function expansionExits(side, board, barracks) {
  const { base, starts } = mapFor(side, board);
  const occupied = new Set([base, ...barracks].map(keyAt));
  const walkable = (at) => onBoard(at, board) && openingOwner(at[0], board) === side && !occupied.has(keyAt(at));
  const queue = [starts[0]];
  const reachable = new Set(queue.map(keyAt));
  for (const at of queue) {
    for (const next of neighbours(at, side, board)) {
      const key = keyAt(next);
      if (!walkable(next) || reachable.has(key)) continue;
      reachable.add(key);
      queue.push(next);
    }
  }
  if (reachable.size !== (boardRows(board) / 2) * boardColumns - occupied.size) return null;
  const exits = new Map();
  for (const at of barracks) {
    const exit = neighbours(at, side, board).find((next) => reachable.has(keyAt(next)));
    if (!exit) return null;
    exits.set(keyAt(at), exit);
  }
  return exits;
}

export function validBuilds(roster, board) {
  const map = mapFor(roster.side, board);
  const builtAt = roster.barracks.map(({ at }) => at);
  const occupied = new Set(builtAt.map(keyAt));
  const anchors = [map.base, ...builtAt];
  const adjacent = new Set(anchors.flatMap((at) => neighbours(at, roster.side, board)).map(keyAt));
  const candidates = map.plots.filter(({ at }) => !occupied.has(keyAt(at)) && adjacent.has(keyAt(at)));
  if (!hasExpansion(board)) return candidates;
  if (builtAt.length >= barracksLimit) return [];
  return candidates.flatMap(({ at }) => {
    const exits = expansionExits(roster.side, board, [...builtAt, at]);
    return exits ? [{ at, exit: exits.get(keyAt(at)), exits }] : [];
  });
}

export function isRosterFull(roster, board) {
  return validBuilds(roster, board).length === 0 && roster.barracks.every(({ level }) => level === maxLevel);
}

export function drawUnit(theme, themeRoll, tierRoll) {
  const others = themes.filter((candidate) => candidate !== theme);
  const origin = themeRoll < 0.5 ? theme : others[themeRoll < 0.75 ? 0 : 1];
  const tier = tierRoll < 0.5 ? 0 : tierRoll < 0.85 ? 1 : 2;
  return { origin, name: names[origin][tier], ...stats[tier] };
}

export function unitStats(barracks) {
  const { hp, damage, ...unit } = barracks.unit;
  const scale = levelScale[barracks.level];
  return { ...unit, hp: Math.floor(hp * scale / 100), damage: Math.floor(damage * scale / 100) };
}

export function battleLoadout(roster, board) {
  const map = mapFor(roster.side, board);
  return {
    side: roster.side,
    theme: roster.theme,
    base: map.base,
    barracks: roster.barracks.map((entry) => ({ ...entry, unit: unitStats(entry) })),
    startingUnits: map.starts.map((at) => ({ at, side: roster.side, hp: 40, damage: 6, range: 1, attackMs: 1000 })),
  };
}

export function enhanceRoster(roster, board) {
  const builds = validBuilds(roster, board);
  const upgrades = roster.barracks.filter(({ level }) => level < maxLevel);
  if (!builds.length && !upgrades.length) return { roster, label: '强化已满，未新增战力' };

  let seed = roster.seed;
  function draw() {
    const next = stepRandom(seed);
    seed = next.seed;
    return next.value;
  }
  const build = builds.length > 0 && (upgrades.length === 0 || draw() < 0.5);
  if (build) {
    const { at, exit, exits } = builds[Math.floor(draw() * builds.length)];
    const unit = drawUnit(roster.theme, draw(), draw());
    const entry = { at, exit, unit, level: 1, side: roster.side };
    const barracks = exits ? roster.barracks.map((built) => ({ ...built, exit: exits.get(keyAt(built.at)) })) : roster.barracks;
    return {
      roster: { ...roster, seed, barracks: [...barracks, entry] },
      at,
      kind: 'build',
      label: `建造${unit.name}兵营（${at[0]}行${at[1]}列）`,
    };
  }
  const target = upgrades[Math.floor(draw() * upgrades.length)];
  const level = target.level + 1;
  return {
    roster: { ...roster, seed, barracks: roster.barracks.map((entry) => entry === target ? { ...entry, level } : entry) },
    at: target.at,
    kind: 'upgrade',
    label: `${target.unit.name}兵营升至 ${level} 级（${target.at[0]}行${target.at[1]}列）`,
  };
}
