import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SavedPlay } from '../types/lottery';
import { buildGeneratedColumn } from './combinatorics';
import { COVER60_COST, COVER60_ODDS, COVER60_TOTAL_DRAWS, generateCover60, getCover60History } from './cover60';

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
