import { winningCredit } from './returns.mjs';
import { playerPoolRules, settlePlayerPool } from './settlement-pool.mjs';

export function settleSession(session, battleResult, finishedAt, now, options = {}) {
  const { round, balance } = session;
  if (round.result || now < finishedAt) return session;

  const { roundNumber, stakes, rates, receipts } = round.snapshot;
  const stake = stakes.red + stakes.blue;
  const { winner, scores, damage, decidedBy, fallenBases, endedAtMs } = battleResult;
  const rules = round.snapshot.settlementRules ?? 1;
  let credit = 0;
  let pool = null;
  if (rules === playerPoolRules) {
    // 奖池按全体玩家已确认实扣计算；匿名版只有本账号一个参与者，账号版由 settleRound 传入全体账号。
    const accounts = options.accounts ?? [{ uid: options.uid ?? session.id, red: stakes.red, blue: stakes.blue }];
    const uid = options.uid ?? session.id;
    const settled = settlePlayerPool(accounts, winner);
    credit = settled.byUid.get(uid) ?? 0;
    const personal = accounts.find((account) => account.uid === uid) ?? { red: 0, blue: 0 };
    const principal = winner === 'red' ? personal.red : winner === 'blue' ? personal.blue : 0;
    pool = { ...settled.detail, principal, share: Math.max(0, credit - principal) };
  } else if (winner === 'draw' || winner === 'void') credit = stake;
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
  if (rules === playerPoolRules) {
    result.settlementRules = playerPoolRules;
    result.pool = pool;
  }
  if (decidedBy) result.decidedBy = decidedBy;
  if (damage) result.damage = damage;
  if (fallenBases) Object.assign(result, { fallenBases, endedAtMs });
  return { ...session, balance: balanceAfter, round: { ...round, result } };
}
