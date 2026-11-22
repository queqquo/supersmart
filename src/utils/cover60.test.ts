import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Draw, SavedPlay } from '../types/lottery';
import { buildGeneratedColumn } from './combinatorics';
import { COVER60_COST, COVER60_ODDS, COVER60_TOTAL_DRAWS, createCover60WeightedShuffle, generateCover60, getCover60ArchiveStats, getCover60History, parseCover60Draft } from './cover60';

test('Copertura 60 generates ten sorted base columns and sixty globally distinct numbers', () => {
  assert.equal(COVER60_COST, 10);
  for (let run = 0; run < 30; run++) {
    const columns = generateCover60();
    assert.ok(columns);
    assert.equal(columns.length, 10);
    assert.equal(new Set(columns.flatMap(column => column.numbers)).size, 60);
    for (const [i, column] of columns.entries()) {
      assert.equal(column.id, i + 1);
      assert.equal(column.numbers.length, 6);
      assert.equal(column.superstar, undefined);
      assert.ok(column.numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 90));
      assert.deepEqual(column.numbers, [...column.numbers].sort((a, b) => a - b));
    }
  }
});

function fixturePlay(day: number, numbers: number[], options: Partial<SavedPlay> = {}): SavedPlay {
  const column = buildGeneratedColumn(1, numbers, options.mode === 'superstar' ? 60 : undefined);
  assert.ok(column);
  return {
    id: `demo-${day}`, createdAt: new Date(Date.UTC(2026, 10, day)).toISOString(),
    targetContestId: '2026-001', mode: 'pure_coverage', cost: 1, savedAmount: 0,
    poolNumbers: numbers, columns: [{ ...column, numbers }], status: 'IN_ATTESA',
    ...options,
  };
}

test('History checks only the ten latest SuperEnalotto plays, including SuperStar main numbers', () => {
  const plays = Array.from({ length: 11 }, (_, i) => fixturePlay(i + 1, [i + 11, 5, 4, 3, 2, 1]));
  plays.splice(3, 0, fixturePlay(20, [6, 5, 4, 3, 2, 1], { targetContestId: 'WFI-2026-001' }));
  plays.splice(2, 0, fixturePlay(19, [7, 5, 4, 3, 2, 1], { mode: 'superstar' }));
  const { forbidden, checkedPlays } = getCover60History(plays);
  assert.equal(checkedPlays, 10);
  assert.equal(forbidden.size, 10);
  assert.ok(forbidden.has('1,2,3,4,5,7'));
  assert.ok(forbidden.has('1,2,3,4,5,21'));
  assert.ok(forbidden.has('1,2,3,4,5,13'));
  for (const n of [6, 11, 12]) assert.ok(!forbidden.has(`1,2,3,4,5,${n}`));
  assert.equal(getCover60History([]).checkedPlays, 0);
});

test('A full six-number duplicate causes a retry; sharing five numbers alone does not', () => {
  const play = fixturePlay(10, [6, 4, 2, 5, 1, 3], { manualNote: 'Giocata manuale' });
  play.columns.unshift(...fixturePlay(9, [70, 72, 73, 74, 75, 76]).columns);
  const { forbidden, checkedPlays } = getCover60History([play]);
  assert.equal(checkedPlays, 1);
  assert.equal(forbidden.size, 2);
  let attempts = 0;
  const next = generateCover60(forbidden, (universe) => {
    if (++attempts === 1) return [...universe];
    const alternate = [...universe];
    [alternate[5], alternate[89]] = [alternate[89], alternate[5]];
    return alternate;
  });
  assert.equal(attempts, 2);
  assert.ok(next);
  assert.deepEqual(next[0].numbers, [1, 2, 3, 4, 5, 90]);
  assert.equal(new Set(next.flatMap(c => c.numbers)).size, 60);
  assert.equal(generateCover60(forbidden, (universe) => [...universe]), null);
});

test('Weighted selection favors both delay and recent frequency without excluding other numbers', () => {
  const universe = Array.from({ length: 90 }, (_, i) => i + 1);
  const stats = Object.fromEntries(universe.map(n => [n, {
    currentDelay: n === 89 ? 20 : 0,
    frequency: n === 90 ? 5 : 0,
  }]));
  // Same random variate for 62 numbers competing for 60 places. The two
  // weighted numbers win places even though they are last in the input.
  let i = 0;
  const shuffle = createCover60WeightedShuffle(stats, () => ++i <= 58 || i >= 89 ? 0.5 : 0.9);
  const columns = generateCover60(undefined, shuffle);
  assert.ok(columns);
  const selected = columns.flatMap(c => c.numbers);
  assert.equal(new Set(selected).size, 60);
  assert.ok(selected.includes(89));
  assert.ok(selected.includes(90));
  assert.ok(selected.includes(1));
  // Positive base weight lets even a number with no bonus rank first.
  i = 0;
  const alternate = createCover60WeightedShuffle(stats, () => ++i === 88 ? 0.01 : 0.5)(universe);
  assert.ok(alternate.includes(88));
});

function archiveDraw(date: string, first: number, contestNumber = 1): Draw {
  return {
    id: `${date}-${contestNumber}`, year: Number(date.slice(0, 4)), contestNumber,
    date, numbers: [first, 2, 3, 4, 5, 6], jolly: 8,
  };
}

test('Delay and frequency both use a rolling two-calendar-year window, including its first day', () => {
  const draws = [
    archiveDraw('2024-11-18', 1),
    archiveDraw('2026-11-19', 7),
    archiveDraw('2024-11-19', 9),
    archiveDraw('2025-01-01', 7),
  ];
  const { start, end, drawCount, stats } = getCover60ArchiveStats(draws);
  assert.equal(start, '2024-11-19');
  assert.equal(end, '2026-11-19');
  assert.equal(drawCount, 3);
  assert.deepEqual(stats[1], { frequency: 0, currentDelay: 3 });
  assert.deepEqual(stats[7], { frequency: 2, currentDelay: 0 });
  assert.deepEqual(stats[9], { frequency: 1, currentDelay: 2 });
  assert.deepEqual(stats[8], { frequency: 0, currentDelay: 3 }); // Jolly is not counted.
});

test('A saved Cover 60 draft restores identical columns and rejects overlapping or malformed sets', () => {
  const columns = generateCover60();
  assert.ok(columns);
  const draft = { id: 'fixture-123', selectionNote: 'Scelta pesata', historyMessage: 'Controllo completato',
    systemResult: { columns: columns.map(({ numbers }) => ({ numbers })) } };
  assert.deepEqual(parseCover60Draft(JSON.parse(JSON.stringify(draft))), draft);
  assert.equal(parseCover60Draft({ ...draft, id: 'other/account' }), null);
  assert.equal(parseCover60Draft({ ...draft, systemResult: { columns: columns.slice(1) } }), null);
  assert.equal(parseCover60Draft({ ...draft, systemResult: { columns: [...columns.slice(1), columns[1]] } }), null);
});

test('A leap-day end date clamps to February 28, and an empty archive has no dates', () => {
  const { start, drawCount, stats } = getCover60ArchiveStats([
    archiveDraw('2024-02-29', 1, 1),
    archiveDraw('2022-02-27', 7),
    archiveDraw('2022-02-28', 9),
    archiveDraw('2024-02-29', 10, 2),
  ]);
  assert.equal(start, '2022-02-28');
  assert.equal(drawCount, 3);
  assert.equal(stats[10].currentDelay, 0);
  assert.equal(stats[1].currentDelay, 1);
  assert.equal(getCover60ArchiveStats([]).end, null);
  assert.equal(getCover60ArchiveStats([]).drawCount, 0);
});

test('Exact coverage counts match inclusion-exclusion over disjoint columns', () => {
  function choose(n: number, k: number) {
    if (k < 0 || k > n) return 0;
    let out = 1;
    for (let i = 1; i <= k; i++) out = (out * (n - i + 1)) / i;
    return out;
  }
  assert.equal(COVER60_TOTAL_DRAWS, choose(90, 6));
  for (const { threshold, draws } of COVER60_ODDS) {
    function intersectionCount(groups: number, remaining: number, outside: number): number {
      if (groups === 0) return choose(outside, remaining);
      let total = 0;
      for (let hits = threshold; hits <= Math.min(6, remaining); hits++) {
        total += choose(6, hits) * intersectionCount(groups - 1, remaining - hits, outside);
      }
      return total;
    }
    let expected = 0;
    for (let groups = 1; groups <= Math.floor(6 / threshold); groups++) {
      expected += (groups % 2 ? 1 : -1) * choose(10, groups) * intersectionCount(groups, 6, 90 - 6 * groups);
    }
    assert.equal(draws, expected, `threshold ${threshold}`);
  }
});

test('Copertura 60 keeps the generation date from the account record without changing the numbers', () => {
  const columns = generateCover60();
  assert.ok(columns);
  const base = { id: 'abc-123', selectionNote: '', historyMessage: '', systemResult: { columns: columns.map(({ numbers }) => ({ numbers })) } };
  const stamp = '2026-11-21T09:32:00.000Z';
  const fromCloud = parseCover60Draft({ ...base, userEmail: 'cover60::x@gmail.com', updatedAt: stamp });
  assert.equal(fromCloud?.generatedAt, stamp);
  assert.deepEqual(fromCloud?.systemResult, base.systemResult);
  // The local cache stores the parsed draft, which carries generatedAt.
  assert.equal(parseCover60Draft(JSON.parse(JSON.stringify(fromCloud)))?.generatedAt, stamp);
  assert.equal(parseCover60Draft({ ...base, updatedAt: 'not-a-date' })?.generatedAt, undefined);
  assert.equal(parseCover60Draft(base)?.generatedAt, undefined);
});
