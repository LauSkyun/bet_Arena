import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { battleDataFor, battleDataReport } from '../prototype-playtest/battle-data.mjs';
import { betting, confirmBet, maxReferenceThreshold } from '../prototype-playtest/betting.mjs';
import { groundProfile } from '../prototype-playtest/profiles.mjs';
import { advance, newSession, timeline } from '../prototype-playtest/round.mjs';
import { betDataReport, newRoundArchive, recordBattleFrames, recoverBetEntries, saveBattleSnapshot } from '../prototype-playtest/round-archive.mjs';
import { settleSession } from '../prototype-playtest/settlement.mjs';

const day = 86_400_000;
const parse = (row) => row ? JSON.parse(row.data) : null;
const emptyStakes = { red: 0, blue: 0 };

export function normalizeName(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!/^[\p{L}\p{M}\p{N} _-]{1,24}$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) return null;
  return { name, key: name.toLowerCase().normalize('NFKC') };
}

export function openArena(path, { clock = Date.now, durations } = {}) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      uid TEXT PRIMARY KEY, name_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, balance INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS logins (
      token TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES accounts(uid), expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS arena (
      id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bets (
      uid TEXT NOT NULL REFERENCES accounts(uid), round INTEGER NOT NULL, request_id TEXT NOT NULL,
      side TEXT NOT NULL, amount INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (uid, round, request_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS bets_by_round ON bets(round);
    CREATE TABLE IF NOT EXISTS rounds (
      number INTEGER PRIMARY KEY, data TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS history (
      uid TEXT NOT NULL REFERENCES accounts(uid), round INTEGER NOT NULL REFERENCES rounds(number),
      data TEXT NOT NULL, PRIMARY KEY (uid, round)
    ) STRICT;
  `);
  const loginLookup = db.prepare('SELECT a.* FROM accounts a JOIN logins l USING (uid) WHERE l.token = ? AND l.expires > ?');
  const load = db.prepare('SELECT data FROM arena WHERE id = 1');
  const save = db.prepare('UPDATE arena SET data = ? WHERE id = 1');
  const balanceFor = db.prepare('SELECT balance FROM accounts WHERE uid = ?');
  const setBalance = db.prepare('UPDATE accounts SET balance = ? WHERE uid = ?');
  const archivedRound = db.prepare('SELECT data FROM rounds WHERE number = ?');
  const roundBets = db.prepare('SELECT uid, data FROM bets WHERE round = ? ORDER BY rowid');
  const personalBets = db.prepare('SELECT data FROM bets WHERE uid = ? AND round = ? ORDER BY rowid');
  const roundHistory = db.prepare('SELECT data FROM history WHERE uid = ? AND round = ?');
  const setHistory = db.prepare('INSERT INTO history VALUES (?, ?, ?)');
  const storeRound = db.prepare('INSERT OR IGNORE INTO rounds VALUES (?, ?)');
  const historyPage = db.prepare('SELECT data FROM history WHERE uid = ? AND round < ? ORDER BY round DESC LIMIT 21');
  const findRequest = db.prepare('SELECT side, amount, data FROM bets WHERE uid = ? AND round = ? AND request_id = ?');
  const storeRequest = db.prepare('INSERT INTO bets VALUES (?, ?, ?, ?, ?, ?)');

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work(clock());
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function logEntries(rows) {
    return rows.map(parse).filter(({ receipt }) => receipt).map(({ receipt }) => receipt);
  }

  function personalRound(round, receipts) {
    const stakes = { ...emptyStakes };
    for (const { side, amount } of receipts) stakes[side] += amount;
    const teams = Object.fromEntries(Object.entries(round.teams).map(([side, team]) => [side, { ...team, player: stakes[side] }]));
    return { ...round, teams, receipts, snapshot: round.snapshot ? { ...round.snapshot, teams, stakes, receipts } : null };
  }

  function settleRound(round) {
    if (!storeRound.run(round.number, JSON.stringify(round)).changes) return;
    const byAccount = new Map();
    for (const row of roundBets.all(round.number)) {
      const { receipt } = parse(row);
      if (!receipt) continue;
      if (!byAccount.has(row.uid)) byAccount.set(row.uid, []);
      byAccount.get(row.uid).push(receipt);
    }
    for (const [uid, receipts] of byAccount) {
      const { balance } = balanceFor.get(uid);
      const personal = personalRound({ ...round, result: null }, receipts);
      const settled = settleSession({ balance, round: personal }, round.result, round.result.settledAt, round.result.settledAt);
      setHistory.run(uid, round.number, JSON.stringify(settled.round.result));
      setBalance.run(settled.balance, uid);
    }
  }

  function tick(now) {
    const current = parse(load.get());
    const moved = advance(current, now, { finished: settleRound });
    if (moved.round.result) settleRound(moved.round);
    if (moved === current) return current;
    const state = { ...moved, balance: 0, previous: null };
    save.run(JSON.stringify(state));
    return state;
  }

  function accountFor(token, now) {
    return typeof token === 'string' ? loginLookup.get(token, now) : null;
  }

  function spectatorResult(result, balance) {
    return { ...result, stakes: emptyStakes, stake: 0, credit: 0, net: 0, balanceAfter: balance, receipts: [] };
  }

  function payload(state, account, now) {
    const { uid, name } = account;
    const { balance } = balanceFor.get(uid);
    const round = personalRound(state.round, logEntries(personalBets.all(uid, state.round.number)));
    if (round.result) round.result = parse(roundHistory.get(uid, round.number)) ?? spectatorResult(round.result, balance);
    const previous = parse(roundHistory.get(uid, round.number - 1));
    return { now, account: { uid, name }, session: { ...state, id: uid, balance, round, previous } };
  }

  function authorized(token, work) {
    return transaction((now) => {
      const account = accountFor(token, now);
      if (!account) return null;
      return work(tick(now), account, now);
    });
  }

  transaction((now) => {
    const state = newSession(randomUUID(), now, undefined, undefined, durations, undefined, groundProfile);
    db.prepare('INSERT OR IGNORE INTO arena VALUES (1, ?)').run(JSON.stringify({ ...state, balance: 0 }));
  });

  return {
    close: () => db.close(),
    tick: () => transaction(tick),
    login(value) {
      const normalized = normalizeName(value);
      if (!normalized) return null;
      return transaction((now) => {
        db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?)').run(randomUUID(), normalized.key, normalized.name, betting.initialBalance);
        const account = db.prepare('SELECT uid, name FROM accounts WHERE name_key = ?').get(normalized.key);
        const token = randomUUID();
        db.prepare('DELETE FROM logins WHERE expires <= ?').run(now);
        db.prepare('INSERT INTO logins VALUES (?, ?, ?)').run(token, account.uid, now + 30 * day);
        return { token, account };
      });
    },
    logout(token) {
      if (typeof token === 'string') transaction(() => db.prepare('DELETE FROM logins WHERE token = ?').run(token));
    },
    state: (token) => authorized(token, payload),
    bet: (token, request) => authorized(token, (state, account, now) => {
      const { uid } = account;
      const { sessionId, roundNumber, requestId, side, amount } = request ?? {};
      const response = (result) => ({ ...payload(state, account, now), ...result });
      if (sessionId !== uid) return response({ error: '账号已切换，积分未扣除。' });
      if (!Number.isSafeInteger(roundNumber) || roundNumber < 1 || typeof requestId !== 'string' || !/^[\w-]{1,80}$/.test(requestId) ||
          !['red', 'blue'].includes(side) || !Number.isSafeInteger(amount) || amount < 1) {
        return response({ error: '请选择队伍并输入正整数点数。' });
      }
      const seen = findRequest.get(uid, roundNumber, requestId);
      if (seen) return response(amount === seen.amount && side === seen.side ? { ...parse(seen), replayed: true }
        : { error: '该请求已有不同的确认记录。' });
      const { balance } = balanceFor.get(uid);
      const total = state.round.teams.red.total + state.round.teams.blue.total;
      let result;
      if (roundNumber !== state.round.number || state.round.snapshot || now >= state.round.startedAt + state.round.durations.betMs) {
        result = { error: '本轮下注已截止，积分未扣除。' };
      } else if (amount > maxReferenceThreshold - total) {
        result = { error: '超过本轮可确认的总积分，积分未扣除。' };
      } else {
        result = confirmBet({ ...state, balance }, now, { sessionId: state.id, roundNumber, side, amount, requestId });
      }
      const record = result.receipt ? { receipt: result.receipt } : { error: result.error };
      storeRequest.run(uid, roundNumber, requestId, side, amount, JSON.stringify(record));
      if (result.receipt) {
        setBalance.run(result.session.balance, uid);
        state = { ...state, round: { ...result.session.round, receipts: [] } };
        save.run(JSON.stringify(state));
      }
      return response(record);
    }),
    history: (token, before = Number.MAX_SAFE_INTEGER) => authorized(token, (_state, { uid, name }) => {
      const rows = historyPage.all(uid, before).map(parse);
      return { account: { uid, name }, entries: rows.slice(0, 20), next: rows.length > 20 ? rows[19].round : null };
    }),
    archive: (token, number) => authorized(token, (state, { uid }, now) => {
      const current = number === state.round.number;
      const settlement = parse(roundHistory.get(uid, number));
      const round = current ? state.round : settlement ? parse(archivedRound.get(number)) : null;
      if (!round) return { archive: null };
      const receipts = logEntries(personalBets.all(uid, number));
      const personal = personalRound({ ...round, result: settlement }, receipts);
      const record = newRoundArchive(state, number, round.startedAt, false);
      record.bet_log.entries = recoverBetEntries(receipts, round.reference.slice(0, round.referenceIndex), round.startedAt);
      saveBattleSnapshot(record, state, personal);
      if (!record.battle_data) record.battle_data = battleDataReport(battleDataFor(personal), 'bet', now - round.startedAt);
      const frames = [];
      if (round.snapshot) {
        const time = timeline(round);
        const cutoff = round.result ? time.finish - time.battle : now - time.battle;
        const result = round.result ? settlement ?? spectatorResult(round.result, balanceFor.get(uid).balance) : null;
        recordBattleFrames(record, cutoff, result, (frame) => frames.push(frame));
      }
      return { archive: betDataReport(record, frames) };
    }),
  };
}
