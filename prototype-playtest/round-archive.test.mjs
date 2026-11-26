import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordedBattleFrames } from './battle-log.mjs';
import { simulateBattle } from './battle.mjs';
import { groundProfile } from './profiles.mjs';
import { advance, newSession, placeBet, replayForRound, timeline } from './round.mjs';
import { betDataReport, newRoundArchive, recordBattleFrames, saveBattleSnapshot } from './round-archive.mjs';

test('round archive freezes once, records through available beats, and reconstructs all battle frames and the result', () => {
  let session = newSession('archive', 0, [], 8, undefined, undefined, groundProfile);
  const record = newRoundArchive(session, 1, session.round.startedAt);
  const deltas = [];
  const persist = (delta) => deltas.push(delta);
  saveBattleSnapshot(record, session, session.round);
  assert.equal(betDataReport(record, []).battle_data, null);
  assert.equal(recordBattleFrames(record, 2000, null, persist), false);
  for (const side of ['red', 'blue']) session = placeBet(session, 1, { sessionId: session.id, roundNumber: 1, side, amount: 700, requestId: side }).session;
  const locked = advance(session, timeline(session.round).lock);
  saveBattleSnapshot(record, locked, locked.round);
  const frozen = JSON.stringify(record.battle_data);
  const replay = replayForRound(locked.round);
  assert.equal(recordBattleFrames(record, -1, null, persist), false);
  assert.equal(recordBattleFrames(record, 7502, null, persist), true);
  assert.equal(recordBattleFrames(record, 7502, null, persist), false);
  let report = JSON.parse(JSON.stringify(betDataReport(record, deltas)));
  assert.equal(report.battle_log.recordedThroughMs, 7500);
  assert.equal(report.battle_log.result, null);
  assert.equal(report.battle_log.complete, false);
  assert.deepEqual(recordedBattleFrames(report.battle_log), JSON.parse(JSON.stringify(replay.frames.slice(0, 16))));
  const settled = advance(locked, timeline(locked.round).finish);
  saveBattleSnapshot(record, settled, settled.round);
  assert.equal(JSON.stringify(record.battle_data), frozen);
  recordBattleFrames(record, Infinity, settled.round.result, persist);
  assert.equal(recordBattleFrames(record, Infinity, settled.round.result, persist), false);
  report = JSON.parse(JSON.stringify(betDataReport(record, deltas)));
  assert.deepEqual(recordedBattleFrames(report.battle_log), JSON.parse(JSON.stringify(replay.frames)));
  assert.equal(report.battle_log.result.winner, 'red');
  const firstBarracks = report.battle_data.round.loadout.red.barracks[0];
  assert.deepEqual(report.battle_log.barracks[0], { at: firstBarracks.at, side: 'red', name: firstBarracks.unit.name, level: firstBarracks.level, quality: firstBarracks.unit.quality });
  assert.equal(report.battle_log.settlement.balanceAfter, 9608);
  assert.ok(report.battle_log.frames.some((frame) => frame.events.some((event) => event.kind === 'spawn')));
  assert.ok(report.battle_log.frames.some((frame) => frame.events.some((event) => event.kind === 'move')));
  assert.ok(report.battle_log.frames.some((frame) => frame.shots.some((shot) => shot.effect === 'self-destruct')));
});

test('capture enriches old replays without changing deterministic battle state or result', () => {
  for (const rules of [8, 9, 10, 11]) {
    let session = newSession('legacy-capture', 0, [], 24, undefined, undefined, groundProfile);
    session.round.combatRules = rules;
    for (const side of ['red', 'blue']) session = placeBet(session, 1, { sessionId: session.id, roundNumber: 1, side, amount: 600, requestId: side }).session;
    const round = advance(session, timeline(session.round).lock).round;
    const expected = simulateBattle(round.snapshot.battle, round.durations.battleMs, round.board, rules, round.fireRevision);
    const captured = replayForRound(round);
    const state = ({ events, shots, ...frame }) => frame;
    assert.deepEqual(captured.frames.map(state), expected.frames.map(state));
    assert.deepEqual(captured.result, expected.result);
  }
});
