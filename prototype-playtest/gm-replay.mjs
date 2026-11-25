import { battleRules } from './battle.mjs';
import { battleShotLines, setupBattleLogPanel } from './battle-log-panel.mjs';
import { drawShots, glyphFor, unitName } from './board-display.mjs';
import { replayFromReport } from './replay-import.mjs';
import { boardColumns, boardRows, isHex, keyAt } from './roster.mjs';

const element = (id) => document.getElementById(id);
const board = element('replay-board');
const canvas = element('shots');
const fileInput = element('replay-file');
const inspector = element('replay-inspect');
const notice = element('replay-notice');
const play = element('replay-play');
const step = element('replay-step');
const renderLog = setupBattleLogPanel(element('replay-log'));
const cells = new Map();
const teams = { red: '红队', blue: '蓝队' };
const outcomes = { red: '红队获胜', blue: '蓝队获胜', draw: '平局', void: '战斗作废' };
let replay;
let frameIndex = 0;
let selected;
let timer;
let importNumber = 0;

function stop() {
  clearInterval(timer);
  timer = undefined;
}

function buildBoard(layout) {
  const hex = isHex(layout);
  board.classList.toggle('hex-board', hex);
  cells.clear();
  board.replaceChildren();
  for (let row = 1; row <= boardRows(layout); row++) {
    for (let col = 1; col <= boardColumns; col++) {
      const key = keyAt([row, col]);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.at = key;
      if (hex) {
        cell.style.gridRow = row;
        cell.style.gridColumn = `${2 * col - 1 + row % 2} / span 2`;
      }
      cell.addEventListener('click', () => { selected = selected === key ? undefined : key; render(); });
      cells.set(key, cell);
      board.append(cell);
    }
  }
}

function renderBoard(frame) {
  const pieces = new Map();
  for (const entry of [...frame.buildings, ...frame.units]) {
    const key = keyAt(entry.at);
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key).push(entry);
  }
  for (const [key, cell] of cells) {
    const entries = pieces.get(key) ?? [];
    const first = entries[0];
    const isBuilding = first?.kind === 'base' || first?.kind === 'barracks';
    const marker = isBuilding ? (first.kind === 'base' ? '基' : '营') : first ? glyphFor(first.name) : frame.terrain[key] === 'ruins' ? '废' : '';
    cell.className = `cell ${first?.side ?? frame.owners[key] ?? 'neutral'} ${isBuilding ? first.kind : ''}${selected === key ? ' selected' : ''}`;
    cell.textContent = marker + (entries.length > 1 ? entries.length : '');
    cell.title = `${key} · ${entries.map((entry) => `${teams[entry.side]}${entry.kind === 'base' ? '基地' : entry.kind === 'barracks' ? '兵营' : unitName(entry.name)} #${entry.id}，生命 ${entry.hp}`).join('；') || (marker ? '废墟' : '空格')}`;
  }
  drawShots(canvas, frame.shots, cells);
  inspector.hidden = !selected;
  if (selected) {
    const title = document.createElement('strong');
    title.textContent = cells.get(selected).title;
    const chosenShots = frame.shots.filter((shot) => keyAt(shot.from) === selected || keyAt(shot.to) === selected);
    inspector.replaceChildren(title);
    if (chosenShots.length) {
      const list = document.createElement('ul');
      for (const text of chosenShots.flatMap(battleShotLines)) {
        const item = document.createElement('li');
        item.textContent = text;
        list.append(item);
      }
      inspector.append(list);
    }
  }
}

function render() {
  const frame = replay.frames[frameIndex];
  const last = frameIndex >= replay.frames.length - 1;
  const result = last && replay.result ? ` · ${outcomes[replay.result.winner]}` : '';
  element('replay-state').textContent = `${frame.elapsed / 1000} 秒 · 红 ${frame.scores.red} 格，蓝 ${frame.scores.blue} 格${result}`;
  play.disabled = last;
  step.disabled = last;
  play.textContent = timer ? '暂停' : '播放';
  renderBoard(frame);
  renderLog(replay, frameIndex, replay.board);
}

function advanceFrame() {
  frameIndex = Math.min(frameIndex + 1, replay.frames.length - 1);
  if (frameIndex === replay.frames.length - 1) stop();
  render();
}

play.addEventListener('click', () => {
  if (timer) stop();
  else timer = setInterval(advanceFrame, battleRules.stepMs);
  render();
});
step.addEventListener('click', () => { stop(); advanceFrame(); });
element('replay-restart').addEventListener('click', () => { stop(); frameIndex = 0; render(); });
window.addEventListener('resize', () => { if (replay) drawShots(canvas, replay.frames[frameIndex].shots, cells); });

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const attempt = ++importNumber;
  fileInput.value = '';
  notice.textContent = '正在读取战局文件。';
  try {
    const contents = await file.text();
    let report;
    try { report = JSON.parse(contents); } catch { throw Error('JSON 无法读取，请检查文件内容。'); }
    const next = replayFromReport(report);
    if (attempt !== importNumber) return;
    stop();
    replay = next;
    frameIndex = 0;
    selected = undefined;
    element('replay-layout').hidden = false;
    buildBoard(next.board);
    const source = next.source === 'snapshot' ? '按封盘快照推演' : next.complete ? '按完整战斗日志播放'
      : `按部分日志播放，记录截至开战后 ${next.recordedThroughMs / 1000} 秒`;
    element('replay-source').textContent = `第 ${next.roundNumber} 局 · 规则 ${next.combatRules} · ${source}`;
    render();
    notice.textContent = '';
  } catch (error) {
    if (attempt === importNumber) notice.textContent = error.message;
  }
});
