import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { simulateBattle } from './battle.mjs';
import { battleDataFor, battleDataReport } from './battle-data.mjs';
import { replayFromReport } from './replay-import.mjs';
import { legacyBoard, squareExpansionBoard } from './roster.mjs';
import { advance, newSession, placeBet, timeline } from './round.mjs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`../testing/fixtures/${path}.json`, import.meta.url)));

test('legacy sealed data uses recorded board, rules and fire version', () => {
  for (const [board, rules] of [[legacyBoard, 1], [squareExpansionBoard, 3]]) {
    let session = newSession('legacy', 0, [], 2, undefined, board);
    session.round.combatRules = rules;
    delete session.round.fireRevision;
    session = placeBet(session, 1, { sessionId: session.id, roundNumber: 1, side: 'red', amount: 200, requestId: 'legacy' }).session;
    const sealed = advance(session, timeline(session.round).lock);
    const record = battleDataReport(battleDataFor(sealed.round, []), 'lock', 60_000);
    const replay = replayFromReport(record);
    assert.equal(replay.board, board);
    assert.equal(replay.combatRules, rules);
    assert.equal(replay.source, 'snapshot');
    const expected = simulateBattle(record.round.loadout, record.round.durations.battleMs, board, rules, 1, false, true);
    assert.deepEqual(replay.frames, expected.frames);
    assert.deepEqual(replay.result, expected.result);
  }
});

test('a bundle plays stored beats and a standalone battle log yields the same frames', () => {
  const full = fixture('round-archive/complete');
  const a = replayFromReport(full);
  const b = replayFromReport(full.battle_log);
  assert.deepEqual(a.frames, b.frames);
  assert.deepEqual(a.result, b.result);
  const firstCamp = full.battle_data.round.loadout.red.barracks[0];
  const tile = `red:${firstCamp.at.join('-')}`;
  assert.deepEqual(a.barracks.get(tile), { name: firstCamp.unit.name, level: firstCamp.level });
  assert.deepEqual(b.barracks.get(tile), { name: firstCamp.unit.name, level: undefined });
  assert.equal(a.source, 'log');
  assert.equal(a.recordedThroughMs, 38_000);
  assert.equal(a.result.winner, 'blue');
  // A valid recorded log still plays its original content if the snapshot cannot be simulated.
  full.battle_data.round.loadout = {};
  assert.deepEqual(replayFromReport(full), b);
});

test('standalone log pins recorded barracks names and levels before their first spawn', () => {
  const full = fixture('round-archive/complete');
  const camp = full.battle_data.round.loadout.red.barracks[0];
  const at = camp.at;
  const log = { ...full.battle_log, complete: false, result: null, frames: [], recordedThroughMs: 0 };
  const tile = `red:${at.join('-')}`;
  assert.equal(replayFromReport(log).barracks.has(tile), false);
  log.barracks = [null, { at: 'bad', side: 'red', name: '坏值', level: 2 }, { at, side: 'red', name: camp.unit.name, level: camp.level }];
  assert.deepEqual(replayFromReport(log).barracks.get(tile), { name: camp.unit.name, level: camp.level });
});

test('partial logs end at their last recorded beat without a final result', () => {
  const data = fixture('round-archive/partial');
  const replay = replayFromReport(data);
  assert.equal(replay.recordedThroughMs, 7500);
  assert.equal(replay.frames.at(-1).elapsed, 7500);
  assert.equal(replay.result, null);
  assert.equal(replay.complete, false);
  assert.deepEqual(replay.frames, replayFromReport(data.battle_log).frames);
  assert.equal(replayFromReport(fixture('round-archive/lock')).source, 'snapshot');
});

test('unknown versions, incomplete shapes, missing frames and mismatched bundle identity are rejected', () => {
  const valid = fixture('round-archive/partial');
  const old = fixture('ground-self-destruct/normal');
  assert.throws(() => replayFromReport({ ...old, version: 99 }), /快照版本/);
  assert.throws(() => replayFromReport({ ...old, round: { ...old.round, combatRules: 199 } }), /规则版本/);
  assert.throws(() => replayFromReport({ ...valid, version: 99 }), /战局包版本/);
  assert.throws(() => replayFromReport({ ...valid.battle_log, version: 99 }), /战斗日志版本/);
  assert.throws(() => replayFromReport({ ...valid.battle_log, initialFrame: null }), /初始帧/);
  assert.throws(() => replayFromReport({ ...valid.battle_log, frames: valid.battle_log.frames.slice(1) }), /损坏/);
  assert.throws(() => replayFromReport({ ...valid, roundNumber: valid.roundNumber + 1 }), /轮次不一致/);
  assert.throws(() => replayFromReport({ ...valid, sessionId: 'other' }), /会话或轮次不一致/);
  assert.throws(() => replayFromReport({ ...valid, battle_data: { ...valid.battle_data, round: { ...valid.battle_data.round, combatRules: 1 } } }), /规则不一致/);
  assert.throws(() => replayFromReport(fixture('round-archive/open')), /封盘快照/);
  assert.throws(() => replayFromReport({ ...old, round: { ...old.round, sealed: false } }), /尚未封盘/);
  assert.throws(() => replayFromReport({ format: 'alien' }), /格式不受支持/);
});
