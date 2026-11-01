import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCombinations,
  checkEvenOdd,
  checkHighLow,
  checkSumRange,
  checkConsecutiveAndDecades,
  applyStatisticalFilters,
  greedyCoveringReduction,
  generateOptimizedSystem,
  parseExtractionText,
  evaluatePlayedSystem
} from './combinatorics';
import { FilterOptions, Draw, GeneratedColumn } from '../types/lottery';

test('generateCombinations produces exact C(n, k)', () => {
  const pool = [1, 2, 3, 4, 5, 6, 7];
  const combos = generateCombinations(pool, 6);
  assert.equal(combos.length, 7); // C(7, 6) = 7

  const pool8 = [1, 2, 3, 4, 5, 6, 7, 8];
  const combos8 = generateCombinations(pool8, 6);
  assert.equal(combos8.length, 28); // C(8, 6) = 28
});

test('checkEvenOdd validates 2, 3, or 4 evens', () => {
  assert.equal(checkEvenOdd([2, 4, 6, 1, 3, 5]), true); // 3 evens
  assert.equal(checkEvenOdd([2, 4, 1, 3, 5, 7]), true); // 2 evens
  assert.equal(checkEvenOdd([2, 4, 6, 8, 1, 3]), true); // 4 evens
  assert.equal(checkEvenOdd([2, 4, 6, 8, 10, 1]), false); // 5 evens
  assert.equal(checkEvenOdd([1, 3, 5, 7, 9, 11]), false); // 0 evens
});

test('checkHighLow validates 2, 3, or 4 numbers <= 45', () => {
  assert.equal(checkHighLow([10, 20, 30, 50, 60, 70]), true); // 3 low
  assert.equal(checkHighLow([50, 60, 70, 80, 85, 90]), false); // 0 low
  assert.equal(checkHighLow([1, 2, 3, 4, 5, 6]), false); // 6 low
});

test('checkSumRange validates sum bounds', () => {
  assert.equal(checkSumRange([10, 20, 30, 40, 50, 60], 190, 350), true); // sum = 210
  assert.equal(checkSumRange([1, 2, 3, 4, 5, 6], 190, 350), false); // sum = 21
  assert.equal(checkSumRange([85, 86, 87, 88, 89, 90], 190, 350), false); // sum = 525
});

test('checkConsecutiveAndDecades rejects 3+ consecutive numbers or 3+ numbers in same decade', () => {
  assert.equal(checkConsecutiveAndDecades([10, 11, 25, 42, 60, 81]), true); // 2 consecutive, distributed decades
  assert.equal(checkConsecutiveAndDecades([10, 11, 12, 42, 60, 81]), false); // 3 consecutive
  assert.equal(checkConsecutiveAndDecades([11, 14, 18, 42, 60, 81]), false); // 3 numbers in 10-19 decade
});

test('greedyCoveringReduction produces exactly 10 columns for v=12', () => {
  const pool12 = [3, 7, 14, 25, 33, 48, 52, 61, 74, 80, 85, 89];
  const allCombos = generateCombinations(pool12, 6);
  assert.equal(allCombos.length, 924); // C(12, 6) = 924

  const filters: FilterOptions = {
    evenOdd: true,
    highLow: true,
    sumRange: true,
    minSum: 190,
    maxSum: 350,
    consecutive: true,
    decades: true
  };

  const filtered = applyStatisticalFilters(allCombos, filters);
  assert.ok(filtered.length > 10, 'Filtered combinations should leave ample candidates');

  const reduced = greedyCoveringReduction(filtered, pool12, 10);
  assert.equal(reduced.length, 10, 'Should extract exactly 10 columns');
});

test('generateOptimizedSystem runs and outputs coverage metrics in <500ms', () => {
  const pool12 = [5, 12, 23, 34, 45, 56, 67, 72, 78, 81, 84, 90];
  const filters: FilterOptions = {
    evenOdd: true,
    highLow: true,
    sumRange: true,
    minSum: 190,
    maxSum: 350,
    consecutive: true,
    decades: true
  };

  const result = generateOptimizedSystem(pool12, filters, 10);
  assert.equal(result.columns.length, 10);
  assert.ok(result.executionTimeMs < 500, `Execution time was ${result.executionTimeMs}ms, should be <500ms`);
  assert.equal(result.coverageMetrics.poolSize, 12);
  assert.ok(result.coverageMetrics.pairsCoveredCount > 0);
});

test('parseExtractionText parses natural Italian lottery strings', () => {
  const sample1 = 'Estrazione n. 45 del 12/03/2026: 12, 24, 35, 58, 71, 89 Jolly: 15 SuperStar: 44';
  const parsed1 = parseExtractionText(sample1);

  assert.ok(parsed1 !== null);
  assert.deepEqual(parsed1?.numbers, [12, 24, 35, 58, 71, 89]);
  assert.equal(parsed1?.jolly, 15);
  assert.equal(parsed1?.superstar, 44);
  assert.equal(parsed1?.date, '2026-03-12');
  assert.equal(parsed1?.contestNumber, 45);
});

test('evaluatePlayedSystem correctly matches winning numbers and awards prizes', () => {
  const columns: GeneratedColumn[] = [
    { id: 1, numbers: [10, 20, 30, 40, 50, 60], sum: 210, evens: 6, odds: 0, lows: 4, highs: 2 },
    { id: 2, numbers: [5, 12, 23, 34, 45, 56], sum: 175, evens: 3, odds: 3, lows: 4, highs: 2 }
  ];

  const dummyDraw: Draw = {
    id: '2026-001',
    contestNumber: 1,
    year: 2026,
    date: '2026-01-02',
    numbers: [10, 20, 30, 77, 88, 89],
    jolly: 40
  };

  const evalResult = evaluatePlayedSystem(columns, dummyDraw);
  // Column 1 has 3 matches: 10, 20, 30. Plus jolly 40
  assert.equal(evalResult.matchesPerColumn[0].matchCount, 3);
  assert.equal(evalResult.matchesPerColumn[0].hasJolly, true);
  assert.equal(evalResult.matchesPerColumn[0].estimatedPrize, 25);
  assert.equal(evalResult.hasWin, true);
});

test('generateFullHistoricalDataset provides complete official archive from 2009 to October 2026 (all 18 years)', async () => {
  const { generateFullHistoricalDataset } = await import('../data/seedDraws');
  const full = generateFullHistoricalDataset();

  assert.equal(full.length, 2946);
  assert.equal(full[0].id, '2026-174');
  assert.equal(full[0].date, '2026-10-30');
  assert.deepEqual(full[0].numbers, [19, 24, 49, 62, 64, 85]);

  assert.equal(full[full.length - 1].id, '2009-001');
  assert.equal(full[full.length - 1].date, '2009-01-02');
  assert.deepEqual(full[full.length - 1].numbers, [16, 19, 29, 34, 48, 64]);

  const yearsPresent = new Set(full.map((d) => d.year));
  for (let yr = 2009; yr <= 2026; yr++) {
    assert.ok(yearsPresent.has(yr), `Year ${yr} must be present in historical archive`);
  }
});
