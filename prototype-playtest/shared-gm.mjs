import { arenaRequest } from './shared-client.mjs';

const element = (id) => document.getElementById(id);
const notice = (text) => { element('notice').textContent = text || ''; };
const form = element('gm-form');
const guest = element('guest');
const readonly = element('readonly');

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
  notice('');
  const result = await arenaRequest('gm/config', undefined, { allowGuest: true });
  guest.hidden = result.signedIn;
  readonly.hidden = !result.signedIn || result.allowed;
  form.hidden = !result.allowed;
  element('who').textContent = result.account ? `当前账号：${result.account.name}` : '尚未登录';
  if (result.allowed) {
    fill(result.gmConfig);
    element('current').hidden = true;
  } else if (result.signedIn) {
    // 只读账号：把当前配置以可读文本展示，不提供表单。
    element('current').hidden = false;
    element('current').textContent = JSON.stringify(result.gmConfig, null, 2);
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
    notice(`已保存，下一轮（第 ${result.roundNumber} 轮）生效。`);
    await refresh();
  } catch (error) { notice(error.message); }
});

refresh().catch((error) => notice(error.message));
