import { arenaRequest } from './shared-client.mjs';

const element = (id) => document.getElementById(id);
const notice = (text) => { element('notice').textContent = text || ''; };
const form = element('gm-form');
const guest = element('guest');
const readonly = element('readonly');

function summary(config) {
  if (!config) return '';
  const mode = config.settlementMode === 2 ? '奖池（只计玩家实扣）' : '旧倍率';
  const bots = config.botEnabled ? '开启' : '关闭';
  return `当前配置（只读）· 结算模式：${mode}；模拟多人下注：${bots}；陪练人数：${config.botCount ?? 3}；每人金额：${config.minAmount ?? 10}–${config.maxAmount ?? 200} 点。下一新轮生效。`;
}

function fill(config) {
  if (!config) return;
  const mode = String(config.settlementMode ?? 2);
  const radio = form.querySelector(`input[name=mode][value="${mode}"]`);
  if (radio) radio.checked = true;
  element('bot-enabled').checked = Boolean(config.botEnabled);
  element('bot-count').value = config.botCount ?? 3;
  element('bot-min').value = config.minAmount ?? 10;
  element('bot-max').value = config.maxAmount ?? 200;
}

async function refresh() {
  const result = await arenaRequest('gm/config', undefined, { allowGuest: true });
  guest.hidden = result.signedIn;
  readonly.hidden = !result.signedIn || result.allowed;
  form.hidden = !result.allowed;
  element('who').textContent = result.account ? `当前账号：${result.account.name}` : '尚未登录';
  if (result.allowed) {
    fill(result.gmConfig);
    element('current').hidden = true;
  } else if (result.signedIn) {
    // 只读账号：中文摘要，不展示原始 JSON、不提供表单。
    element('current').hidden = false;
    element('current').textContent = summary(result.gmConfig);
  } else {
    element('current').hidden = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice('');
  const value = {
    settlementMode: Number(form.querySelector('input[name=mode]:checked').value),
    botEnabled: element('bot-enabled').checked,
    botCount: Number(element('bot-count').value),
    minAmount: Number(element('bot-min').value),
    maxAmount: Number(element('bot-max').value),
  };
  try {
    const result = await arenaRequest('gm/config', value);
    await refresh();
    // 保存回执在 refresh 之后写入，避免被刷新流程清空，稳定保留成功提示与生效轮号。
    notice(`已保存，下一轮（第 ${result.roundNumber} 轮）生效。`);
  } catch (error) { notice(error.message); }
});

refresh().catch((error) => notice(error.message));
