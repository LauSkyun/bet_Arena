import { battleRules, currentFireRevision, groundProductionRules, simulateBattle } from './battle.mjs';
import { groundUnits } from './ground-units.mjs';
import { groundProfile } from './profiles.mjs';
import { baseAttack, boardColumns, boardRows, currentBoard, expansionExits, keyAt, mapFor, maxLevel, newRoster, onBoard, unitStats, validBuilds } from './roster.mjs';

export const teams = ['red', 'blue'];
export function newScenario(seed = 37) {
  const loadout = {};
  for (const [i, side] of teams.entries()) {
    loadout[side] = { side, theme: newRoster(side, seed + i).theme, base: mapFor(side).base, hp: battleRules.baseHp,
      maxHp: battleRules.baseHp, baseAttack: { ...baseAttack }, barracks: [], startingUnits: [] };
  }
  return { seed, number: 1, sealed: true, board: currentBoard, profile: groundProfile, combatRules: groundProductionRules,
    fireRevision: currentFireRevision, durations: { battleMs: 40000 }, loadout };
}
export function legalSites(round, side) {
  const occupied = new Set(teams.flatMap(team => round.loadout[team].startingUnits.map(u => keyAt(u.at))));
  return validBuilds(round.loadout[side], round.board).filter(site => !occupied.has(keyAt(site.at)));
}
function unitFor(unitId, level) {
  const unit = groundUnits.find(u => u.unitId === unitId);
  if (!unit || !Number.isInteger(level) || level < 1 || level > maxLevel) throw Error('请选择有效兵种与等级');
  return unitStats({ unit, level });
}
export function addBuilding(round, side, at, unitId) {
  const site = legalSites(round, side).find(s => keyAt(s.at) === keyAt(at));
  if (!site) throw Error('请点选本方高亮的可建格');
  const setup = round.loadout[side];
  for (const b of setup.barracks) b.exit = site.exits.get(keyAt(b.at));
  setup.barracks.push({ side, at, exit: site.exit, level: 1, unit: unitFor(unitId, 1), hp: battleRules.barracksHp, maxHp: battleRules.barracksHp });
}
export function setBuildingLevel(b, level) {
  const unit = unitFor(b.unit.unitId, level);
  b.unit = unit;
  b.level = level;
}
export function setHealth(value, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw Error(`剩余生命须为 1 到 ${max} 的整数`);
  return value;
}
export function addSoldier(round, side, at, unitId, level, hp) {
  const unit = unitFor(unitId, level);
  if (!onBoard(at, round.board) || teams.some(t => [round.loadout[t].base, ...round.loadout[t].barracks.map(b=>b.at)].some(pos => keyAt(pos) === keyAt(at)))) throw Error('测试兵须放在可通行格');
  round.loadout[side].startingUnits.push({ ...unit, level, side, at, currentHp: setHealth(hp ?? unit.hp, unit.hp) });
}
export function mirrorScenario(original) {
  const result = structuredClone(original);
  const flip = ([r,c]) => [boardRows(result.board) + 1 - r, boardColumns + 1 - c];
  for (const side of teams) {
    const setup = structuredClone(original.loadout[side === 'red' ? 'blue' : 'red']);
    setup.side = side;
    setup.base = flip(setup.base);
    for (const b of setup.barracks) { b.at = flip(b.at); b.side = side; }
    const exits = expansionExits(side, result.board, setup.barracks.map(b=>b.at));
    for (const b of setup.barracks) b.exit = exits.get(keyAt(b.at));
    for (const u of setup.startingUnits) { u.at = flip(u.at); u.side = side; }
    result.loadout[side] = setup;
  }
  return result;
}
export function runScenario(round) {
  const replay = simulateBattle(round.loadout, round.durations.battleMs, round.board, round.combatRules, round.fireRevision, true);
  if (!replay.frames.length) throw Error('测试阵容无法开战，请检查兵营、出兵口和初始生命');
  return replay;
}
