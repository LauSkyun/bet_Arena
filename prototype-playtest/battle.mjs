import { boardColumns, boardRows, currentBoard, keyAt, mapFor, openingOwner } from './roster.mjs';

export const battleRules = Object.freeze({ stepMs: 500, spawnMs: 500, sense: 4, baseHp: 240, barracksHp: 120 });
export const previousCombatRules = 1;
export const currentCombatRules = 2;
const sides = ['red', 'blue'];
const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const distance = ([row, col], [otherRow, otherCol]) => Math.abs(row - otherRow) + Math.abs(col - otherCol);
const enemy = (side) => side === 'red' ? 'blue' : 'red';
const onBoard = ([row, col], board) => row >= 1 && row <= boardRows(board) && col >= 1 && col <= boardColumns;
const usableStats = ({ hp, damage, range, attackMs, limit } = {}, needsLimit = false) =>
  [hp, damage, range, attackMs].every((value) => Number.isSafeInteger(value) && value > 0) &&
  attackMs % battleRules.stepMs === 0 && (!needsLimit || (Number.isSafeInteger(limit) && limit > 0 && limit <= 10));

export function openingGround(board) {
  const owners = {};
  for (let row = 1; row <= boardRows(board); row++) {
    for (let col = 1; col <= boardColumns; col++) {
      const key = keyAt([row, col]);
      owners[key] = openingOwner(row, board);
    }
  }
  for (const side of sides) {
    const { base, plots } = mapFor(side, board);
    delete owners[keyAt(base)];
    for (const { at } of plots) delete owners[keyAt(at)];
  }
  return owners;
}

function makeState(loadout, board) {
  const owners = openingGround(board);
  const terrain = Object.fromEntries(Object.keys(owners).map((key) => [key, 'ground']));
  const buildings = [], units = [];
  let sequence = 0;
  for (const side of sides) {
    const map = mapFor(side, board);
    const setup = loadout?.[side];
    if (setup?.side !== side || !Array.isArray(setup.base) || keyAt(setup.base) !== keyAt(map.base) ||
      !Array.isArray(setup.barracks) || setup.barracks.length > map.plots.length ||
      !Array.isArray(setup.startingUnits) || setup.startingUnits.length !== map.starts.length) throw Error('Invalid battle loadout');
    terrain[keyAt(map.base)] = 'base';
    buildings.push({ id: ++sequence, side, at: map.base, hp: battleRules.baseHp, kind: 'base' });
    for (const plot of map.plots) {
      terrain[keyAt(plot.at)] = 'plot';
    }
    const used = new Set();
    for (const barracks of setup.barracks) {
      const plot = map.plots.find(({ at }) => keyAt(at) === keyAt(barracks.at));
      if (!plot || used.has(keyAt(plot.at)) || keyAt(plot.exit) !== keyAt(barracks.exit) ||
        barracks.side !== side || !usableStats(barracks.unit, true)) throw Error('Invalid barracks');
      used.add(keyAt(plot.at));
      terrain[keyAt(plot.at)] = 'barracks';
      buildings.push({ id: ++sequence, side, at: plot.at, exit: plot.exit, unit: barracks.unit,
        hp: battleRules.barracksHp, kind: 'barracks', nextSpawn: battleRules.spawnMs });
    }
    const startKeys = new Set(setup.startingUnits.map(({ at }) => keyAt(at)));
    if (startKeys.size !== map.starts.length || map.starts.some((at) => !startKeys.has(keyAt(at)))) throw Error('Invalid starting positions');
    for (const starter of setup.startingUnits) {
      if (starter.side !== side || !usableStats(starter)) throw Error('Invalid starting unit');
      units.push({ ...starter, id: ++sequence, target: null, nextAttack: 0 });
    }
  }
  return { terrain, owners, buildings, units, sequence };
}

const passable = (terrain, at) => ['ground', 'ruins'].includes(terrain[keyAt(at)]);

function makeRoutes(terrain, board) {
  const cache = new Map();
  return (start, side) => {
    const key = `${side}:${keyAt(start)}`;
    if (cache.has(key)) return cache.get(key);
    const visited = new Set([keyAt(start)]);
    const queue = [{ at: start, first: null, steps: 0 }];
    for (const current of queue) {
      for (const [dr, dc] of directions) {
        // Mirroring the vertical tie-break preserves symmetry between the two team layouts.
        const next = [current.at[0] + (side === 'blue' ? -dr : dr), current.at[1] + dc];
        const nextKey = keyAt(next);
        if (!onBoard(next, board) || !passable(terrain, next) || visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push({ at: next, first: current.first ?? next, steps: current.steps + 1 });
      }
    }
    cache.set(key, queue);
    return queue;
  };
}

function chooseTarget(unit, units, buildings, route) {
  const candidates = [...units, ...buildings].filter((target) => target.side !== unit.side && distance(unit.at, target.at) <= battleRules.sense);
  const reachable = (target) => route.some(({ at }) => distance(at, target.at) <= unit.range);
  const locked = candidates.find(({ id }) => id === unit.target);
  if (locked && reachable(locked)) return locked;
  candidates.sort((a, b) => Number(Boolean(a.kind)) - Number(Boolean(b.kind)) || distance(unit.at, a.at) - distance(unit.at, b.at) || a.id - b.id);
  return candidates.find(reachable);
}

function march(unit, buildings, route, terrain, board) {
  const targets = buildings.filter(({ side }) => side === enemy(unit.side));
  const base = targets.find(({ kind }) => kind === 'base');
  const destinations = base ? [base] : targets;
  const approach = route.find(({ at }) => destinations.some((building) => distance(at, building.at) <= unit.range));
  if (approach) return approach.first;
  const original = base?.at ?? mapFor(enemy(unit.side), board).base;
  let closest;
  for (const entry of route) {
    if (terrain[keyAt(entry.at)] !== 'ground') continue;
    if (!closest || distance(entry.at, original) < distance(closest.at, original)) closest = entry;
  }
  return closest?.first;
}

export function applyOccupancy(owners, entries) {
  const arrivals = new Map();
  for (const { side, at } of entries) {
    const key = keyAt(at);
    if (!Object.hasOwn(owners, key)) continue;
    const mask = side === 'red' ? 1 : 2;
    arrivals.set(key, (arrivals.get(key) ?? 0) | mask);
  }
  for (const [key, mask] of arrivals) {
    if (mask === 1) owners[key] = 'red';
    if (mask === 2) owners[key] = 'blue';
  }
}

function resolveReversals(plans, elapsed) {
  const pending = new Map(plans.map((plan) => [plan.unit.id, plan]));
  const turn = Math.floor(elapsed / battleRules.stepMs);
  const yieldingSide = turn % 2 === 0 ? 'red' : 'blue';
  for (const plan of plans) {
    const { unit, at } = plan;
    if (unit.side !== yieldingSide || !at || !unit.lastAt || distance(at, unit.lastAt) !== 0) continue;
    const rival = pending.get(unit.target);
    if (!rival?.at || !rival.unit.lastAt || distance(rival.at, rival.unit.lastAt) !== 0) continue;
    const engagementRange = Math.max(unit.range, rival.unit.range);
    if (distance(at, rival.at) > engagementRange && distance(unit.at, rival.at) <= engagementRange) plan.at = null;
  }
}

export function advanceBattle(state, elapsed, board = currentBoard, combatRules = currentCombatRules) {
  const routes = makeRoutes(state.terrain, board);
  const arrivals = [];
  if (elapsed === 0) arrivals.push(...state.units);
  else {
    const moves = state.units.map((unit) => {
      const route = routes(unit.at, unit.side);
      const target = chooseTarget(unit, state.units, state.buildings, route);
      unit.target = target?.id ?? null;
      const at = target ? route.find(({ at }) => distance(at, target.at) <= unit.range)?.first
        : march(unit, state.buildings, route, state.terrain, board);
      return { unit, at };
    });
    if (combatRules === currentCombatRules) resolveReversals(moves, elapsed);
    for (const { unit, at } of moves) {
      unit.lastAt = at ? unit.at : null;
      if (!at) continue;
      unit.at = at;
      arrivals.push(unit);
    }
  }

  const strikes = new Map();
  for (const unit of state.units) {
    const target = chooseTarget(unit, state.units, state.buildings, routes(unit.at, unit.side));
    unit.target = target?.id ?? null;
    if (!target || elapsed < unit.nextAttack || distance(unit.at, target.at) > unit.range) continue;
    const pending = strikes.get(target.id)?.damage ?? 0;
    strikes.set(target.id, { target, damage: pending + unit.damage });
    unit.nextAttack = elapsed + unit.attackMs;
  }
  for (const { target, damage } of strikes.values()) target.hp -= damage;
  for (const building of state.buildings) {
    if (building.hp <= 0) state.terrain[keyAt(building.at)] = 'ruins';
  }
  state.units = state.units.filter(({ hp }) => hp > 0);
  state.buildings = state.buildings.filter(({ hp }) => hp > 0);

  const livePerSource = new Map();
  for (const { source } of state.units) {
    if (source !== undefined) livePerSource.set(source, (livePerSource.get(source) ?? 0) + 1);
  }
  for (const building of state.buildings) {
    if (building.kind !== 'barracks') continue;
    const live = livePerSource.get(building.id) ?? 0;
    if (live >= building.unit.limit) {
      building.nextSpawn = null;
      continue;
    }
    building.nextSpawn ??= elapsed + battleRules.spawnMs;
    if (building.nextSpawn > elapsed) continue;
    building.nextSpawn = elapsed + battleRules.spawnMs;
    if (!passable(state.terrain, building.exit)) continue;
    const unit = { ...building.unit, id: ++state.sequence, at: building.exit, side: building.side,
      source: building.id, target: null, nextAttack: elapsed };
    state.units.push(unit);
    arrivals.push(unit);
    if (live + 1 === building.unit.limit) building.nextSpawn = null;
  }
  applyOccupancy(state.owners, arrivals);
}

export function countGround(owners) {
  const scores = { red: 0, blue: 0 };
  for (const owner of Object.values(owners)) if (owner) scores[owner]++;
  return scores;
}

function frame(state, elapsed) {
  return { elapsed, scores: countGround(state.owners), terrain: { ...state.terrain }, owners: { ...state.owners },
    buildings: state.buildings.map(({ id, side, kind, at, hp }) => ({ id, side, kind, at, hp })),
    units: state.units.map(({ id, side, at, hp, name, source }) => ({ id, side, at, hp, name, source })) };
}

export function simulateBattle(loadout, durationMs, board = currentBoard, combatRules = currentCombatRules) {
  try {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw Error('Invalid battle duration');
    const state = makeState(loadout, board);
    const frames = [];
    for (let elapsed = 0; elapsed <= durationMs; elapsed += battleRules.stepMs) {
      advanceBattle(state, elapsed, board, combatRules);
      frames.push(frame(state, elapsed));
    }
    const scores = frames.at(-1).scores;
    const winner = scores.red === scores.blue ? 'draw' : scores.red > scores.blue ? 'red' : 'blue';
    return { frames, result: { winner, scores, durationMs } };
  } catch {
    return { frames: [], result: { winner: 'void', scores: null, durationMs } };
  }
}

// A refresh regenerates the same stream from the persisted sealed roster. Keep only the latest two streams in memory.
const replays = new Map();
export function replayFor(loadout, durationMs, board, combatRules = currentCombatRules) {
  const key = JSON.stringify([board, combatRules, durationMs, loadout]);
  if (!replays.has(key)) {
    if (replays.size >= 2) replays.delete(replays.keys().next().value);
    replays.set(key, simulateBattle(loadout, durationMs, board, combatRules));
  }
  return replays.get(key);
}

export function frameAt(replay, elapsedMs) {
  const index = Math.floor(Math.max(0, elapsedMs) / battleRules.stepMs);
  return replay.frames[Math.min(index, replay.frames.length - 1)] ?? null;
}
