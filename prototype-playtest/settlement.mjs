import { winningCredit } from './returns.mjs';

export function settleSession(session, battleResult, finishedAt, now) {
  const { round, balance } = session;
  if (round.result || now < finishedAt) return session;

  const { roundNumber, stakes, rates, receipts } = round.snapshot;
  const stake = stakes.red + stakes.blue;
  const { winner, scores, damage, decidedBy, fallenBases, endedAtMs } = battleResult;
  let credit = 0;
  if (winner === 'draw' || winner === 'void') credit = stake;
  else credit = winningCredit(stakes[winner], rates[winner]);

  const balanceAfter = balance + credit;
  const result = {
    round: roundNumber,
    status: 'settled',
    winner,
    scores,
    stakes,
    rates,
    stake,
    credit,
    net: credit - stake,
    balanceAfter,
    settledAt: finishedAt,
    receipts,
  };
  if (decidedBy) result.decidedBy = decidedBy;
  if (damage) result.damage = damage;
  if (fallenBases) Object.assign(result, { fallenBases, endedAtMs });
  return { ...session, balance: balanceAfter, round: { ...round, result } };
}
