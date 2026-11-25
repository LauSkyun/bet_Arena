import { arenaRequest } from './shared-client.mjs';

const element = (id) => document.getElementById(id);
const rows = element('history-rows');
const more = element('history-more');
const notice = element('history-notice');
const resultName = { red: '红队获胜', blue: '蓝队获胜', draw: '平局', void: '本轮作废' };
let uid;
let next = null;
let loading = false;

function historyRow(entry) {
  const tr = document.createElement('tr');
  const { round, settledAt, winner, stakes, credit, net, balanceAfter } = entry;
  const values = [round, new Date(settledAt).toLocaleString(), resultName[winner], stakes.red, stakes.blue,
    credit, net > 0 ? `+${net}` : net, balanceAfter];
  for (const text of values) {
    const cell = tr.insertCell();
    cell.textContent = text;
  }
  const link = document.createElement('a');
  link.href = `/api/archive?round=${round}&uid=${encodeURIComponent(uid)}&download=1`;
  link.download = `bet-data-round-${round}.json`;
  link.textContent = '下载';
  link.setAttribute('aria-label', `下载第 ${round} 局战局包`);
  tr.insertCell().append(link);
  return tr;
}

async function load(before) {
  if (loading) return;
  loading = true;
  more.disabled = true;
  try {
    const page = await arenaRequest(before ? `history?before=${before}` : 'history');
    if (!before || uid !== page.account.uid) rows.replaceChildren();
    if (before && uid !== page.account.uid) {
      location.reload();
      return;
    }
    uid = page.account.uid;
    element('history-account').textContent = page.account.name;
    rows.append(...page.entries.map(historyRow));
    element('history-scroll').hidden = rows.childElementCount === 0;
    notice.textContent = rows.childElementCount ? '' : '暂无已结算的下注记录。';
    next = page.next;
    more.hidden = !next;
  } catch (error) {
    notice.textContent = error.message;
    more.hidden = false;
    more.textContent = '重试';
  } finally {
    more.disabled = false;
    loading = false;
  }
}

more.addEventListener('click', () => {
  more.textContent = '加载更早记录';
  void load(next);
});
window.addEventListener('pageshow', () => void load(null));
