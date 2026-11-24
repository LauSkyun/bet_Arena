import { battleLoadout } from './roster.mjs';
import { stakesFor } from './betting.mjs';
import { returnsFor } from './returns.mjs';

const sides = ['red', 'blue'];

export function battleDataFor(round, reference) {
  const { snapshot, result, number, board, combatRules, durations, fireRevision, profile } = round;
  const teams = snapshot?.teams ?? round.teams;
  const loadout = snapshot?.battle ?? Object.fromEntries(sides.map((side) => [side, battleLoadout(teams[side].roster, board, combatRules)]));
  const stakes = snapshot?.stakes ?? stakesFor(teams);
  return {
    number, board, combatRules, durations, fireRevision, profile,
    sealed: Boolean(snapshot),
    stakes,
    rates: snapshot ? snapshot.rates : returnsFor(teams),
    totals: Object.fromEntries(sides.map((side) => [side, teams[side].total])),
    bets: round.receipts.map(({ side, amount, confirmedAt }) => ({ side, amount, elapsedMs: confirmedAt - round.startedAt })),
    reference,
    loadout,
    result: result ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'receipts' && key !== 'settledAt')) : null,
  };
}

export function battleDataReport(data, phase, elapsedMs) {
  return { format: 'bet-arena/battle-data', version: 1, phase, elapsedMs, round: data };
}
