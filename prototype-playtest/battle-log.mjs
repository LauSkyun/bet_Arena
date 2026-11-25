const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changedCells(before, after) {
  return Object.keys({ ...before, ...after }).filter((key) => before[key] !== after[key] || Object.hasOwn(before, key) !== Object.hasOwn(after, key))
    .map((key) => Object.hasOwn(after, key) ? [key, after[key]] : [key]);
}

function changedObjects(before, after) {
  const previous = new Map(before.map((entry) => [entry.id, entry]));
  const current = new Set(after.map(({ id }) => id));
  const entries = after.filter((entry) => !same(previous.get(entry.id), entry)).map((entry) => [entry.id, entry]);
  for (const { id } of before) if (!current.has(id)) entries.push([id]);
  return entries;
}

export function battleFrameDelta(before, after) {
  return {
    elapsed: after.elapsed, scores: after.scores, shots: after.shots, events: after.events ?? [],
    owners: changedCells(before.owners, after.owners), terrain: changedCells(before.terrain, after.terrain),
    units: changedObjects(before.units, after.units), buildings: changedObjects(before.buildings, after.buildings),
  };
}

function patch(entries, changes) {
  for (const [key, value] of changes) {
    if (value === undefined) entries.delete(key);
    else entries.set(key, value);
  }
  return entries;
}

export function applyBattleFrameDelta(before, change) {
  const patchCells = (entries, edits) => Object.fromEntries(patch(new Map(Object.entries(entries)), edits));
  const patchObjects = (entries, edits) => [...patch(new Map(entries.map((entry) => [entry.id, entry])), edits).values()];
  return {
    elapsed: change.elapsed, scores: change.scores, shots: change.shots, events: change.events,
    owners: patchCells(before.owners, change.owners), terrain: patchCells(before.terrain, change.terrain),
    units: patchObjects(before.units, change.units), buildings: patchObjects(before.buildings, change.buildings),
  };
}

export function recordedBattleFrames(log) {
  if (!log.initialFrame) return [];
  const frames = [log.initialFrame];
  for (const change of log.frames) frames.push(applyBattleFrameDelta(frames.at(-1), change));
  return frames;
}
