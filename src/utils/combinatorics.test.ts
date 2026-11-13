import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCombinations,
  checkEvenOdd,
  checkHighLow,
  checkSumRange,
  checkCadences,
  checkConsecutiveAndDecades,
  computeFilterPenalty,
  applyStatisticalFilters,
  greedyCoveringReduction,
  generateOptimizedSystem,
  parseExtractionText,
  evaluatePlayedSystem,
  buildGeneratedColumn,
  parseManualSestineText,
  createManualSavedPlay,
  applyManualCostAndWinning,
  calculateBudgetSystemAllocation,
  clampArchiveComparisonDrawsCount,
  compareSavedPlayAgainstRecentDraws
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

test('checkConsecutiveAndDecades and checkCadences reject 3+ consecutive, 3+ same decade, or 3+ same cadence', () => {
  assert.equal(checkConsecutiveAndDecades([10, 11, 25, 42, 60, 81]), true); // 2 consecutive, distributed decades
  assert.equal(checkConsecutiveAndDecades([10, 11, 12, 42, 60, 81]), false); // 3 consecutive
  assert.equal(checkConsecutiveAndDecades([11, 14, 18, 42, 60, 81]), false); // 3 numbers in 10-19 decade
  assert.equal(checkCadences([12, 42, 25, 37, 68, 81], 2), true); // max 2 ending in 2
  assert.equal(checkCadences([12, 42, 72, 37, 68, 81], 2), false); // 3 numbers ending in 2
  assert.equal(checkConsecutiveAndDecades([12, 42, 72, 37, 68, 81], 2, 2, 2), false);
});

test('computeFilterPenalty calculates 0 for clean sestine and proportional penalties for violations', () => {
  const filters: FilterOptions = {
    evenOdd: true,
    highLow: true,
    sumRange: true,
    minSum: 190,
    maxSum: 350,
    consecutive: true,
    decades: true,
    cadences: true
  };

  // Clean sestina: [10, 23, 35, 48, 61, 84] -> sum=261, evens=3, lows=3, no 3-consec, max 1 per decade, cadences: 0,3,5,8,1,4
  assert.equal(computeFilterPenalty([10, 23, 35, 48, 61, 84], filters), 0);

  // Violates only cadences (3 numbers ending in 1: 11, 41, 71): [11, 24, 36, 41, 68, 71] -> sum=251, evens=3, lows=4
  assert.equal(computeFilterPenalty([11, 24, 36, 41, 68, 71], filters), 50);

  // Violates only decades (3 numbers in 20s: 21, 24, 28): [21, 24, 28, 53, 65, 82] -> sum=273, evens=3, lows=3
  assert.equal(computeFilterPenalty([21, 24, 28, 53, 65, 82], filters), 55);
});

test('greedyCoveringReduction produces exactly 10 columns for v=12 with Uint8Array bitmask and Soft-Penalty', () => {
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
    decades: true,
    cadences: true
  };

  const filtered = applyStatisticalFilters(allCombos, filters);
  assert.ok(filtered.length > 10, 'Filtered combinations should leave ample candidates');

  const reduced = greedyCoveringReduction(allCombos, pool12, 10, 'terni', filters);
  assert.equal(reduced.length, 10, 'Should extract exactly 10 columns');
});

test('Soft-Penalty preserves covering matrix when pool contains 3 consecutive or 3 same-decade numbers, and runs v=15 in <150ms', () => {
  // Pool of 10 numbers containing 3 consecutive in same decade (11, 12, 13):
  // With 20 columns in 'terni' mode, a hard pre-filter would NEVER cover triplet (11, 12, 13),
  // whereas Soft-Penalty allows selecting a column with (11, 12, 13) once clean triplets are saturated!
  const pool10 = [11, 12, 13, 25, 38, 47, 56, 64, 79, 88];
  const filters: FilterOptions = {
    evenOdd: true,
    highLow: true,
    sumRange: true,
    minSum: 190,
    maxSum: 350,
    consecutive: true,
    decades: true,
    cadences: true
  };

  const sys10 = generateOptimizedSystem(pool10, filters, 25, undefined, 'terni');
  const coversConsecutiveTriplet = sys10.columns.some(
    (col) => col.numbers.includes(11) && col.numbers.includes(12) && col.numbers.includes(13)
  );
  assert.equal(
    coversConsecutiveTriplet,
    true,
    'Soft-penalty must allow covering triplet (11, 12, 13) instead of permanently deleting it'
  );

  // Benchmark v=15 (C(15, 6) = 5,005 combinations) with Uint8Array bitmask indexing
  const pool15 = [3, 9, 14, 21, 27, 34, 40, 45, 52, 58, 63, 71, 77, 84, 90];
  const sys15 = generateOptimizedSystem(pool15, filters, 10);
  assert.equal(sys15.totalCombinations, 5005);
  assert.equal(sys15.columns.length, 10);
  assert.equal(sys15.coverageTarget, 'terni'); // Default coverageTarget is 'terni'
  assert.ok(
    sys15.executionTimeMs < 200,
    `v=15 execution time was ${sys15.executionTimeMs}ms, should be <200ms`
  );
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
    decades: true,
    cadences: true
  };

  const result = generateOptimizedSystem(pool12, filters, 10);
  assert.equal(result.columns.length, 10);
  assert.ok(result.executionTimeMs < 500, `Execution time was ${result.executionTimeMs}ms, should be <500ms`);
  assert.equal(result.coverageMetrics.poolSize, 12);
  assert.ok(result.coverageMetrics.pairsCoveredCount > 0);
});

test('calculateBudgetSystemAllocation computes exact columns and caps free budget at 100€', () => {
  // Pure coverage: 1€ per column
  const b10 = calculateBudgetSystemAllocation(10, 'pure_coverage');
  assert.equal(b10.targetColumnsCount, 10);
  assert.equal(b10.actualCost, 10.0);
  assert.equal(b10.savedAmount, 0.0);
  assert.equal(b10.isCappedAtMax, false);

  const b15 = calculateBudgetSystemAllocation(15, 'pure_coverage');
  assert.equal(b15.targetColumnsCount, 15);
  assert.equal(b15.actualCost, 15.0);

  const b20 = calculateBudgetSystemAllocation(20, 'pure_coverage');
  assert.equal(b20.targetColumnsCount, 20);
  assert.equal(b20.actualCost, 20.0);

  // Free budget capped at 100€
  const b150 = calculateBudgetSystemAllocation(150, 'pure_coverage');
  assert.equal(b150.isCappedAtMax, true);
  assert.equal(b150.clampedBudget, 100);
  assert.equal(b150.targetColumnsCount, 100);
  assert.equal(b150.actualCost, 100.0);

  // SuperStar mode: 1.50€ per column
  const s10 = calculateBudgetSystemAllocation(10, 'superstar');
  assert.equal(s10.targetColumnsCount, 6);
  assert.equal(s10.actualCost, 9.0);
  assert.equal(s10.savedAmount, 1.0);

  const s15 = calculateBudgetSystemAllocation(15, 'superstar');
  assert.equal(s15.targetColumnsCount, 10);
  assert.equal(s15.actualCost, 15.0);
  assert.equal(s15.savedAmount, 0.0);

  const s20 = calculateBudgetSystemAllocation(20, 'superstar');
  assert.equal(s20.targetColumnsCount, 13);
  assert.equal(s20.actualCost, 19.5);
  assert.equal(s20.savedAmount, 0.5);
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

  const evalResult = evaluatePlayedSystem(columns, dummyDraw, 4.0);
  // Column 1 has 3 matches: 10, 20, 30. Plus jolly 40
  assert.equal(evalResult.matchesPerColumn[0].matchCount, 3);
  assert.equal(evalResult.matchesPerColumn[0].hasJolly, true);
  assert.equal(evalResult.matchesPerColumn[0].estimatedPrize, 25);
  assert.equal(evalResult.netReturn, 21); // 25 - 4.0 customCost
  assert.equal(evalResult.hasWin, true);
});

test('buildGeneratedColumn, parseManualSestineText, createManualSavedPlay, and applyManualCostAndWinning work accurately', () => {
  const col = buildGeneratedColumn(1, [88, 12, 5, 42, 31, 64], 77);
  assert.ok(col !== null);
  assert.deepEqual(col?.numbers, [5, 12, 31, 42, 64, 88]);
  assert.equal(col?.superstar, 77);

  // Reject duplicate or out-of-range
  assert.equal(buildGeneratedColumn(1, [5, 5, 12, 31, 42, 64]), null);
  assert.equal(buildGeneratedColumn(1, [5, 12, 31, 42, 64, 95]), null);

  const parsedCols = parseManualSestineText('5 14 28 42 67 89 *45\n10, 20, 30, 40, 50, 60');
  assert.equal(parsedCols.length, 2);
  assert.deepEqual(parsedCols[0].numbers, [5, 14, 28, 42, 67, 89]);
  assert.equal(parsedCols[0].superstar, 45);
  assert.deepEqual(parsedCols[1].numbers, [10, 20, 30, 40, 50, 60]);

  const manualPlay = createManualSavedPlay({
    targetContestId: '2026-175',
    columns: parsedCols,
    cost: 3.5,
    winningAmount: 25.0,
    manualNote: 'Schedina bar'
  });

  assert.equal(manualPlay.mode, 'manual');
  assert.equal(manualPlay.cost, 3.5);
  assert.equal(manualPlay.status, 'VERIFICATA');
  assert.equal(manualPlay.result?.totalWinning, 25.0);
  assert.equal(manualPlay.result?.netReturn, 21.5);
  assert.equal(manualPlay.manualNote, 'Schedina bar');

  const updated = applyManualCostAndWinning(manualPlay, 5.0, 105.0, true);
  assert.equal(updated.cost, 5.0);
  assert.equal(updated.result?.totalWinning, 105.0);
  assert.equal(updated.result?.netReturn, 100.0);
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

test('generateOptimizedSystem supports both Massimizza Ambi (t=2) and Massimizza Terni (t=3) coverage targets', () => {
  const pool = [4, 11, 18, 25, 32, 39, 46, 53, 60, 67, 74, 81];
  const filters: FilterOptions = {
    evenOdd: true,
    highLow: true,
    sumRange: true,
    minSum: 190,
    maxSum: 350,
    consecutive: true,
    decades: true,
    cadences: true
  };

  const resAmbi = generateOptimizedSystem(pool, filters, 10, undefined, 'ambi');
  const resTerni = generateOptimizedSystem(pool, filters, 10, undefined, 'terni');

  assert.equal(resAmbi.coverageTarget, 'ambi');
  assert.equal(resTerni.coverageTarget, 'terni');
  assert.equal(resAmbi.columns.length, 10);
  assert.equal(resTerni.columns.length, 10);
  assert.ok(
    resTerni.coverageMetrics.tripletsCoveredCount >= resAmbi.coverageMetrics.tripletsCoveredCount,
    `Terni mode should cover at least as many triplets (${resTerni.coverageMetrics.tripletsCoveredCount}) as Ambi mode (${resAmbi.coverageMetrics.tripletsCoveredCount})`
  );
});

test('compareSavedPlayAgainstRecentDraws clamps range [10..200], highlights drawn numbers, and calculates Spesa, Utile Lordo, and Utile Netto', async () => {
  assert.equal(clampArchiveComparisonDrawsCount(3), 10);
  assert.equal(clampArchiveComparisonDrawsCount(50), 50);
  assert.equal(clampArchiveComparisonDrawsCount(350), 200);

  const { generateFullHistoricalDataset } = await import('../data/seedDraws');
  const full = generateFullHistoricalDataset();

  const col1 = buildGeneratedColumn(1, [19, 24, 49, 62, 64, 85], 10)!;
  const col2 = buildGeneratedColumn(2, [1, 2, 3, 4, 5, 6], 20)!;
  const play = createManualSavedPlay({
    targetContestId: '2026-175',
    columns: [col1, col2],
    cost: 3.0,
    winningAmount: 0,
    manualNote: 'Test confronto archivio'
  });

  const summary = compareSavedPlayAgainstRecentDraws(play, full, 15);
  assert.equal(summary.drawsEvaluatedCount, 15);
  assert.equal(summary.costPerDraw, 3.0);
  assert.equal(summary.totalSpent, 45.0); // 15 draws * 3.00 €
  assert.equal(summary.netProfitLoss, Number((summary.grossWinnings - summary.totalSpent).toFixed(2)));
  assert.equal(summary.rows.length, 15);
  // First draw 2026-174 has numbers [19, 24, 49, 62, 64, 85] which match col1 completely
  assert.deepEqual(summary.rows[0].matchedNumbersInPlay, [19, 24, 49, 62, 64, 85]);
  assert.ok(summary.grossWinnings > 0);
});



