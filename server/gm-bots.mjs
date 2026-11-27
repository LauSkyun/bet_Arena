// dev GM 多人下注模拟的纯逻辑：配置校验、按轮确定性计划、到期事件应用。
// 陪练走 confirmBet 同一套 invest/封盘路径，但不建账号、不扣真人余额、不落真人历史。

import { confirmBet, maxReferenceThreshold } from '../prototype-playtest/betting.mjs';
import { playerPoolRules } from '../prototype-playtest/settlement-pool.mjs';

// settlementMode: 2 = 奖池规则（playerPoolRules），1 = 旧倍率；默认奖池，模拟默认关。
export const defaultGmConfig = Object.freeze({
  settlementMode: playerPoolRules,
  botEnabled: false,
  botCount: 3,
  minAmount: 10,
  maxAmount: 200,
});

export function validateGmConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const settlementMode = value.settlementMode;
  if (settlementMode !== 1 && settlementMode !== playerPoolRules) return null;
  if (typeof value.botEnabled !== 'boolean') return null;
  if (!Number.isSafeInteger(value.botCount) || value.botCount < 1 || value.botCount > 5) return null;
  if (!Number.isSafeInteger(value.minAmount) || !Number.isSafeInteger(value.maxAmount)) return null;
  if (value.minAmount < 1 || value.maxAmount < value.minAmount) return null;
  return { settlementMode, botEnabled: value.botEnabled, botCount: value.botCount, minAmount: value.minAmount, maxAmount: value.maxAmount };
}

function mix(a, b) {
  return Math.imul((a ^ b) >>> 0, 0x9e3779b1) >>> 0;
}

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 计划由会话种子 + 轮号 + 配置确定性生成；重启后按同一计划时间处理到期事件。
export function botPlan(round, config, sessionSeed) {
  if (!config?.botEnabled || round.snapshot) return [];
  let hash = sessionSeed >>> 0;
  for (const part of [round.number, config.botCount, config.minAmount, config.maxAmount]) hash = mix(hash, part >>> 0);
  const rnd = randomFrom(hash);
  const span = config.maxAmount - config.minAmount + 1;
  const plan = [];
  for (let index = 0; index < config.botCount; index++) {
    const side = rnd() < 0.5 ? 'red' : 'blue';
    const amount = config.minAmount + Math.floor(rnd() * span);
    // 轮内 10%–80% 的时点，留出封盘前的处理窗口。
    const elapsedMs = Math.floor(round.durations.betMs * (0.10 + rnd() * 0.70));
    plan.push({ requestId: `bot:${round.number}:${index}`, side, amount, elapsedMs, index });
  }
  return plan.sort((a, b) => a.elapsedMs - b.elapsedMs || a.index - b.index);
}

// 把到期的陪练计划按 confirmBet 应用到共享轮次。返回更新后的 state 与新落库的回执列表。
// dueNow 由调用方封顶到锁定时刻：封盘前的到期事件全部处理，封盘后禁止补单。
export function applyDueBots(state, config, dueNow, hasStored, store) {
  if (!config?.botEnabled || state.round.snapshot) return { state, applied: [] };
  const plan = botPlan(state.round, config, state.seed);
  let updated = state;
  const applied = [];
  for (const planned of plan) {
    const confirmedAt = state.round.startedAt + planned.elapsedMs;
    if (confirmedAt > dueNow) continue;
    if (hasStored(state.round.number, planned.requestId)) continue;
    // 与真人在 arena.bet 的公共总投闸门一致：陪练也不能把本轮总投推过精确计算上限。
    const total = updated.round.teams.red.total + updated.round.teams.blue.total;
    if (planned.amount > maxReferenceThreshold - total) continue;
    const synthetic = { ...updated, id: planned.requestId, balance: Number.MAX_SAFE_INTEGER, round: { ...updated.round } };
    const result = confirmBet(synthetic, confirmedAt, {
      sessionId: planned.requestId, roundNumber: state.round.number,
      side: planned.side, amount: planned.amount, requestId: planned.requestId,
    });
    if (!result.receipt) continue;
    store(state.round.number, planned.requestId, planned.side, planned.amount, confirmedAt, result.receipt);
    applied.push({ ...planned, confirmedAt, receipt: result.receipt });
    // 采用陪练带来的强化与总投，但共享轮次的 receipts 仍只放真人回执。
    updated = { ...updated, round: { ...result.session.round, receipts: updated.round.receipts } };
  }
  return { state: updated, applied };
}
