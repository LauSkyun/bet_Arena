import { returnsFor } from './returns.mjs';
import { countGround, frameAt, openingGround, replayFor } from './battle.mjs';
import { betting, findReceipt, isFull, sides, stakesFor } from './betting.mjs';
import { barracksLimit, boardColumns, boardRows, hasExpansion, isHex, keyAt, mapFor, openingOwner, unitStats } from './roster.mjs';
import { placeBet, saveRoundDurations, view } from './round.mjs';
import { secondsLimit } from './timing.mjs';
import { resetSession, updateSession } from './storage.mjs';

const element = (id) => document.getElementById(id);
const teamName = { red: '红队', blue: '蓝队' };
const statements = {
  bet: '下注进行中，可分别支持红队和蓝队，也可直接观战。',
  lock: '下注截止，双方阵容和回报率已锁定。',
  battle: '战斗回放进行中。',
  settling: '战斗结束，正在确认积分。',
  result: '本轮积分已结算。',
};
const pendingKey = 'bet-arena.prototype.pending-playtest.v1';
const form = element('bet-form');
const submit = element('bet-submit');
const amountInput = element('amount');
const sideInputs = [...form.querySelectorAll('input[name="side"]')];
const stages = [...document.querySelectorAll('[data-phase]')];
const timingForm = element('timing-form');
const betSeconds = element('bet-seconds');
const battleSeconds = element('battle-seconds');
const timingSave = element('timing-save');
let timingDraft = false;
let savingTiming = false;
for (const input of [betSeconds, battleSeconds]) input.max = String(secondsLimit);
let displayed;
let polling = false;
let submitting = false;
let pendingCheck = true;

const chosenSide = () => sideInputs.find((input) => input.checked)?.value;
const signed = (value) => value > 0 ? `+${value}` : String(value);
const resultLabel = (winner) => ({ void: '本轮作废', draw: '平局', red: '红队获胜', blue: '蓝队获胜' })[winner];
const clockLabel = { bet: '下注截止', lock: '回放开始', battle: '战斗剩余', settling: '正在结算', result: '下一轮开始' };
const scoreLabel = ({ red, blue }) => `红方 ${red} 格　蓝方 ${blue} 格`;

function describeEffects(effects) {
  if (effects.length === 0) return '';
  const names = effects.map(({ label }) => label);
  return [...new Set(names)].join('、');
}

function receiptMessage(receipt) {
  const changes = describeEffects(receipt.effects);
  const confirmed = `已确认支持${teamName[receipt.side]} ${receipt.amount} 点。`;
  return changes ? `${confirmed}${changes}。` : confirmed;
}

function renderTeam(side, team, phase, percent, layout) {
  element(`${side}-rate`).textContent = percent === null ? '—' : `${percent}%`;
  element(`${side}-own`).textContent = String(team.player);
  element(`${side}-total`).textContent = String(team.total);
  element(`${side}-system`).textContent = `系统投入 ${team.system} 点`;
  const barracks = team.roster.barracks.map(({ unit, level, at }) => `${unit.name} ${level} 级（${at[0]}行${at[1]}列）`);
  element(`${side}-layout`).textContent = hasExpansion(layout) ? `兵营 ${barracks.length}／${barracksLimit}${barracks.length ? ` · ${barracks.join('、')}` : ''}`
    : barracks.join('、') || '尚无兵营';
  const left = betting.threshold - team.total % betting.threshold;
  const threshold = element(`${side}-threshold`);
  threshold.hidden = phase !== 'bet';
  threshold.textContent = isFull(team, layout) ? '强化已满' : `距下次强化 ${left} 点`;
}

const cells = new Map();
const board = element('board');
let renderedLayout;
let startingScores;

function renderBoard(layout, teams, frame, effects) {
  if (renderedLayout !== layout) {
    renderedLayout = layout;
    const rows = boardRows(layout);
    const hex = isHex(layout);
    board.classList.toggle('hex-board', hex);
    startingScores = countGround(openingGround(layout));
    cells.clear();
    const tiles = document.createDocumentFragment();
    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= boardColumns; col++) {
        const cell = document.createElement('span');
        const key = keyAt([row, col]);
        cell.dataset.at = key;
        if (hex) {
          cell.style.gridColumn = `${2 * col - 1 + row % 2} / span 2`;
          cell.style.gridRow = String(row);
        }
        cell.setAttribute('role', 'img');
        cells.set(key, cell);
        tiles.append(cell);
      }
    }
    board.setAttribute('aria-label', `${rows} 行 ${boardColumns} 列${hex ? '六边形' : ''}棋盘`);
    board.replaceChildren(tiles);
  }
  const changes = new Map(effects.filter(({ at }) => at).map((effect) => [keyAt(effect.at), effect.kind]));
  const markers = new Map();
  for (const side of sides) {
    const map = mapFor(side, layout);
    const roster = teams[side].roster;
    markers.set(keyAt(map.base), { kind: 'base', symbol: '基', label: `${teamName[side]}主基地` });
    for (const { at, exit } of map.plots) {
      markers.set(keyAt(at), { kind: 'plot', symbol: '', label: `${teamName[side]}可建格` });
      if (exit) markers.set(keyAt(exit), { kind: 'exit', symbol: '·', label: `${teamName[side]}出兵口` });
    }
    for (const barracks of roster.barracks) {
      const { at, exit, level } = barracks;
      if (hasExpansion(layout)) {
        const exitKey = keyAt(exit);
        const reserved = markers.get(exitKey)?.kind === 'plot';
        markers.set(exitKey, { kind: reserved ? 'plot' : 'exit', symbol: '·', label: `${teamName[side]}${reserved ? '可建格兼' : ''}出兵口` });
      }
      const { name, tier, hp, damage, limit } = unitStats(barracks);
      const label = `${teamName[side]}${name}兵营，${level}级，生命${hp}，单次伤害${damage}，存活上限${limit}`;
      markers.set(keyAt(at), { kind: 'barracks', symbol: `${tier[0]}${level}`, label });
    }
  }
  const troops = new Map();
  if (frame) {
    for (const { at, kind, side, hp } of frame.buildings) {
      const key = keyAt(at);
      const marker = markers.get(key);
      markers.set(key, { ...marker, label: `${marker?.label ?? teamName[side] + kind}，建筑生命${hp}` });
    }
    for (const { at, side } of frame.units) {
      const key = keyAt(at);
      const count = troops.get(key) ?? { red: 0, blue: 0 };
      count[side]++;
      troops.set(key, count);
    }
  }
  for (const [key, cell] of cells) {
    const [row, col] = key.split('-').map(Number);
    const initial = openingOwner(row, layout) ?? 'neutral';
    const land = frame?.terrain[key] === 'ground' ? frame.owners[key] ?? 'neutral' : initial;
    const marker = frame?.terrain[key] === 'ruins' ? { kind: 'ruins', symbol: '废', label: '废墟' } : markers.get(key);
    const units = troops.get(key);
    const troopLabel = units ? `，红方${units.red}兵，蓝方${units.blue}兵` : '';
    const troopClass = units ? ` soldier ${units.red && units.blue ? 'mixed' : units.red ? 'troop-red' : 'troop-blue'}` : '';
    const change = changes.get(key);
    const markerClass = change ? ` reinforced ${change}` : '';
    const css = `cell ${land}${marker ? ` ${marker.kind}` : ''}${troopClass}${markerClass}`;
    const symbol = units ? (units.red && units.blue ? `${units.red}∶${units.blue}` : `兵${units.red || units.blue}`) : marker?.symbol ?? '';
    const changeLabel = change === 'build' ? '，新建兵营' : change === 'upgrade' ? '，刚升级' : '';
    const ownerLabel = teamName[land] ?? '中立';
    const label = `${row}行${col}列，${marker?.label ?? '普通格'}${marker && marker.kind !== 'exit' ? '' : `，${ownerLabel}领地`}${troopLabel}${changeLabel}`;
    if (cell.className !== css) cell.className = css;
    if (cell.textContent !== symbol) cell.textContent = symbol;
    if (cell.title !== label) {
      cell.title = label;
      cell.setAttribute('aria-label', label);
    }
  }
}

function renderControls(session, phase) {
  const open = phase === 'bet' && !submitting && !pendingCheck;
  form.hidden = phase !== 'bet';
  form.setAttribute('aria-busy', String(submitting || pendingCheck));
  element('bet-actions').disabled = !open;
  amountInput.disabled = !open;
  const side = chosenSide();
  submit.disabled = !open || !side || session.balance < 1;
  submit.textContent = submitting ? '确认中' : '确认下注';
  const stakes = stakesFor(session.round.teams);
  const summary = stakes.red || stakes.blue ? `本轮投入 · 红 ${stakes.red} 点 / 蓝 ${stakes.blue} 点` : '本轮尚未下注';
  const limit = session.balance < 1 ? ' · 测试积分不足，可继续观战' : '';
  element('ticket').textContent = summary + limit;
}

function renderTiming(session) {
  const describe = ({ betMs, battleMs }) => `下注 ${betMs / 1000} 秒 · 战斗 ${battleMs / 1000} 秒`;
  element('timing-current').textContent = `本轮　${describe(session.round.durations)}`;
  element('timing-next').textContent = `下一轮　${describe(session.nextDurations)}`;
  if (!timingDraft) {
    betSeconds.value = String(session.nextDurations.betMs / 1000);
    battleSeconds.value = String(session.nextDurations.battleMs / 1000);
  }
  for (const control of [betSeconds, battleSeconds, timingSave]) control.disabled = savingTiming;
}

function render(session, now) {
  const stage = view(session, now);
  const { round, previous } = session;
  const { battleMs } = round.durations;
  if (displayed?.session.id !== session.id || displayed?.session.round.number !== round.number) {
    element('notice').textContent = '';
    for (const input of sideInputs) input.checked = false;
    amountInput.value = '100';
  }
  displayed = { session, phase: stage.phase };
  renderTiming(session);
  element('round').textContent = String(round.number);
  element('balance').textContent = String(session.balance);
  element('time-label').textContent = clockLabel[stage.phase];
  element('time').textContent = stage.phase === 'settling' ? '—' : `${Math.ceil(stage.remainingMs / 1000)} 秒`;
  const phaseText = element('phase-text');
  if (phaseText.textContent !== statements[stage.phase]) phaseText.textContent = statements[stage.phase];
  for (const step of stages) {
    const active = step.dataset.phase === (stage.phase === 'settling' ? 'battle' : stage.phase);
    if (active) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
  const teams = round.snapshot?.teams ?? round.teams;
  element('red-theme').textContent = teams.red.roster.theme;
  element('blue-theme').textContent = teams.blue.roster.theme;
  const progress = element('progress');
  progress.hidden = stage.phase !== 'battle';
  progress.value = stage.progress ?? 0;
  const showBattle = ['battle', 'settling', 'result'].includes(stage.phase);
  const replay = showBattle ? replayFor(round.snapshot.battle, battleMs, round.board, round.combatRules) : null;
  const frame = replay ? frameAt(replay, stage.elapsedMs ?? battleMs) : null;
  const latestEffects = stage.phase === 'bet' ? round.lastEffects : [];
  renderBoard(round.board, teams, frame, latestEffects);
  const score = element('scores');
  score.textContent = showBattle && !frame ? '本轮战斗作废' : scoreLabel(frame?.scores ?? startingScores);
  const rates = round.snapshot ? round.snapshot.rates : returnsFor(teams);
  for (const side of sides) renderTeam(side, teams[side], stage.phase, rates[side], round.board);
  const effects = element('latest-effects');
  effects.hidden = !latestEffects.length;
  if (latestEffects.length) {
    effects.textContent = `${teamName[latestEffects[0].side]}近期强化 · ${describeEffects(latestEffects)}`;
  }
  renderControls(session, stage.phase);
  element('result').hidden = !round.result;
  if (round.result) {
    const { winner, scores, stakes, rates: settledRates, stake, credit, net, balanceAfter } = round.result;
    element('result-winner').textContent = resultLabel(winner);
    element('result-score').textContent = scores ? `最终占格 · ${scoreLabel(scores)}` : '本轮无最终格数';
    element('result-ticket').textContent = stake ? `投入 · 红 ${stakes.red} 点 / 蓝 ${stakes.blue} 点` : '本轮观战';
    const winningPercent = settledRates[winner];
    const appliedRate = Boolean(stakes[winner]) && winningPercent != null;
    element('result-rate').hidden = !appliedRate;
    if (appliedRate) element('result-rate').textContent = `${teamName[winner]}锁定回报率 ${winningPercent}%（含本金）`;
    element('result-net').textContent = `本轮净变化 ${signed(net)} 点`;
    const change = stake && (winner === 'void' || winner === 'draw') ? '退回投入' : '本次入账';
    element('result-credit').textContent = `${change} ${credit} 点 · 结算后余额 ${balanceAfter} 点`;
  }
  element('previous').hidden = !previous || Boolean(round.result);
  if (previous) {
    element('previous-summary').textContent = `第 ${previous.round} 轮 · ${resultLabel(previous.winner)} · 净变化 ${signed(previous.net)} 点 · 结算后余额 ${previous.balanceAfter} 点`;
  }
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const { session, now } = await updateSession();
    render(session, now);
    if (pendingCheck && !submitting) {
      const saved = sessionStorage.getItem(pendingKey);
      if (saved) {
        const receipt = findReceipt(session, JSON.parse(saved));
        element('notice').textContent = receipt ? receiptMessage(receipt) : '上一笔未查到确认记录，请核对本轮投入。';
        sessionStorage.removeItem(pendingKey);
      }
      pendingCheck = false;
      renderControls(session, displayed.phase);
    }
  } catch {
    submit.disabled = true;
    element('notice').textContent = '读取试玩记录失败，正在重新读取。';
  } finally {
    polling = false;
  }
}

form.addEventListener('change', () => {
  if (displayed) renderControls(displayed.session, displayed.phase);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!displayed || submitting || submit.disabled) return;
  const { session, phase } = displayed;
  const side = chosenSide();
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    element('notice').textContent = '请输入正整数点数。';
    return;
  }
  const request = { sessionId: session.id, roundNumber: session.round.number, side, amount, requestId: crypto.randomUUID() };
  submitting = true;
  renderControls(session, phase);
  try {
    sessionStorage.setItem(pendingKey, JSON.stringify(request));
    const response = await updateSession((current, now) => placeBet(current, now, request));
    render(response.session, response.now);
    element('notice').textContent = response.receipt ? receiptMessage(response.receipt) : response.error;
    sessionStorage.removeItem(pendingKey);
  } catch {
    pendingCheck = true;
    element('notice').textContent = '正在核对这笔下注的确认记录。';
  } finally {
    submitting = false;
    if (displayed) renderControls(displayed.session, displayed.phase);
    void refresh();
  }
});

timingForm.addEventListener('input', () => { timingDraft = true; });
timingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!displayed || savingTiming) return;
  const bet = betSeconds.valueAsNumber;
  const battle = battleSeconds.valueAsNumber;
  savingTiming = true;
  renderTiming(displayed.session);
  try {
    const saved = await updateSession((session, now) => saveRoundDurations(session, now, bet, battle));
    if (!saved.error) timingDraft = false;
    render(saved.session, saved.now);
    element('timing-feedback').textContent = saved.error ?? '已保存，从下一轮生效。';
  } catch {
    element('timing-feedback').textContent = '时长设置未能保存，请再试一次。';
  } finally {
    savingTiming = false;
    renderTiming(displayed.session);
  }
});

element('reset').addEventListener('click', async () => {
  if (!window.confirm('开始新的试玩会话并把测试积分重置为 10,000 点？')) return;
  try {
    const { session, now } = await resetSession();
    sessionStorage.removeItem(pendingKey);
    timingDraft = false;
    element('timing-feedback').textContent = '';
    render(session, now);
  } catch {
    element('notice').textContent = '无法开始新试玩，请重新进入页面。';
  }
});

void refresh();
window.setInterval(() => void refresh(), 250);
window.addEventListener('pageshow', () => void refresh());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});
