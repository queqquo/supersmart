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

test('Zero Mock Data & External Archive Schema: no local heavy draw files in app repo, validateRealDrawInput & exportEstrazioniSisalJSON enforce strict Sisal schema', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { generateFullHistoricalDataset, INITIAL_HISTORICAL_DRAWS } = await import('../data/seedDraws');
  const { validateRealDrawInput } = await import('./combinatorics');
  const { validateAndDeduplicateDraws, exportEstrazioniSisalJSON } = await import('./storage');

  assert.equal(generateFullHistoricalDataset().length, 0);
  assert.equal(INITIAL_HISTORICAL_DRAWS.length, 0);

  // Verify heavy local draw files are removed (hosted in external GitHub repo)
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'src/data/officialDraws.json')), false);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'src/data/superenalotto.json')), false);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'src/data/winforitalia.json')), false);

  // Valid real draw in official Sisal schema { concorso, data, sestina, jolly, superstar }
  const validRes = validateRealDrawInput({
    concorso: 174,
    data: '2026-10-30',
    sestina: [85, 19, 24, 64, 49, 62],
    jolly: 12,
    superstar: 77
  });
  assert.equal(validRes.valid, true);
  assert.deepEqual(validRes.sisalRecord, {
    concorso: 174,
    data: '2026-10-30',
    sestina: [19, 24, 49, 62, 64, 85],
    jolly: 12,
    superstar: 77
  });

  // Reject incomplete record (missing superstar)
  assert.equal(
    validateRealDrawInput({
      concorso: 174,
      data: '2026-10-30',
      sestina: [19, 24, 49, 62, 64, 85],
      jolly: 12
    }).valid,
    false
  );

  // Reject duplicate numbers in sestina
  assert.equal(
    validateRealDrawInput({ numbers: [7, 7, 19, 24, 49, 62], jolly: 12, superstar: 44 }).valid,
    false
  );

  // Reject out-of-range numbers (<1 or >90)
  assert.equal(
    validateRealDrawInput({ numbers: [0, 19, 24, 49, 62, 85], jolly: 12, superstar: 44 }).valid,
    false
  );
  assert.equal(
    validateRealDrawInput({ numbers: [7, 19, 24, 49, 62, 91], jolly: 12, superstar: 44 }).valid,
    false
  );

  // Reject Jolly equal to one of the 6 winning numbers
  assert.equal(
    validateRealDrawInput({ numbers: [7, 19, 24, 49, 62, 85], jolly: 24, superstar: 44 }).valid,
    false
  );

  // Deduplication and exportEstrazioniSisalJSON descending order verification
  const rawMixed = [
    { concorso: 44, data: '2026-03-10', sestina: [90, 5, 18, 22, 41, 63], jolly: 11, superstar: 33 },
    { concorso: 45, data: '2026-03-12', sestina: [89, 12, 24, 35, 58, 71], jolly: 15, superstar: 44 },
    { concorso: 45, data: '2026-03-12', sestina: [12, 24, 35, 58, 71, 89], jolly: 15, superstar: 44 }, // duplicate
    { concorso: 46, data: '2026-03-14', sestina: [1, 2, 3, 4, 5], jolly: 10, superstar: 20 } // incomplete (5 numbers) -> discarded
  ];
  const deduped = validateAndDeduplicateDraws(rawMixed);
  assert.equal(deduped.length, 2);
  const exportedJson = JSON.parse(exportEstrazioniSisalJSON(deduped));
  assert.deepEqual(exportedJson, [
    {
      concorso: 45,
      data: '2026-03-12',
      sestina: [12, 24, 35, 58, 71, 89],
      jolly: 15,
      superstar: 44
    },
    {
      concorso: 44,
      data: '2026-03-10',
      sestina: [5, 18, 22, 41, 63, 90],
      jolly: 11,
      superstar: 33
    }
  ]);
});

test('Exact 5x Symmetry: generateOptimizedSystem on 12 numbers -> 10 sestine guarantees every number appears EXACTLY 5 times with 0 duplicate sestine', () => {
  const pool12 = [4, 11, 18, 25, 32, 39, 46, 53, 60, 67, 74, 81];
  const unbiasedFilters: FilterOptions = {
    evenOdd: false,
    highLow: false,
    sumRange: false,
    minSum: 190,
    maxSum: 350,
    consecutive: false,
    decades: false,
    cadences: false
  };

  for (const target of ['ambi', 'terni'] as const) {
    const res = generateOptimizedSystem(pool12, unbiasedFilters, 10, undefined, target);
    assert.equal(res.columns.length, 10);
    assert.equal(res.coverageMetrics.minPresence, 5, `Every number must appear at least 5 times (${target})`);
    assert.equal(res.coverageMetrics.maxPresence, 5, `Every number must appear at most 5 times (${target})`);
    assert.equal(res.coverageMetrics.averagePresence, 5);

    // Check every individual number in pool12 appears exactly 5 times
    for (const num of pool12) {
      assert.equal(
        res.coverageMetrics.presenceHistogram[num],
        5,
        `Number ${num} must appear exactly 5 times in the 10 sestine, got ${res.coverageMetrics.presenceHistogram[num]}`
      );
    }

    // Check zero duplicate sestine
    const uniqueColumnKeys = new Set(res.columns.map((c) => c.numbers.join(',')));
    assert.equal(uniqueColumnKeys.size, 10, 'All 10 sestine must be strictly distinct (0 duplicates)');
  }
});

test('compareSavedPlayAgainstRecentDraws clamps range [10..200], highlights drawn numbers, and calculates Spesa, Utile Lordo, and Utile Netto on real user draws', () => {
  assert.equal(clampArchiveComparisonDrawsCount(3), 10);
  assert.equal(clampArchiveComparisonDrawsCount(50), 50);
  assert.equal(clampArchiveComparisonDrawsCount(350), 200);

  const realDrawsSample: Draw[] = Array.from({ length: 15 }, (_, idx) => ({
    id: `2026-${String(174 - idx).padStart(3, '0')}`,
    contestNumber: 174 - idx,
    year: 2026,
    date: `2026-10-${String(30 - idx).padStart(2, '0')}`,
    numbers: idx === 0 ? [19, 24, 49, 62, 64, 85] : [3, 14, 27, 41, 58, 79],
    jolly: 11,
    superstar: 10
  }));

  const col1 = buildGeneratedColumn(1, [19, 24, 49, 62, 64, 85], 10)!;
  const col2 = buildGeneratedColumn(2, [1, 2, 3, 4, 5, 6], 20)!;
  const play = createManualSavedPlay({
    targetContestId: '2026-175',
    columns: [col1, col2],
    cost: 3.0,
    winningAmount: 0,
    manualNote: 'Test confronto archivio reale'
  });

  const summary = compareSavedPlayAgainstRecentDraws(play, realDrawsSample, 15);
  assert.equal(summary.drawsEvaluatedCount, 15);
  assert.equal(summary.costPerDraw, 3.0);
  assert.equal(summary.totalSpent, 45.0); // 15 draws * 3.00 €
  assert.equal(summary.netProfitLoss, Number((summary.grossWinnings - summary.totalSpent).toFixed(2)));
  assert.equal(summary.rows.length, 15);
  assert.deepEqual(summary.rows[0].matchedNumbersInPlay, [19, 24, 49, 62, 64, 85]);
  assert.ok(summary.grossWinnings > 0);
});

test('selectFairPoolNumbers, selectFunnelPool30To12, and selectBalancedTopNumbers operate with zero decade/parity/extreme bias via Fisher-Yates crypto.getRandomValues', async () => {
  const {
    selectFairPoolNumbers,
    selectFunnelPool30To12,
    selectBalancedTopNumbers,
    scorePool30InPureCompetition,
    getCryptoRandomFloat
  } = await import('./combinatorics');

  // 1. Verify scorePool30InPureCompetition gives every number equal base dignity (uniform score = 100 without artificial cluster/extreme bias)
  const testPool = [1, 2, 11, 45, 89];
  const scored = scorePool30InPureCompetition(testPool);
  for (const item of scored) {
    assert.equal(item.score, 100, `Number ${item.num} must have uniform base score 100 without artificial cluster/extreme bias`);
  }

  // 2. Verify NO artificial cap of "max 3 per decade": if input has 10 numbers in the same decade, all 10 are selected without blocking
  const singleDecadePool = [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 12, 88];
  const selected12 = selectBalancedTopNumbers(singleDecadePool, 12);
  assert.equal(selected12.length, 12);
  const decade4Count = selected12.filter((n) => Math.floor((n - 1) / 10) === 4).length;
  assert.equal(decade4Count, 10, 'Must not block 3+ numbers in the same decade');

  // 3. Verify selectFairPoolNumbers falls back to pure_uniform when draws is empty
  const fairEmpty = selectFairPoolNumbers({
    draws: [],
    targetSize: 12,
    mode: 'real_archive_weighted'
  });
  assert.equal(fairEmpty.modeUsed, 'pure_uniform');
  assert.equal(fairEmpty.selectedNumbers.length, 12);
  assert.equal(new Set(fairEmpty.selectedNumbers).size, 12);

  // 4. Verify selectFunnelPool30To12 returns 12 distinct sorted numbers in [1..90]
  const funnel12 = selectFunnelPool30To12([], 12, getCryptoRandomFloat, 'pure_uniform');
  assert.equal(funnel12.top12Numbers.length, 12);
  assert.equal(new Set(funnel12.top12Numbers).size, 12);
  for (let i = 0; i < funnel12.top12Numbers.length; i++) {
    const n = funnel12.top12Numbers[i];
    assert.ok(n >= 1 && n <= 90);
    if (i > 0) {
      assert.ok(n > funnel12.top12Numbers[i - 1], 'Selected pool must be sorted ascending');
    }
  }
});

test('runCamelWorkforcePipeline works cleanly both with empty archive (Equiprobable Pure mode) and with real draws, producing exact 5x symmetry on 12->10 sestine', async () => {
  const { runCamelWorkforcePipeline } = await import('./camelWorkforce');
  const { getBalancedFunnelUiLabels } = await import('./combinatorics');

  const filters: FilterOptions = {
    evenOdd: false,
    highLow: false,
    sumRange: false,
    minSum: 190,
    maxSum: 350,
    consecutive: false,
    decades: false,
    cadences: false
  };

  // Run with empty archive (Zero Mock Data startup state)
  const resEmpty = runCamelWorkforcePipeline({
    draws: [],
    poolSizeV: 12,
    budgetEuro: 10,
    playMode: 'pure_coverage',
    coverageTarget: 'terni',
    baseFilters: filters
  });

  assert.equal(resEmpty.agents.length, 5);
  assert.equal(resEmpty.candidates.length, 3);
  for (const cand of resEmpty.candidates) {
    assert.equal(cand.poolNumbers.length, 12);
    assert.equal(new Set(cand.poolNumbers).size, 12);
    assert.equal(cand.systemResult.columns.length, 10);
    assert.equal(cand.systemResult.coverageMetrics.minPresence, 5);
    assert.equal(cand.systemResult.coverageMetrics.maxPresence, 5);
  }

  const labels12 = getBalancedFunnelUiLabels(12);
  assert.equal(labels12.title, 'Selezione Equa 12 Numeri (Fisher-Yates Crypto RNG)');
  assert.equal(labels12.recalcButton, 'Estrai Nuovi 12 Numeri Equi');

  const { compactCamelWorkforceResult, hydrateCamelWorkforceResult } = await import(
    './camelWorkforce'
  );
  const compacted = compactCamelWorkforceResult(resEmpty);
  assert.equal(compacted.winnerCandidateId, resEmpty.winnerCandidate.id);
  const hydrated = hydrateCamelWorkforceResult(JSON.parse(JSON.stringify(compacted)));
  assert.ok(hydrated);
  assert.equal(hydrated.runId, resEmpty.runId);
  assert.equal(hydrated.agents.length, 5);
  assert.equal(hydrated.candidates.length, 3);
  assert.equal(hydrated.winnerCandidate.id, resEmpty.winnerCandidate.id);
  assert.deepEqual(hydrated.winnerCandidate.poolNumbers, resEmpty.winnerCandidate.poolNumbers);
  assert.deepEqual(
    hydrated.winnerCandidate.systemResult.columns,
    JSON.parse(JSON.stringify(resEmpty.winnerCandidate.systemResult.columns))
  );
});
