import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openArena } from './shared-arena.mjs';

const gmConfig = { settlementMode: 2, botEnabled: true, botCount: 4, minAmount: 20, maxAmount: 150 };
const legacy = { settlementMode: 1, botEnabled: false, botCount: 3, minAmount: 10, maxAmount: 200 };
const opts = () => ({ clock: () => 100_000, durations: { betMs: 10_000, battleMs: 40_000 }, seed: 42,
  gmUsers: ['  ＧＭ 管理 ', 'second-gm'] });

test('GM panel permission follows whitelist and current login identity', () => {
  const arena = openArena(':memory:', opts());
  try {
    // not signed in: no identity
    const guest = arena.gmPanel('nope');
    assert.equal(guest.signedIn, false);
    assert.equal(guest.allowed, false);

    const gm = arena.login('gm 管理'); // normalizes to same key as whitelist entry
    const normal = arena.login('普通玩家');
    assert.equal(arena.gmPanel(gm.token).allowed, true);
    assert.equal(arena.gmPanel(gm.token).account.name, 'gm 管理');
    assert.equal(arena.gmPanel(normal.token).allowed, false);
    assert.equal(arena.gmPanel(normal.token).signedIn, true);

    // whitelist write works and returns next-round number
    const saved = arena.configureAs(gm.token, gmConfig);
    assert.equal(saved.roundNumber, 2);
    assert.deepEqual(arena.gmPanel(normal.token).gmConfig, gmConfig);
  } finally { arena.close(); }
});

test('normal account cannot write GM settings even by direct submit; config unchanged', () => {
  const arena = openArena(':memory:', opts());
  try {
    const gm = arena.login('gm 管理');
    const normal = arena.login('outsider');
    arena.configureAs(gm.token, gmConfig);
    const denied = arena.configureAs(normal.token, legacy);
    assert.match(denied.error, /权限/);
    assert.deepEqual(arena.gmPanel(normal.token).gmConfig, gmConfig, 'setting must not change');
    // unsigned write also denied
    assert.match(arena.configureAs('nope', legacy).error, /用户名/);
    assert.deepEqual(arena.gmPanel(gm.token).gmConfig, gmConfig);
  } finally { arena.close(); }
});

test('switching or logging out changes GM permission with the tab session', () => {
  const arena = openArena(':memory:', opts());
  try {
    const gm = arena.login('gm 管理');
    const normal = arena.login('plain');
    assert.equal(arena.gmPanel(gm.token).allowed, true);
    // logout invalidates that token; the account may log in anew as a normal user in the same tab
    arena.logout(gm.token);
    assert.equal(arena.gmPanel(gm.token).signedIn, false);
    assert.equal(arena.gmPanel(gm.token).allowed, false);
    // a freshly issued token for a non-whitelist name has no permission
    const again = arena.login('gm 管理');
    assert.equal(arena.gmPanel(again.token).allowed, true);
    assert.equal(arena.gmPanel(normal.token).allowed, false);
  } finally { arena.close(); }
});
