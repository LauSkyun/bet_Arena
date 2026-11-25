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
  assert.match(lines.at(-1), /^蓝队获胜 · 红队主基地被摧毁/);
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

test('a barracks becoming ruins on the final beat does not imply base victory or owner capture', () => {
  const before = {
    units: [], events: [], shots: [], scores: { red: 22, blue: 34 },
    buildings: [{ id: 3, side: 'red', kind: 'barracks', at: [3, 5], hp: 10 }],
    terrain: { '3-5': 'barracks', '3-4': 'plot', '4-4': 'ground' }, owners: { '3-4': 'red', '4-4': 'red' },
  };
  const final = {
    ...before, elapsed: 40_000, buildings: [], terrain: { ...before.terrain, '3-5': 'ruins' },
    owners: { '3-5': 'red', '3-4': 'blue', '4-4': 'blue' },
  };
  assert.deepEqual(battleLogLines(final, before, 'hex-14', { winner: 'blue', scores: final.scores, fallenBases: [], decidedBy: 'territory' }), [
    '蓝队占格 4-4', '蓝队占据 3-4（不计分）', '红队兵营被摧毁（3-5）', '蓝队获胜 · 战斗到时，按占格判胜 · 红 22 格，蓝 34 格',
  ]);
});
