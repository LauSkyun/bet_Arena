// 多人测试积分奖池结算（settlementRules = 2，见 requirements/09-player-pool）。
// 奖池只由玩家已确认实扣构成；系统投点只强化，不参与分配。

export const playerPoolRules = 2;
const rakePercent = 5n;

// accounts: [{ uid, red, blue }] —— 每账号本轮已确认的胜/败两侧实扣（整数，非负数）。
// winner: 'red' | 'blue' | 'draw' | 'void'。
// 返回 { byUid: Map<uid, credit>, detail }。detail 为公共奖池口径，不含个人金额。
export function settlePlayerPool(accounts, winner) {
  const redTotal = accounts.reduce((sum, { red }) => sum + red, 0);
  const blueTotal = accounts.reduce((sum, { blue }) => sum + blue, 0);
  const detail = { red: redTotal, blue: blueTotal, winnerPool: 0, loserPool: 0, rake: 0, distributable: 0 };

  // 退款：平局/作废，或只有一边有玩家实扣（对侧只有系统参照投入也一样全退）。
  if (winner === 'draw' || winner === 'void' || redTotal === 0 || blueTotal === 0) {
    const byUid = new Map(accounts.map(({ uid, red, blue }) => [uid, red + blue]));
    return { byUid, detail };
  }

  const winSide = winner;
  const loseSide = winner === 'red' ? 'blue' : 'red';
  const winnerPool = winSide === 'red' ? redTotal : blueTotal;
  const loserPool = loseSide === 'red' ? redTotal : blueTotal;
  const rake = Number((BigInt(loserPool) * rakePercent) / 100n); // 向下取整
  const distributable = loserPool - rake;
  Object.assign(detail, { winnerPool, loserPool, rake, distributable });

  // 每个有胜方实扣的账号：本金 s + 基础份额 q，余数 m 用于排序。
  const shares = [];
  let allocated = 0;
  for (const [index, account] of accounts.entries()) {
    const principal = account[winSide];
    if (principal <= 0) continue;
    const numerator = BigInt(distributable) * BigInt(principal);
    const denominator = BigInt(winnerPool);
    const base = Number(numerator / denominator);
    const remainder = numerator % denominator;
    allocated += base;
    shares.push({ uid: account.uid, principal, base, remainder, index });
  }

  // 余数降序分配 e 个余额点；余数相同按首次确认序（index），再按 UID 兜底。
  const leftover = distributable - allocated;
  shares.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return String(a.uid) < String(b.uid) ? -1 : String(a.uid) > String(b.uid) ? 1 : 0;
  });
  for (let i = 0; i < leftover && i < shares.length; i++) shares[i].base += 1;

  const byUid = new Map(accounts.map(({ uid }) => [uid, 0]));
  for (const share of shares) byUid.set(share.uid, share.principal + share.base);
  return { byUid, detail };
}

// 单账号在指定胜方下的奖池明细（供结果里的 pool 字段）。
export function personalPoolDetail(detail, winner, red, blue) {
  const winSide = winner === 'red' ? 'red' : 'blue';
  const principal = winSide === 'red' ? red : blue;
  // 退款场景没有分成；正常场景分成 = 入账 − 本金，由调用方按 byUid 结果补齐 share。
  return { ...detail, principal };
}
