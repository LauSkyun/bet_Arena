import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyReference } from './betting.mjs';
import { battleDataFor, battleDataReport } from './battle-data.mjs';
import { currentCombatRules, damageTiebreakRules, reversalCombatRules, simulateBattle } from './battle.mjs';
import { advance, newSession, placeBet, sessionVersion, timeline } from './round.mjs';
import { upgradeSession } from './storage.mjs';

const equalStakes = () => {
  let session = newSession('private-session-id', 1234, legacyReference, 0);
  session.round.threshold = 10; // Recorded pre-update battle.
  for (const side of ['red', 'blue']) {
    session = placeBet(session, 2234, {
      sessionId: session.id, roundNumber: 1, side, amount: 100, requestId: `private-id-${side}`,
    }).session;
  }
  return session;
};

test('in-progress rounds preserve the effective-damage and older payout rules', () => {
  const session = equalStakes();
  session.round.combatRules = damageTiebreakRules;
  const time = timeline(session.round);
  const settled = advance(session, time.finish);
  assert.deepEqual(settled.round.result.scores, { red: 28, blue: 28 });
  assert.deepEqual(settled.round.result.damage, { red: 7578, blue: 9492 });
  assert.equal(settled.round.result.decidedBy, 'damage');
  assert.equal(settled.round.result.winner, 'blue');
  assert.equal(settled.round.result.credit, 165);
  assert.equal(settled.balance, 9965);
  const old = { ...session, version: 6, round: { ...session.round, combatRules: reversalCombatRules } };
  const migrated = upgradeSession(JSON.parse(JSON.stringify(old)));
  assert.equal(migrated.version, sessionVersion);
  assert.equal(migrated.round.combatRules, reversalCombatRules);
  const restored = advance(migrated, time.finish);
  assert.equal(restored.round.result.winner, 'draw');
  assert.equal(restored.balance, 10000);
  assert.equal(advance(restored, time.next).round.combatRules, currentCombatRules);
});

test('current and previous exports preserve the exact inputs without private identifiers', () => {
  const session = equalStakes();
  const live = battleDataFor(session.round, session.reference);
  assert.equal(live.sealed, false);
  assert.deepEqual(live.bets, [
    { side: 'red', amount: 100, elapsedMs: 1000 }, { side: 'blue', amount: 100, elapsedMs: 1000 },
  ]);
  const locked = advance(session, timeline(session.round).lock);
  const time = timeline(locked.round);
  const result = advance(session, time.finish);
  const next = advance(result, time.next);
  assert.deepEqual(next.previous.battleData, battleDataFor(result.round, result.reference));
  const json = JSON.stringify(battleDataReport(next.previous.battleData, 'result', null));
  assert.doesNotMatch(json, /private-id|private-session/);
  const { round } = JSON.parse(json);
  const reproduced = simulateBattle(round.loadout, round.durations.battleMs, round.board, round.combatRules);
  assert.equal(reproduced.result.winner, round.result.winner);
  assert.deepEqual(reproduced.result.damage, round.result.damage);
  assert.deepEqual(reproduced.result.scores, round.result.scores);
});


test('new rounds field only barracks production and an empty battlefield settles as a draw', () => {
  const empty = newSession('empty', 0, [], 4);
  const result = advance(empty, timeline(empty.round).finish);
  assert.equal(result.round.result.winner, 'draw');
  assert.deepEqual(result.round.result.scores, { red: 28, blue: 28 });
  assert.equal(result.balance, 10000);
  for (const profile of ['arena-v1', 'sc-sample-v1', 'sc-range-v1']) {
    const session = newSession('s', 0, [], 4, undefined, undefined, profile);
    const paid = placeBet(session, 1, { sessionId: 's', requestId: 'bet', roundNumber: 1, side: 'red', amount: 100 }).session;
    const open = battleDataFor(paid.round, []);
    const sealed = advance(paid, timeline(paid.round).lock);
    const data = battleDataFor(sealed.round, []);
    assert.deepEqual(open.loadout, data.loadout);
    const replay = simulateBattle(data.loadout, 5000, data.board, data.combatRules);
    const { unit } = data.loadout.red.barracks[0];
    const first = replay.frames.find(f => f.units.length);
    assert.equal(first.elapsed, unit.spawnMs ?? 500);
    assert.equal(first.units.length, unit.spawnCount ?? 1);
    assert.ok(replay.frames.every(f => f.units.every(u => u.side === 'red' && u.source && u.name)));
  }
});

test('v10 retains opening troops through seal and export, then rolls over to barracks only', () => {
  const old = newSession('old', 0, [], 4);
  old.version = 10;
  old.round.combatRules = 6;
  const migrated = upgradeSession(JSON.parse(JSON.stringify(old)));
  const sealed = advance(migrated, timeline(migrated.round).lock);
  const oldData = battleDataFor(sealed.round, []);
  assert.equal(oldData.loadout.red.startingUnits.length, 3);
  const replay = simulateBattle(oldData.loadout, 500, oldData.board, oldData.combatRules, oldData.fireRevision);
  assert.equal(replay.frames[0].units.length, 6);
  const next = advance(sealed, timeline(sealed.round).next);
  assert.equal(next.round.combatRules, currentCombatRules);
  assert.deepEqual(next.previous.battleData.loadout, oldData.loadout);
  assert.deepEqual(battleDataFor(next.round, []).loadout.red.startingUnits, []);
});
