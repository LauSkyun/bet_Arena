import { drawShots, barracksLabel, troopsByTile, unitName } from './board-display.mjs';
import { arenaProfile, profiles } from './profiles.mjs';
import { groundAreaLabels } from './ground-area.mjs';
import { battleDataFor, battleDataReport } from './battle-data.mjs';
import { returnsFor } from './returns.mjs';
import { battleRules, fireRevisionFor, baseVictoryRules, groundHealingRules, groundAreaRules, groundSelfDestructRules, countGround, frameAt, openingGround, replayFor } from './battle.mjs';
import { findReceipt, isFull, sides, stakesFor } from './betting.mjs';
import { baseAttack, baseDefenseRules, barracksLimit, distance, boardColumns, boardRows, hasExpansion, isHex, keyAt, mapFor, openingOwner, unitStats } from './roster.mjs';
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
const pendingKey = 'bet-arena.prototype.pending-sc-ground-v21.v1';
const form = element('bet-form');
const submit = element('bet-submit');
const amountInput = element('amount');
const sideInputs = [...form.querySelectorAll('input[name="side"]')];
const stages = [...document.querySelectorAll('[data-phase]')];
const timingForm = element('timing-form');
const copyBattleData = element('copy-battle-data');
const saveBattleData = element('save-battle-data');
const copyPreviousData = element('copy-previous-data');
const savePreviousData = element('save-previous-data');
const battleDataFeedback = element('battle-data-feedback');
const thresholdInput = element('bet-threshold');
const betSeconds = element('bet-seconds');
const battleSeconds = element('battle-seconds');
const timingSave = element('timing-save');
const battleProfile = element('battle-profile');
for (const [id, label] of Object.entries(profiles)) battleProfile.add(new Option(label, id));
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
const clockLabel = { bet: '下注截止', lock: '回放开始', battle: '战斗时限剩余', settling: '正在结算', result: '下一轮开始' };
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

function renderTeam(side, team, phase, percent, layout, stepSize) {
  element(`${side}-rate`).textContent = percent === null ? '—' : `${percent}%`;
  element(`${side}-own`).textContent = String(team.player);
  element(`${side}-total`).textContent = String(team.total);
  element(`${side}-system`).textContent = `系统投入 ${team.system} 点`;
  const barracks = team.roster.barracks.map(({ unit, level, at }) => `〔${barracksLabel(unit.name)}〕${unit.name} ${level} 级（${at[0]}行${at[1]}列）`);
  element(`${side}-layout`).textContent = hasExpansion(layout) ? `兵营 ${barracks.length}／${barracksLimit}${barracks.length ? ` · ${barracks.join('、')}` : ''}`
    : barracks.join('、') || '尚无兵营';
  const left = stepSize - team.total % stepSize;
  const threshold = element(`${side}-threshold`);
  threshold.hidden = phase !== 'bet';
  threshold.textContent = isFull(team, layout) ? '强化已满' : `距下次强化 ${left} 点`;
}

const cells = new Map();
const board = element('board');
let renderedLayout = null;
let startingScores;
let selectedTile = null;
let lastFrame;
let lastShots = [];
const canvas = element('shots');
const inspector = element('tile-inspector');
const crowded = element('crowded-tiles');
new ResizeObserver(() => drawShots(canvas, lastShots, cells)).observe(board);
board.addEventListener('click', (event) => {
  const key = event.target.closest('[data-at]')?.dataset.at;
  if (!key || !displayed) return;
  selectedTile = selectedTile === key ? null : key;
  render(displayed.session, displayed.now);
});

function renderBoard(round, teams, frame, effects) {
  const layout = round.board;
  const updatedOccupation = round.combatRules >= baseVictoryRules;
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
        const cell = document.createElement('button');
        cell.type = 'button';
        const key = keyAt([row, col]);
        cell.dataset.at = key;
        if (hex) {
          cell.style.gridColumn = `${2 * col - 1 + row % 2} / span 2`;
          cell.style.gridRow = String(row);
        }
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
    const weapon = round.combatRules >= baseDefenseRules ? (round.snapshot?.battle[side].baseAttack ?? baseAttack) : null;
    const defense = weapon ? `，射程${weapon.range}格，单次伤害${weapon.damage}，攻击间隔${weapon.attackMs / 1000}秒` : '';
    markers.set(keyAt(map.base), { kind: 'base', symbol: roster.theme, range: weapon?.range, maxHp: battleRules.baseHp,
      label: `${teamName[side]}${roster.theme}主基地${defense}` });
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
      const { name, hp, damage, limit, range, attackMs, spawnMs = 500, spawnCount = 1, effect, healing, directDamagePercent = 100 } = unitStats(barracks);
      const treatment = round.combatRules >= groundHealingRules ? `单次治疗${healing}，间隔${attackMs / 1000}秒` : '本局未启用治疗';
      const area = Object.hasOwn(groundAreaLabels, effect);
      const direct = Math.ceil(damage * directDamagePercent / 100);
      const selfDestruct = round.combatRules >= groundSelfDestructRules ? `自爆主伤害${damage}，触发时自耗` : '本局未启用自爆';
      const attack = effect === 'heal' ? treatment : effect === 'self-destruct' ? selfDestruct
        : area && round.combatRules >= groundAreaRules ? `${groundAreaLabels[effect]}主伤害${damage}，攻击间隔${attackMs / 1000}秒`
        : `直击伤害${direct}，攻击间隔${attackMs / 1000}秒${area ? '（本局仅直击）' : ''}`;
      const label = `${teamName[side]}${name}兵营，${level}级，出兵生命${hp}，${attack}，射程${range}格，每${spawnMs / 1000}秒出${spawnCount}兵，存活上限${limit}`;
      markers.set(keyAt(at), { kind: 'barracks', symbol: barracksLabel(name), maxHp: battleRules.barracksHp, level, range, side, label });
    }
  }
  const troops = troopsByTile(frame?.units ?? []);
  for (const { at, hp } of frame?.buildings ?? []) {
    const key = keyAt(at);
    markers.get(key).hp = hp;
  }
  const selectedGroups = [...(troops.get(selectedTile)?.values() ?? [])];
  const selectedMarker = frame?.terrain[selectedTile] === 'ruins' ? null : markers.get(selectedTile);
  const maxRange = Math.max(selectedMarker?.range ?? 0, ...selectedGroups.map(group => group.range));
  const crowdedTiles = [];
  const selectedAt = selectedTile?.split('-').map(Number);
  const shots = frame?.shots ?? [];
  for (const [key, cell] of cells) {
    const [row, col] = key.split('-').map(Number);
    const initial = openingOwner(row, layout) ?? 'neutral';
    const claimsLand = frame && (frame.terrain[key] === 'ground' || (updatedOccupation && Object.hasOwn(frame.owners, key)));
    const land = claimsLand ? frame.owners[key] ?? 'neutral' : initial;
    const marker = frame?.terrain[key] === 'ruins' ? { kind: 'ruins', symbol: '废', label: '废墟' } : markers.get(key);
    const groups = [...(troops.get(key)?.values() ?? [])];
    const troopLabel = groups.map(g => `${teamName[g.side]}${g.name}×${g.count}（射程${g.range}格）`).join('、');
    const teamsHere = new Set(groups.map(g => g.side));
    const troopClass = groups.length ? ` soldier ${teamsHere.size > 1 ? 'mixed' : 'troop-' + groups[0].side}` : '';
    const gap = selectedAt ? distance(selectedAt, [row, col], layout) : Infinity;
    const inRange = maxRange > 0 && gap <= maxRange;
    if (groups.length > 4) crowdedTiles.push(`${row}行${col}列　${troopLabel}`);
    const change = changes.get(key);
    const changeLabelClass = change ? ` reinforced ${change}` : '';
    const css = `cell ${land}${marker ? ` ${marker.kind}` : ''}${claimsLand && frame.terrain[key] === 'ruins' ? ' controlled-ruins' : ''}${troopClass}${changeLabelClass}${inRange ? ' in-range' : ''}${selectedTile === key ? ' selected' : ''}`;
    const changeLabel = change === 'build' ? '，新建兵营' : change === 'upgrade' ? '，刚升级' : '';
    const ownerLabel = teamName[land] ?? '中立';
    const hp = marker?.hp ?? marker?.maxHp;
    const healthLabel = marker?.maxHp ? `，建筑生命 ${hp}/${marker.maxHp}` : '';
    const healthWidth = marker?.maxHp ? `${hp / marker.maxHp * 100}%` : '';
    if (cell.style.getPropertyValue('--building-hp') !== healthWidth) {
      cell.style.setProperty('--building-hp', healthWidth);
    }
    const label = `${row}行${col}列，${marker?.label ?? '普通格'}${healthLabel}${claimsLand || !marker || marker.kind === 'exit' ? `，${ownerLabel}领地` : ''}${troopLabel ? '，' + troopLabel : ''}${changeLabel}`;
    if (cell.className !== css) cell.className = css;
    const signature = troopLabel || `${marker?.symbol ?? ''}/${marker?.level ?? ''}`;
    if (cell.dataset.content !== signature) {
      cell.dataset.content = signature;
      cell.replaceChildren();
      if (groups.length) {
        const chips = document.createElement('span');
        chips.className = 'unit-chips';
        for (const group of groups.length > 4 ? groups.slice(0, 3) : groups) {
          const chip = document.createElement('span');
          chip.className = `unit-chip ${group.side}`;
          chip.textContent = group.glyph + (group.count > 1 ? group.count : '');
          chips.append(chip);
        }
        if (groups.length > 4) chips.append('…');
        cell.append(chips);
      } else if (marker?.maxHp) {
        const title = document.createElement('span');
        title.className = 'building-name';
        title.textContent = marker.symbol;
        const bar = document.createElement('span');
        bar.className = 'building-health';
        bar.setAttribute('aria-hidden', 'true');
        cell.append(bar, title);
        if (marker.level) {
          const grade = document.createElement('span');
          grade.className = 'building-level';
          grade.textContent = `${marker.level}级`;
          cell.append(grade);
        }
      } else cell.textContent = marker?.symbol ?? '';
    }
    if (cell.title !== label) {
      cell.title = label;
      cell.setAttribute('aria-label', label);
    }
  }
  const overflowText = crowdedTiles.join('\n');
  crowded.hidden = !overflowText;
  if (crowded.textContent !== overflowText) crowded.textContent = overflowText;
  inspector.hidden = !selectedAt;
  if (selectedAt) {
    const cell = cells.get(selectedTile);
    const touchesTile = (shot) => keyAt(shot.from) === selectedTile || keyAt(shot.to) === selectedTile;
    const hits = new Set(shots.filter(shot => !shot.effect && keyAt(shot.from) === selectedTile).map(shot =>
      `${teamName[shot.side]}${unitName(shot.name)} → ${shot.to[0]}行${shot.to[1]}列（实际${distance(shot.from, shot.to, layout)}格）`));
    const areaHits = shots.filter(shot => Object.hasOwn(groundAreaLabels, shot.effect) && touchesTile(shot)).map(shot =>
      `${teamName[shot.side]}${shot.name}${groundAreaLabels[shot.effect]}命中${shot.to[0]}行${shot.to[1]}列的${shot.targetName} #${shot.targetId}（${shot.primary ? '主目标' : '附带'}），实际伤害${shot.applied}，本拍生命 ${shot.before} → ${shot.after}${shot.effect === 'self-destruct' && shot.primary ? '，爆虫本拍自耗' : ''}`);
    const heals = shots.filter(shot => shot.effect === 'heal' && touchesTile(shot)).map(shot =>
      `${teamName[shot.side]}${shot.name}治疗${shot.to[0]}行${shot.to[1]}列的${shot.targetName}，实际回复${shot.power}，本拍生命 ${shot.before} → ${shot.after}`);
    const parts = [cell.title];
    if (maxRange) parts.push(`高亮为${selectedGroups.length ? '格内单位的最大射程' : selectedMarker?.kind === 'base' ? '基地防守射程' : '从兵营格预览的兵种射程'} ${maxRange} 格`);
    if (hits.size) parts.push(`本拍命中：${[...hits].join('、')}`);
    parts.push(...areaHits, ...heals);
    inspector.textContent = parts.join('。');
  }
  if (lastFrame !== frame) {
    lastFrame = frame;
    lastShots = shots;
    drawShots(canvas, shots, cells);
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
  element('timing-current').textContent = `本轮　${describe(session.round.durations)} · ${profiles[session.round.profile ?? arenaProfile]} · 每 ${session.round.threshold} 点强化`;
  element('timing-next').textContent = `下一轮　${describe(session.nextDurations)} · ${profiles[session.nextProfile ?? arenaProfile]} · 每 ${session.nextThreshold} 点强化`;
  if (!timingDraft) {
    thresholdInput.value = String(session.nextThreshold);
    battleProfile.value = session.nextProfile ?? arenaProfile;
    betSeconds.value = String(session.nextDurations.betMs / 1000);
    battleSeconds.value = String(session.nextDurations.battleMs / 1000);
  }
  for (const control of [betSeconds, battleSeconds, timingSave, battleProfile, thresholdInput]) control.disabled = savingTiming;
}

function render(session, now) {
  const stage = view(session, now);
  const { round, previous } = session;
  const { battleMs } = round.durations;
  if (displayed?.session.id !== session.id || displayed?.session.round.number !== round.number) {
    selectedTile = null;
    element('notice').textContent = '';
    for (const input of sideInputs) input.checked = false;
    amountInput.value = '100';
  }
  displayed = { session, phase: stage.phase, now };
  copyBattleData.disabled = false;
  saveBattleData.disabled = false;
  copyPreviousData.hidden = !previous?.battleData;
  savePreviousData.hidden = copyPreviousData.hidden;
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
  const replay = showBattle ? replayFor(round.snapshot.battle, battleMs, round.board, round.combatRules, fireRevisionFor(round)) : null;
  const frame = replay ? frameAt(replay, stage.elapsedMs ?? battleMs) : null;
  const latestEffects = stage.phase === 'bet' ? round.lastEffects : [];
  renderBoard(round, teams, frame, latestEffects);
  const score = element('scores');
  score.textContent = showBattle && !frame ? '本轮战斗作废' : scoreLabel(frame?.scores ?? startingScores);
  const rates = round.snapshot ? round.snapshot.rates : returnsFor(teams);
  for (const side of sides) renderTeam(side, teams[side], stage.phase, rates[side], round.board, round.threshold);
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
    const damage = round.result.damage;
    const reason = element('result-reason');
    const fallen = round.result.fallenBases ?? [];
    reason.hidden = !fallen.length && (!damage || scores?.red !== scores?.blue);
    if (fallen.length === 1) reason.textContent = `${teamName[fallen[0]]}主基地被摧毁`;
    else if (fallen.length === 2) reason.textContent = '双方主基地同拍被摧毁，按占格判定';
    else if (!reason.hidden) reason.textContent = `占格相同，比较有效伤害 · 红 ${damage.red}／蓝 ${damage.blue}`;
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

function exportBattleData(previous, download) {
  const shown = displayed;
  if (!shown) return;
  const { session, phase, now } = shown;
  const data = previous ? session.previous?.battleData : battleDataFor(session.round, session.reference);
  if (!data) return;
  const elapsedMs = previous ? null : Math.max(0, now - session.round.startedAt);
  const payload = JSON.stringify(battleDataReport(data, previous ? 'result' : phase, elapsedMs));
  if (download) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    link.href = url;
    link.download = `battle-data-round-${data.number}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    battleDataFeedback.textContent = `已请求下载第 ${data.number} 局数据。`;
    return;
  }
  if (!navigator.clipboard?.writeText) {
    battleDataFeedback.textContent = '复制不可用，可以下载对应的 JSON。';
    return;
  }
  return navigator.clipboard.writeText(payload).then(() => {
    battleDataFeedback.textContent = `已复制第 ${data.number} 局数据。`;
  }, () => {
    battleDataFeedback.textContent = '复制未成功，可以下载对应的 JSON。';
  });
}

copyBattleData.addEventListener('click', () => void exportBattleData(false, false));
saveBattleData.addEventListener('click', () => void exportBattleData(false, true));
copyPreviousData.addEventListener('click', () => void exportBattleData(true, false));
savePreviousData.addEventListener('click', () => void exportBattleData(true, true));

timingForm.addEventListener('input', () => { timingDraft = true; });
timingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!displayed || savingTiming) return;
  const bet = betSeconds.valueAsNumber;
  const battle = battleSeconds.valueAsNumber;
  savingTiming = true;
  renderTiming(displayed.session);
  try {
    const saved = await updateSession((session, now) => saveRoundDurations(session, now, bet, battle, battleProfile.value, thresholdInput.valueAsNumber));
    if (!saved.error) timingDraft = false;
    render(saved.session, saved.now);
    element('timing-feedback').textContent = saved.error ?? '已保存，从下一轮生效。';
  } catch {
    element('timing-feedback').textContent = '下一轮设置未能保存，请再试一次。';
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
