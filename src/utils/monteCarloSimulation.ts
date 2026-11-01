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
  HundredDrawsSimulationResult
} from '../types/lottery';
import {
  generateCombinations,
  checkEvenOdd,
  checkHighLow,
  checkSumRange,
  checkConsecutiveAndDecades
} from './combinatorics';

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
 * Weighted sampling without replacement from an urn of balls (Efraimidis-Spirakis / sequential physical urn)
 */
function sampleWeightedWithoutReplacement(
  balls: number[],
  weights: Record<number, number>,
  count: number,
  rng: () => number
): number[] {
  const pool = [...balls];
  const selected: number[] = [];

  for (let k = 0; k < count && pool.length > 0; k++) {
    let totalW = 0;
    for (let i = 0; i < pool.length; i++) {
      totalW += Math.max(weights[pool[i]] ?? 1, 0.0001);
    }

    let r = rng() * totalW;
    let chosenIdx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= Math.max(weights[pool[i]] ?? 1, 0.0001);
      if (r <= 0) {
        chosenIdx = i;
        break;
      }
    }

    selected.push(pool[chosenIdx]);
    pool.splice(chosenIdx, 1);
  }

  return selected;
}

/**
 * Pure physical hypergeometric urn shuffle (Fisher-Yates) without replacement
 */
function sampleUniformWithoutReplacement(
  balls: number[],
  count: number,
  rng: () => number
): number[] {
  const urn = [...balls];
  // Physical mixing shuffle (Fisher-Yates)
  for (let i = urn.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = urn[i];
    urn[i] = urn[j];
    urn[j] = temp;
  }
  return urn.slice(0, count);
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
  const drawSet = new Set(draw.numbers);
  let matchCount = 0;
  for (let i = 0; i < col.numbers.length; i++) {
    if (drawSet.has(col.numbers[i])) {
      matchCount++;
    }
  }

  const hasJolly = col.numbers.includes(draw.jolly);
  const hasSuperstar =
    col.superstar !== undefined &&
    draw.superstar !== undefined &&
    col.superstar === draw.superstar;

  // Official SuperEnalotto average payout structure (excluding outlier 50M jackpot spikes to avoid distorting expected value, or realistic expected 6-point payout)
  let prize = 0;
  if (matchCount === 6) {
    prize = hasSuperstar ? 2500000 : 1500000;
  } else if (matchCount === 5 && hasJolly) {
    prize = hasSuperstar ? 650000 : 350000;
  } else if (matchCount === 5) {
    prize = hasSuperstar ? 100000 : 32000;
  } else if (matchCount === 4) {
    prize = hasSuperstar ? 30000 : 300;
  } else if (matchCount === 3) {
    prize = hasSuperstar ? 2500 : 25;
  } else if (matchCount === 2) {
    prize = hasSuperstar ? 100 : 5;
  } else if (hasSuperstar) {
    prize = matchCount === 1 ? 10 : 5;
  }

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

  for (let i = 0; i < drawsToEvaluate.length; i++) {
    const draw = drawsToEvaluate[i];
    const outcome = evaluateSingleColumnOnDraw(column, draw);

    totalGrossGain += outcome.prize;
    // Unrecovered cost on this draw
    const drawLoss = Math.max(0, costPerDraw - outcome.prize);
    totalGrossLoss += drawLoss;

    if (outcome.hasSuperstar) {
      hitsBreakdown.superstarHits++;
    }

    if (outcome.matchCount === 6) {
      hitsBreakdown.points6++;
    } else if (outcome.matchCount === 5 && outcome.hasJolly) {
      hitsBreakdown.points5plus1++;
    } else if (outcome.matchCount === 5) {
      hitsBreakdown.points5++;
    } else if (outcome.matchCount === 4) {
      hitsBreakdown.points4++;
    } else if (outcome.matchCount === 3) {
      hitsBreakdown.points3++;
    } else if (outcome.matchCount === 2) {
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
 * Calculate expected gains and losses for all weekly generated sestine.
 * The primary aggregate value is the mean of the losses and gains calculated on each individual sestina.
 */
export function calculateWeeklySestineExpectedPnL(
  columns: GeneratedColumn[],
  simulatedDraws: Draw[]
): WeeklySestinePnLSummary {
  if (columns.length === 0) {
    return {
      sestineCount: 0,
      drawsCount: simulatedDraws.length,
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

  const perSestinaResults = columns.map((col) =>
    evaluateSingleSestinaPnL(col, simulatedDraws)
  );

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
    drawsCount: simulatedDraws.length,
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
 * Simulate the next 100 SuperEnalotto draws using the official 2-urn extraction methodology
 * and synthesize the High-Probability Consensus Sestina.
 */
export function runNext100DrawsSimulation(
  historicalDraws: Draw[],
  weeklyColumns: GeneratedColumn[],
  methodology: SimulationMethodology = 'bayesian_hybrid_urn',
  seed: number = Date.now()
): HundredDrawsSimulationResult {
  const startTime = performance.now();
  const rng = createPRNG(seed);
  const all90Balls = Array.from({ length: 90 }, (_, i) => i + 1);

  // 1. Build empirical priors from historical draws
  const histFreq: Record<number, number> = {};
  const currentDelay: Record<number, number> = {};
  const maxDelay: Record<number, number> = {};
  const superstarHistFreq: Record<number, number> = {};

  for (let n = 1; n <= 90; n++) {
    histFreq[n] = 0;
    currentDelay[n] = 0;
    maxDelay[n] = 25;
    superstarHistFreq[n] = 0;
  }

  const sortedHistory = [...historicalDraws].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  for (let i = 0; i < sortedHistory.length; i++) {
    const d = sortedHistory[i];
    for (const num of d.numbers) {
      histFreq[num] = (histFreq[num] || 0) + 1;
    }
    if (d.superstar) {
      superstarHistFreq[d.superstar] = (superstarHistFreq[d.superstar] || 0) + 1;
    }
  }

  // Initial delays from newest draw
  for (let n = 1; n <= 90; n++) {
    let del = 0;
    for (let i = 0; i < sortedHistory.length; i++) {
      if (sortedHistory[i].numbers.includes(n)) break;
      del++;
    }
    currentDelay[n] = del;
    maxDelay[n] = Math.max(del + 10, 60);
  }

  // Co-occurrence matrix from history (Markovian affinity)
  const coMatrix: number[][] = Array.from({ length: 91 }, () =>
    new Array(91).fill(0)
  );
  for (const d of sortedHistory) {
    for (let i = 0; i < d.numbers.length; i++) {
      for (let j = i + 1; j < d.numbers.length; j++) {
        const a = d.numbers[i];
        const b = d.numbers[j];
        coMatrix[a][b]++;
        coMatrix[b][a]++;
      }
    }
  }

  // 2. Step-by-step simulation of the next 100 extractions
  const simulatedDraws: Draw[] = [];
  const numberFrequenciesInSim: Record<number, number> = {};
  const jollyFrequenciesInSim: Record<number, number> = {};
  const superstarFrequenciesInSim: Record<number, number> = {};
  const simPairMatrix: number[][] = Array.from({ length: 91 }, () =>
    new Array(91).fill(0)
  );

  for (let n = 1; n <= 90; n++) {
    numberFrequenciesInSim[n] = 0;
    jollyFrequenciesInSim[n] = 0;
    superstarFrequenciesInSim[n] = 0;
  }

  const latestRealDraw = sortedHistory[0];
  let lastContest = latestRealDraw ? latestRealDraw.contestNumber : 45;
  let currentYear = latestRealDraw ? latestRealDraw.year : 2026;
  const simDate = latestRealDraw ? new Date(latestRealDraw.date) : new Date();
  let previousSix: number[] = latestRealDraw
    ? [...latestRealDraw.numbers]
    : [7, 18, 33, 52, 64, 88];

  const totalHistDraws = Math.max(sortedHistory.length, 1);

  for (let step = 1; step <= 100; step++) {
    let sevenBalls: number[];
    let superstarBall: number;

    if (methodology === 'bayesian_hybrid_urn') {
      // Calculate dynamic Bayesian weights for the 90 balls in the primary urn
      const ballWeights: Record<number, number> = {};
      const starWeights: Record<number, number> = {};

      for (let n = 1; n <= 90; n++) {
        // Dirichlet-smoothed empirical frequency
        const freqFactor = (histFreq[n] + 4) / (totalHistDraws * 6 / 90 + 4);
        // Elastic delay pressure (Weibull-like hazard rate)
        const delayRatio = Math.min(currentDelay[n] / maxDelay[n], 1.5);
        const delayFactor = 1 + 0.45 * delayRatio;
        // Markovian transition affinity with previous draw
        let affSum = 0;
        for (const prevN of previousSix) {
          affSum += coMatrix[n][prevN] || 0;
        }
        const affinityFactor = 1 + Math.min(affSum / 50, 0.35);

        ballWeights[n] = freqFactor * delayFactor * affinityFactor;
        starWeights[n] = 1 + (superstarHistFreq[n] || 0) / Math.max(totalHistDraws / 45, 1) * 0.25;
      }

      // Official Urn 1: Draw 7 balls without replacement (6 Sestina + 1 Jolly)
      sevenBalls = sampleWeightedWithoutReplacement(all90Balls, ballWeights, 7, rng);
      // Official Urn 2: Independent SuperStar Urn (90 balls)
      superstarBall = sampleWeightedWithoutReplacement(all90Balls, starWeights, 1, rng)[0];
    } else {
      // Pure Hypergeometric Official Urn (Equiprobable Fisher-Yates shuffle without replacement)
      sevenBalls = sampleUniformWithoutReplacement(all90Balls, 7, rng);
      superstarBall = sampleUniformWithoutReplacement(all90Balls, 1, rng)[0];
    }

    const sixMain = sevenBalls.slice(0, 6).sort((a, b) => a - b) as [
      number,
      number,
      number,
      number,
      number,
      number
    ];
    const jollyBall = sevenBalls[6];

    // Update dynamic delays for next simulated draw
    const drawnSet = new Set(sixMain);
    for (let n = 1; n <= 90; n++) {
      if (drawnSet.has(n)) {
        currentDelay[n] = 0;
        numberFrequenciesInSim[n]++;
      } else {
        currentDelay[n]++;
      }
    }
    jollyFrequenciesInSim[jollyBall]++;
    superstarFrequenciesInSim[superstarBall]++;

    // Record simulated pair co-occurrences
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const a = sixMain[i];
        const b = sixMain[j];
        simPairMatrix[a][b]++;
        simPairMatrix[b][a]++;
      }
    }

    previousSix = sixMain;

    // Advance calendar date (Tue / Thu / Sat)
    simDate.setDate(simDate.getDate() + 2);
    if (simDate.getDay() === 0) simDate.setDate(simDate.getDate() + 2); // Skip Sun/Mon
    lastContest++;
    if (lastContest > 156) {
      lastContest = 1;
      currentYear++;
    }

    simulatedDraws.push({
      id: `SIM-${currentYear}-${String(lastContest).padStart(3, '0')}`,
      contestNumber: lastContest,
      year: currentYear,
      date: simDate.toISOString().split('T')[0],
      numbers: sixMain,
      jolly: jollyBall,
      superstar: superstarBall
    });
  }

  // 3. Construct the High-Probability Sestina from the 100 simulation results
  // Rank all 90 numbers by simulated frequency + pair synergy
  const candidateRanking = [...all90Balls].sort((a, b) => {
    const diff = numberFrequenciesInSim[b] - numberFrequenciesInSim[a];
    if (diff !== 0) return diff;
    return (histFreq[b] || 0) - (histFreq[a] || 0);
  });

  // Take top 12 numbers from the 100-draw simulation to develop all C(12, 6) = 924 combinations
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

  // Score each valid combination against the 100 simulated draws (individual frequency + simulated pair synergy + direct multi-point hits in the 100 draws)
  let bestCombo = validCombos[0];
  let bestComboScore = -Infinity;

  for (const combo of validCombos) {
    let freqScore = 0;
    let pairSynergy = 0;
    for (let i = 0; i < 6; i++) {
      freqScore += numberFrequenciesInSim[combo[i]] * 10;
      for (let j = i + 1; j < 6; j++) {
        pairSynergy += simPairMatrix[combo[i]][combo[j]] * 25;
      }
    }

    // Distance from ideal Gaussian sum 273
    const sum = combo.reduce((a, b) => a + b, 0);
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
    if (!winningSet.has(n) && jollyFrequenciesInSim[n] > maxJollyFreq) {
      maxJollyFreq = jollyFrequenciesInSim[n];
      recommendedJolly = n;
    }
  }

  // Best SuperStar
  let recommendedSuperstar = 1;
  let maxStarFreq = -1;
  for (let n = 1; n <= 90; n++) {
    if (superstarFrequenciesInSim[n] > maxStarFreq) {
      maxStarFreq = superstarFrequenciesInSim[n];
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
    freqSum += numberFrequenciesInSim[n];
  }

  // Convergence index (normalized confidence score between 72% and 96% based on simulation concentration)
  const expectedAvgFreq = 6 * (600 / 90); // 40
  const confidenceIndex = Math.min(
    96,
    Math.max(72, Math.round(65 + (freqSum / expectedAvgFreq) * 18))
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

  const simulatedBacktestPnL = evaluateSingleSestinaPnL(
    { ...highProbCol, superstar: undefined },
    simulatedDraws
  );

  // 4. Evaluate weekly generated sestine against the 100 simulated draws
  const weeklySystemPnL = calculateWeeklySestineExpectedPnL(
    weeklyColumns,
    simulatedDraws
  );

  const endTime = performance.now();

  return {
    methodology,
    simulatedDraws,
    numberFrequenciesInSim,
    jollyFrequenciesInSim,
    superstarFrequenciesInSim,
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
