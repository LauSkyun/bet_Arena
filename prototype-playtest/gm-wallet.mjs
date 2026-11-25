import { observeSessionChange, updateSession, updateTestBalance } from './storage.mjs';
import { previewTestBalance } from './test-wallet.mjs';

const pendingKey = 'bet-arena.gm.pending-test-balance.v1';

export function setupTestWallet() {
  const element = (id) => document.getElementById(id);
  const form = element('test-wallet');
  const fields = element('wallet-fields');
  const direction = element('wallet-direction');
  const amount = element('wallet-amount');
  const current = element('wallet-current');
  const projected = element('wallet-projected');
  const confirm = element('wallet-submit');
  const notice = element('wallet-notice');
  let latest;
  let pending;
  let busy = false;
  let reading = false;

  function preview() {
    return latest ? previewTestBalance(latest, direction.value, amount.valueAsNumber) : null;
  }

  function render() {
    const quote = preview();
    current.textContent = latest ? `${latest.balance} 点` : '—';
    projected.textContent = !quote || pending || amount.value === '' ? '—' : quote.error ?? `${quote.balance} 点`;
    fields.disabled = busy || Boolean(pending) || !latest;
    confirm.disabled = busy || (!pending && (!quote || Boolean(quote.error)));
    confirm.textContent = pending && !busy ? '重试这笔调整' : '确认调整';
    form.setAttribute('aria-busy', String(busy));
  }

  async function refresh() {
    if (reading || busy) return;
    reading = true;
    try {
      const { session } = await updateSession();
      latest = session;
    } catch {
      latest = undefined;
      notice.textContent = '无法读取当前试玩的积分。';
    } finally {
      reading = false;
      render();
    }
  }

  async function apply(request) {
    pending = request;
    busy = true;
    notice.textContent = '';
    render();
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(request));
      const response = await updateTestBalance(request);
      latest = response.session;
      sessionStorage.removeItem(pendingKey);
      pending = undefined;
      notice.textContent = response.error ?? (response.replayed ? '这笔调整已确认。' : `已调整，当前余额 ${latest.balance} 点。`);
      if (!response.error) amount.value = '';
    } catch {
      notice.textContent = '暂时无法确认结果，可重试这笔调整。';
    } finally {
      busy = false;
      render();
      void refresh();
    }
  }

  form.addEventListener('input', render);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (confirm.disabled) return;
    if (pending) {
      void apply(pending);
    } else {
      void apply({ sessionId: latest.id, requestId: crypto.randomUUID(), direction: direction.value, amount: amount.valueAsNumber });
    }
  });
  observeSessionChange(() => void refresh());
  window.addEventListener('pageshow', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  try {
    const request = JSON.parse(sessionStorage.getItem(pendingKey));
    if (request?.sessionId && request.requestId) {
      void apply(request);
      return;
    }
  } catch {
    notice.textContent = '无法恢复上一笔调整，请核对当前余额。';
  }
  render();
  void refresh();
}
