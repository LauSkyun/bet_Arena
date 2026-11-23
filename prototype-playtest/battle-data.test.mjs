import assert from 'node:assert/strict';
import { test } from 'node:test';
import { battleDataFor, battleDataReport } from './battle-data.mjs';
import { reversalCombatRules, simulateBattle } from './battle.mjs';
import { advance, newSession, placeBet, sessionVersion, timeline } from './round.mjs';
import { upgradeSession } from './storage.mjs';

const equalStakes = () => {
  let session = newSession('private-session-id', 1234, undefined, 0);
  for (const side of ['red', 'blue']) {
    session = placeBet(session, 2234, {
      sessionId: session.id, roundNumber: 1, side, amount: 100, requestId: `private-id-${side}`,
    }).session;
  }
  return session;
};

test('a territory tie uses effective damage to settle new rounds and preserves old payouts', () => {
  const session = equalStakes();
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
  assert.equal(advance(restored, time.next).round.combatRules, session.round.combatRules);
});

test('current and previous exports preserve the exact inputs without private identifiers', () => {
  const session = equalStakes();
  const live = battleDataFor(session.round, session.reference);
  assert.equal(live.sealed, false);
  assert.deepEqual(live.bets, [
    { side: 'red', amount: 100, elapsedMs: 1000 }, { side: 'blue', amount: 100, elapsedMs: 1000 },
  ]);
  const time = timeline(session.round);
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
