import { barracksLimit, boardColumns, boardRows, currentBoard, distance, expansionExits, hasExpansion, keyAt, mapFor, neighbours, onBoard, openingOwner } from './roster.mjs';

export const battleRules = Object.freeze({ stepMs: 500, spawnMs: 500, sense: 4, baseHp: 240, barracksHp: 120 });
export const previousCombatRules = 1;
export const reversalCombatRules = 2;
export const damageTiebreakRules = 3;
export const baseVictoryRules = 4;
export const splitPursuitRules = 5;
const unitRoleRules = 6;
export const currentCombatRules = unitRoleRules;
const sides = ['red', 'blue'];
const enemy = (side) => side === 'red' ? 'blue' : 'red';
const usableStats = ({ hp, damage, range, attackMs, limit } = {}, needsLimit = false) =>
  [hp, damage, range, attackMs].every((value) => Number.isSafeInteger(value) && value > 0) &&
  attackMs >= battleRules.stepMs && (!needsLimit || (Number.isSafeInteger(limit) && limit > 0 && limit <= 10));

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

function makeState(loadout, board, occupationIncludesSpecial) {
  const owners = openingGround(board);
  const terrain = Object.fromEntries(Object.keys(owners).map((key) => [key, 'ground']));
  const buildings = [], units = [];
  let sequence = 0;
  for (const side of sides) {
    const map = mapFor(side, board);
    const setup = loadout?.[side];
    if (setup?.side !== side || !Array.isArray(setup.base) || keyAt(setup.base) !== keyAt(map.base) ||
      !Array.isArray(setup.barracks) || setup.barracks.length > (hasExpansion(board) ? barracksLimit : map.plots.length) ||
      !Array.isArray(setup.startingUnits) || setup.startingUnits.length !== map.starts.length) throw Error('Invalid battle loadout');
    terrain[keyAt(map.base)] = 'base';
    buildings.push({ id: ++sequence, side, at: map.base, hp: battleRules.baseHp, kind: 'base' });
    for (const plot of map.plots) {
      terrain[keyAt(plot.at)] = 'plot';
      if (occupationIncludesSpecial && hasExpansion(board)) owners[keyAt(plot.at)] = side;
    }
    const exits = hasExpansion(board) ? expansionExits(side, board, setup.barracks.map(({ at }) => at)) : null;
    if (hasExpansion(board) && !exits) throw Error('Invalid barracks exits');
    const used = new Set();
    for (const barracks of setup.barracks) {
      const plot = map.plots.find(({ at }) => keyAt(at) === keyAt(barracks.at));
      if (!plot || used.has(keyAt(plot.at)) || keyAt(exits ? exits.get(keyAt(plot.at)) : plot.exit) !== keyAt(barracks.exit) ||
        barracks.side !== side || !usableStats(barracks.unit, true)) throw Error('Invalid barracks');
      used.add(keyAt(plot.at));
      terrain[keyAt(plot.at)] = 'barracks';
      delete owners[keyAt(plot.at)];
      buildings.push({ id: ++sequence, side, at: plot.at, exit: barracks.exit, unit: barracks.unit,
        hp: battleRules.barracksHp, kind: 'barracks', nextSpawn: barracks.unit.spawnMs ?? battleRules.spawnMs });
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

const passable = (terrain, at, board) => {
  const tile = terrain[keyAt(at)];
  return tile === 'ground' || tile === 'ruins' || (tile === 'plot' && hasExpansion(board));
};

function makeRoutes(terrain, board) {
  const cache = new Map();
  return (start, side) => {
    const key = `${side}:${keyAt(start)}`;
    if (cache.has(key)) return cache.get(key);
    const visited = new Set([keyAt(start)]);
    const queue = [{ at: start, first: null, steps: 0 }];
    for (const current of queue) {
      for (const next of neighbours(current.at, side, board)) {
        const nextKey = keyAt(next);
        if (!onBoard(next, board) || !passable(terrain, next, board) || visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push({ at: next, first: current.first ?? next, steps: current.steps + 1 });
      }
    }
    cache.set(key, queue);
    return queue;
  };
}

function pickTarget(unit, candidates, board, priority) {
  const ordered = candidates.map((target) => ({ target, rank: priority(target), gap: distance(unit.at, target.at, board) }));
  ordered.sort((a, b) => a.rank - b.rank || a.gap - b.gap || a.target.id - b.target.id);
  const first = ordered[0];
  if (!first) return undefined;
  const locked = ordered.find(({ target, rank }) => target.id === unit.target && rank === first.rank);
  return (locked ?? first).target;
}

function chooseTarget(unit, units, buildings, route, board, reservedDamage, roles) {
  const candidates = [...units, ...buildings].filter((target) => target.side !== unit.side &&
    distance(unit.at, target.at, board) <= (target.id === unit.target && unit.skill ? unit.range : unit.sense ?? battleRules.sense));
  const reachable = (target) => route.some(({ at }) => distance(at, target.at, board) <= unit.range);
  if (!reservedDamage) {
    const locked = candidates.find(({ id }) => id === unit.target);
    if (locked && reachable(locked)) return locked;
    candidates.sort((a, b) => Number(Boolean(a.kind)) - Number(Boolean(b.kind)) || distance(unit.at, a.at, board) - distance(unit.at, b.at, board) || a.id - b.id);
    return candidates.find(reachable);
  }
  const available = candidates.filter((target) => (target.kind || (reservedDamage.get(target.id) ?? 0) < target.hp) && reachable(target));
  if (roles && unit.tier === '重型') {
    const local = available.filter((target) => distance(unit.at, target.at, board) <= unit.range);
    const target = pickTarget(unit, local, board, rangedPriority);
    if (target) return target;
  }
  if (roles && unit.tier === '中型') {
    const nearbyRanged = units.filter((ally) => ally.side === unit.side && ally.tier === '重型' && distance(unit.at, ally.at, board) <= 2);
    return pickTarget(unit, available, board, (target) => target.kind ? 2 :
      nearbyRanged.some((ally) => distance(ally.at, target.at, board) <= ally.range) ? 0 : 1);
  }
  return pickTarget(unit, available, board, (target) => Number(Boolean(target.kind)));
}

const rangedPriority = (target) => !target.kind ? 0 : target.kind === 'base' ? 1 : 2;

function directDamage(unit) {
  return Math.ceil(unit.damage * (unit.directDamagePercent ?? 100) / 100);
}

function inRangeShot(unit, units, buildings, board, priority) {
  const candidates = [...units, ...buildings].filter((target) => target.side !== unit.side &&
    distance(unit.at, target.at, board) <= Math.min(unit.range, target.id === unit.target ? unit.range : unit.sense ?? unit.range));
  return pickTarget(unit, candidates, board, priority);
}

function lightStep(unit, destination, state, routes, board) {
  if (!destination?.first) return undefined;
  if (state.terrain[keyAt(destination.first)] === 'ground' && state.owners[keyAt(destination.first)] !== unit.side) return destination.first;
  return neighbours(unit.at, unit.side, board).find((at) => state.terrain[keyAt(at)] === 'ground' &&
    state.owners[keyAt(at)] !== unit.side && routes(at, unit.side).some((entry) =>
      entry.steps === destination.steps - 1 && keyAt(entry.at) === keyAt(destination.at))) ?? destination.first;
}

function march(unit, buildings, route, terrain, board) {
  const targets = buildings.filter(({ side }) => side === enemy(unit.side));
  const base = targets.find(({ kind }) => kind === 'base');
  const destinations = base ? [base] : targets;
  const approach = route.find(({ at }) => destinations.some((building) => distance(at, building.at, board) <= unit.range));
  if (approach) return approach;
  const original = base?.at ?? mapFor(enemy(unit.side), board).base;
  let closest;
  for (const entry of route) {
    if (terrain[keyAt(entry.at)] !== 'ground') continue;
    if (!closest || distance(entry.at, original, board) < distance(closest.at, original, board)) closest = entry;
  }
  return closest;
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

function resolveReversals(plans, elapsed, board) {
  const pending = new Map(plans.map((plan) => [plan.unit.id, plan]));
  const turn = Math.floor(elapsed / battleRules.stepMs);
  const yieldingSide = turn % 2 === 0 ? 'red' : 'blue';
  for (const plan of plans) {
    const { unit, at } = plan;
    if (unit.side !== yieldingSide || !at || !unit.lastAt || distance(at, unit.lastAt, board) !== 0) continue;
    const rival = pending.get(unit.target);
    if (!rival?.at || !rival.unit.lastAt || distance(rival.at, rival.unit.lastAt, board) !== 0) continue;
    const engagementRange = Math.max(unit.range, rival.unit.range);
    if (distance(at, rival.at, board) > engagementRange && distance(unit.at, rival.at, board) <= engagementRange) plan.at = null;
  }
}

export function advanceBattle(state, elapsed, board = currentBoard, combatRules = currentCombatRules) {
  const occupationIncludesSpecial = combatRules >= baseVictoryRules;
  const routes = makeRoutes(state.terrain, board);
  const arrivals = [];
  const roles = combatRules >= unitRoleRules;
  const reservedPlanning = combatRules >= splitPursuitRules;
  if (elapsed === 0) arrivals.push(...state.units);
  else {
    const reservedDamage = reservedPlanning ? new Map() : undefined;
    const moves = state.units.map((unit) => {
      const route = routes(unit.at, unit.side);
      const target = chooseTarget(unit, state.units, state.buildings, route, board, reservedDamage, roles);
      if (reservedDamage && target && !target.kind) reservedDamage.set(target.id, (reservedDamage.get(target.id) ?? 0) + directDamage(unit));
      unit.target = target?.id ?? null;
      const destination = target ? route.find(({ at }) => distance(at, target.at, board) <= unit.range)
        : march(unit, state.buildings, route, state.terrain, board);
      const at = roles && unit.tier === '轻型' ? lightStep(unit, destination, state, routes, board) : destination?.first;
      return { unit, at };
    });
    if (combatRules >= reversalCombatRules) resolveReversals(moves, elapsed, board);
    for (const { unit, at } of moves) {
      unit.lastAt = at ? unit.at : null;
      if (!at) continue;
      unit.at = at;
      arrivals.push(unit);
    }
  }

  const strikes = new Map();
  for (const unit of state.units) {
    const target = reservedPlanning ? inRangeShot(unit, state.units, state.buildings, board,
      roles && unit.tier === '重型' ? rangedPriority : (target) => Number(Boolean(target.kind)))
      : chooseTarget(unit, state.units, state.buildings, routes(unit.at, unit.side), board);
    if (!reservedPlanning) unit.target = target?.id ?? null;
    const canHit = target && elapsed >= unit.nextAttack && distance(unit.at, target.at, board) <= unit.range;
    if (reservedPlanning) unit.hit = canHit ? target.id : null;
    if (!canHit) continue;
    const pending = strikes.get(target.id)?.damage ?? 0;
    strikes.set(target.id, { target, damage: pending + directDamage(unit) });
    // Keep the fractional cadence while firing continuously. Idle time cannot bank shots.
    const due = elapsed - unit.nextAttack < battleRules.stepMs ? unit.nextAttack : elapsed;
    unit.nextAttack = due + unit.attackMs;
  }
  for (const { target, damage } of strikes.values()) {
    if (state.damage) state.damage[enemy(target.side)] += Math.min(target.hp, damage);
    target.hp -= damage;
  }
  for (const building of state.buildings) {
    if (building.hp > 0) continue;
    const key = keyAt(building.at);
    state.terrain[key] = 'ruins';
    if (occupationIncludesSpecial) state.owners[key] = building.side;
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
    const spawnMs = building.unit.spawnMs ?? battleRules.spawnMs;
    building.nextSpawn ??= elapsed + spawnMs;
    if (building.nextSpawn > elapsed) continue;
    building.nextSpawn = elapsed + spawnMs;
    if (!passable(state.terrain, building.exit, board)) continue;
    const count = Math.min(building.unit.spawnCount ?? 1, building.unit.limit - live);
    for (let i = 0; i < count; i++) {
      const unit = { ...building.unit, id: ++state.sequence, at: building.exit, side: building.side,
        source: building.id, target: null, nextAttack: elapsed };
      state.units.push(unit);
      arrivals.push(unit);
    }
    if (live + count === building.unit.limit) building.nextSpawn = null;
  }
  applyOccupancy(state.owners, occupationIncludesSpecial ? state.units : arrivals);
}

export function countGround(owners, terrain) {
  const scores = { red: 0, blue: 0 };
  for (const [key, owner] of Object.entries(owners)) {
    if (owner && (!terrain || terrain[key] === 'ground')) scores[owner]++;
  }
  return scores;
}

function frame(state, elapsed, combatRules) {
  return { elapsed, scores: countGround(state.owners, state.terrain), terrain: { ...state.terrain }, owners: { ...state.owners },
    buildings: state.buildings.map(({ id, side, kind, at, hp }) => ({ id, side, kind, at, hp })),
    units: state.units.map(({ id, side, at, hp, name, source, target, hit }) => ({ id, side, at, hp, name, source,
      ...(combatRules >= splitPursuitRules ? { target: target ?? null, hit: hit ?? null } : {}) })) };
}

export function simulateBattle(loadout, durationMs, board = currentBoard, combatRules = currentCombatRules) {
  try {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw Error('Invalid battle duration');
    const usesBaseVictory = combatRules >= baseVictoryRules;
    const state = makeState(loadout, board, usesBaseVictory);
    if (combatRules === damageTiebreakRules) state.damage = { red: 0, blue: 0 };
    const frames = [];
    let fallenBases = [];
    for (let elapsed = 0; elapsed <= durationMs; elapsed += battleRules.stepMs) {
      advanceBattle(state, elapsed, board, combatRules);
      frames.push(frame(state, elapsed, combatRules));
      if (usesBaseVictory) {
        fallenBases = sides.filter((side) => !state.buildings.some((building) => building.kind === 'base' && building.side === side));
        if (fallenBases.length) break;
      }
    }
    const last = frames.at(-1);
    const { scores } = last;
    const terrainLead = scores.red - scores.blue;
    const damage = state.damage;
    const damageLead = damage ? damage.red - damage.blue : 0;
    const lead = terrainLead || damageLead;
    const winner = fallenBases.length === 1 ? enemy(fallenBases[0]) : lead === 0 ? 'draw' : lead > 0 ? 'red' : 'blue';
    const result = { winner, scores, durationMs };
    if (damage) Object.assign(result, { damage, decidedBy: terrainLead !== 0 ? 'territory' : damageLead !== 0 ? 'damage' : 'draw' });
    if (usesBaseVictory) Object.assign(result, {
      fallenBases,
      endedAtMs: fallenBases.length ? last.elapsed : durationMs,
      decidedBy: fallenBases.length === 1 ? 'base' : terrainLead !== 0 ? 'territory' : 'draw',
    });
    return { frames, result };
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
