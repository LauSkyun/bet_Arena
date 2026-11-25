import { readFileSync } from 'node:fs';
import { recordedBattleFrames } from '../prototype-playtest/battle-log.mjs';
import { secondsLimit } from '../prototype-playtest/timing.mjs';
import { fireRevisionFor, frameAt, simulateBattle } from '../prototype-playtest/battle.mjs';

try {
  const [file, at] = process.argv.slice(2);
  if (!file) throw Error('用法：node testing/replay-battle-data.mjs <JSON 路径> [开战后毫秒]');
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const packageReport = input.format === 'bet-arena/bet_data';
  const log = packageReport ? input.battle_log : input.format === 'bet-arena/battle_log' ? input : null;
  if (packageReport && input.version !== 1) throw Error('完整战局包版本不支持');
  const elapsed = at === undefined ? null : Number(at);
  if (elapsed !== null && (!Number.isSafeInteger(elapsed) || elapsed < 0)) throw Error('回放时点须为非负整数毫秒');
  if (log) {
    if (log.format !== 'bet-arena/battle_log' || log.version !== 1) throw Error('战斗日志版本不支持');
    const frames = recordedBattleFrames(log);
    if (elapsed !== null && elapsed > log.recordedThroughMs) throw Error('所选时间超过日志记录的最后一拍');
    console.log(JSON.stringify({ round: log.roundNumber, sealed: true, result: log.result, complete: log.complete,
      recordedThroughMs: log.recordedThroughMs, reportedSettlement: log.settlement,
      ...(elapsed === null ? {} : { frame: frameAt({ frames }, elapsed) }),
    }, null, 2));
  } else {
    const report = packageReport ? input.battle_data : input;
    if (!report) throw Error('该轮尚未封盘，无战斗可重演');
    const gm = report.format === 'bet-arena/gm-battle';
    if ((!gm && report.format !== 'bet-arena/battle-data') || report.version !== 1) throw Error('战局数据格式不支持');
    const { round } = report;
    const duration = round.durations.battleMs;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > secondsLimit * 1000) throw Error('战斗时长超出支持范围');
    const replay = simulateBattle(round.loadout, duration, round.board, round.combatRules, fireRevisionFor(round), gm);
    if (gm && replay.result.winner === 'void') throw Error('GM 阵容无效');
    console.log(JSON.stringify({
      round: round.number,
      sealed: round.sealed,
      result: replay.result,
      ...(gm ? { reportedResult: report.result } : { reportedSettlement: round.result }),
      ...(elapsed === null ? {} : { frame: frameAt(replay, elapsed) }),
    }, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
