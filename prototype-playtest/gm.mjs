import { groundAreaRules, groundHealingRules, groundSelfDestructRules } from './battle.mjs';
import { setupTestWallet } from './gm-wallet.mjs';
import { setupBattleLogPanel } from './battle-log-panel.mjs';
import { groundAreaLabels } from './ground-area.mjs';
import { groundUnits } from './ground-units.mjs';
import { barracksLabel, glyphFor } from './board-display.mjs';
import { boardColumns, boardRows, expansionExits, keyAt, openingOwner } from './roster.mjs';
import { teams, addBuilding, addSoldier, legalSites, mirrorScenario, newScenario, runScenario, setBuildingLevel, setHealth } from './gm-scenario.mjs';

const el = id => document.getElementById(id);
const renderBattleLog = setupBattleLogPanel(el('gm-battle-log'));
const key = 'bet-arena.gm.ground-self-destruct.v1';
const previousKeys = ['bet-arena.gm.ground-area.v1', 'bet-arena.gm.ground-healing.v1', 'bet-arena.gm.ground-production.v1'];
const teamName = { red: '红', blue: '蓝' };
let round = newScenario(), index = -1, replay, timer, selected = [1,4];
let objects = [];
function save() { localStorage.setItem(key, JSON.stringify({ round, index, selected })); }
try {
  const stored = JSON.parse([key, ...previousKeys].map((name) => localStorage.getItem(name)).find(Boolean) ?? 'null');
  if (stored) {
    round = stored.round; selected = stored.selected; index = stored.index;
    if (index >= 0) replay = runScenario(round, true);
  }
} catch { round = newScenario(); index = -1; selected = [1,4]; el('notice').textContent = '测试存档无法恢复，已打开空白测试局。'; }
for (const u of groundUnits) el('unit').add(new Option(`${u.origin} · ${u.name}`, u.unitId));
const map = el('map'), cells = new Map();
for (let r = 1; r <= boardRows(round.board); r++) {
  for (let c = 1; c <= boardColumns; c++) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.at = keyAt([r,c]);
    button.style.gridRow = String(r); button.style.gridColumn = `${2*c-1+r%2} / span 2`;
    button.onclick = () => { selected = [r,c]; el('hp').value = ''; render(); };
    map.append(button); cells.set(keyAt([r,c]), button);
  }
}
function atCell(at) { return keyAt(at) === keyAt(selected); }
function draftObjects() {
  const all = [];
  for (const side of teams) {
    const s = round.loadout[side];
    all.push({ ref:s, side, at:s.base, kind:'base', name:s.theme+'基地', hp:s.hp, max:s.maxHp });
    for (const b of s.barracks) all.push({ ref:b, side, at:b.at, kind:'barracks', name:b.unit.name+'营', hp:b.hp, max:b.maxHp, level:b.level });
    for (const u of s.startingUnits) all.push({ ref:u, side, at:u.at, kind:'soldier', name:u.name, hp:u.currentHp, max:u.hp, level:u.level });
  }
  return all;
}
function troopText(list) {
  const groups = new Map();
  for (const o of list) {
    const label = teamName[o.side] + glyphFor(o.name);
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  const [label, count] = groups.entries().next().value;
  return label + (count > 1 ? count : '') + (groups.size > 1 ? '…' : '');
}
function caption(o) { return `${teamName[o.side]}${o.name}${o.level ? ` ${o.level}级` : ''} ${o.hp}${o.max ? '/'+o.max : ''}`; }
function stop() { clearInterval(timer); timer = undefined; }
function run() { stop(); replay = runScenario(round, true); index = 0; }
function step() { if (index < replay.frames.length-1) index++; if (index === replay.frames.length-1) stop(); }
function render() {
  const editing = index < 0, frame = editing ? null : replay.frames[index];
  const draft = draftObjects();
  const all = editing ? draft : [...frame.buildings.map(b => ({...draft.find(o=>o.kind===b.kind && keyAt(o.at)===keyAt(b.at)), ...b})),
    ...frame.units.map(u => ({...u, kind:'soldier', max:u.maxHp}))];
  const tiles = new Map();
  for (const o of all) { const k = keyAt(o.at); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(o); }
  const legal = new Set(editing ? legalSites(round, el('side').value).map(site=>keyAt(site.at)) : []);
  for (const [k, cell] of cells) {
    const list = tiles.get(k) ?? [], first = list[0];
    const owner = frame?.owners[k] ?? openingOwner(Number(k.split('-')[0]),round.board);
    cell.className = `cell ${first?.side ?? owner ?? 'neutral'}${legal.has(k)?' gm-site':''}${k===keyAt(selected)?' selected':''}`;
    const text = first?.kind === 'base' ? round.loadout[first.side].theme : first?.kind === 'barracks' ? barracksLabel(first.ref.unit.name)+first.level : first ? troopText(list) : frame?.terrain[k]==='ruins'?'废':'';
    cell.textContent = text; cell.title = `${k} ${list.map(caption).join('、') || (legal.has(k)?'可建营':'空格')}`; cell.setAttribute('aria-label',cell.title);
  }
  const oldChoice = el('entity').selectedIndex;
  objects = tiles.get(keyAt(selected)) ?? [];
  el('entity').replaceChildren(...objects.map((o,i)=>new Option(caption(o),i)));
  if (objects.length) el('entity').selectedIndex = Math.max(0,Math.min(oldChoice,objects.length-1));
  el('inspect').textContent = `${selected[0]}行${selected[1]}列 · ${objects.map(caption).join('，') || '空格'}`;
  el('edit').disabled = !editing;
  const last = !editing && index===replay.frames.length-1;
  el('start').disabled=!editing; el('restart').disabled=editing; el('play').disabled=editing||last; el('step').disabled=editing||last; el('back').disabled=editing;
  el('play').textContent=timer?'暂停':'播放';
  const status = editing ? '布阵中' : `${frame.elapsed/1000} 秒 · 红 ${frame.scores.red} 格，蓝 ${frame.scores.blue} 格${last?' · '+({red:'红胜',blue:'蓝胜',draw:'平局'}[replay.result.winner]):''}`;
  const oldRules = round.combatRules < groundHealingRules ? ' · 旧规则：未启用治疗和范围伤害'
    : round.combatRules < groundAreaRules ? ' · 旧规则：范围技能仅直击'
    : round.combatRules < groundSelfDestructRules ? ' · 旧规则：未启用自爆' : '';
  el('state').textContent = status + oldRules;
  el('hits').replaceChildren();
  for (const shot of frame?.shots ?? []) {
    if (!atCell(shot.from) && !atCell(shot.to)) continue;
    const victim = all.find(o=>o.id===shot.targetId);
    const item = document.createElement('li');
    const effect = shot.effect === 'heal' ? `实际治疗 ${shot.power}` : Object.hasOwn(groundAreaLabels, shot.effect)
      ? `${groundAreaLabels[shot.effect]}${shot.primary ? '主目标' : '附带'}，实际伤害 ${shot.applied}` : `攻击 ${shot.power}`;
    const after = shot.after ?? victim?.hp ?? 0;
    const consumed = shot.effect === 'self-destruct' && shot.primary ? '，爆虫本拍自耗' : '';
    item.textContent = `${teamName[shot.side]}${shot.name} #${shot.attackerId} → ${keyAt(shot.to)} 的${shot.targetName} #${shot.targetId}，${effect}，目标本拍生命 ${shot.before} → ${after}${consumed}`;
    el('hits').append(item);
  }
  renderBattleLog(replay, index, round.board);
  save();
}
function action(id, fn) {
  el(id).onclick = () => { try { fn(); el('notice').textContent=''; render(); } catch (error) { el('notice').textContent=error.message; } };
}
function object() { const o=objects[el('entity').selectedIndex]; if (!o) throw Error('先点棋盘上的对象'); return o; }
function building() { const o=object(); if(o.kind!=='barracks') throw Error('请选择兵营'); return o.ref; }
const who = () => el('side').value;
const unitId = () => Number(el('unit').value);
action('build',()=>addBuilding(round,who(),selected,unitId()));
action('place',()=>addSoldier(round,who(),selected,unitId(),Number(el('level').value),el('hp').value===''?undefined:el('hp').valueAsNumber));
action('up',()=>{const b=building(); if(b.level===3) throw Error('已达 3 级'); setBuildingLevel(b,b.level+1);});
action('set-level',()=>setBuildingLevel(building(),Number(el('level').value)));
action('set-hp',()=>{ const o=object(); o.ref[o.kind==='soldier'?'currentHp':'hp']=setHealth(el('hp').valueAsNumber,o.max); });
action('remove',()=>{
  const o=object(), setup=round.loadout[o.side];
  if(o.kind==='base') throw Error('基地须保留');
  if(o.kind==='soldier') setup.startingUnits=setup.startingUnits.filter(u=>u!==o.ref);
  else { const left=setup.barracks.filter(b=>b!==o.ref); const exits=expansionExits(o.side,round.board,left.map(b=>b.at));
    if(!exits) throw Error('移除后无法分配出兵口'); for(const b of left) b.exit=exits.get(keyAt(b.at)); setup.barracks=left; }
});
el('side').onchange=render;
action('start',run); action('restart',run); action('step',()=>{stop();step();});
action('play',()=>{ if(timer) stop(); else timer=setInterval(()=>{step();render();},500); });
action('back',()=>{stop();index=-1;replay=undefined;});
action('new', () => {
  if (!window.confirm('清空双方测试兵和兵营，恢复默认基地并新建测试局？')) return;
  stop();
  round = newScenario();
  index = -1;
  replay = undefined;
  selected = [1, 4];
  el('hp').value = '';
});
action('mirror',()=>{stop();round=mirrorScenario(round);index=-1;replay=undefined;selected=[boardRows(round.board)+1-selected[0],boardColumns+1-selected[1]];});
action('export',()=>{
  const report = { format: 'bet-arena/gm-battle', version: 1, round: { ...round, sealed: index >= 0 },
    elapsedMs: index < 0 ? null : replay.frames[index].elapsed, result: index < 0 ? null : replay.result };
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url;a.download='gm-ground-battle.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();
setupTestWallet();
