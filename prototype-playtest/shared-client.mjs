const sessionKey = 'bet-arena.shared.tab-session.v1';
export const pendingKey = 'bet-arena.shared.pending.v1';

export async function signIn(username) {
  const { token } = await arenaRequest('login', { username });
  sessionStorage.setItem(sessionKey, token);
}

function signOut() {
  sessionStorage.removeItem(sessionKey);
  location.replace('/');
}

export async function arenaRequest(path, data, { allowMissing = false, signal } = {}) {
  const login = path === 'login';
  const token = login ? null : sessionStorage.getItem(sessionKey);
  if (!login && !token) {
    signOut();
    throw new Error('请重新进入试玩。');
  }
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const options = data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) };
  if (data !== undefined) headers.set('Content-Type', 'application/json');
  const timeout = AbortSignal.timeout(6000);
  const response = await fetch(`/api/${path}`, {
    ...options, headers, credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  signal?.throwIfAborted();
  if (response.status === 401 && !login) {
    if (sessionStorage.getItem(sessionKey) === token) signOut();
    throw new Error('请重新进入试玩。');
  }
  if (response.status === 404 && allowMissing) return null;
  const result = await response.json();
  signal?.throwIfAborted();
  if (!login && sessionStorage.getItem(sessionKey) !== token) throw new Error('本页账号已切换，请重新读取。');
  if (!response.ok) throw new Error(result.error || '服务暂时不可用。');
  return result;
}

export const updateSession = () => arenaRequest('state');
export const submitArchivedBet = (request) => arenaRequest('bets', request);
// If a response was lost, resubmitting this same request returns its original receipt.
export const archivedBetResult = submitArchivedBet;

export async function archiveRoundNumbers(uid) {
  const history = await arenaRequest('history');
  if (history.account.uid !== uid) return [];
  return history.entries.map(({ round }) => round).reverse();
}

export async function exportArchivedRound(uid, round) {
  const response = await arenaRequest(`archive?round=${round}&uid=${encodeURIComponent(uid)}`, undefined, { allowMissing: true });
  return response?.archive ?? null;
}

export function mountAccountNav() {
  const header = document.querySelector('header');
  header.classList.add('account-header');
  const accountName = header.querySelector('.subheading');
  accountName.textContent = '账号试玩 · 正在连接';
  const nav = document.createElement('nav');
  nav.className = 'account-nav';
  const history = document.createElement('a');
  history.href = '/history/';
  history.textContent = '我的历史';
  const logout = document.createElement('button');
  logout.className = 'secondary';
  logout.textContent = '退出';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await arenaRequest('logout', {});
      sessionStorage.removeItem(pendingKey);
      signOut();
    } catch (error) {
      document.getElementById('notice').textContent = error.message;
      logout.disabled = false;
    }
  });
  nav.append(history, logout);
  header.append(nav);
  return ({ name }) => { accountName.textContent = `账号试玩 · ${name}`; };
}
