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
  FilterOptions
} from '../types/lottery';
import {
  generateCombinations,
  checkEvenOdd,
  checkHighLow,
  checkSumRange,
  checkConsecutiveAndDecades,
  calculateNumberStatistics
} from './combinatorics';

export const MIN_SIMULATION_DRAWS = 100;
export const MAX_SIMULATION_DRAWS = 100000;
export const MAX_LOGGED_SIMULATED_DRAWS = 500;
export const PRESET_SIMULATION_COUNTS = [100, 1000, 5000, 10000, 50000, 100000] as const;

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
 * Compute official SuperEnalotto average payout given matchCount, hasJolly, hasSuperstar
 */
function computeOfficialPrize(
  matchCount: number,
  hasJolly: boolean,
  hasSuperstar: boolean
): number {
  if (matchCount === 6) {
    return hasSuperstar ? 2500000 : 1500000;
  } else if (matchCount === 5 && hasJolly) {
    return hasSuperstar ? 650000 : 350000;
  } else if (matchCount === 5) {
    return hasSuperstar ? 100000 : 32000;
  } else if (matchCount === 4) {
    return hasSuperstar ? 30000 : 300;
  } else if (matchCount === 3) {
    return hasSuperstar ? 2500 : 25;
  } else if (matchCount === 2) {
    return hasSuperstar ? 100 : 5;
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
  draw: Draw
): {
  matchCount: number;
  hasJolly: boolean;
  hasSuperstar: boolean;
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

  const prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar);

  return {
    matchCount,
    hasJolly,
    hasSuperstar,
    prize
  };
}

/**
 * Calculate expected gains and losses for a single sestina across a set of simulated/random draws
 */
export function evaluateSingleSestinaPnL(
  column: GeneratedColumn,
  drawsToEvaluate: Draw[]
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

    const prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar);

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
 */
function evaluateSingleSestinaPnLCompact(
  column: GeneratedColumn,
  compactDraws: Uint8Array,
  totalDrawsEvaluated: number
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

    const prize = computeOfficialPrize(matchCount, hasJolly, hasSuperstar);

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
 * The primary aggregate value is the mean of the losses and gains calculated on each individual sestina.
 */
export function calculateWeeklySestineExpectedPnL(
  columns: GeneratedColumn[],
  simulatedDraws: Draw[]
): WeeklySestinePnLSummary {
  if (columns.length === 0) {
    return summarizePerSestinaResults([], simulatedDraws.length);
  }
  const perSestinaResults = columns.map((col) =>
    evaluateSingleSestinaPnL(col, simulatedDraws)
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

  // Ensure positive minimum signals and normalize onto [0.15, 0.95] rounded to 0.05
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
 * Simulate the next N SuperEnalotto draws (from 100 up to 100,000) using the official 2-urn extraction methodology
 * and synthesize the High-Probability Consensus Sestina + optimal generator parameters.
 */
export function runNext100DrawsSimulation(
  historicalDraws: Draw[],
  weeklyColumns: GeneratedColumn[],
  methodology: SimulationMethodology = 'bayesian_hybrid_urn',
  seed: number = Date.now(),
  numDrawsToSimulate: number = MIN_SIMULATION_DRAWS
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

  // 2. Step-by-step simulation of the next N extractions (100 to 100,000)
  const loggedDrawsLimit = Math.min(totalSimulatedDrawsCount, MAX_LOGGED_SIMULATED_DRAWS);
  const simulatedDraws: Draw[] = new Array(loggedDrawsLimit);
  const compactDraws = new Uint8Array(totalSimulatedDrawsCount * 8);

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
        // Fallback if floating point rounding left r > 0
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

  // Filter combinations by golden structural balance (Even/Odd, High/Low, Gaussian Sum [190, 350], Max 2 consecutive/decade)
  let validCombos = all924Combos.filter(
    (c) =>
      checkEvenOdd(c) &&
      checkHighLow(c) &&
      checkSumRange(c, 190, 350) &&
      checkConsecutiveAndDecades(c, 2, 2)
  );
  if (validCombos.length === 0) {
    validCombos = all924Combos;
  }

  // Scale factor so sumPenalty stays proportional regardless of N (100 vs 100,000)
  const scaleFactor = 100 / totalSimulatedDrawsCount;

  let bestCombo = validCombos[0];
  let bestComboScore = -Infinity;

  for (const combo of validCombos) {
    let freqScore = 0;
    let pairSynergy = 0;
    for (let i = 0; i < 6; i++) {
      const ci = combo[i];
      freqScore += simFreqArr[ci] * 10 * scaleFactor;
      const rowOffset = ci * 91;
      for (let j = i + 1; j < 6; j++) {
        pairSynergy += simPairFlat[rowOffset + combo[j]] * 25 * scaleFactor;
      }
    }

    const sum = combo[0] + combo[1] + combo[2] + combo[3] + combo[4] + combo[5];
    const sumPenalty = Math.abs(sum - 273) * 0.25;

    const totalScore = freqScore + pairSynergy - sumPenalty;
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

  // Convergence index (normalized confidence score between 72% and 97% based on simulation concentration & sample size)
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
    totalSimulatedDrawsCount
  );

  // 4. Evaluate weekly generated sestine against all N simulated draws
  const perSestinaResults = weeklyColumns.map((col) =>
    evaluateSingleSestinaPnLCompact(col, compactDraws, totalSimulatedDrawsCount)
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
    decades: checkConsecutiveAndDecades(winningSix, 2, 2)
  };

  const endTime = performance.now();

  return {
    methodology,
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
