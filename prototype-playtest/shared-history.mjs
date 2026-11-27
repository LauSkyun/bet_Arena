import { arenaRequest, exportArchivedRound } from './shared-client.mjs';

const element = (id) => document.getElementById(id);
const rows = element('history-rows');
const more = element('history-more');
const notice = element('history-notice');
const accountName = element('history-account');
const table = element('history-scroll');
const resultName = { red: '红队获胜', blue: '蓝队获胜', draw: '平局', void: '本轮作废' };
let uid;
let next = null;
let pending;

function historyRow(entry) {
  const tr = document.createElement('tr');
  const { round, settledAt, winner, stakes, credit, net, balanceAfter } = entry;
  const values = [round, new Date(settledAt).toLocaleString(), resultName[winner], stakes.red, stakes.blue,
    credit, net > 0 ? `+${net}` : net, balanceAfter];
  for (const text of values) {
    const cell = tr.insertCell();
    cell.textContent = text;
  }
  const owner = uid;
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'secondary';
  download.textContent = '下载';
  download.setAttribute('aria-label', `下载第 ${round} 局战局包`);
  download.addEventListener('click', async () => {
    download.disabled = true;
    try {
      const archive = await exportArchivedRound(owner, round);
      if (!archive) throw new Error('这局存档不可用。');
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `bet-data-round-${round}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      download.disabled = false;
    }
  });
  tr.insertCell().append(download);
  return tr;
}

function clearHistory() {
  pending?.abort();
  pending = undefined;
  uid = undefined;
  next = null;
  accountName.textContent = '';
  rows.replaceChildren();
  table.hidden = true;
  more.hidden = true;
  notice.textContent = '正在读取历史。';
}

function refreshHistory() {
  clearHistory();
  if (document.visibilityState === 'visible') void load(null);
}

async function load(before) {
  if (pending) return;
  const request = new AbortController();
  pending = request;
  more.disabled = true;
  try {
    const page = await arenaRequest(before ? `history?before=${before}` : 'history', undefined, { signal: request.signal });
    if (request !== pending) return;
    if (before && uid !== page.account.uid) {
      refreshHistory();
      return;
    }
    uid = page.account.uid;
    accountName.textContent = page.account.name;
    rows.append(...page.entries.map(historyRow));
    table.hidden = rows.childElementCount === 0;
    notice.textContent = rows.childElementCount ? '' : '暂无已结算的下注记录。';
    next = page.next;
    more.textContent = '加载更早记录';
    more.hidden = !next;
  } catch (error) {
    if (request !== pending) return;
    notice.textContent = error.message;
    more.hidden = false;
    more.textContent = '重试';
  } finally {
    if (request === pending) {
      more.disabled = false;
      pending = undefined;
    }
  }
}

more.addEventListener('click', () => void load(next));
window.addEventListener('pageshow', refreshHistory);
window.addEventListener('pagehide', clearHistory);
document.addEventListener('visibilitychange', refreshHistory);
