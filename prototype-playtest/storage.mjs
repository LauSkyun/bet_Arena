import { previousCombatRules } from './battle.mjs';
import { legacyBoard } from './roster.mjs';
import { defaultDurations, legacyDurations } from './timing.mjs';
import { stakesFor } from './betting.mjs';
import { advance, newSession } from './round.mjs';

const sessionKey = 'bet-arena.prototype.playtest.v1';

function legacyRates(red, blue) {
  return { red: red > 0 ? 200 : null, blue: blue > 0 ? 200 : null };
}

function migrateResult(result, rates) {
  if (!result) return null;
  const { support, stake, ...fields } = result;
  const stakes = fields.stakes ?? { red: support === 'red' ? stake : 0, blue: support === 'blue' ? stake : 0 };
  return { ...fields, stake, stakes, rates: rates ?? legacyRates(stakes.red, stakes.blue) };
}

export function upgradeSession(saved) {
  if (!saved || saved.version === 6) return saved;
  if (saved.version === 5) return { ...saved, version: 6, round: { ...saved.round, combatRules: previousCombatRules } };
  if (saved.version === 4) return { ...saved, version: 6, round: { ...saved.round, board: legacyBoard, combatRules: previousCombatRules } };
  if (saved.version === 3) return { ...saved, version: 6, nextDurations: defaultDurations,
    round: { ...saved.round, board: legacyBoard, combatRules: previousCombatRules, durations: legacyDurations } };
  if (saved.version !== 1 && saved.version !== 2) throw Error('试玩记录版本不受支持');
  const { support: _support, stake: _stake, snapshot, result, ...round } = saved.round;
  let sealed = null;
  if (snapshot) {
    const { support: _side, stake: _total, ...fields } = snapshot;
    const { red, blue } = snapshot.teams;
    // A round sealed under the fixed multiplier keeps that multiplier through recovery.
    sealed = { ...fields, stakes: fields.stakes ?? stakesFor(snapshot.teams), rates: legacyRates(red.total, blue.total) };
  }
  return { ...saved, version: 6, nextDurations: defaultDurations, previous: migrateResult(saved.previous),
    round: { ...round, board: legacyBoard, combatRules: previousCombatRules, durations: legacyDurations, snapshot: sealed, result: migrateResult(result, sealed?.rates) } };
}

export function updateSession(action = null) {
  // Serialize writes from all tabs on the same origin, including refresh and retry.
  return navigator.locks.request(sessionKey, () => {
    const now = Date.now();
    const saved = localStorage.getItem(sessionKey);
    const original = saved ? JSON.parse(saved) : null;
    const session = upgradeSession(original) ?? newSession(crypto.randomUUID(), now);
    const update = action ? action(session, now) : { session: advance(session, now) };
    if (update.session !== original) localStorage.setItem(sessionKey, JSON.stringify(update.session));
    return { ...update, now };
  });
}

export function resetSession() {
  return updateSession((session, now) => ({ session: newSession(crypto.randomUUID(), now, undefined, undefined, session.nextDurations) }));
}
