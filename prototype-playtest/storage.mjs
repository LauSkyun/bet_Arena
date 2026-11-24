import { groundProfile } from './profiles.mjs';
import { previousCombatRules } from './battle.mjs';
import { legacyBoard } from './roster.mjs';
import { defaultDurations, legacyDurations } from './timing.mjs';
import { betting, stakesFor } from './betting.mjs';
import { advance, newSession, sessionVersion } from './round.mjs';

const sessionKey = 'bet-arena.prototype.sc-ground-v21.v1';

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
  if (!saved || saved.version === sessionVersion) return saved;
  // Sessions through v12 used a fixed 10-point threshold for every wager in the open round.
  saved = { ...saved, round: { ...saved.round, threshold: 10 }, nextThreshold: betting.threshold };
  // Older tabs reject this version before they can settle a round with newer rules.
  if (Number.isInteger(saved.version) && saved.version >= 6 && saved.version <= 12) return { ...saved, version: sessionVersion };
  if (saved.version === 5) return { ...saved, version: sessionVersion, round: { ...saved.round, combatRules: previousCombatRules } };
  if (saved.version === 4) return { ...saved, version: sessionVersion, round: { ...saved.round, board: legacyBoard, combatRules: previousCombatRules } };
  if (saved.version === 3) return { ...saved, version: sessionVersion, nextDurations: defaultDurations,
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
  return { ...saved, version: sessionVersion, nextDurations: defaultDurations, previous: migrateResult(saved.previous),
    round: { ...round, board: legacyBoard, combatRules: previousCombatRules, durations: legacyDurations, snapshot: sealed, result: migrateResult(result, sealed?.rates) } };
}

export function updateSession(action = null) {
  // Serialize writes from all tabs on the same origin, including refresh and retry.
  return navigator.locks.request(sessionKey, () => {
    const now = Date.now();
    const saved = localStorage.getItem(sessionKey);
    const original = saved ? JSON.parse(saved) : null;
    const session = upgradeSession(original) ?? newSession(crypto.randomUUID(), now, undefined, undefined, undefined, undefined, groundProfile);
    const update = action ? action(session, now) : { session: advance(session, now) };
    if (update.session !== original) localStorage.setItem(sessionKey, JSON.stringify(update.session));
    return { ...update, now };
  });
}

export function resetSession() {
  return updateSession((session, now) => ({ session: newSession(crypto.randomUUID(), now, undefined, undefined, session.nextDurations, undefined, session.nextProfile, session.nextThreshold) }));
}
