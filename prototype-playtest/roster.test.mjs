import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, newSession, placeBet, timeline } from './round.mjs';
import { battleLoadout, boardColumns, boardRows, drawUnit, enhanceRoster, isRosterFull, keyAt, mapFor, newRoster, themes, unitStats, validBuilds } from './roster.mjs';

const asKeys = (points) => points.map(keyAt).sort();
const adjacent = ([a, b], [c, d]) => Math.abs(a - c) + Math.abs(b - d) === 1;

test('map geometry mirrors the two bases, connected expansion plots and walkable exits', () => {
  const red = mapFor('red');
  const blue = mapFor('blue');
  const mirror = ([row, col]) => [11 - row, col];
  assert.equal(boardRows(), 10);
  assert.equal(boardColumns, 7);
  assert.deepEqual(red.base, [1, 4]);
  assert.deepEqual(blue.base, [10, 4]);
  assert.deepEqual(blue.plots, red.plots.map(({ at, exit }) => ({ at: mirror(at), exit: mirror(exit) })));
  assert.deepEqual(blue.starts, red.starts.map(mirror));
  const reserved = new Set(asKeys([red, blue].flatMap(({ base, plots }) => [base, ...plots.map(({ at }) => at)])));
  const walkable = [];
  for (let row = 1; row <= boardRows(); row++) {
    for (let col = 1; col <= boardColumns; col++) {
      if (!reserved.has(keyAt([row, col]))) walkable.push([row, col]);
    }
  }
  const reachable = [walkable[0]];
  const seen = new Set(asKeys(reachable));
  for (const at of reachable) {
    for (const next of walkable.filter((point) => adjacent(at, point))) {
      const key = keyAt(next);
      if (seen.has(key)) continue;
      seen.add(key);
      reachable.push(next);
    }
  }
  assert.equal(reachable.length, 56);
  for (const map of [red, blue]) {
    assert.ok(map.plots.every(({ at, exit }) => adjacent(at, exit) && seen.has(keyAt(exit))));
    assert.ok(map.starts.every((at) => seen.has(keyAt(at))));
  }
});

test('theme and tier intervals include all source themes and use the configured cutoffs', () => {
  for (const theme of themes) {
    const others = themes.filter((candidate) => candidate !== theme);
    assert.equal(drawUnit(theme, .49999, 0).origin, theme);
    assert.equal(drawUnit(theme, .5, 0).origin, others[0]);
    assert.equal(drawUnit(theme, .75, 0).origin, others[1]);
    assert.deepEqual([.49999, .5, .85].map((roll) => drawUnit(theme, 0, roll).limit), [10, 5, 3]);
  }
  assert.equal(drawUnit('虫族', .5, 0).name, '巡地兵');
});

test('a seed persists the two random themes and allows matching themes', () => {
  const combinations = new Set();
  for (let seed = 0; seed < 256; seed++) {
    const readThemes = () => Object.values(newSession('test', 0, [], seed).round.teams).map(({ roster }) => roster.theme);
    const [red, blue] = readThemes();
    assert.deepEqual([red, blue], readThemes());
    combinations.add(`${red}/${blue}`);
  }
  assert.equal(combinations.size, 9);
});

test('first building uses a base edge and later buildings use discrete adjacent plots', () => {
  const roster = newRoster('red', 73);
  assert.deepEqual(asKeys(validBuilds(roster).map(({ at }) => at)), ['1-3', '1-5', '2-4']);
  const first = enhanceRoster(roster).roster;
  assert.equal(first.barracks.length, 1);
  assert.ok(adjacent(mapFor('red').base, first.barracks[0].at));
  for (const { at } of validBuilds(first)) {
    assert.ok([mapFor('red').base, first.barracks[0].at].some((occupied) => adjacent(at, occupied)));
    assert.notDeepEqual(at, first.barracks[0].at);
  }
  assert.equal(new Set(asKeys(validBuilds(first).map(({ at }) => at))).size, validBuilds(first).length);
});

test('when all plots are built only upgrades apply, then all confirmed effects stop changing the roster', () => {
  const unit = drawUnit('人族', 0, 0);
  const barracks = mapFor('red').plots.map(({ at, exit }) => ({ side: 'red', at, exit, unit, level: 1 }));
  let roster = { ...newRoster('red', 13), barracks };
  assert.deepEqual(validBuilds(roster), []);
  for (let index = 0; index < 12; index++) {
    const next = enhanceRoster(roster).roster;
    assert.equal(next.barracks.length, 6);
    assert.equal(next.barracks.reduce((sum, entry) => sum + entry.level, 0), 7 + index);
    assert.ok(next.barracks.every((entry) => entry.unit === unit));
    roster = next;
  }
  assert.ok(isRosterFull(roster));
  assert.equal(enhanceRoster(roster).roster, roster);
  assert.deepEqual([1, 2, 3].map((level) => {
    const current = unitStats({ unit, level });
    return [current.hp, current.damage, current.limit];
  }), [[40, 6, 10], [48, 7, 10], [56, 8, 10]]);
});

test('cross-theme barracks belong to their original side and get route and combat attributes in the snapshot', () => {
  const allOrigins = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const roster = { ...newRoster('red', seed), theme: '虫族' };
    const built = enhanceRoster(roster).roster;
    const loadout = battleLoadout(built);
    const barracks = loadout.barracks[0];
    assert.equal(barracks.side, 'red');
    assert.ok(adjacent(barracks.at, barracks.exit));
    assert.ok([10, 5, 3].includes(barracks.unit.limit));
    allOrigins.add(barracks.unit.origin);
  }
  assert.deepEqual([...allOrigins].sort(), [...themes].sort());
  const session = newSession('test', 0, [], 73);
  const charged = placeBet(session, 10, { sessionId: 'test', requestId: 'one', roundNumber: 1, side: 'red', amount: 30 }).session;
  const { lock, finish } = timeline(charged.round);
  const locked = advance(charged, lock);
  assert.deepEqual(locked.round.snapshot.battle.red.startingUnits.map(({ at }) => at), mapFor('red').starts);
  assert.deepEqual(locked.round.snapshot.battle.blue.startingUnits.map(({ at }) => at), mapFor('blue').starts);
  assert.deepEqual(advance(locked, finish).round.snapshot, locked.round.snapshot);
});

test('all plots and levels can be filled through threshold processing before a valid player bet', () => {
  const reference = [{ elapsed: 100, side: 'red', amount: 180 }];
  const session = newSession('full-fixture', 0, reference, 73);
  const full = advance(session, 100);
  const { roster } = full.round.teams.red;
  assert.equal(roster.barracks.length, 6);
  assert.ok(isRosterFull(roster));
  const { session: charged, receipt } = placeBet(full, 101, {
    sessionId: full.id, roundNumber: 1, requestId: 'after-full', side: 'red', amount: 10,
  });
  assert.equal(charged.balance, 9990);
  assert.equal(charged.round.teams.red.total, 190);
  assert.equal(charged.round.teams.red.roster, roster);
  assert.match(receipt.effects[0].label, /未新增战力/);
  const sealed = advance(charged, timeline(charged.round).lock).round.snapshot;
  assert.deepEqual(sealed.stakes, { red: 10, blue: 0 });
  assert.ok(sealed.battle.red.barracks.every(({ level }) => level === 3));
});
