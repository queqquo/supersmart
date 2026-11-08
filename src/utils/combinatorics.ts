/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Draw,
  NumberStat,
  ScoringWeights,
  FilterOptions,
  GeneratedColumn,
  SystemGenerationResult,
  ColumnMatchResult,
  PlayResult,
  SavedPlay,
  PlayMode
} from '../types/lottery';

/**
 * Generate all combinations of k elements from an array of numbers
 */
export function generateCombinations(elements: number[], k: number): number[][] {
  const result: number[][] = [];
  const n = elements.length;
  if (k > n || k <= 0) return result;

  const current: number[] = new Array(k);

  function backtrack(startIdx: number, depth: number) {
    if (depth === k) {
      result.push([...current]);
      return;
    }
    for (let i = startIdx; i <= n - (k - depth); i++) {
      current[depth] = elements[i];
      backtrack(i + 1, depth + 1);
    }
  }

  backtrack(0, 0);
  return result;
}

/**
 * Filter 1: Even/Odd balance
 * Accepts 2/4, 3/3, 4/2 (i.e. even count in [2, 3, 4])
 */
export function checkEvenOdd(combo: number[]): boolean {
  let evens = 0;
  for (let i = 0; i < combo.length; i++) {
    if (combo[i] % 2 === 0) evens++;
  }
  return evens >= 2 && evens <= 4;
}

/**
 * Filter 2: High/Low balance
 * Lows: 1-45, Highs: 46-90
 * Accepts 2/4, 3/3, 4/2 (i.e. lows in [2, 3, 4])
 */
export function checkHighLow(combo: number[]): boolean {
  let lows = 0;
  for (let i = 0; i < combo.length; i++) {
    if (combo[i] <= 45) lows++;
  }
  return lows >= 2 && lows <= 4;
}

/**
 * Filter 3: Sum of numbers in range [minSum, maxSum]
 * Default [190, 350], Gaussian central mean 273
 */
export function checkSumRange(combo: number[], minSum = 190, maxSum = 350): boolean {
  const sum = combo.reduce((a, b) => a + b, 0);
  return sum >= minSum && sum <= maxSum;
}

/**
 * Filter 4: Consecutivity and Decades
 * Max 2 consecutive numbers (e.g. 10,11 ok; 10,11,12 not allowed)
 * Max 2 numbers in the same decade (e.g. 1-9, 10-19, ..., 80-90)
 */
export function checkConsecutiveAndDecades(
  sortedCombo: number[],
  maxConsecutive = 2,
  maxPerDecade = 2
): boolean {
  // Check consecutive
  let consecutiveRun = 1;
  let maxRunFound = 1;
  for (let i = 1; i < sortedCombo.length; i++) {
    if (sortedCombo[i] === sortedCombo[i - 1] + 1) {
      consecutiveRun++;
      if (consecutiveRun > maxRunFound) maxRunFound = consecutiveRun;
    } else {
      consecutiveRun = 1;
    }
  }
  if (maxRunFound > maxConsecutive) return false;

  // Check decades
  const decadeCounts = new Array(10).fill(0);
  for (let i = 0; i < sortedCombo.length; i++) {
    const num = sortedCombo[i];
    // Decade 0: 1-9; Decade 1: 10-19; ... Decade 8: 80-89; Decade 9: 90
    const decade = Math.min(Math.floor(num / 10), 9);
    decadeCounts[decade]++;
    if (decadeCounts[decade] > maxPerDecade) return false;
  }

  return true;
}

/**
 * Apply all statistical conditioning filters to combinations
 */
export function applyStatisticalFilters(
  combinations: number[][],
  filters: FilterOptions
): number[][] {
  return combinations.filter((combo) => {
    // Note: combo numbers are sorted ascending
    if (filters.evenOdd && !checkEvenOdd(combo)) return false;
    if (filters.highLow && !checkHighLow(combo)) return false;
    if (filters.sumRange && !checkSumRange(combo, filters.minSum, filters.maxSum)) return false;
    if (
      (filters.consecutive || filters.decades) &&
      !checkConsecutiveAndDecades(
        combo,
        filters.consecutive ? 2 : 6,
        filters.decades ? 2 : 6
      )
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Greedy Set Cover / Covering Design Reduction
 * Selects exactly targetCount columns (10 for pure coverage, 6 for superstar)
 * maximizing coverage of pairs and triplets, while balancing frequency of each number.
 */
export function greedyCoveringReduction(
  candidates: number[][],
  poolNumbers: number[],
  targetCount: number
): number[][] {
  if (candidates.length <= targetCount) {
    return candidates;
  }

  const poolSet = new Set(poolNumbers);
  const targetNumberPresence = (targetCount * 6) / poolNumbers.length; // e.g. 60 / 12 = 5
  const numberUsage: Record<number, number> = {};
  for (const n of poolNumbers) {
    numberUsage[n] = 0;
  }

  // Set of covered pairs: encode as "num1,num2"
  const coveredPairs = new Set<string>();
  const coveredTriplets = new Set<string>();

  const selected: number[][] = [];
  const remainingCandidates = [...candidates];

  // Helper to calculate score of a candidate
  function evaluateCandidate(combo: number[]): number {
    let score = 0;

    // Number presence balance reward/penalty
    let balancePenalty = 0;
    for (const num of combo) {
      const currentCount = numberUsage[num] || 0;
      if (currentCount >= targetNumberPresence) {
        balancePenalty += Math.pow(currentCount - targetNumberPresence + 1, 2) * 15;
      } else {
        score += 10;
      }
    }

    // New pair coverage
    let newPairs = 0;
    for (let i = 0; i < combo.length; i++) {
      for (let j = i + 1; j < combo.length; j++) {
        const pairKey = `${combo[i]},${combo[j]}`;
        if (!coveredPairs.has(pairKey)) {
          newPairs++;
        }
      }
    }

    // New triplet coverage
    let newTriplets = 0;
    for (let i = 0; i < combo.length; i++) {
      for (let j = i + 1; j < combo.length; j++) {
        for (let m = j + 1; m < combo.length; m++) {
          const tripKey = `${combo[i]},${combo[j]},${combo[m]}`;
          if (!coveredTriplets.has(tripKey)) {
            newTriplets++;
          }
        }
      }
    }

    score += newPairs * 8 + newTriplets * 2 - balancePenalty;
    return score;
  }

  while (selected.length < targetCount && remainingCandidates.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remainingCandidates.length; i++) {
      const candidate = remainingCandidates[i];
      const score = evaluateCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      bestIdx = 0;
    }

    const chosen = remainingCandidates.splice(bestIdx, 1)[0];
    selected.push(chosen);

    // Update usage and covered pairs/triplets
    for (const num of chosen) {
      if (poolSet.has(num)) {
        numberUsage[num] = (numberUsage[num] || 0) + 1;
      }
    }

    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        coveredPairs.add(`${chosen[i]},${chosen[j]}`);
        for (let m = j + 1; m < chosen.length; m++) {
          coveredTriplets.add(`${chosen[i]},${chosen[j]},${chosen[m]}`);
        }
      }
    }
  }

  return selected;
}

/**
 * Calculate coverage metrics for the chosen columns
 */
export function computeCoverageMetrics(
  columns: number[][],
  poolNumbers: number[]
) {
  const allPairs = new Set<string>();
  const allTriplets = new Set<string>();

  // Total possible pairs & triplets in the pool
  for (let i = 0; i < poolNumbers.length; i++) {
    for (let j = i + 1; j < poolNumbers.length; j++) {
      allPairs.add(`${poolNumbers[i]},${poolNumbers[j]}`);
      for (let m = j + 1; m < poolNumbers.length; m++) {
        allTriplets.add(`${poolNumbers[i]},${poolNumbers[j]},${poolNumbers[m]}`);
      }
    }
  }

  const coveredPairs = new Set<string>();
  const coveredTriplets = new Set<string>();
  const presence: Record<number, number> = {};
  for (const n of poolNumbers) presence[n] = 0;

  for (const col of columns) {
    for (const num of col) {
      if (presence[num] !== undefined) {
        presence[num]++;
      }
    }
    for (let i = 0; i < col.length; i++) {
      for (let j = i + 1; j < col.length; j++) {
        const pKey = `${col[i]},${col[j]}`;
        if (allPairs.has(pKey)) coveredPairs.add(pKey);
        for (let m = j + 1; m < col.length; m++) {
          const tKey = `${col[i]},${col[j]},${col[m]}`;
          if (allTriplets.has(tKey)) coveredTriplets.add(tKey);
        }
      }
    }
  }

  const presenceValues = Object.values(presence);
  const avgPresence =
    presenceValues.length > 0
      ? presenceValues.reduce((a, b) => a + b, 0) / presenceValues.length
      : 0;

  return {
    poolSize: poolNumbers.length,
    pairsCoveredCount: coveredPairs.size,
    pairsTotalInPool: allPairs.size,
    tripletsCoveredCount: coveredTriplets.size,
    tripletsTotalInPool: allTriplets.size,
    averagePresence: Number(avgPresence.toFixed(2)),
    presenceHistogram: presence
  };
}

/**
 * Calculate historical delays, max delays, and cyclic frequency
 */
export function calculateNumberStatistics(draws: Draw[], kCycles = 36): Record<number, NumberStat> {
  const stats: Record<number, NumberStat> = {};

  for (let num = 1; num <= 90; num++) {
    stats[num] = {
      number: num,
      currentDelay: 0,
      maxHistoricalDelay: 1,
      normalizedDelay: 0,
      frequencyK: 0,
      totalFrequency: 0,
      affinityScore: 0,
      compositeScore: 0
    };
  }

  if (draws.length === 0) return stats;

  // Draws are ordered chronologically or reverse-chronologically.
  // Standardize: ensure draws are sorted newest first for delay calculation
  const sortedDraws = [...draws].sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  // Calculate current delay (draws since last appearance from newest draw)
  for (let num = 1; num <= 90; num++) {
    let delay = 0;
    let found = false;
    for (let i = 0; i < sortedDraws.length; i++) {
      if (sortedDraws[i].numbers.includes(num)) {
        found = true;
        break;
      }
      delay++;
    }
    stats[num].currentDelay = found ? delay : sortedDraws.length;
  }

  // Calculate max historical delay and total frequency
  for (let num = 1; num <= 90; num++) {
    let currentStreak = 0;
    let maxStreak = 0;
    let totalFreq = 0;

    // Iterate chronological (oldest to newest)
    for (let i = sortedDraws.length - 1; i >= 0; i--) {
      if (sortedDraws[i].numbers.includes(num)) {
        totalFreq++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
        currentStreak = 0;
      } else {
        currentStreak++;
      }
    }
    if (currentStreak > maxStreak) {
      maxStreak = currentStreak;
    }

    stats[num].totalFrequency = totalFreq;
    // Cap at minimum 1 to prevent division by 0
    stats[num].maxHistoricalDelay = Math.max(maxStreak, stats[num].currentDelay, 1);
    stats[num].normalizedDelay = Math.min(
      stats[num].currentDelay / stats[num].maxHistoricalDelay,
      1.0
    );
  }

  // Calculate frequency in last K cycles
  const recentKDraws = sortedDraws.slice(0, kCycles);
  for (const draw of recentKDraws) {
    for (const num of draw.numbers) {
      stats[num].frequencyK++;
    }
  }

  // Affinity calculation based on the latest draw's numbers (Numeri Spia / Simpatia)
  const latestDraw = sortedDraws[0];
  if (latestDraw && sortedDraws.length > 1) {
    const latestNumbers = new Set(latestDraw.numbers);
    const coOccurrenceCounts: Record<number, number> = {};
    for (let n = 1; n <= 90; n++) coOccurrenceCounts[n] = 0;

    // Check co-occurrence in history whenever one of latest numbers was drawn
    for (let i = 0; i < sortedDraws.length; i++) {
      const drawNums = sortedDraws[i].numbers;
      let matchesWithLatest = 0;
      for (const num of drawNums) {
        if (latestNumbers.has(num)) matchesWithLatest++;
      }

      if (matchesWithLatest > 0) {
        for (const num of drawNums) {
          if (!latestNumbers.has(num)) {
            coOccurrenceCounts[num] += matchesWithLatest;
          }
        }
      }
    }

    // Find max affinity count
    let maxAffinity = 1;
    for (let n = 1; n <= 90; n++) {
      if (coOccurrenceCounts[n] > maxAffinity) {
        maxAffinity = coOccurrenceCounts[n];
      }
    }

    for (let n = 1; n <= 90; n++) {
      stats[n].affinityScore = coOccurrenceCounts[n] / maxAffinity;
    }
  }

  return stats;
}

/**
 * Score all numbers using S(x) = w1*Rit(x) + w2*Freq(x) + w3*Aff(x)
 */
export function scoreAllNumbers(
  stats: Record<number, NumberStat>,
  weights: ScoringWeights,
  kCycles = 36
): NumberStat[] {
  // Max observed K frequency for normalization
  let maxFreqK = 1;
  for (let n = 1; n <= 90; n++) {
    if (stats[n].frequencyK > maxFreqK) {
      maxFreqK = stats[n].frequencyK;
    }
  }

  const scoredList: NumberStat[] = [];

  for (let n = 1; n <= 90; n++) {
    const s = stats[n];
    const normFreq = s.frequencyK / maxFreqK;
    const normDelay = s.normalizedDelay;
    const normAff = s.affinityScore;

    const composite =
      weights.wDelay * normDelay +
      weights.wFrequency * normFreq +
      weights.wAffinity * normAff;

    s.compositeScore = Number(composite.toFixed(4));
    scoredList.push({ ...s });
  }

  // Sort descending by composite score
  scoredList.sort((a, b) => b.compositeScore - a.compositeScore);
  return scoredList;
}

/**
 * Full Pipeline: Generates the optimized SuperEnalotto system
 */
export function generateOptimizedSystem(
  poolNumbers: number[],
  filters: FilterOptions,
  targetColumnsCount: number,
  superstarPool?: number[]
): SystemGenerationResult {
  const startTime = performance.now();
  const sortedPool = [...poolNumbers].sort((a, b) => a - b);

  // 1. Generate all C(v, 6)
  const allCombos = generateCombinations(sortedPool, 6);

  // 2. Filter combinations
  let filtered = applyStatisticalFilters(allCombos, filters);

  // Fallback: If filters were so restrictive that fewer than targetColumnsCount survived,
  // gracefully relax filters so user always gets the required columns
  if (filtered.length < targetColumnsCount) {
    filtered = applyStatisticalFilters(allCombos, {
      ...filters,
      consecutive: false,
      decades: false
    });
    if (filtered.length < targetColumnsCount) {
      filtered = allCombos;
    }
  }

  // 3. Greedy Covering Design
  const selectedCombos = greedyCoveringReduction(filtered, sortedPool, targetColumnsCount);

  // 4. Form columns with metrics and SuperStar if requested
  const generatedColumns: GeneratedColumn[] = selectedCombos.map((numbers, idx) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    let evens = 0;
    let lows = 0;
    let sum = 0;
    for (const n of sorted) {
      if (n % 2 === 0) evens++;
      if (n <= 45) lows++;
      sum += n;
    }

    let starNumber: number | undefined = undefined;
    if (superstarPool && superstarPool.length > 0) {
      starNumber = superstarPool[idx % superstarPool.length];
    }

    return {
      id: idx + 1,
      numbers: sorted,
      superstar: starNumber,
      sum,
      evens,
      odds: 6 - evens,
      lows,
      highs: 6 - lows
    };
  });

  const coverageMetrics = computeCoverageMetrics(
    generatedColumns.map((c) => c.numbers),
    sortedPool
  );

  const endTime = performance.now();

  return {
    poolNumbers: sortedPool,
    columns: generatedColumns,
    totalCombinations: allCombos.length,
    filteredCombinationsCount: filtered.length,
    executionTimeMs: Math.round(endTime - startTime),
    coverageMetrics
  };
}

/**
 * Evaluate winnings of played columns against a winning draw
 */
export function evaluatePlayedSystem(
  columns: GeneratedColumn[],
  winningDraw: Draw,
  customCost?: number
): PlayResult {
  const winningSet = new Set(winningDraw.numbers);
  const jolly = winningDraw.jolly;
  const superstar = winningDraw.superstar;

  const matchesPerColumn: ColumnMatchResult[] = [];
  let totalWinning = 0;
  let bestMatch = 0;

  for (const col of columns) {
    const matchedNumbers: number[] = [];
    let matchCount = 0;
    for (const num of col.numbers) {
      if (winningSet.has(num)) {
        matchedNumbers.push(num);
        matchCount++;
      }
    }

    const hasJolly = col.numbers.includes(jolly);
    const hasSuperstar =
      superstar !== undefined &&
      col.superstar !== undefined &&
      col.superstar === superstar;

    if (matchCount > bestMatch) {
      bestMatch = matchCount;
    }

    // Determine prize tier and payout (approximate historical median values in €)
    let prizeTier = 'Nessun Punto';
    let estimatedPrize = 0;

    if (matchCount === 6) {
      prizeTier = hasSuperstar ? '6 + SuperStar (Jackpot Super)' : '6 (Jackpot)';
      estimatedPrize = 50000000; // Symbolic jackpot
    } else if (matchCount === 5 && hasJolly) {
      prizeTier = hasSuperstar ? '5+1 + SuperStar' : '5+1';
      estimatedPrize = hasSuperstar ? 1350000 : 350000;
    } else if (matchCount === 5) {
      prizeTier = hasSuperstar ? '5 Stella' : '5 Punti';
      estimatedPrize = hasSuperstar ? 1032000 : 32000;
    } else if (matchCount === 4) {
      prizeTier = hasSuperstar ? '4 Stella' : '4 Punti';
      estimatedPrize = hasSuperstar ? 7800 : 300;
    } else if (matchCount === 3) {
      prizeTier = hasSuperstar ? '3 Stella' : '3 Punti';
      estimatedPrize = hasSuperstar ? 2500 : 25;
    } else if (matchCount === 2) {
      prizeTier = hasSuperstar ? '2 Stella' : '2 Punti';
      estimatedPrize = hasSuperstar ? 105 : 5;
    } else if (hasSuperstar) {
      if (matchCount === 1) {
        prizeTier = '1 Stella';
        estimatedPrize = 10;
      } else {
        prizeTier = '0 Stella';
        estimatedPrize = 5;
      }
    }

    totalWinning += estimatedPrize;

    matchesPerColumn.push({
      columnId: col.id,
      numbers: col.numbers,
      matchedNumbers,
      matchCount,
      hasJolly,
      hasSuperstar,
      superstarPlayed: col.superstar,
      prizeTier,
      estimatedPrize
    });
  }

  // System cost: use customCost if provided, else 1.50€ per column with SuperStar or 1.00€ per pure column
  const hasSuperstarCols = columns.some((c) => c.superstar !== undefined);
  const cost =
    customCost !== undefined
      ? customCost
      : Number((columns.length * (hasSuperstarCols ? 1.5 : 1.0)).toFixed(2));
  const netReturn = Number((totalWinning - cost).toFixed(2));

  return {
    matchesPerColumn,
    totalWinning: Number(totalWinning.toFixed(2)),
    netReturn,
    bestMatch,
    hasWin: totalWinning > 0,
    verifiedAt: new Date().toISOString()
  };
}

export const MAX_REDUCED_SYSTEM_BUDGET = 100;
export const MIN_REDUCED_SYSTEM_BUDGET = 1;
export const PRESET_SYSTEM_BUDGETS = [10, 15, 20] as const;

export interface BudgetSystemAllocation {
  requestedBudget: number;
  clampedBudget: number;
  isCappedAtMax: boolean;
  unitCost: number;
  targetColumnsCount: number;
  actualCost: number;
  savedAmount: number;
}

/**
 * Calculates the reduced system columns count, actual play cost, and piggybank remainder
 * for a given budget (10€, 15€, 20€, or custom free budget capped at 100€).
 */
export function calculateBudgetSystemAllocation(
  budgetEuro: number,
  playMode: PlayMode = 'pure_coverage'
): BudgetSystemAllocation {
  const parsed = Number(budgetEuro);
  const raw = Number.isFinite(parsed) ? parsed : 10;
  const minBudget = playMode === 'superstar' ? 1.5 : MIN_REDUCED_SYSTEM_BUDGET;
  const isCappedAtMax = raw > MAX_REDUCED_SYSTEM_BUDGET;
  const clampedBudget = Number(
    Math.min(MAX_REDUCED_SYSTEM_BUDGET, Math.max(minBudget, raw)).toFixed(2)
  );
  const unitCost = playMode === 'superstar' ? 1.5 : 1.0;
  const targetColumnsCount = Math.max(1, Math.floor((clampedBudget + 1e-9) / unitCost));
  const actualCost = Number((targetColumnsCount * unitCost).toFixed(2));
  const savedAmount = Number(Math.max(0, clampedBudget - actualCost).toFixed(2));

  return {
    requestedBudget: raw,
    clampedBudget,
    isCappedAtMax,
    unitCost,
    targetColumnsCount,
    actualCost,
    savedAmount
  };
}

/**
 * Validates and builds a single GeneratedColumn from 6 distinct numbers in [1..90]
 */
export function buildGeneratedColumn(
  id: number,
  rawNumbers: number[],
  superstar?: number
): GeneratedColumn | null {
  const uniqueValid: number[] = [];
  for (const n of rawNumbers) {
    const intVal = Math.round(Number(n));
    if (Number.isFinite(intVal) && intVal >= 1 && intVal <= 90 && !uniqueValid.includes(intVal)) {
      uniqueValid.push(intVal);
    }
  }

  if (uniqueValid.length !== 6) {
    return null;
  }

  const sorted = [...uniqueValid].sort((a, b) => a - b);
  let evens = 0;
  let lows = 0;
  let sum = 0;
  for (const num of sorted) {
    if (num % 2 === 0) evens++;
    if (num <= 45) lows++;
    sum += num;
  }

  let validSuperstar: number | undefined = undefined;
  if (superstar !== undefined && superstar !== null && !Number.isNaN(Number(superstar))) {
    const sVal = Math.round(Number(superstar));
    if (sVal >= 1 && sVal <= 90) {
      validSuperstar = sVal;
    }
  }

  return {
    id,
    numbers: sorted,
    superstar: validSuperstar,
    sum,
    evens,
    odds: 6 - evens,
    lows,
    highs: 6 - lows
  };
}

/**
 * Parses multi-line manual sestine text into GeneratedColumn[]
 * Each line can contain 6 numbers (1..90) and optionally a 7th number or "*N" / "stella N" as SuperStar.
 */
export function parseManualSestineText(rawText: string): GeneratedColumn[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const columns: GeneratedColumn[] = [];

  for (const line of lines) {
    // Check explicit superstar marker like *45, ★45, SS:45, stella 45
    let explicitStar: number | undefined;
    let cleanedLine = line;
    const starMatch = cleanedLine.match(/(?:★|\*|superstar|stella|ss)\s*[:=]?\s*(\d{1,2})\b/i);
    if (starMatch) {
      const parsedStar = parseInt(starMatch[1], 10);
      if (parsedStar >= 1 && parsedStar <= 90) {
        explicitStar = parsedStar;
      }
      cleanedLine = cleanedLine.replace(starMatch[0], ' ');
    }

    const tokens = cleanedLine.match(/\b([1-8]?[0-9]|90)\b/g);
    if (!tokens) continue;

    const nums: number[] = [];
    let extraStar: number | undefined = explicitStar;
    for (const tok of tokens) {
      const val = parseInt(tok, 10);
      if (val >= 1 && val <= 90) {
        if (nums.length < 6 && !nums.includes(val)) {
          nums.push(val);
        } else if (nums.length === 6 && extraStar === undefined) {
          extraStar = val;
        }
      }
    }

    if (nums.length === 6) {
      const col = buildGeneratedColumn(columns.length + 1, nums, extraStar);
      if (col) {
        columns.push(col);
      }
    }
  }

  return columns;
}

/**
 * Creates a SavedPlay object from manual user entry (sestine, cost, optional winning)
 */
export function createManualSavedPlay(params: {
  id?: string;
  targetContestId: string;
  columns: GeneratedColumn[];
  cost: number;
  winningAmount?: number;
  savedAmount?: number;
  status?: 'IN_ATTESA' | 'VERIFICATA';
  manualNote?: string;
  createdAt?: string;
}): SavedPlay {
  const normalizedColumns = params.columns.map((c, idx) => ({
    ...c,
    id: idx + 1,
    numbers: [...c.numbers].sort((a, b) => a - b)
  }));

  const poolSet = new Set<number>();
  for (const col of normalizedColumns) {
    for (const n of col.numbers) {
      poolSet.add(n);
    }
  }
  const poolNumbers = Array.from(poolSet).sort((a, b) => a - b);

  const safeCost = Math.max(0, Number((Number(params.cost) || 0).toFixed(2)));
  const safeSaved = Math.max(0, Number((Number(params.savedAmount) || 0).toFixed(2)));
  const safeWin = Math.max(0, Number((Number(params.winningAmount) || 0).toFixed(2)));

  const effectiveStatus: 'IN_ATTESA' | 'VERIFICATA' =
    params.status === 'VERIFICATA' || safeWin > 0 ? 'VERIFICATA' : 'IN_ATTESA';

  let result: PlayResult | undefined = undefined;
  if (effectiveStatus === 'VERIFICATA') {
    const matchesPerColumn: ColumnMatchResult[] = normalizedColumns.map((col, idx) => ({
      columnId: col.id,
      numbers: col.numbers,
      matchedNumbers: [],
      matchCount: 0,
      hasJolly: false,
      hasSuperstar: false,
      superstarPlayed: col.superstar,
      prizeTier: idx === 0 && safeWin > 0 ? 'Vincita Manuale' : 'Esito Manuale',
      estimatedPrize: idx === 0 ? safeWin : 0
    }));

    result = {
      matchesPerColumn,
      totalWinning: safeWin,
      netReturn: Number((safeWin - safeCost).toFixed(2)),
      bestMatch: 0,
      hasWin: safeWin > 0,
      verifiedAt: params.createdAt || new Date().toISOString(),
      isManualWinning: true
    };
  }

  return {
    id: params.id || `play-manual-${Date.now()}`,
    createdAt: params.createdAt || new Date().toISOString(),
    targetContestId: (params.targetContestId || '').trim() || `${new Date().getFullYear()}-001`,
    mode: 'manual',
    cost: safeCost,
    savedAmount: safeSaved,
    poolNumbers,
    columns: normalizedColumns,
    status: effectiveStatus,
    result,
    manualNote: params.manualNote?.trim() || undefined
  };
}

/**
 * Updates an existing SavedPlay with a manually edited cost and/or winning amount
 */
export function applyManualCostAndWinning(
  play: SavedPlay,
  newCost: number,
  manualWinning: number,
  markVerified = true
): SavedPlay {
  const safeCost = Math.max(0, Number((Number(newCost) || 0).toFixed(2)));
  const safeWin = Math.max(0, Number((Number(manualWinning) || 0).toFixed(2)));

  if (!markVerified && safeWin === 0) {
    return {
      ...play,
      cost: safeCost,
      status: 'IN_ATTESA',
      result: undefined
    };
  }

  const existingMatches: ColumnMatchResult[] =
    play.result && play.result.matchesPerColumn.length === play.columns.length
      ? play.result.matchesPerColumn.map((m, idx) => ({
          ...m,
          prizeTier:
            safeWin !== play.result?.totalWinning && idx === 0
              ? safeWin > 0
                ? 'Vincita Manuale'
                : 'Nessun Punto'
              : m.prizeTier,
          estimatedPrize:
            safeWin !== play.result?.totalWinning ? (idx === 0 ? safeWin : 0) : m.estimatedPrize
        }))
      : play.columns.map((col, idx) => ({
          columnId: col.id,
          numbers: col.numbers,
          matchedNumbers: [],
          matchCount: 0,
          hasJolly: false,
          hasSuperstar: false,
          superstarPlayed: col.superstar,
          prizeTier: idx === 0 && safeWin > 0 ? 'Vincita Manuale' : 'Esito Manuale',
          estimatedPrize: idx === 0 ? safeWin : 0
        }));

  return {
    ...play,
    cost: safeCost,
    status: 'VERIFICATA',
    result: {
      matchesPerColumn: existingMatches,
      totalWinning: safeWin,
      netReturn: Number((safeWin - safeCost).toFixed(2)),
      bestMatch: play.result?.bestMatch || 0,
      hasWin: safeWin > 0,
      verifiedAt: new Date().toISOString(),
      isManualWinning: true
    }
  };
}

/**
 * Smart Text Parser for lottery extractions
 * Parses pasted text from lottery portals (Sisal, Giochi24, televideo, etc.)
 */
export function parseExtractionText(rawText: string): Partial<Draw> | null {
  if (!rawText || rawText.trim().length === 0) return null;

  const cleanText = rawText.replace(/\r/g, ' ');

  // Extract date: dd/mm/yyyy or yyyy-mm-dd or dd-mm-yyyy
  let dateStr = '';
  const dateMatch = cleanText.match(/\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})\b/);
  if (dateMatch) {
    const d = dateMatch[1].padStart(2, '0');
    const m = dateMatch[2].padStart(2, '0');
    const y = dateMatch[3];
    dateStr = `${y}-${m}-${d}`;
  } else {
    // Check yyyy-mm-dd
    const isoMatch = cleanText.match(/\b(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})\b/);
    if (isoMatch) {
      dateStr = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
  }

  // Extract contest number (e.g. "concorso n. 45", "concorso 45/26", "estrazione 45")
  let contestNumber = 0;
  const contestMatch = cleanText.match(/(?:concorso|estrazione|conc\.|n\.)\s*(?:n\.?)?\s*(\d{1,4})/i);
  if (contestMatch) {
    contestNumber = parseInt(contestMatch[1], 10);
  }

  // Extract Jolly number
  let jolly: number | undefined;
  const jollyMatch = cleanText.match(/(?:jolly|numero\s+jolly)[\s:=]+(\d{1,2})/i);
  if (jollyMatch) {
    jolly = parseInt(jollyMatch[1], 10);
  }

  // Extract SuperStar number
  let superstar: number | undefined;
  const superstarMatch = cleanText.match(/(?:superstar|super\s*star|stella)[\s:=]+(\d{1,2})/i);
  if (superstarMatch) {
    superstar = parseInt(superstarMatch[1], 10);
  }

  // Extract numbers: look for all integer tokens between 1 and 90
  // Strip out dates, contest match, Jolly and SuperStar so they don't get misidentified
  let textForNumbers = cleanText;
  if (dateMatch) {
    textForNumbers = textForNumbers.replace(dateMatch[0], ' ');
  }
  if (contestMatch) {
    textForNumbers = textForNumbers.replace(contestMatch[0], ' ');
  }
  if (jollyMatch) {
    textForNumbers = textForNumbers.replace(jollyMatch[0], ' ');
  }
  if (superstarMatch) {
    textForNumbers = textForNumbers.replace(superstarMatch[0], ' ');
  }

  // If there's a colon followed by numbers (e.g. "Estrazione: 1, 2, 3..."), prioritize the part around or after it
  const numberMatches = textForNumbers.match(/\b([1-8]?[0-9]|90)\b/g);
  if (!numberMatches) return null;

  const validNumbers: number[] = [];
  for (const tok of numberMatches) {
    const val = parseInt(tok, 10);
    // Ignore year in number list (e.g. 2026) and contest number if matched
    if (val >= 1 && val <= 90 && !validNumbers.includes(val)) {
      validNumbers.push(val);
    }
  }

  if (validNumbers.length < 6) return null;

  const sixNumbers = validNumbers.slice(0, 6).sort((a, b) => a - b) as [
    number,
    number,
    number,
    number,
    number,
    number
  ];

  // If Jolly wasn't found via keyword but we have extra numbers:
  if (jolly === undefined && validNumbers.length >= 7) {
    jolly = validNumbers[6];
  }
  if (superstar === undefined && validNumbers.length >= 8) {
    superstar = validNumbers[7];
  }

  const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : new Date().getFullYear();
  const cNum = contestNumber || 1;
  const id = `${year}-${String(cNum).padStart(3, '0')}`;

  return {
    id,
    contestNumber: cNum,
    year,
    date: dateStr || new Date().toISOString().split('T')[0],
    numbers: sixNumbers,
    jolly: jolly ?? 1,
    superstar: superstar
  };
}
