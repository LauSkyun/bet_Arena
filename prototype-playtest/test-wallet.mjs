import { stakesFor } from './betting.mjs';

// Leave room for the pool odds (in integer percent) and payouts to stay exact.
const maxTestFunds = Math.floor(Number.MAX_SAFE_INTEGER / 100);
const validDirection = (direction) => direction === 'add' || direction === 'subtract';

export function previewTestBalance(session, direction, amount) {
  if (!validDirection(direction) || !Number.isSafeInteger(amount) || amount <= 0) {
    return { error: '请输入正整数点数。' };
  }
  const balance = session.balance + (direction === 'add' ? amount : -amount);
  if (balance < 0) return { error: '测试积分不足。' };
  const { red, blue } = session.round.result ? { red: 0, blue: 0 } : stakesFor(session.round.teams);
  if (direction === 'add' && (!Number.isSafeInteger(balance) || balance + red + blue > maxTestFunds)) {
    return { error: '调整后积分超出可计算范围。' };
  }
  return { balance };
}

export function adjustTestBalance(session, request) {
  const { sessionId, requestId, direction, amount } = request;
  if (sessionId !== session.id) return { session, error: '试玩会话已切换，请核对当前余额后重试。' };
  if (typeof requestId !== 'string' || !requestId) return { session, error: '无法识别这次积分调整。' };
  const adjustments = session.testBalanceAdjustments ?? [];
  const previous = adjustments.find((entry) => entry.requestId === requestId);
  if (previous) {
    if (previous.direction !== direction || previous.amount !== amount) return { session, error: '这笔调整的请求内容已变化。' };
    return { session, receipt: previous, error: previous.error, replayed: true };
  }
  if (!validDirection(direction) || !Number.isSafeInteger(amount) || amount <= 0) {
    return { session, error: '请输入正整数点数。' };
  }
  const { balance, error } = previewTestBalance(session, direction, amount);
  const receipt = { requestId, direction, amount, ...(error ? { error } : { balanceAfter: balance }) };
  return { session: { ...session, balance: balance ?? session.balance, testBalanceAdjustments: [...adjustments, receipt] }, receipt, error };
}
