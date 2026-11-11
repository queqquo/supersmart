/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Draw,
  GeneratedColumn,
  SimulationMethodology,
  SingleSestinaPnL,
  WeeklySestinePnLSummary,
  HundredDrawsSimulationResult,
  ScoringWeights,
  FilterOptions,
  CoverageTarget,
  WalkForwardWeightVector,
  SmartPoolRecommendationResult,
  HistoricalContestWinEntry,
  HistoricalRealBacktestResult
} from '../types/lottery';
import {
  generateCombinations,
  checkEvenOdd,
  checkHighLow,
  checkSumRange,
  checkConsecutiveAndDecades,
  checkCadences,
  calculateNumberStatistics
} from './combinatorics';

export const MIN_SIMULATION_DRAWS = 100;
export const MAX_SIMULATION_DRAWS = 250000;
export const MAX_LOGGED_SIMULATED_DRAWS = 500;
export const PRESET_SIMULATION_COUNTS = [100, 1000, 10000, 50000, 100000, 250000] as const;

export function clampSimulationDrawsCount(count: number): number {
  if (!Number.isFinite(count) || Number.isNaN(count)) {
    return MIN_SIMULATION_DRAWS;
  }
  return Math.min(MAX_SIMULATION_DRAWS, Math.max(MIN_SIMULATION_DRAWS, Math.round(count)));
}

/**
 * Seedable PRNG (Mulberry32) for reproducible or stochastic physical urn simulations
 */
export function createPRNG(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute dynamic "Anti-Crowd" payout multiplier in [0.75, 1.65] from a compactDraws buffer at offset.
 * Analyzes the 6 drawn numbers at compactDraws[offset .. offset + 5]:
 * - Counts numbers > 31 (outside birthday dates 1..31)
 * - Counts distinct decades (Math.min(Math.floor(n / 10), 9)) and distinct cadences (n % 10)
 * - Checks if 3+ numbers are concentrated in the same decade or if there are consecutive pairs/triplets
 * Returns a continuous multiplier between 0.75 (crowded draw -> lower payouts) and 1.65 (dispersed anti-crowd draw -> higher payouts).
 */
export function computeAntiCrowdMultiplier(compactDraws: Uint8Array, offset: number): number {
  let highBeyond31 = 0;
  let distinctDecades = 0;
  let distinctCadences = 0;
  let maxInSameDecade = 0;
  let maxInSameCadence = 0;
  let consecutivePairs = 0;
  let consecutiveRun = 1;
  let maxConsecutiveRun = 1;

  // Bitmasks and tiny counters on stack/register variables
  const decadeCounts = new Uint8Array(10);
  const cadenceCounts = new Uint8Array(10);

  let prev = 0;
  for (let k = 0; k < 6; k++) {
    const n = compactDraws[offset + k];
    if (n > 31) {
      highBeyond31++;
    }
    const dec = n >= 90 ? 9 : (n / 10) | 0;
    const cad = n % 10;

    if (decadeCounts[dec] === 0) distinctDecades++;
    decadeCounts[dec]++;
    if (decadeCounts[dec] > maxInSameDecade) maxInSameDecade = decadeCounts[dec];

    if (cadenceCounts[cad] === 0) distinctCadences++;
    cadenceCounts[cad]++;
    if (cadenceCounts[cad] > maxInSameCadence) maxInSameCadence = cadenceCounts[cad];

    if (k > 0) {
      if (n === prev + 1) {
        consecutivePairs++;
        consecutiveRun++;
        if (consecutiveRun > maxConsecutiveRun) maxConsecutiveRun = consecutiveRun;
      } else {
        consecutiveRun = 1;
      }
    }
    prev = n;
  }

  let mult = 0.85;
  // Reward numbers outside birthday range (1-31)
  mult += highBeyond31 * 0.08;
  // Reward dispersion across distinct decades and cadences
  if (distinctDecades > 3) {
    mult += (distinctDecades - 3) * 0.06;
  }
  if (distinctCadences > 3) {
    mult += (distinctCadences - 3) * 0.05;
  }

  // Penalize concentration in 1-2 decades or 3+ numbers in same decade/cadence
  if (maxInSameDecade >= 3) {
    mult -= (maxInSameDecade - 2) * 0.12;
  }
  if (distinctDecades <= 2) {
    mult -= 0.12;
  }
  if (maxInSameCadence >= 3) {
    mult -= (maxInSameCadence - 2) * 0.08;
  }

  // Penalize consecutive pairs and triplets (heavily played by the crowd)
  if (consecutivePairs > 0) {
    mult -= consecutivePairs * 0.08;
  }
  if (maxConsecutiveRun >= 3) {
    mult -= 0.10;
  }
  if (highBeyond31 <= 1) {
    mult -= 0.08;
  }

  if (mult < 0.75) return 0.75;
  if (mult > 1.65) return 1.65;
  return Math.round(mult * 1000) / 1000;
}

/**
 * Convenience wrapper to compute the Anti-Crowd multiplier from a standard 6-number array
 */
export function computeAntiCrowdMultiplierFromNumbers(numbers: number[]): number {
  const buf = new Uint8Array(6);
  const sorted = [...numbers].slice(0, 6).sort((a, b) => a - b);
  for (let i = 0; i < 6; i++) {
    buf[i] = sorted[i] || 1;
  }
  return computeAntiCrowdMultiplier(buf, 0);
}

/**
 * Compute official SuperEnalotto payout given matchCount, hasJolly, hasSuperstar,
 * modulated for categories 2, 3, 4, and 5 by the Anti-Crowd multiplier (default 1.0).
 */
export function computeOfficialPrize(
  matchCount: number,
  hasJolly: boolean,
  hasSuperstar: boolean,
  antiCrowdMultiplier: number = 1.0
): number {
  const m = antiCrowdMultiplier;
  if (matchCount === 6) {
    return hasSuperstar ? 2500000 : 1500000;
  } else if (matchCount === 5 && hasJolly) {
    return hasSuperstar ? 650000 : 350000;
  } else if (matchCount === 5) {
    const base = hasSuperstar ? 100000 : 32000;
    return m === 1.0 ? base : Math.round(base * m * 100) / 100;
  } else if (matchCount === 4) {
    const base = hasSuperstar ? 30000 : 300;
    return m === 1.0 ? base : Math.round(base * m * 100) / 100;
  } else if (matchCount === 3) {
    const base = hasSuperstar ? 2500 : 25;
    return m === 1.0 ? base : Math.round(base * m * 100) / 100;
  } else if (matchCount === 2) {
    const base = hasSuperstar ? 100 : 5;
    return m === 1.0 ? base : Math.round(base * m * 100) / 100;
  } else if (hasSuperstar) {
    return matchCount === 1 ? 10 : 5;
  }
  return 0;
}

/**
 * Evaluate prize and hit tier of a single column against a single draw
 */
export function evaluateSingleColumnOnDraw(
  col: GeneratedColumn,
  draw: Draw,
  useAntiCrowd: boolean = false
): {
  matchCount: number;
  hasJolly: boolean;
  hasSuperstar: boolean;
  antiCrowdMultiplier: number;
  prize: number;
} {
  const d0 = draw.numbers[0];
  const d1 = draw.numbers[1];
  const d2 = draw.numbers[2];
  const d3 = draw.numbers[3];
  const d4 = draw.numbers[4];
  const d5 = draw.numbers[5];

  let matchCount = 0;
  let hasJolly = false;
  const jolly = draw.jolly;

  for (let i = 0; i < col.numbers.length; i++) {
    const n = col.numbers[i];
    if (n === d0 || n === d1 || n === d2 || n === d3 || n === d4 || n === d5) {
      matchCount++;
    }
    if (n === jolly) {
      hasJolly = true;
    }
  }

  const hasSuperstar =
    col.superstar !== undefined &&
    draw.superstar !== undefined &&
    col.superstar === draw.superstar;

  const antiCrowdMultiplier = useAntiCrowd
    ? computeAntiCrowdMultiplierFromNumbers(draw.numbers)
    : 1.0;
  const prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar, antiCrowdMultiplier);

  return {
    matchCount,
    hasJolly,
    hasSuperstar,
    antiCrowdMultiplier,
    prize
  };
}

/**
 * Calculate expected gains and losses for a single sestina across a set of draws
 */
export function evaluateSingleSestinaPnL(
  column: GeneratedColumn,
  drawsToEvaluate: Draw[],
  useAntiCrowd: boolean = false
): SingleSestinaPnL {
  const costPerDraw = column.superstar !== undefined ? 1.5 : 1.0;
  const totalDrawsEvaluated = drawsToEvaluate.length;
  const totalCost = Number((costPerDraw * totalDrawsEvaluated).toFixed(2));

  let totalGrossGain = 0;
  let totalGrossLoss = 0;

  const hitsBreakdown = {
    points0or1: 0,
    points2: 0,
    points3: 0,
    points4: 0,
    points5: 0,
    points5plus1: 0,
    points6: 0,
    superstarHits: 0
  };

  const mask = new Uint8Array(91);
  for (let i = 0; i < column.numbers.length; i++) {
    const num = column.numbers[i];
    if (num >= 1 && num <= 90) mask[num] = 1;
  }
  const colSuperstar = column.superstar ?? -1;

  for (let i = 0; i < totalDrawsEvaluated; i++) {
    const draw = drawsToEvaluate[i];
    const nums = draw.numbers;
    const matchCount =
      mask[nums[0]] +
      mask[nums[1]] +
      mask[nums[2]] +
      mask[nums[3]] +
      mask[nums[4]] +
      mask[nums[5]];
    const hasJolly = mask[draw.jolly] === 1;
    const hasSuperstar = colSuperstar > 0 && draw.superstar === colSuperstar;

    const mult = useAntiCrowd ? computeAntiCrowdMultiplierFromNumbers(nums) : 1.0;
    const prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar, mult);

    totalGrossGain += prize;
    const drawLoss = costPerDraw > prize ? costPerDraw - prize : 0;
    totalGrossLoss += drawLoss;

    if (hasSuperstar) {
      hitsBreakdown.superstarHits++;
    }

    if (matchCount === 6) {
      hitsBreakdown.points6++;
    } else if (matchCount === 5 && hasJolly) {
      hitsBreakdown.points5plus1++;
    } else if (matchCount === 5) {
      hitsBreakdown.points5++;
    } else if (matchCount === 4) {
      hitsBreakdown.points4++;
    } else if (matchCount === 3) {
      hitsBreakdown.points3++;
    } else if (matchCount === 2) {
      hitsBreakdown.points2++;
    } else {
      hitsBreakdown.points0or1++;
    }
  }

  const totalNetProfitLoss = Number((totalGrossGain - totalCost).toFixed(2));
  const denom = Math.max(totalDrawsEvaluated, 1);

  return {
    columnId: column.id,
    numbers: column.numbers,
    superstar: column.superstar,
    costPerDraw,
    totalDrawsEvaluated,
    totalCost,
    totalGrossGain: Number(totalGrossGain.toFixed(2)),
    totalGrossLoss: Number(totalGrossLoss.toFixed(2)),
    totalNetProfitLoss,
    averageGainPerDraw: Number((totalGrossGain / denom).toFixed(4)),
    averageLossPerDraw: Number((totalGrossLoss / denom).toFixed(4)),
    averageNetPerDraw: Number((totalNetProfitLoss / denom).toFixed(4)),
    hitsBreakdown
  };
}

/**
 * Fast evaluation of a single column against compact simulated draws buffer (Uint8Array of length N * 8)
 * using the dynamic Anti-Crowd payout multiplier on every simulated draw.
 */
export function evaluateSingleSestinaPnLCompact(
  column: GeneratedColumn,
  compactDraws: Uint8Array,
  totalDrawsEvaluated: number,
  precomputedMultipliers?: Float32Array
): SingleSestinaPnL {
  const costPerDraw = column.superstar !== undefined ? 1.5 : 1.0;
  const totalCost = Number((costPerDraw * totalDrawsEvaluated).toFixed(2));

  let totalGrossGain = 0;
  let totalGrossLoss = 0;

  const hitsBreakdown = {
    points0or1: 0,
    points2: 0,
    points3: 0,
    points4: 0,
    points5: 0,
    points5plus1: 0,
    points6: 0,
    superstarHits: 0
  };

  const mask = new Uint8Array(91);
  for (let i = 0; i < column.numbers.length; i++) {
    const num = column.numbers[i];
    if (num >= 1 && num <= 90) mask[num] = 1;
  }
  const colSuperstar = column.superstar ?? -1;

  for (let i = 0; i < totalDrawsEvaluated; i++) {
    const offset = i * 8;
    const matchCount =
      mask[compactDraws[offset]] +
      mask[compactDraws[offset + 1]] +
      mask[compactDraws[offset + 2]] +
      mask[compactDraws[offset + 3]] +
      mask[compactDraws[offset + 4]] +
      mask[compactDraws[offset + 5]];
    const hasJolly = mask[compactDraws[offset + 6]] === 1;
    const hasSuperstar = colSuperstar > 0 && compactDraws[offset + 7] === colSuperstar;

    let prize = 0;
    if (matchCount >= 2 || hasSuperstar) {
      const antiCrowdMult = precomputedMultipliers
        ? precomputedMultipliers[i]
        : computeAntiCrowdMultiplier(compactDraws, offset);
      prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar, antiCrowdMult);
    }

    totalGrossGain += prize;
    const drawLoss = costPerDraw > prize ? costPerDraw - prize : 0;
    totalGrossLoss += drawLoss;

    if (hasSuperstar) {
      hitsBreakdown.superstarHits++;
    }

    if (matchCount === 6) {
      hitsBreakdown.points6++;
    } else if (matchCount === 5 && hasJolly) {
      hitsBreakdown.points5plus1++;
    } else if (matchCount === 5) {
      hitsBreakdown.points5++;
    } else if (matchCount === 4) {
      hitsBreakdown.points4++;
    } else if (matchCount === 3) {
      hitsBreakdown.points3++;
    } else if (matchCount === 2) {
      hitsBreakdown.points2++;
    } else {
      hitsBreakdown.points0or1++;
    }
  }

  const totalNetProfitLoss = Number((totalGrossGain - totalCost).toFixed(2));
  const denom = Math.max(totalDrawsEvaluated, 1);

  return {
    columnId: column.id,
    numbers: column.numbers,
    superstar: column.superstar,
    costPerDraw,
    totalDrawsEvaluated,
    totalCost,
    totalGrossGain: Number(totalGrossGain.toFixed(2)),
    totalGrossLoss: Number(totalGrossLoss.toFixed(2)),
    totalNetProfitLoss,
    averageGainPerDraw: Number((totalGrossGain / denom).toFixed(4)),
    averageLossPerDraw: Number((totalGrossLoss / denom).toFixed(4)),
    averageNetPerDraw: Number((totalNetProfitLoss / denom).toFixed(4)),
    hitsBreakdown
  };
}

/**
 * Summarize per-sestina PnL array into WeeklySestinePnLSummary
 */
function summarizePerSestinaResults(
  perSestinaResults: SingleSestinaPnL[],
  drawsCount: number
): WeeklySestinePnLSummary {
  if (perSestinaResults.length === 0) {
    return {
      sestineCount: 0,
      drawsCount,
      perSestinaResults: [],
      meanTotalGainPerSestina: 0,
      meanTotalLossPerSestina: 0,
      meanTotalCostPerSestina: 0,
      meanNetProfitLossPerSestina: 0,
      meanSingleDrawGainPerSestina: 0,
      meanSingleDrawLossPerSestina: 0,
      meanSingleDrawNetPerSestina: 0,
      bestPerformingColumnId: 1
    };
  }

  const count = perSestinaResults.length;
  let sumTotalGain = 0;
  let sumTotalLoss = 0;
  let sumTotalCost = 0;
  let sumNetProfitLoss = 0;
  let sumSingleDrawGain = 0;
  let sumSingleDrawLoss = 0;
  let sumSingleDrawNet = 0;

  let bestColId = perSestinaResults[0].columnId;
  let bestNet = perSestinaResults[0].totalNetProfitLoss;

  for (const res of perSestinaResults) {
    sumTotalGain += res.totalGrossGain;
    sumTotalLoss += res.totalGrossLoss;
    sumTotalCost += res.totalCost;
    sumNetProfitLoss += res.totalNetProfitLoss;
    sumSingleDrawGain += res.averageGainPerDraw;
    sumSingleDrawLoss += res.averageLossPerDraw;
    sumSingleDrawNet += res.averageNetPerDraw;

    if (res.totalNetProfitLoss > bestNet) {
      bestNet = res.totalNetProfitLoss;
      bestColId = res.columnId;
    }
  }

  return {
    sestineCount: count,
    drawsCount,
    perSestinaResults,
    meanTotalGainPerSestina: Number((sumTotalGain / count).toFixed(2)),
    meanTotalLossPerSestina: Number((sumTotalLoss / count).toFixed(2)),
    meanTotalCostPerSestina: Number((sumTotalCost / count).toFixed(2)),
    meanNetProfitLossPerSestina: Number((sumNetProfitLoss / count).toFixed(2)),
    meanSingleDrawGainPerSestina: Number((sumSingleDrawGain / count).toFixed(4)),
    meanSingleDrawLossPerSestina: Number((sumSingleDrawLoss / count).toFixed(4)),
    meanSingleDrawNetPerSestina: Number((sumSingleDrawNet / count).toFixed(4)),
    bestPerformingColumnId: bestColId
  };
}

/**
 * Calculate expected gains and losses for all weekly generated sestine.
 */
export function calculateWeeklySestineExpectedPnL(
  columns: GeneratedColumn[],
  simulatedDraws: Draw[],
  useAntiCrowd: boolean = false
): WeeklySestinePnLSummary {
  if (columns.length === 0) {
    return summarizePerSestinaResults([], simulatedDraws.length);
  }
  const perSestinaResults = columns.map((col) =>
    evaluateSingleSestinaPnL(col, simulatedDraws, useAntiCrowd)
  );
  return summarizePerSestinaResults(perSestinaResults, simulatedDraws.length);
}

/**
 * Derive optimal scoring weights (wDelay, wFrequency, wAffinity) that align with the simulated
 * Top 12 pool and High-Probability Sestina relative to the historical archive statistics.
 */
function deriveSimulationRecommendedWeights(
  historicalDraws: Draw[],
  top12Pool: number[],
  highProbNumbers: number[]
): ScoringWeights {
  if (historicalDraws.length === 0) {
    return { wDelay: 0.5, wFrequency: 0.35, wAffinity: 0.25 };
  }

  const statsMap = calculateNumberStatistics(historicalDraws, 36);
  let maxFreqK = 1;
  for (let n = 1; n <= 90; n++) {
    if (statsMap[n] && statsMap[n].frequencyK > maxFreqK) {
      maxFreqK = statsMap[n].frequencyK;
    }
  }

  let delaySignal = 0;
  let freqSignal = 0;
  let affSignal = 0;

  const hpSet = new Set(highProbNumbers);
  for (const num of top12Pool) {
    const st = statsMap[num];
    if (!st) continue;
    const boost = hpSet.has(num) ? 1.5 : 1.0;
    delaySignal += st.normalizedDelay * boost;
    freqSignal += (st.frequencyK / maxFreqK) * boost;
    affSignal += st.affinityScore * boost;
  }

  const dNorm = Math.max(delaySignal / Math.max(top12Pool.length, 1), 0.12);
  const fNorm = Math.max(freqSignal / Math.max(top12Pool.length, 1), 0.12);
  const aNorm = Math.max(affSignal / Math.max(top12Pool.length, 1), 0.12);

  const maxComponent = Math.max(dNorm, fNorm, aNorm, 0.001);
  const roundStep = (val: number) =>
    Number(Math.min(1.0, Math.max(0.1, Math.round((val * 0.85) / 0.05) * 0.05)).toFixed(2));

  return {
    wDelay: roundStep(dNorm / maxComponent),
    wFrequency: roundStep(fNorm / maxComponent),
    wAffinity: roundStep(aNorm / maxComponent)
  };
}

/**
 * Walk-Forward Optimization Engine for 10-15 Recommended Pool Numbers.
 * Analyzes real historicalDraws using a rolling Walk-Forward window (zero data leakage: uses only data up to t-1
 * to predict pool at contest t), tests multiple 5-factor weight vectors (wFreqHot, wFreqCold, wDelay, wCoOccurrence, wDecadeBalance),
 * selects the strategy that maximized real terni/quaterne hits in walk-forward validation, and extracts the
 * balanced 10-15 number pool for the next contest.
 */
export function generateSmartPoolRecommendation(
  historicalDraws: Draw[],
  poolSize: number = 12,
  walkForwardWindow: number = 40
): SmartPoolRecommendationResult {
  const startTime = performance.now();
  const clampedPoolSize = Math.min(15, Math.max(10, Math.round(poolSize || 12)));

  // Sort chronological (oldest -> newest) so index t-1 strictly precedes contest t
  const chronological = [...historicalDraws].sort((a, b) => a.date.localeCompare(b.date));
  const totalDraws = chronological.length;

  const candidateConfigs: Array<{
    id: string;
    label: string;
    wFreqHot: number;
    wFreqCold: number;
    wDelay: number;
    wCoOccurrence: number;
    wDecadeBalance: number;
  }> = [
    {
      id: 'wf-terni-balanced',
      label: 'Walk-Forward Ortogonale Terni (Hot + Ritardo + Spia)',
      wFreqHot: 0.42,
      wFreqCold: 0.12,
      wDelay: 0.55,
      wCoOccurrence: 0.38,
      wDecadeBalance: 0.35
    },
    {
      id: 'wf-delay-cooc',
      label: 'Spinta Ritardo & Co-Occorrenza Markoviana',
      wFreqHot: 0.25,
      wFreqCold: 0.20,
      wDelay: 0.72,
      wCoOccurrence: 0.50,
      wDecadeBalance: 0.30
    },
    {
      id: 'wf-hot-momentum',
      label: 'Momentum Frequenza Ciclica (K=36) & Affinità',
      wFreqHot: 0.75,
      wFreqCold: 0.05,
      wDelay: 0.32,
      wCoOccurrence: 0.45,
      wDecadeBalance: 0.40
    },
    {
      id: 'wf-contrarian-cold',
      label: 'Inversione Statistica (Freddi + Ritardo Storico)',
      wFreqHot: 0.10,
      wFreqCold: 0.68,
      wDelay: 0.65,
      wCoOccurrence: 0.30,
      wDecadeBalance: 0.35
    },
    {
      id: 'wf-anti-crowd-high',
      label: 'Anti-Massa Dispersione Decine & Cadenze',
      wFreqHot: 0.38,
      wFreqCold: 0.22,
      wDelay: 0.48,
      wCoOccurrence: 0.35,
      wDecadeBalance: 0.70
    },
    {
      id: 'wf-spia-affinity',
      label: 'Correlazione Numeri Spia & Coppie Storiche',
      wFreqHot: 0.35,
      wFreqCold: 0.15,
      wDelay: 0.40,
      wCoOccurrence: 0.80,
      wDecadeBalance: 0.30
    }
  ];

  // Helper to select a balanced pool of size V given raw ball scores, enforcing decade and cadence caps
  const maxPerDecadeAndCadence = clampedPoolSize <= 13 ? 2 : 3;
  function selectBalancedPoolFromScores(scores: Float64Array, targetV: number, wBalance: number): number[] {
    const order = Array.from({ length: 90 }, (_, i) => i + 1);
    order.sort((a, b) => scores[b] - scores[a]);

    const decCounts = new Uint8Array(10);
    const cadCounts = new Uint8Array(10);
    const selected: number[] = [];

    // First pass: strict balance cap (max 2 or 3 per decade and cadence) with dynamic dispersion penalty
    while (selected.length < targetV) {
      let bestBall = -1;
      let bestAdjustedScore = -Infinity;

      for (let i = 0; i < 90; i++) {
        const ball = order[i];
        if (selected.includes(ball)) continue;
        const dec = ball >= 90 ? 9 : (ball / 10) | 0;
        const cad = ball % 10;
        if (decCounts[dec] >= maxPerDecadeAndCadence || cadCounts[cad] >= maxPerDecadeAndCadence) {
          continue;
        }
        const dispersionPenalty = (decCounts[dec] * 0.18 + cadCounts[cad] * 0.15) * wBalance;
        const adj = scores[ball] - dispersionPenalty;
        if (adj > bestAdjustedScore) {
          bestAdjustedScore = adj;
          bestBall = ball;
        }
      }

      if (bestBall === -1) break;
      selected.push(bestBall);
      const dec = bestBall >= 90 ? 9 : (bestBall / 10) | 0;
      const cad = bestBall % 10;
      decCounts[dec]++;
      cadCounts[cad]++;
    }

    // Fallback if strict cap left fewer than targetV balls
    for (let i = 0; i < 90 && selected.length < targetV; i++) {
      const ball = order[i];
      if (!selected.includes(ball)) {
        selected.push(ball);
      }
    }

    return selected.sort((a, b) => a - b);
  }

  // Incremental running state from draw 0 up to t-1
  const totalFreq = new Int32Array(91);
  const lastSeenIdx = new Int32Array(91).fill(-1);
  const maxDelaySeen = new Int32Array(91).fill(15);
  const coMatrix = new Int32Array(91 * 91);
  const recentWindowSize = 36;
  const recentFreq = new Int32Array(91);

  const actualWindow = Math.min(walkForwardWindow, Math.max(1, totalDraws - 20));
  const wfStartIdx = Math.max(1, totalDraws - actualWindow);

  // Initialize state with draws [0 .. wfStartIdx - 1]
  for (let idx = 0; idx < wfStartIdx; idx++) {
    const nums = chronological[idx].numbers;
    for (let i = 0; i < 6; i++) {
      const a = nums[i];
      totalFreq[a]++;
      const gap = lastSeenIdx[a] >= 0 ? idx - lastSeenIdx[a] : idx + 1;
      if (gap > maxDelaySeen[a]) maxDelaySeen[a] = gap;
      lastSeenIdx[a] = idx;

      if (idx >= wfStartIdx - recentWindowSize) {
        recentFreq[a]++;
      }

      const aRow = a * 91;
      for (let j = i + 1; j < 6; j++) {
        const b = nums[j];
        coMatrix[aRow + b]++;
        coMatrix[b * 91 + a]++;
      }
    }
  }

  const evaluatedStrategies: WalkForwardWeightVector[] = candidateConfigs.map((cfg) => ({
    ...cfg,
    walkForwardDrawsEvaluated: 0,
    ambiHitCount: 0,
    terniHitCount: 0,
    quaterneHitCount: 0,
    cinquineHitCount: 0,
    compositeYieldScore: 0
  }));

  const ballScores = new Float64Array(91);
  const normHotArr = new Float64Array(91);
  const normColdArr = new Float64Array(91);
  const normDelayArr = new Float64Array(91);
  const normCoArr = new Float64Array(91);

  // Helper to compute normalized feature signals at step t using strictly [0 .. t-1]
  function computeSignalsAtStep(stepIdx: number, prevDrawNumbers: number[]) {
    let maxRecent = 1;
    let maxCo = 1;
    for (let n = 1; n <= 90; n++) {
      if (recentFreq[n] > maxRecent) maxRecent = recentFreq[n];
    }

    for (let n = 1; n <= 90; n++) {
      const hot = recentFreq[n] / maxRecent;
      normHotArr[n] = hot;
      normColdArr[n] = 1.0 - hot;

      const curDel = lastSeenIdx[n] >= 0 ? stepIdx - 1 - lastSeenIdx[n] : stepIdx;
      const maxDel = Math.max(maxDelaySeen[n], curDel, 1);
      normDelayArr[n] = Math.min(1.2, curDel / maxDel);

      const row = n * 91;
      let coSum = 0;
      for (let k = 0; k < prevDrawNumbers.length; k++) {
        coSum += coMatrix[row + prevDrawNumbers[k]];
      }
      normCoArr[n] = coSum;
      if (coSum > maxCo) maxCo = coSum;
    }

    for (let n = 1; n <= 90; n++) {
      normCoArr[n] = normCoArr[n] / maxCo;
    }
  }

  // Walk-Forward Loop over [wfStartIdx .. totalDraws - 1]
  for (let t = wfStartIdx; t < totalDraws; t++) {
    const prevDraw = chronological[t - 1];
    const targetDraw = chronological[t];
    computeSignalsAtStep(t, prevDraw.numbers);

    const targetMask = new Uint8Array(91);
    for (let k = 0; k < 6; k++) {
      targetMask[targetDraw.numbers[k]] = 1;
    }

    for (let sIdx = 0; sIdx < evaluatedStrategies.length; sIdx++) {
      const strat = evaluatedStrategies[sIdx];
      for (let n = 1; n <= 90; n++) {
        const highNumberBonus = n > 31 ? 0.08 * strat.wDecadeBalance : 0;
        ballScores[n] =
          strat.wFreqHot * normHotArr[n] +
          strat.wFreqCold * normColdArr[n] +
          strat.wDelay * normDelayArr[n] +
          strat.wCoOccurrence * normCoArr[n] +
          highNumberBonus;
      }

      const poolAtT = selectBalancedPoolFromScores(ballScores, clampedPoolSize, strat.wDecadeBalance);
      let hitsInPool = 0;
      for (let i = 0; i < poolAtT.length; i++) {
        if (targetMask[poolAtT[i]] === 1) {
          hitsInPool++;
        }
      }

      strat.walkForwardDrawsEvaluated++;
      if (hitsInPool >= 2) {
        const ambi = (hitsInPool * (hitsInPool - 1)) / 2;
        strat.ambiHitCount += ambi;
        strat.compositeYieldScore += ambi * 4;
      }
      if (hitsInPool >= 3) {
        const terni = (hitsInPool * (hitsInPool - 1) * (hitsInPool - 2)) / 6;
        strat.terniHitCount += terni;
        strat.compositeYieldScore += terni * 45;
      }
      if (hitsInPool >= 4) {
        const quaterne = (hitsInPool * (hitsInPool - 1) * (hitsInPool - 2) * (hitsInPool - 3)) / 24;
        strat.quaterneHitCount += quaterne;
        strat.compositeYieldScore += quaterne * 420;
      }
      if (hitsInPool >= 5) {
        strat.cinquineHitCount += 1;
        strat.compositeYieldScore += 5000;
      }
    }

    // Advance running statistics by incorporating contest t (and sliding the K=36 window)
    const oldOutIdx = t - recentWindowSize;
    if (oldOutIdx >= 0) {
      const oldNums = chronological[oldOutIdx].numbers;
      for (let k = 0; k < 6; k++) {
        if (recentFreq[oldNums[k]] > 0) recentFreq[oldNums[k]]--;
      }
    }

    const curNums = targetDraw.numbers;
    for (let i = 0; i < 6; i++) {
      const a = curNums[i];
      totalFreq[a]++;
      recentFreq[a]++;
      const gap = lastSeenIdx[a] >= 0 ? t - lastSeenIdx[a] : t + 1;
      if (gap > maxDelaySeen[a]) maxDelaySeen[a] = gap;
      lastSeenIdx[a] = t;

      const aRow = a * 91;
      for (let j = i + 1; j < 6; j++) {
        const b = curNums[j];
        coMatrix[aRow + b]++;
        coMatrix[b * 91 + a]++;
      }
    }
  }

  // Sort strategies by compositeYieldScore (and terniHitCount tie-breaker)
  evaluatedStrategies.sort((a, b) => {
    if (b.compositeYieldScore !== a.compositeYieldScore) {
      return b.compositeYieldScore - a.compositeYieldScore;
    }
    return b.terniHitCount - a.terniHitCount;
  });

  const bestStrategy = evaluatedStrategies[0];

  // Apply bestStrategy to the full archive up to the latest draw (totalDraws) for next contest prediction
  const latestDrawNums = totalDraws > 0 ? chronological[totalDraws - 1].numbers : [7, 18, 33, 52, 64, 88];
  computeSignalsAtStep(totalDraws, latestDrawNums);

  for (let n = 1; n <= 90; n++) {
    const highNumberBonus = n > 31 ? 0.08 * bestStrategy.wDecadeBalance : 0;
    ballScores[n] =
      bestStrategy.wFreqHot * normHotArr[n] +
      bestStrategy.wFreqCold * normColdArr[n] +
      bestStrategy.wDelay * normDelayArr[n] +
      bestStrategy.wCoOccurrence * normCoArr[n] +
      highNumberBonus;
  }

  const recommendedPool = selectBalancedPoolFromScores(
    ballScores,
    clampedPoolSize,
    bestStrategy.wDecadeBalance
  );

  const decadeDistribution: Record<number, number> = {};
  const cadenceDistribution: Record<number, number> = {};
  for (const num of recommendedPool) {
    const dec = num >= 90 ? 9 : (num / 10) | 0;
    const cad = num % 10;
    decadeDistribution[dec] = (decadeDistribution[dec] || 0) + 1;
    cadenceDistribution[cad] = (cadenceDistribution[cad] || 0) + 1;
  }

  const roundWeight = (w: number) =>
    Number(Math.min(1.0, Math.max(0.1, Math.round(w / 0.05) * 0.05)).toFixed(2));

  const mappedScoringWeights: ScoringWeights = {
    wDelay: roundWeight(bestStrategy.wDelay),
    wFrequency: roundWeight(Math.max(bestStrategy.wFreqHot, bestStrategy.wFreqCold * 0.85)),
    wAffinity: roundWeight(bestStrategy.wCoOccurrence)
  };

  const endTime = performance.now();

  return {
    poolSize: clampedPoolSize,
    recommendedPool,
    bestStrategy,
    evaluatedStrategies,
    walkForwardWindowSize: actualWindow,
    mappedScoringWeights,
    decadeDistribution,
    cadenceDistribution,
    executionTimeMs: Math.round(endTime - startTime)
  };
}

/**
 * Instant Real Historical Backtest:
 * Evaluates the generated system (e.g. 10 columns for 10€) against ALL real draws in historicalDraws,
 * applying each real contest's dynamic Anti-Crowd payout multiplier.
 */
export function runHistoricalRealBacktest(
  columns: GeneratedColumn[],
  historicalDraws: Draw[]
): HistoricalRealBacktestResult {
  const startTime = performance.now();
  const sestineCount = columns.length;
  const totalContestsEvaluated = historicalDraws.length;

  const hasSuperstarCols = columns.some((c) => c.superstar !== undefined);
  const costPerContest = Number((sestineCount * (hasSuperstarCols ? 1.5 : 1.0)).toFixed(2));
  const totalHistoricalCost = Number((costPerContest * totalContestsEvaluated).toFixed(2));

  if (sestineCount === 0 || totalContestsEvaluated === 0) {
    return {
      totalContestsEvaluated,
      sestineCount,
      costPerContest,
      totalHistoricalCost: 0,
      totalEstimatedGrossWinnings: 0,
      netHistoricalPnL: 0,
      historicalRoiPct: 0,
      averageAntiCrowdMultiplier: 1.0,
      totalWinningContests: 0,
      tierCounts: {
        points2: 0,
        points3: 0,
        points4: 0,
        points5: 0,
        points5plus1: 0,
        points6: 0,
        superstarHits: 0
      },
      winningContests: [],
      executionTimeMs: 0
    };
  }

  // Pre-build bitmasks for each played column for fast O(1) lookup across all 2,946+ draws
  const colMasks: Uint8Array[] = columns.map((col) => {
    const m = new Uint8Array(91);
    for (let i = 0; i < col.numbers.length; i++) {
      const n = col.numbers[i];
      if (n >= 1 && n <= 90) m[n] = 1;
    }
    return m;
  });

  let totalEstimatedGrossWinnings = 0;
  let sumAntiCrowd = 0;

  const tierCounts = {
    points2: 0,
    points3: 0,
    points4: 0,
    points5: 0,
    points5plus1: 0,
    points6: 0,
    superstarHits: 0
  };

  const winningContests: HistoricalContestWinEntry[] = [];
  const drawBuf = new Uint8Array(6);

  for (let dIdx = 0; dIdx < totalContestsEvaluated; dIdx++) {
    const draw = historicalDraws[dIdx];
    const dNums = draw.numbers;
    drawBuf[0] = dNums[0];
    drawBuf[1] = dNums[1];
    drawBuf[2] = dNums[2];
    drawBuf[3] = dNums[3];
    drawBuf[4] = dNums[4];
    drawBuf[5] = dNums[5];

    const antiCrowdMult = computeAntiCrowdMultiplier(drawBuf, 0);
    sumAntiCrowd += antiCrowdMult;

    let contestGrossPrize = 0;
    let winningColumnsCount = 0;
    let bestColumnId = columns[0].id;
    let bestMatchCount = 0;
    let bestMatchedNumbers: number[] = [];

    let p2 = 0;
    let p3 = 0;
    let p4 = 0;
    let p5 = 0;
    let p5plus1 = 0;
    let p6 = 0;
    let ssHits = 0;

    for (let cIdx = 0; cIdx < sestineCount; cIdx++) {
      const col = columns[cIdx];
      const mask = colMasks[cIdx];

      const matchCount =
        mask[dNums[0]] +
        mask[dNums[1]] +
        mask[dNums[2]] +
        mask[dNums[3]] +
        mask[dNums[4]] +
        mask[dNums[5]];
      const hasJolly = mask[draw.jolly] === 1;
      const hasSuperstar =
        col.superstar !== undefined &&
        draw.superstar !== undefined &&
        col.superstar === draw.superstar;

      if (hasSuperstar) {
        ssHits++;
        tierCounts.superstarHits++;
      }

      if (matchCount === 6) {
        p6++;
        tierCounts.points6++;
      } else if (matchCount === 5 && hasJolly) {
        p5plus1++;
        tierCounts.points5plus1++;
      } else if (matchCount === 5) {
        p5++;
        tierCounts.points5++;
      } else if (matchCount === 4) {
        p4++;
        tierCounts.points4++;
      } else if (matchCount === 3) {
        p3++;
        tierCounts.points3++;
      } else if (matchCount === 2) {
        p2++;
        tierCounts.points2++;
      }

      if (matchCount >= 2 || hasSuperstar) {
        const prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar, antiCrowdMult);
        if (prize > 0) {
          contestGrossPrize += prize;
          winningColumnsCount++;
        }
      }

      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestColumnId = col.id;
        const matched: number[] = [];
        for (let k = 0; k < 6; k++) {
          if (mask[dNums[k]] === 1) matched.push(dNums[k]);
        }
        bestMatchedNumbers = matched;
      }
    }

    if (contestGrossPrize > 0) {
      totalEstimatedGrossWinnings += contestGrossPrize;
      const roundedGross = Number(contestGrossPrize.toFixed(2));
      winningContests.push({
        drawId: draw.id,
        contestNumber: draw.contestNumber,
        year: draw.year,
        date: draw.date,
        drawnNumbers: dNums,
        jolly: draw.jolly,
        superstar: draw.superstar,
        antiCrowdMultiplier: antiCrowdMult,
        bestColumnId,
        bestMatchCount,
        bestMatchedNumbers,
        winningColumnsCount,
        points2Count: p2,
        points3Count: p3,
        points4Count: p4,
        points5Count: p5,
        points5Plus1Count: p5plus1,
        points6Count: p6,
        superstarHitsCount: ssHits,
        contestGrossPrize: roundedGross,
        contestCost: costPerContest,
        contestNetReturn: Number((roundedGross - costPerContest).toFixed(2))
      });
    }
  }

  const roundedTotalWin = Number(totalEstimatedGrossWinnings.toFixed(2));
  const netHistoricalPnL = Number((roundedTotalWin - totalHistoricalCost).toFixed(2));
  const historicalRoiPct =
    totalHistoricalCost > 0
      ? Number(((roundedTotalWin / totalHistoricalCost) * 100).toFixed(2))
      : 0;
  const averageAntiCrowdMultiplier = Number(
    (sumAntiCrowd / Math.max(totalContestsEvaluated, 1)).toFixed(3)
  );

  const endTime = performance.now();

  return {
    totalContestsEvaluated,
    sestineCount,
    costPerContest,
    totalHistoricalCost,
    totalEstimatedGrossWinnings: roundedTotalWin,
    netHistoricalPnL,
    historicalRoiPct,
    averageAntiCrowdMultiplier,
    totalWinningContests: winningContests.length,
    tierCounts,
    winningContests,
    executionTimeMs: Math.round(endTime - startTime)
  };
}

/**
 * Simulate the next N SuperEnalotto draws (from 100 up to 250,000) using the official 2-urn extraction methodology.
 * Default methodology is 'hypergeometric_pure_urn' (Fisher-Yates uniform physical urn without data leakage),
 * with 'bayesian_hybrid_urn' available as a secondary stress-test scenario.
 * Supports an optional onProgress callback invoked every 20,000 draws for Web Worker progress reporting.
 */
export function runNext100DrawsSimulation(
  historicalDraws: Draw[],
  weeklyColumns: GeneratedColumn[],
  methodology: SimulationMethodology = 'hypergeometric_pure_urn',
  seed: number = Date.now(),
  numDrawsToSimulate: number = MIN_SIMULATION_DRAWS,
  coverageTarget: CoverageTarget = 'terni',
  onProgress?: (completedDraws: number, totalDraws: number) => void
): HundredDrawsSimulationResult {
  const startTime = performance.now();
  const totalSimulatedDrawsCount = clampSimulationDrawsCount(numDrawsToSimulate);
  const rng = createPRNG(seed);
  const all90Balls = Array.from({ length: 90 }, (_, i) => i + 1);

  // 1. Build empirical priors from historical draws using typed arrays
  const histFreq = new Int32Array(91);
  const curDelayArr = new Int32Array(91);
  const invMaxDelay = new Float64Array(91);
  const superstarHistFreq = new Int32Array(91);

  const sortedHistory = [...historicalDraws].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  for (let i = 0; i < sortedHistory.length; i++) {
    const d = sortedHistory[i];
    const nums = d.numbers;
    for (let k = 0; k < 6; k++) {
      histFreq[nums[k]]++;
    }
    if (d.superstar && d.superstar >= 1 && d.superstar <= 90) {
      superstarHistFreq[d.superstar]++;
    }
  }

  // Initial delays from newest draw
  for (let n = 1; n <= 90; n++) {
    let del = 0;
    for (let i = 0; i < sortedHistory.length; i++) {
      if (sortedHistory[i].numbers.includes(n)) break;
      del++;
    }
    curDelayArr[n] = del;
    const maxDel = Math.max(del + 10, 60);
    invMaxDelay[n] = 1 / maxDel;
  }

  // Co-occurrence matrix from history (Markovian affinity) in flat Int32Array
  const coMatrixFlat = new Int32Array(91 * 91);
  for (let idx = 0; idx < sortedHistory.length; idx++) {
    const nums = sortedHistory[idx].numbers;
    for (let i = 0; i < 6; i++) {
      const a = nums[i];
      const aRow = a * 91;
      for (let j = i + 1; j < 6; j++) {
        const b = nums[j];
        coMatrixFlat[aRow + b]++;
        coMatrixFlat[b * 91 + a]++;
      }
    }
  }

  // Precompute constant Bayesian priors per ball
  const totalHistDraws = Math.max(sortedHistory.length, 1);
  const baseFreqFactor = new Float64Array(91);
  const starCumWeights = new Float64Array(91);
  const freqDenom = (totalHistDraws * 6) / 90 + 4;
  const starDenom = Math.max(totalHistDraws / 45, 1);
  let cumStarW = 0;

  for (let n = 1; n <= 90; n++) {
    baseFreqFactor[n] = (histFreq[n] + 4) / freqDenom;
    const starW = 1 + (superstarHistFreq[n] / starDenom) * 0.25;
    cumStarW += starW;
    starCumWeights[n] = cumStarW;
  }

  // 2. Step-by-step simulation of the next N extractions (100 to 250,000)
  const loggedDrawsLimit = Math.min(totalSimulatedDrawsCount, MAX_LOGGED_SIMULATED_DRAWS);
  const simulatedDraws: Draw[] = new Array(loggedDrawsLimit);
  const compactDraws = new Uint8Array(totalSimulatedDrawsCount * 8);
  const antiCrowdMultipliers = new Float32Array(totalSimulatedDrawsCount);

  const simFreqArr = new Int32Array(91);
  const jollyFreqArr = new Int32Array(91);
  const starFreqArr = new Int32Array(91);
  const simPairFlat = new Int32Array(91 * 91);

  const latestRealDraw = sortedHistory[0];
  let lastContest = latestRealDraw ? latestRealDraw.contestNumber : 45;
  let currentYear = latestRealDraw ? latestRealDraw.year : 2026;
  const simDate = latestRealDraw ? new Date(latestRealDraw.date) : new Date();

  let p0 = latestRealDraw ? latestRealDraw.numbers[0] : 7;
  let p1 = latestRealDraw ? latestRealDraw.numbers[1] : 18;
  let p2 = latestRealDraw ? latestRealDraw.numbers[2] : 33;
  let p3 = latestRealDraw ? latestRealDraw.numbers[3] : 52;
  let p4 = latestRealDraw ? latestRealDraw.numbers[4] : 64;
  let p5 = latestRealDraw ? latestRealDraw.numbers[5] : 88;

  const ballWeightsArr = new Float64Array(91);
  const uniformUrn = new Int32Array(90);
  for (let i = 0; i < 90; i++) uniformUrn[i] = i + 1;
  const pickedMain = new Int32Array(6);

  for (let step = 0; step < totalSimulatedDrawsCount; step++) {
    if (onProgress && step > 0 && step % 20000 === 0) {
      onProgress(step, totalSimulatedDrawsCount);
    }

    let jollyBall = 1;
    let superstarBall = 1;

    if (methodology === 'bayesian_hybrid_urn') {
      let totalW = 0;
      for (let n = 1; n <= 90; n++) {
        let delayRatio = curDelayArr[n] * invMaxDelay[n];
        if (delayRatio > 1.5) delayRatio = 1.5;
        const delayFactor = 1 + 0.45 * delayRatio;

        const baseIdx = n * 91;
        const affSum =
          coMatrixFlat[baseIdx + p0] +
          coMatrixFlat[baseIdx + p1] +
          coMatrixFlat[baseIdx + p2] +
          coMatrixFlat[baseIdx + p3] +
          coMatrixFlat[baseIdx + p4] +
          coMatrixFlat[baseIdx + p5];
        let affBonus = affSum * 0.02;
        if (affBonus > 0.35) affBonus = 0.35;

        const w = baseFreqFactor[n] * delayFactor * (1 + affBonus);
        ballWeightsArr[n] = w;
        totalW += w;
      }

      // Draw 7 balls without replacement from Urn 1
      for (let k = 0; k < 7; k++) {
        let r = rng() * totalW;
        let chosen = 90;
        for (let n = 1; n <= 90; n++) {
          const w = ballWeightsArr[n];
          if (w > 0) {
            r -= w;
            if (r <= 0) {
              chosen = n;
              break;
            }
          }
        }
        if (ballWeightsArr[chosen] === 0) {
          for (let n = 90; n >= 1; n--) {
            if (ballWeightsArr[n] > 0) {
              chosen = n;
              break;
            }
          }
        }
        totalW -= ballWeightsArr[chosen];
        ballWeightsArr[chosen] = 0;
        if (k < 6) {
          pickedMain[k] = chosen;
        } else {
          jollyBall = chosen;
        }
      }

      // Draw 1 SuperStar ball from independent Urn 2 using binary search on cumulative weights
      const rStar = rng() * cumStarW;
      let lo = 1;
      let hi = 90;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (starCumWeights[mid] < rStar) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      superstarBall = lo;
    } else {
      // Pure Hypergeometric Official Urn: partial Fisher-Yates shuffle for first 7 balls
      for (let i = 0; i < 7; i++) {
        const j = i + Math.floor(rng() * (90 - i));
        const tmp = uniformUrn[i];
        uniformUrn[i] = uniformUrn[j];
        uniformUrn[j] = tmp;
      }
      pickedMain[0] = uniformUrn[0];
      pickedMain[1] = uniformUrn[1];
      pickedMain[2] = uniformUrn[2];
      pickedMain[3] = uniformUrn[3];
      pickedMain[4] = uniformUrn[4];
      pickedMain[5] = uniformUrn[5];
      jollyBall = uniformUrn[6];
      superstarBall = Math.floor(rng() * 90) + 1;
    }

    // Insertion sort on pickedMain (6 elements)
    for (let i = 1; i < 6; i++) {
      const key = pickedMain[i];
      let j = i - 1;
      while (j >= 0 && pickedMain[j] > key) {
        pickedMain[j + 1] = pickedMain[j];
        j--;
      }
      pickedMain[j + 1] = key;
    }

    const m0 = pickedMain[0];
    const m1 = pickedMain[1];
    const m2 = pickedMain[2];
    const m3 = pickedMain[3];
    const m4 = pickedMain[4];
    const m5 = pickedMain[5];

    // Update dynamic delays & frequencies
    for (let n = 1; n <= 90; n++) {
      curDelayArr[n]++;
    }
    curDelayArr[m0] = 0;
    curDelayArr[m1] = 0;
    curDelayArr[m2] = 0;
    curDelayArr[m3] = 0;
    curDelayArr[m4] = 0;
    curDelayArr[m5] = 0;

    simFreqArr[m0]++;
    simFreqArr[m1]++;
    simFreqArr[m2]++;
    simFreqArr[m3]++;
    simFreqArr[m4]++;
    simFreqArr[m5]++;
    jollyFreqArr[jollyBall]++;
    starFreqArr[superstarBall]++;

    // Record simulated pair co-occurrences
    for (let i = 0; i < 6; i++) {
      const a = pickedMain[i];
      const aRow = a * 91;
      for (let j = i + 1; j < 6; j++) {
        const b = pickedMain[j];
        simPairFlat[aRow + b]++;
        simPairFlat[b * 91 + a]++;
      }
    }

    p0 = m0;
    p1 = m1;
    p2 = m2;
    p3 = m3;
    p4 = m4;
    p5 = m5;

    // Store in compact buffer for full N-draw PnL evaluation
    const baseOffset = step * 8;
    compactDraws[baseOffset] = m0;
    compactDraws[baseOffset + 1] = m1;
    compactDraws[baseOffset + 2] = m2;
    compactDraws[baseOffset + 3] = m3;
    compactDraws[baseOffset + 4] = m4;
    compactDraws[baseOffset + 5] = m5;
    compactDraws[baseOffset + 6] = jollyBall;
    compactDraws[baseOffset + 7] = superstarBall;

    // Precompute dynamic Anti-Crowd payout multiplier for this simulated draw
    antiCrowdMultipliers[step] = computeAntiCrowdMultiplier(compactDraws, baseOffset);

    // Materialize Draw object for the logged table (first 500 draws)
    if (step < loggedDrawsLimit) {
      simDate.setDate(simDate.getDate() + 2);
      if (simDate.getDay() === 0) simDate.setDate(simDate.getDate() + 2);
      lastContest++;
      if (lastContest > 156) {
        lastContest = 1;
        currentYear++;
      }

      simulatedDraws[step] = {
        id: `SIM-${currentYear}-${String(lastContest).padStart(3, '0')}`,
        contestNumber: lastContest,
        year: currentYear,
        date: simDate.toISOString().split('T')[0],
        numbers: [m0, m1, m2, m3, m4, m5],
        jolly: jollyBall,
        superstar: superstarBall
      };
    }
  }

  if (onProgress) {
    onProgress(totalSimulatedDrawsCount, totalSimulatedDrawsCount);
  }

  // Convert frequency arrays to Record<number, number>
  const numberFrequenciesInSim: Record<number, number> = {};
  const jollyFrequenciesInSim: Record<number, number> = {};
  const superstarFrequenciesInSim: Record<number, number> = {};
  for (let n = 1; n <= 90; n++) {
    numberFrequenciesInSim[n] = simFreqArr[n];
    jollyFrequenciesInSim[n] = jollyFreqArr[n];
    superstarFrequenciesInSim[n] = starFreqArr[n];
  }

  // 3. Construct the High-Probability Sestina from the N simulation results
  const candidateRanking = [...all90Balls].sort((a, b) => {
    const diff = simFreqArr[b] - simFreqArr[a];
    if (diff !== 0) return diff;
    return histFreq[b] - histFreq[a];
  });

  // Take top 12 numbers from the N-draw simulation to develop all C(12, 6) = 924 combinations
  const top12Pool = candidateRanking.slice(0, 12).sort((a, b) => a - b);
  const all924Combos = generateCombinations(top12Pool, 6);

  // Filter combinations by golden structural balance (Even/Odd, High/Low, Gaussian Sum [190, 350], Max 2 consecutive/decade/cadence)
  let validCombos = all924Combos.filter(
    (c) =>
      checkEvenOdd(c) &&
      checkHighLow(c) &&
      checkSumRange(c, 190, 350) &&
      checkConsecutiveAndDecades(c, 2, 2, 2)
  );
  if (validCombos.length === 0) {
    validCombos = all924Combos;
  }

  const scaleFactor = 100 / totalSimulatedDrawsCount;

  const poolIndexMap = new Int8Array(91).fill(-1);
  for (let i = 0; i < top12Pool.length; i++) {
    poolIndexMap[top12Pool[i]] = i;
  }
  const simTripletCube = new Int32Array(12 * 12 * 12);
  if (coverageTarget === 'terni') {
    const matchedIdx = new Int8Array(6);
    for (let step = 0; step < totalSimulatedDrawsCount; step++) {
      const base = step * 8;
      let mCount = 0;
      for (let k = 0; k < 6; k++) {
        const idx = poolIndexMap[compactDraws[base + k]];
        if (idx >= 0) {
          matchedIdx[mCount++] = idx;
        }
      }
      if (mCount >= 3) {
        for (let a = 0; a < mCount - 2; a++) {
          const ia = matchedIdx[a] * 144;
          for (let b = a + 1; b < mCount - 1; b++) {
            const ib = matchedIdx[b] * 12;
            for (let c = b + 1; c < mCount; c++) {
              simTripletCube[ia + ib + matchedIdx[c]]++;
            }
          }
        }
      }
    }
  }

  let bestCombo = validCombos[0];
  let bestComboScore = -Infinity;

  for (const combo of validCombos) {
    let freqScore = 0;
    let pairSynergy = 0;
    let tripletSynergy = 0;

    for (let i = 0; i < 6; i++) {
      const ci = combo[i];
      freqScore += simFreqArr[ci] * 10 * scaleFactor;
      const rowOffset = ci * 91;
      for (let j = i + 1; j < 6; j++) {
        const cj = combo[j];
        pairSynergy += simPairFlat[rowOffset + cj] * (coverageTarget === 'terni' ? 10 : 25) * scaleFactor;
        if (coverageTarget === 'terni') {
          const ia = poolIndexMap[ci];
          const ib = poolIndexMap[cj];
          if (ia >= 0 && ib >= 0) {
            const baseTri = ia * 144 + ib * 12;
            for (let m = j + 1; m < 6; m++) {
              const ic = poolIndexMap[combo[m]];
              if (ic >= 0) {
                tripletSynergy += simTripletCube[baseTri + ic] * 65 * scaleFactor;
              }
            }
          }
        }
      }
    }

    const sum = combo[0] + combo[1] + combo[2] + combo[3] + combo[4] + combo[5];
    const sumPenalty = Math.abs(sum - 273) * 0.25;

    const totalScore = freqScore + pairSynergy + tripletSynergy - sumPenalty;
    if (totalScore > bestComboScore) {
      bestComboScore = totalScore;
      bestCombo = combo;
    }
  }

  const winningSix = [...bestCombo].sort((a, b) => a - b) as [
    number,
    number,
    number,
    number,
    number,
    number
  ];

  // Best Jolly not in winningSix
  const winningSet = new Set(winningSix);
  let recommendedJolly = 1;
  let maxJollyFreq = -1;
  for (let n = 1; n <= 90; n++) {
    if (!winningSet.has(n) && jollyFreqArr[n] > maxJollyFreq) {
      maxJollyFreq = jollyFreqArr[n];
      recommendedJolly = n;
    }
  }

  // Best SuperStar
  let recommendedSuperstar = 1;
  let maxStarFreq = -1;
  for (let n = 1; n <= 90; n++) {
    if (starFreqArr[n] > maxStarFreq) {
      maxStarFreq = starFreqArr[n];
      recommendedSuperstar = n;
    }
  }

  // Metrics for High-Probability Sestina
  let evens = 0;
  let lows = 0;
  let sum = 0;
  let freqSum = 0;
  for (const n of winningSix) {
    if (n % 2 === 0) evens++;
    if (n <= 45) lows++;
    sum += n;
    freqSum += simFreqArr[n];
  }

  const expectedAvgFreq = 6 * ((totalSimulatedDrawsCount * 6) / 90);
  const sampleSizeBonus = Math.min(4, Math.log10(totalSimulatedDrawsCount / 100) * 1.5);
  const confidenceIndex = Math.min(
    97,
    Math.max(
      72,
      Math.round(65 + (freqSum / Math.max(expectedAvgFreq, 1)) * 18 + sampleSizeBonus)
    )
  );

  const highProbCol: GeneratedColumn = {
    id: 0,
    numbers: winningSix,
    superstar: recommendedSuperstar,
    sum,
    evens,
    odds: 6 - evens,
    lows,
    highs: 6 - lows
  };

  const simulatedBacktestPnL = evaluateSingleSestinaPnLCompact(
    { ...highProbCol, superstar: undefined },
    compactDraws,
    totalSimulatedDrawsCount,
    antiCrowdMultipliers
  );

  // 4. Evaluate weekly generated sestine against all N simulated draws with Anti-Crowd payouts
  const perSestinaResults = weeklyColumns.map((col) =>
    evaluateSingleSestinaPnLCompact(col, compactDraws, totalSimulatedDrawsCount, antiCrowdMultipliers)
  );
  const weeklySystemPnL = summarizePerSestinaResults(
    perSestinaResults,
    totalSimulatedDrawsCount
  );

  // 5. Derive recommended generator weights and filter parameters from simulation
  const recommendedWeights = deriveSimulationRecommendedWeights(
    sortedHistory,
    top12Pool,
    winningSix
  );

  const recommendedFilters: FilterOptions = {
    evenOdd: checkEvenOdd(winningSix),
    highLow: checkHighLow(winningSix),
    sumRange: true,
    minSum: Math.min(190, sum - 15),
    maxSum: Math.max(350, sum + 15),
    consecutive: checkConsecutiveAndDecades(winningSix, 2, 2),
    decades: checkConsecutiveAndDecades(winningSix, 2, 2),
    cadences: checkCadences(winningSix, 2)
  };

  const endTime = performance.now();

  return {
    methodology,
    coverageTarget,
    totalSimulatedDrawsCount,
    simulatedDraws,
    numberFrequenciesInSim,
    jollyFrequenciesInSim,
    superstarFrequenciesInSim,
    top12PoolNumbers: top12Pool,
    recommendedWeights,
    recommendedFilters,
    highProbabilitySestina: {
      numbers: winningSix,
      recommendedJolly,
      recommendedSuperstar,
      sum,
      evens,
      odds: 6 - evens,
      lows,
      highs: 6 - lows,
      confidenceIndex,
      simulatedBacktestPnL
    },
    weeklySystemPnL,
    executionTimeMs: Math.round(endTime - startTime)
  };
}
