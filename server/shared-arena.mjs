import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyDueBots, defaultGmConfig, validateGmConfig } from './gm-bots.mjs';
import { battleDataFor, battleDataReport } from '../prototype-playtest/battle-data.mjs';
import { betting, confirmBet, maxReferenceThreshold } from '../prototype-playtest/betting.mjs';
import { groundProfile } from '../prototype-playtest/profiles.mjs';
import { advance, newSession, timeline } from '../prototype-playtest/round.mjs';
import { betDataReport, newRoundArchive, recordBattleFrames, recoverBetEntries, saveBattleSnapshot } from '../prototype-playtest/round-archive.mjs';
import { settleSession } from '../prototype-playtest/settlement.mjs';
import { playerPoolRules, poolPending, poolRatesFor, settlePlayerPool } from '../prototype-playtest/settlement-pool.mjs';

const day = 86_400_000;
const parse = (row) => row ? JSON.parse(row.data) : null;
const emptyStakes = { red: 0, blue: 0 };

export function normalizeName(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!/^[\p{L}\p{M}\p{N} _-]{1,24}$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) return null;
  return { name, key: name.toLowerCase().normalize('NFKC') };
}

export function openArena(path, { clock = Date.now, durations, seed, gmKey } = {}) {
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
    CREATE TABLE IF NOT EXISTS bot_bets (
      round INTEGER NOT NULL, request_id TEXT NOT NULL, side TEXT NOT NULL, amount INTEGER NOT NULL,
      confirmed_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (round, request_id)
    ) STRICT;
  `);
  const loginLookup = db.prepare('SELECT a.* FROM accounts a JOIN logins l USING (uid) WHERE l.token = ? AND l.expires > ?');
  const load = db.prepare('SELECT data FROM arena WHERE id = 1');
  const save = db.prepare('UPDATE arena SET data = ? WHERE id = 1');
  const balanceFor = db.prepare('SELECT balance FROM accounts WHERE uid = ?');
  const setBalance = db.prepare('UPDATE accounts SET balance = ? WHERE uid = ?');
  const archivedRound = db.prepare('SELECT data FROM rounds WHERE number = ?');
  const hasArchive = db.prepare('SELECT 1 FROM rounds WHERE number = ?');
  const roundBets = db.prepare('SELECT uid, data FROM bets WHERE round = ? ORDER BY rowid');
  const personalBets = db.prepare('SELECT request_id, side, amount, data FROM bets WHERE uid = ? AND round = ? ORDER BY rowid');
  const roundHistory = db.prepare('SELECT data FROM history WHERE uid = ? AND round = ?');
  const setHistory = db.prepare('INSERT INTO history VALUES (?, ?, ?)');
  const storeRound = db.prepare('INSERT INTO rounds VALUES (?, ?)');
  const historyPage = db.prepare('SELECT data FROM history WHERE uid = ? AND round < ? ORDER BY round DESC LIMIT 21');
  const findRequest = db.prepare('SELECT side, amount, data FROM bets WHERE uid = ? AND round = ? AND request_id = ?');
  const storeRequest = db.prepare('INSERT INTO bets VALUES (?, ?, ?, ?, ?, ?)');
  const hasBotBet = db.prepare('SELECT 1 FROM bot_bets WHERE round = ? AND request_id = ?');
  const storeBotBet = db.prepare('INSERT INTO bot_bets VALUES (?, ?, ?, ?, ?, ?)');
  const roundBotBets = db.prepare('SELECT request_id, side, amount, confirmed_at, data FROM bot_bets WHERE round = ? ORDER BY confirmed_at');

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

  function acceptedReceipts(rows) {
    return rows.map(parse).filter(({ receipt }) => receipt).map(({ receipt }) => receipt);
  }

  function archiveEntries(round, requests) {
    const system = recoverBetEntries([], round.reference.slice(0, round.referenceIndex), round.startedAt);
    for (const [index, entry] of system.entries()) entry.effects = round.referenceEffects?.[index + 1] ?? null;
    const player = requests.map(({ request_id, side, amount, data }) => {
      const { receipt = null, error = null, requestedAt = receipt?.confirmedAt } = JSON.parse(data);
      return { source: 'player', requestId: request_id, side, amount, requestedRoundNumber: round.number,
        elapsedMs: requestedAt == null ? null : Math.max(0, requestedAt - round.startedAt), accepted: Boolean(receipt), error,
        receipt, effects: receipt?.effects ?? [] };
    });
    const bots = roundBotBets.all(round.number).map((row) => {
      const { receipt } = parse(row);
      return { source: 'bot', requestId: row.request_id, side: row.side, amount: row.amount, requestedRoundNumber: round.number,
        elapsedMs: Math.max(0, row.confirmed_at - round.startedAt), accepted: Boolean(receipt), error: null,
        receipt, effects: receipt?.effects ?? [] };
    });
    const entries = [...system, ...player, ...bots].sort((a, b) => (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity));
    return { version: 1, entries, complete: entries.every(({ elapsedMs, effects }) => elapsedMs !== null && effects !== null) };
  }

  function personalRound(round, receipts) {
    const stakes = { ...emptyStakes };
    for (const { side, amount } of receipts) stakes[side] += amount;
    const teams = Object.fromEntries(Object.entries(round.teams).map(([side, team]) => [side, { ...team, player: stakes[side] }]));
    // 奖池成池与否、展示倍率用服务器的公共实扣合计判定，不随个人票据改写。
    const poolView = round.settlementRules === playerPoolRules
      ? { rates: poolRatesFor(round.teams), pending: poolPending(round.teams) } : null;
    return { ...round, teams, receipts, poolView, snapshot: round.snapshot ? { ...round.snapshot, teams, stakes, receipts } : null };
  }

  function settleRound(state, round) {
    if (hasArchive.get(round.number)) return;
    const byAccount = new Map();
    for (const row of roundBets.all(round.number)) {
      const { receipt } = parse(row);
      if (!receipt) continue;
      if (!byAccount.has(row.uid)) byAccount.set(row.uid, []);
      byAccount.get(row.uid).push(receipt);
    }
    const botRows = roundBotBets.all(round.number).filter((row) => parse(row).receipt);
    if (!byAccount.size && !botRows.length) return;
    // 奖池按全体真人账号＋陪练的已确认实扣计算，传给每个真人的结算共用同一份口径。
    const accounts = [];
    for (const [uid, receipts] of byAccount) {
      const stakes = { red: 0, blue: 0 };
      for (const { side, amount } of receipts) stakes[side] += amount;
      accounts.push({ uid, red: stakes.red, blue: stakes.blue });
    }
    for (const row of botRows) {
      accounts.push({ uid: row.request_id, red: row.side === 'red' ? row.amount : 0, blue: row.side === 'blue' ? row.amount : 0 });
    }
    const poolResult = round.snapshot?.settlementRules === playerPoolRules
      ? settlePlayerPool(accounts, round.result.winner) : null;
    // 陪练赢款只在模拟侧入账，不写入任何真人余额或历史。
    const sim = botRows.map((row) => ({
      requestId: row.request_id, side: row.side, amount: row.amount,
      credit: poolResult ? poolResult.byUid.get(row.request_id) ?? 0 : 0,
    }));
    const snapshot = newRoundArchive(state, round.number, round.startedAt);
    saveBattleSnapshot(snapshot, state, round);
    const frames = [];
    const time = timeline(round);
    if (round.result.winner !== 'void') {
      recordBattleFrames(snapshot, time.finish - time.battle, round.result, (frame) => frames.push(frame));
      snapshot.log.settlement = null;
    }
    storeRound.run(round.number, JSON.stringify({ round, log: snapshot.log, frames, sim }));
    for (const [uid, receipts] of byAccount) {
      const { balance } = balanceFor.get(uid);
      const personal = personalRound({ ...round, result: null }, receipts);
      const settled = settleSession({ balance, round: personal }, round.result, round.result.settledAt, round.result.settledAt, { accounts, uid });
      setHistory.run(uid, round.number, JSON.stringify(settled.round.result));
      setBalance.run(settled.balance, uid);
    }
  }

  function applyBots(now) {
    const current = parse(load.get());
    // 封盘前的到期事件全部处理；已封盘不再补单。dueNow 封顶到锁定时刻。
    const lock = current.round.startedAt + current.round.durations.betMs;
    const dueNow = Math.min(now, lock);
    const config = current.round.gmConfig ?? current.gmConfig;
    const { state: updated, applied } = applyDueBots(current, config, dueNow,
      (round, requestId) => Boolean(hasBotBet.get(round, requestId)),
      (round, requestId, side, amount, confirmedAt, receipt) =>
        storeBotBet.run(round, requestId, side, amount, confirmedAt, JSON.stringify({ receipt })));
    if (applied.length) save.run(JSON.stringify({ ...updated, balance: 0 }));
    return updated;
  }

  function tick(now) {
    applyBots(now);
    const current = parse(load.get());
    const observed = new Map();
    const withReferenceEffects = (round) => observed.has(round.number)
      ? { ...round, referenceEffects: { ...round.referenceEffects, ...observed.get(round.number) } } : round;
    const moved = advance(current, now, {
      reference(round, _event, index) {
        if (!observed.has(round.number)) observed.set(round.number, {});
        observed.get(round.number)[index] = round.lastEffects;
      },
      finished: (round) => settleRound(current, withReferenceEffects(round)),
    });
    if (moved === current) return current;
    const state = { ...moved, round: withReferenceEffects(moved.round), balance: 0, previous: null };
    if (state.round.result && (state.round.number !== current.round.number || !current.round.result)) settleRound(state, state.round);
    save.run(JSON.stringify(state));
    return state;
  }

  function accountFor(token, now) {
    return typeof token === 'string' ? loginLookup.get(token, now) : null;
  }

  function spectatorResult(result, balance) {
    const personal = { ...result, stakes: emptyStakes, stake: 0, credit: 0, net: 0, balanceAfter: balance, receipts: [] };
    // 观战者不投入：个人本金与分成为 0，公共奖池口径仍保留供回查。
    if (personal.pool) personal.pool = { ...personal.pool, principal: 0, share: 0, refund: 0 };
    return personal;
  }

  function payload(state, account, now) {
    const { uid, name } = account;
    const { balance } = balanceFor.get(uid);
    const round = personalRound(state.round, acceptedReceipts(personalBets.all(uid, state.round.number)));
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
    const existing = load.get();
    if (!existing) {
      const state = newSession(randomUUID(), now, undefined, seed, durations, undefined, groundProfile, undefined, playerPoolRules, defaultGmConfig);
      db.prepare('INSERT OR IGNORE INTO arena VALUES (1, ?)').run(JSON.stringify({ ...state, balance: 0 }));
    } else {
      // 旧库升级：本轮保持旧口径，只把会话级规则设为 2，让下一次新建轮次启用奖池。
      const state = parse(existing);
      const patch = {};
      if (state.settlementRules !== playerPoolRules) patch.settlementRules = playerPoolRules;
      if (!state.gmConfig) patch.gmConfig = defaultGmConfig;
      if (Object.keys(patch).length) save.run(JSON.stringify({ ...state, ...patch }));
    }
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
    // GM 配置：写入会话级配置与下一轮的结算规则映射；当前轮次不受影响，下轮生效。
    configure(key, value) {
      if (!gmKey || key !== gmKey) return { error: '无权修改 GM 设置。' };
      const config = validateGmConfig(value);
      if (!config) return { error: '配置不合法：结算档位、开关、人数与金额范围需符合要求。' };
      return transaction(() => {
        const state = parse(load.get());
        const settlementRules = config.settlementMode === playerPoolRules ? playerPoolRules : undefined;
        const patch = { gmConfig: config, ...(settlementRules === undefined ? { settlementRules: undefined } : { settlementRules }) };
        const next = { ...state, ...patch };
        save.run(JSON.stringify({ ...next, balance: 0 }));
        return { gmConfig: config, roundNumber: state.round.number + 1 };
      });
    },
    gmConfig: () => parse(load.get())?.gmConfig ?? defaultGmConfig,
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
      if (seen) {
        if (amount !== seen.amount || side !== seen.side) return response({ error: '该请求已有不同的确认记录。' });
        const { receipt, error } = parse(seen);
        return response({ receipt, error, replayed: true });
      }
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
      storeRequest.run(uid, roundNumber, requestId, side, amount, JSON.stringify({ ...record, requestedAt: now }));
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
    archive: (token, number, expectedUid) => authorized(token, (state, { uid }, now) => {
      if (expectedUid != null && uid !== expectedUid) return { archive: null };
      const current = number === state.round.number;
      const settlement = parse(roundHistory.get(uid, number));
      const storedRow = current || settlement ? archivedRound.get(number) : null;
      const stored = storedRow ? parse(storedRow) : null;
      const round = current ? state.round : stored?.round;
      if (!round) return { archive: null };
      const requests = personalBets.all(uid, number);
      const personal = personalRound({ ...round, result: settlement }, acceptedReceipts(requests));
      const record = newRoundArchive(state, number, round.startedAt);
      record.bet_log = archiveEntries(round, requests);
      if (stored?.sim) record.sim = stored.sim;
      saveBattleSnapshot(record, state, personal);
      if (!record.battle_data) record.battle_data = battleDataReport(battleDataFor(personal), 'bet', now - round.startedAt);
      const result = round.result ? settlement ?? spectatorResult(round.result, balanceFor.get(uid).balance) : null;
      if (stored?.log) {
        record.log = { ...stored.log, settlement: result };
        return { archive: betDataReport(record, stored.frames) };
      }
      const frames = [];
      if (round.snapshot && round.result?.winner !== 'void') {
        const time = timeline(round);
        const cutoff = round.result ? time.finish - time.battle : now - time.battle;
        recordBattleFrames(record, cutoff, result, (frame) => frames.push(frame));
      }
      return { archive: betDataReport(record, frames) };
    }),
  };
}
