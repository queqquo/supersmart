import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER60_COST, COVER60_ODDS, COVER60_TOTAL_DRAWS, generateCover60 } from './cover60';

test('Copertura 60 generates ten sorted base columns and sixty globally distinct numbers', () => {
  assert.equal(COVER60_COST, 10);
  for (let run = 0; run < 30; run++) {
    const columns = generateCover60();
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
