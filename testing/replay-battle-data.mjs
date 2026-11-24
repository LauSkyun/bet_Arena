import { readFileSync } from 'node:fs';
import { secondsLimit } from '../prototype-playtest/timing.mjs';
import { fireRevisionFor, frameAt, simulateBattle } from '../prototype-playtest/battle.mjs';

try {
  const [file, at] = process.argv.slice(2);
  if (!file) throw Error('用法：node testing/replay-battle-data.mjs <JSON 路径> [开战后毫秒]');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (report.format !== 'bet-arena/battle-data' || report.version !== 1) throw Error('战局数据格式不支持');
  const { round } = report;
  const duration = round.durations.battleMs;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > secondsLimit * 1000) throw Error('战斗时长超出支持范围');
  const elapsed = at === undefined ? null : Number(at);
  if (elapsed !== null && (!Number.isSafeInteger(elapsed) || elapsed < 0)) throw Error('回放时点须为非负整数毫秒');
  const replay = simulateBattle(round.loadout, duration, round.board, round.combatRules, fireRevisionFor(round));
  console.log(JSON.stringify({
    round: round.number,
    sealed: round.sealed,
    result: replay.result,
    reportedSettlement: round.result,
    ...(elapsed === null ? {} : { frame: frameAt(replay, elapsed) }),
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
