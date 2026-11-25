import { battleFrameDelta } from './battle-log.mjs';
import { unitName } from './board-display.mjs';
import { groundAreaLabels } from './ground-area.mjs';
import { keyAt, openingOwner } from './roster.mjs';

const teamName = { red: '红队', blue: '蓝队' };
const outcome = { red: '红队获胜', blue: '蓝队获胜', draw: '平局', void: '战斗作废' };
const nearBottom = (view) => view.scrollHeight - view.scrollTop - view.clientHeight <= 24;

export function battleShotLines(shot) {
  const attacker = `${teamName[shot.side]}${unitName(shot.name)}${shot.attackerId ? ` #${shot.attackerId}` : ''}`;
  const victim = `${shot.targetName ?? '目标'}${shot.targetId ? ` #${shot.targetId}` : ''}（${keyAt(shot.to)}）`;
  const name = groundAreaLabels[shot.effect] ?? '攻击';
  const detail = shot.effect === 'heal' ? `治疗 ${shot.power}` : `${name} · 实际伤害 ${shot.applied ?? shot.power}`;
  const hp = shot.before === undefined || shot.after === undefined ? '' : `，生命 ${shot.before} → ${shot.after}`;
  const hit = `${attacker} → ${victim}，${detail}${hp}`;
  return shot.effect === 'self-destruct' && shot.primary ? [hit, `${attacker} 自耗并离场（${keyAt(shot.from)}）`] : [hit];
}

export function battleLogLines(frame, prior, board, result) {
  const delta = prior ? battleFrameDelta(prior, frame) : null;
  const entries = [];
  const spawns = [];
  for (const event of frame.events ?? []) {
    const unit = `${teamName[event.side]}${unitName(event.name)} #${event.id}`;
    if (event.kind === 'spawn') spawns.push(`${unit} 在 ${keyAt(event.at)} 出兵（生命 ${event.hp}）`);
    if (event.kind === 'move') entries.push(`${unit} 移动 ${keyAt(event.from)} → ${keyAt(event.to)}`);
  }
  for (const shot of frame.shots) entries.push(...battleShotLines(shot));
  entries.push(...spawns);
  const ownership = delta?.owners ?? Object.entries(frame.owners).filter(([key, side]) =>
    side !== openingOwner(Number(key.split('-')[0]), board));
  for (const [side, label] of Object.entries(teamName)) {
    const occupied = ownership.filter(([, owner]) => owner === side).map(([key]) => key);
    if (occupied.length) entries.push(`${label}占格 ${occupied.join('、')}`);
  }
  if (delta) {
    const removed = new Set(delta.buildings.filter((change) => change.length === 1).map(([id]) => id));
    for (const { id, side, kind, at } of prior.buildings) {
      if (removed.has(id)) entries.push(`${teamName[side]}${kind === 'base' ? '基地' : '兵营'}被摧毁（${keyAt(at)}）`);
    }
  }
  if (result) entries.push(`${outcome[result.winner]} · 红 ${result.scores?.red ?? '—'} 格，蓝 ${result.scores?.blue ?? '—'} 格`);
  return entries;
}

export function setupBattleLogPanel(root) {
  const scrollArea = root.querySelector('.battle-log-scroll');
  const beats = root.querySelector('.battle-log-beats');
  const empty = root.querySelector('.battle-log-empty');
  const latest = root.querySelector('.battle-log-latest');
  let source;
  let lastIndex = -1;
  const scrollToLatest = () => { scrollArea.scrollTop = scrollArea.scrollHeight; };
  latest.addEventListener('click', scrollToLatest);

  return (replay, index, board) => {
    const replace = source !== replay || index < lastIndex;
    if (replace) {
      source = replay;
      lastIndex = -1;
      beats.replaceChildren();
    }
    if (index === lastIndex) {
      empty.hidden = index >= 0;
      latest.disabled = index < 0;
      return;
    }
    const follow = replace || nearBottom(scrollArea);
    const fragment = document.createDocumentFragment();
    for (let i = lastIndex + 1; i <= index; i++) {
      const frame = replay.frames[i];
      const result = i === replay.frames.length - 1 ? replay.result : null;
      const lines = battleLogLines(frame, replay.frames[i - 1], board, result);
      const beat = document.createElement('li');
      beat.dataset.elapsed = frame.elapsed;
      const time = document.createElement('strong');
      time.textContent = `${frame.elapsed / 1000} 秒`;
      beat.append(time);
      if (lines.length) {
        const items = document.createElement('ul');
        for (const text of lines) {
          const item = document.createElement('li');
          item.textContent = text;
          items.append(item);
        }
        beat.append(items);
      }
      fragment.append(beat);
    }
    beats.append(fragment);
    lastIndex = index;
    empty.hidden = true;
    latest.disabled = false;
    if (follow) scrollToLatest();
  };
}
