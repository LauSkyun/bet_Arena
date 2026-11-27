import assert from 'node:assert/strict';
import { test } from 'node:test';

// Minimal DOM/fetch shim so the real shared-gm.mjs page logic runs under node --test.
function makeElement(id) {
  const el = {
    id, textContent: '', hidden: false, checked: false, value: '', disabled: false,
    handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    querySelector(sel) { return this._query?.(sel) ?? null; },
  };
  return el;
}

async function loadPage({ panel, saveResult }) {
  const ids = ['notice', 'gm-form', 'guest', 'readonly', 'who', 'current',
    'bot-enabled', 'bot-count', 'bot-min', 'bot-max', 'save'];
  const els = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  const form = els['gm-form'];
  const radios = { '2': makeElement('mode2'), '1': makeElement('mode1') };
  form._query = (sel) => {
    if (sel === 'input[name=mode]:checked') return radios['2'];
    const m = /value="(\d)"/.exec(sel);
    return m ? radios[m[1]] : null;
  };

  globalThis.document = { getElementById: (id) => els[id] ?? null };
  globalThis.sessionStorage = { getItem: () => 'test-token', setItem() {}, removeItem() {} };
  globalThis.fetch = async (url, options) => {
    const isPost = options?.method === 'POST';
    const body = isPost ? JSON.stringify(saveResult) : JSON.stringify(panel);
    return { status: 200, ok: true, json: async () => JSON.parse(body) };
  };

  // fresh module instance per test
  const mod = await import(`./shared-gm.mjs?t=${Date.now()}-${Math.random()}`);
  void mod;
  // allow the initial refresh() promise to settle
  await new Promise((r) => setTimeout(r, 0));
  return { els, form, radios };
}

test('GM page keeps the saved success message with the effective round number', async () => {
  const panel = { signedIn: true, allowed: true, account: { uid: 'u', name: 'GM' },
    gmConfig: { settlementMode: 2, botEnabled: false, botCount: 3, minAmount: 10, maxAmount: 200 } };
  const { els, form } = await loadPage({ panel, saveResult: { gmConfig: panel.gmConfig, roundNumber: 7 } });
  await form.handlers.submit({ preventDefault() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(els.notice.textContent, /已保存/);
  assert.match(els.notice.textContent, /第 7 轮/);
});

test('GM page readonly view shows a Chinese summary, never raw JSON keys', async () => {
  const panel = { signedIn: true, allowed: false, account: { uid: 'u', name: '路人' },
    gmConfig: { settlementMode: 1, botEnabled: true, botCount: 4, minAmount: 20, maxAmount: 150 } };
  const { els, form } = await loadPage({ panel, saveResult: {} });
  assert.equal(els.readonly.hidden, false);
  assert.equal(form.hidden, true);
  const text = els.current.textContent;
  assert.match(text, /结算模式/);
  assert.match(text, /旧倍率/);
  assert.match(text, /开启/);
  assert.match(text, /4/);
  assert.match(text, /20[\u2013-]150/);
  assert.equal(text.includes('settlementMode'), false);
  assert.equal(text.includes('botEnabled'), false);
  // readonly account cannot submit: form has no visible submit path
  assert.equal(form.hidden, true);
});

test('GM page guest state shows login entry and hides config', async () => {
  const { els, form } = await loadPage({ panel: { signedIn: false, allowed: false, gmConfig: null }, saveResult: {} });
  assert.equal(els.guest.hidden, false);
  assert.equal(form.hidden, true);
  assert.equal(els.current.hidden, true);
});
