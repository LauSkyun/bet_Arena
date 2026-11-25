import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { timeline } from '../prototype-playtest/round.mjs';
import { createArenaServer } from './http.mjs';
import { openArena } from './shared-arena.mjs';

test('HTTP concurrent clients share a round and credits while account details remain private', async (t) => {
  let now = 5000;
  const arena = openArena(':memory:', { clock: () => now, durations: { betMs: 10_000, battleMs: 2000 } });
  const server = createArenaServer({ arena }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    arena.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (token) => token ? { authorization: `Bearer ${token}` } : {};
  const get = (path, token) => fetch(`${base}${path}`, { headers: auth(token) });
  const post = (path, value, token) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth(token) }, body: JSON.stringify(value),
  });
  async function login(username) {
    const response = await post('/api/login', { username });
    assert.equal(response.status, 200);
    assert.deepEqual(response.headers.getSetCookie(), []);
    const { account, token } = await response.json();
    return { ...account, token };
  }
  assert.equal((await get('/api/state')).status, 401);
  assert.match(await (await get('/arena/')).text(), /<body data-shared-arena>/);
  assert.equal((await get('/replay/gm-replay.mjs')).status, 200);
  const [a, same, b] = await Promise.all([login('Alpha'), login('ＡＬＰＨＡ'), login('Beta')]);
  assert.equal(a.uid, same.uid);
  assert.notEqual(a.uid, b.uid);
  const sendBet = async (user, requestId, side, amount) => (await post('/api/bets', {
    sessionId: user.uid, roundNumber: 1, requestId, side, amount,
  }, user.token)).json();
  const competing = await Promise.all([sendBet(a, 'a1', 'red', 6000), sendBet(same, 'a2', 'blue', 6000), sendBet(b, 'b1', 'blue', 500)]);
  assert.equal(competing.filter(({ receipt }) => receipt).length, 2);
  assert.equal(competing.filter(({ error }) => error?.includes('积分不足')).length, 1);
  const replayed = await Promise.all([sendBet(b, 'b1', 'blue', 500), sendBet(b, 'b1', 'blue', 500)]);
  assert.ok(replayed.every(({ replayed, session }) => replayed && session.balance === 9500));
  const state = async (user) => (await (await get('/api/state', user.token)).json()).session;
  const [alice, bob] = await Promise.all([state(a), state(b)]);
  assert.equal(alice.balance, 4000);
  assert.equal(alice.round.receipts[0].amount, 6000);
  assert.equal(bob.round.receipts[0].amount, 500);
  assert.equal(alice.round.teams.blue.total, bob.round.teams.blue.total);
  now = timeline(alice.round).lock;
  assert.match((await sendBet(b, 'late', 'blue', 1)).error, /截止/);
  const sealed = (await state(a)).round;
  assert.deepEqual(sealed.snapshot.battle, (await state(b)).round.snapshot.battle);
  now = timeline(sealed).finish;
  const results = await Promise.all([state(a), state(same), state(b)]);
  assert.deepEqual(results[0].round.result, results[1].round.result);
  assert.equal(results[0].round.result.winner, results[2].round.result.winner);
  const history = await (await get('/api/history', b.token)).json();
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].stake, 500);
  assert.equal((await get('/api/archive?round=2', b.token)).status, 404);
  assert.equal((await get(`/api/archive?round=1&uid=${a.uid}`, b.token)).status, 404);
  const download = await get(`/api/archive?round=1&uid=${b.uid}&download=1`, b.token);
  assert.equal(download.headers.get('content-disposition'), 'attachment; filename="bet-data-round-1.json"');
  assert.equal((await download.json()).format, 'bet-arena/bet_data');
  const drawAccount = await login('Draw');
  now = timeline(sealed).next;
  const roundNumber = (await state(drawAccount)).round.number;
  const small = await (await post('/api/bets', { sessionId: drawAccount.uid, roundNumber, requestId: 'round2', side: 'red', amount: 20 }, drawAccount.token)).json();
  now = timeline(small.session.round).lock;
  const nextSealed = (await state(drawAccount)).round;
  now = timeline(nextSealed).finish;
  const tied = (await state(drawAccount)).round.result;
  assert.equal(tied.winner, 'draw');
  assert.equal(tied.credit, 20);
  assert.equal(tied.balanceAfter, 10_000);
  const switched = await (await post('/api/login', { username: 'Beta' }, a.token)).json();
  assert.equal(switched.account.uid, b.uid);
  assert.equal((await post('/api/logout', {}, switched.token)).status, 200);
  assert.equal((await get('/api/state', switched.token)).status, 401);
  assert.equal((await get('/api/state', a.token)).status, 200);
  assert.equal((await get('/api/state', b.token)).status, 200);
  assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: `arena44_session=${a.token}` } })).status, 401);
});
