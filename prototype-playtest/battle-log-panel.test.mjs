import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { battleLogLines } from './battle-log-panel.mjs';
import { recordedBattleFrames } from './battle-log.mjs';
import { addSoldier, newScenario, runScenario } from './gm-scenario.mjs';

test('archived frames feed the same log formatter for movement, spawning, ownership, damage and outcome', () => {
  const { battle_log: log } = JSON.parse(readFileSync(new URL('../testing/fixtures/round-archive/complete.json', import.meta.url)));
  const frames = recordedBattleFrames(log);
  const lines = frames.flatMap((frame, index) => battleLogLines(frame, frames[index - 1], log.board, index === frames.length - 1 ? log.result : null));
  for (const word of ['出兵', '移动', '实际伤害', '占格', '自耗并离场', '基地被摧毁']) {
    assert.ok(lines.some((line) => line.includes(word)), word);
  }
  assert.ok(lines.at(-1).startsWith('蓝队获胜'));
  assert.ok(battleLogLines(frames[0], undefined, log.board).every((line) => !line.includes('获胜')));
});

test('GM captures the healing action and final life even when the target explodes on the same beat', () => {
  const round = newScenario();
  addSoldier(round, 'red', [7, 3], 27, 1, 10);
  addSoldier(round, 'red', [7, 2], 10, 1);
  addSoldier(round, 'blue', [7, 4], 4, 1);
  const replay = runScenario(round, true);
  const lines = battleLogLines(replay.frames[0], undefined, round.board);
  assert.ok(lines.some((line) => line.includes('治疗 12，生命 10 → 0')));
  assert.ok(lines.some((line) => line.includes('爆虫') && line.includes('自耗并离场')));
  assert.ok(!lines.some((line) => line.includes('出兵')));
});
