import { battleRules, currentFireRevision, fireRevisionFor, groundSelfDestructRules, previousCombatRules, simulateBattle } from './battle.mjs';
import { recordedBattleFrames } from './battle-log.mjs';
import { boardColumns, boardRows, currentBoard, legacyBoard, onBoard, priorBoard, squareExpansionBoard } from './roster.mjs';
import { secondsLimit } from './timing.mjs';

const snapshotFormat = 'bet-arena/battle-data';
const logFormat = 'bet-arena/battle_log';
const bundleFormat = 'bet-arena/bet_data';
const boards = new Set([currentBoard, legacyBoard, priorBoard, squareExpansionBoard]);
const sides = new Set(['red', 'blue']);
const terrain = new Set(['ground', 'plot', 'base', 'barracks', 'ruins']);
const winners = new Set(['red', 'blue', 'draw', 'void']);
const maxMs = secondsLimit * 1000;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const nonNegative = (value) => Number.isSafeInteger(value) && value >= 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value) => value == null || typeof value === 'string';

function requireData(condition, message = '战斗日志缺少记录或已损坏。') {
  if (!condition) throw Error(message);
}

function readRules(board, revision, fireRevision) {
  requireData(boards.has(board), '棋盘版本不受支持。');
  requireData(positive(revision) && revision >= previousCombatRules && revision <= groundSelfDestructRules &&
    positive(fireRevision) && fireRevision <= currentFireRevision, '战斗规则版本不受支持。');
}

function readSnapshot(report) {
  requireData(report?.format === snapshotFormat, '缺少可用的封盘快照。');
  requireData(report.version === 1, '封盘快照版本不受支持。');
  const round = report.round;
  requireData(round?.sealed === true, '该局尚未封盘，无法从快照重播。');
  requireData(positive(round.number) && object(round.loadout) && positive(round.durations?.battleMs) && round.durations.battleMs <= maxMs,
    '封盘快照缺少阵容或战斗时长。');
  const revision = fireRevisionFor(round);
  readRules(round.board, round.combatRules, revision);
  return round;
}

function readRecordedLog(log) {
  requireData(log?.format === logFormat);
  requireData(log.version === 1, '战斗日志版本不受支持。');
  const { board, initialFrame, frames, complete, result, recordedThroughMs } = log;
  readRules(board, log.combatRules, log.fireRevision);
  const clock = (value) => nonNegative(value) && value <= maxMs && value % battleRules.stepMs === 0;
  requireData(identity(log.sessionId) && positive(log.roundNumber) && Array.isArray(frames) &&
    frames.length <= maxMs / battleRules.stepMs && typeof complete === 'boolean' && clock(recordedThroughMs));
  requireData(object(initialFrame) && initialFrame.elapsed === 0, '战斗日志缺少开战初始帧。');
  requireData(complete ? object(result) && winners.has(result.winner) : result == null);
  const position = (at) => Array.isArray(at) && at.length === 2 && at.every(positive) && onBoard(at, board);
  const cellKey = (key) => typeof key === 'string' && /^[1-9]\d*-[1-9]\d*$/.test(key) && position(key.split('-').map(Number));
  const owner = (value) => value === null || sides.has(value);
  const entity = (entry) => object(entry) && positive(entry.id) && sides.has(entry.side) && position(entry.at) && positive(entry.hp);
  const unit = (entry) => entity(entry) && nullableText(entry.name);
  const building = (entry) => entity(entry) && ['base', 'barracks'].includes(entry.kind);
  const score = (value) => object(value) && ['red', 'blue'].every((side) => nonNegative(value[side]) && value[side] <= boardColumns * boardRows(board));
  const shot = (entry) => object(entry) && sides.has(entry.side) && position(entry.from) && position(entry.to) &&
    [entry.name, entry.targetName, entry.effect].every(nullableText) &&
    positive(entry.attackerId) && positive(entry.targetId) &&
    [entry.power, entry.before, entry.after].every(nonNegative) && (entry.applied == null || nonNegative(entry.applied));
  const event = (entry) => object(entry) && sides.has(entry.side) && positive(entry.id) && nullableText(entry.name) &&
    (entry.kind === 'spawn' ? position(entry.at) && positive(entry.hp) : entry.kind === 'move' && position(entry.from) && position(entry.to));
  function validateCommon(frame) {
    requireData(object(frame) && score(frame.scores) && Array.isArray(frame.shots) && frame.shots.every(shot) &&
      Array.isArray(frame.events) && frame.events.every(event));
  }
  function entries(value, validator) {
    return Array.isArray(value) && value.every(validator);
  }
  function cells(value, validator) {
    return object(value) && Object.entries(value).every(([key, data]) => cellKey(key) && validator(data));
  }
  function changes(value, keyTest, valueTest) {
    return entries(value, (entry) => Array.isArray(entry) && (entry.length === 1 || entry.length === 2) &&
      keyTest(entry[0]) && (entry.length === 1 || valueTest(entry[1], entry[0])));
  }
  validateCommon(initialFrame);
  requireData(cells(initialFrame.owners, owner) && cells(initialFrame.terrain, (value) => terrain.has(value)) &&
    entries(initialFrame.units, unit) && entries(initialFrame.buildings, building));
  for (const [offset, frame] of frames.entries()) {
    validateCommon(frame);
    requireData(frame.elapsed === (offset + 1) * battleRules.stepMs &&
      changes(frame.owners, cellKey, owner) && changes(frame.terrain, cellKey, (value) => terrain.has(value)) &&
      changes(frame.units, positive, (entry, id) => unit(entry) && entry.id === id) &&
      changes(frame.buildings, positive, (entry, id) => building(entry) && entry.id === id));
  }
  requireData(recordedThroughMs === frames.length * battleRules.stepMs);
  if (complete) {
    const scores = (frames.at(-1) ?? initialFrame).scores;
    requireData(score(result.scores) && scores.red === result.scores.red && scores.blue === result.scores.blue &&
      (result.endedAtMs === undefined || result.endedAtMs === recordedThroughMs));
  }
  return { frames: recordedBattleFrames(log), result: complete ? result : null, source: 'log', complete,
    board, roundNumber: log.roundNumber, combatRules: log.combatRules, recordedThroughMs };
}

export function replayFromReport(report) {
  requireData(object(report), '请选择有效的战局 JSON。');
  if (report.format === logFormat) return readRecordedLog(report);
  let snapshot = report;
  if (report.format === bundleFormat) {
    requireData(report.version === 1, '完整战局包版本不受支持。');
    requireData(identity(report.sessionId) && positive(report.roundNumber), '完整战局包缺少会话或轮次。');
    snapshot = report.battle_data;
    const log = report.battle_log;
    if (log != null) {
      requireData(log.sessionId === report.sessionId && log.roundNumber === report.roundNumber, '战斗日志与战局包的会话或轮次不一致。');
      if (snapshot != null) {
        const round = readSnapshot(snapshot);
        requireData(round.number === log.roundNumber && round.board === log.board && round.combatRules === log.combatRules &&
          fireRevisionFor(round) === log.fireRevision, '封盘快照与战斗日志的轮次或规则不一致。');
      }
      return readRecordedLog(log);
    }
    if (snapshot != null) requireData(snapshot.round?.number === report.roundNumber, '封盘快照与战局包的轮次不一致。');
  } else requireData(report.format === snapshotFormat, '文件格式不受支持。请选择封盘快照、战斗日志或完整战局包。');
  const round = readSnapshot(snapshot);
  const replay = simulateBattle(round.loadout, round.durations.battleMs, round.board, round.combatRules, fireRevisionFor(round), false, true);
  requireData(replay.frames.length > 0, '封盘阵容无法重演，请检查文件。');
  return { ...replay, source: 'snapshot', complete: true, board: round.board, roundNumber: round.number,
    combatRules: round.combatRules, recordedThroughMs: replay.frames.at(-1).elapsed };
}
