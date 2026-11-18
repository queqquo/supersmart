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
  PlayMode,
  CoverageTarget
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
 * Filter 4a: Cadences (Final digit 0-9, i.e. num % 10)
 * Max 2 numbers with the same final digit (e.g. 12, 42 ok; 12, 42, 72 not allowed)
 */
export function checkCadences(combo: number[], maxPerCadence = 2): boolean {
  const cadenceCounts = new Uint8Array(10);
  for (let i = 0; i < combo.length; i++) {
    const cad = combo[i] % 10;
    cadenceCounts[cad]++;
    if (cadenceCounts[cad] > maxPerCadence) return false;
  }
  return true;
}

/**
 * Filter 4: Consecutivity, Decades, and optional Cadences
 * Max 2 consecutive numbers (e.g. 10,11 ok; 10,11,12 not allowed)
 * Max 2 numbers in the same decade (e.g. 1-9, 10-19, ..., 80-90)
 * Optional maxPerCadence: Max 2 numbers with the same final digit (0-9)
 */
export function checkConsecutiveAndDecades(
  sortedCombo: number[],
  maxConsecutive = 2,
  maxPerDecade = 2,
  maxPerCadence?: number
): boolean {
  let consecutiveRun = 1;
  let maxRunFound = 1;
  const decadeCounts = new Uint8Array(10);
  const cadenceCounts = new Uint8Array(10);

  for (let i = 0; i < sortedCombo.length; i++) {
    const num = sortedCombo[i];
    if (i > 0 && num === sortedCombo[i - 1] + 1) {
      consecutiveRun++;
      if (consecutiveRun > maxRunFound) maxRunFound = consecutiveRun;
    } else if (i > 0) {
      consecutiveRun = 1;
    }

    // Decade 0: 1-9; Decade 1: 10-19; ... Decade 8: 80-89; Decade 9: 90
    const decade = Math.min(Math.floor(num / 10), 9);
    decadeCounts[decade]++;
    if (decadeCounts[decade] > maxPerDecade) return false;

    if (maxPerCadence !== undefined) {
      const cadence = num % 10;
      cadenceCounts[cadence]++;
      if (cadenceCounts[cadence] > maxPerCadence) return false;
    }
  }

  if (maxRunFound > maxConsecutive) return false;

  return true;
}

/**
 * Compute soft-penalty score for a candidate combination against active statistical & anti-crowd filters.
 * Returns 0 if the combination satisfies all enabled filters, or a positive penalty proportional to violations.
 */
export function computeFilterPenalty(combo: number[], filters: FilterOptions): number {
  let penalty = 0;
  if (filters.evenOdd && !checkEvenOdd(combo)) penalty += 45;
  if (filters.highLow && !checkHighLow(combo)) penalty += 45;
  if (filters.sumRange && !checkSumRange(combo, filters.minSum, filters.maxSum)) penalty += 40;

  // Consecutive, Decades & Cadences check
  let consecutiveRun = 1;
  let maxRun = 1;
  const decadeCounts = new Uint8Array(10);
  const cadenceCounts = new Uint8Array(10);

  for (let i = 0; i < combo.length; i++) {
    const num = combo[i];
    if (i > 0 && num === combo[i - 1] + 1) {
      consecutiveRun++;
      if (consecutiveRun > maxRun) maxRun = consecutiveRun;
    } else if (i > 0) {
      consecutiveRun = 1;
    }
    const dec = Math.min(Math.floor(num / 10), 9);
    const cad = num % 10;
    decadeCounts[dec]++;
    cadenceCounts[cad]++;
  }

  if (filters.consecutive && maxRun > 2) penalty += (maxRun - 2) * 60;
  if (filters.decades) {
    for (let d = 0; d < 10; d++) {
      if (decadeCounts[d] > 2) penalty += (decadeCounts[d] - 2) * 55;
    }
  }
  if (filters.cadences !== false) {
    for (let c = 0; c < 10; c++) {
      if (cadenceCounts[c] > 2) penalty += (cadenceCounts[c] - 2) * 50;
    }
  }
  return penalty;
}

/**
 * Apply all statistical conditioning filters to combinations (returns strictly zero-penalty combinations)
 */
export function applyStatisticalFilters(
  combinations: number[][],
  filters: FilterOptions
): number[][] {
  return combinations.filter((combo) => computeFilterPenalty(combo, filters) === 0);
}

/**
 * Fast 32-bit population count (Hamming weight) for 90-bit column intersection
 */
function popcnt32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Greedy Set Cover / Covering Design Reduction with Flat Uint8Array Indexing, Soft-Filter Penalty,
 * Hamming Overlap Control, and 2-Opt Kempe-Swap Local Search Refinement.
 * Selects exactly targetCount columns maximizing coverage of triplets (t=3) or pairs (t=2),
 * while balancing number frequency and applying soft-penalties for statistical filters so the
 * mathematical covering matrix is never broken by hard pre-filtering.
 */
export function greedyCoveringReduction(
  candidates: number[][],
  poolNumbers: number[],
  targetCount: number,
  coverageTarget: CoverageTarget = 'terni',
  filters?: FilterOptions
): number[][] {
  const numCandidates = candidates.length;
  if (numCandidates <= targetCount) {
    return candidates;
  }

  const poolMask = new Uint8Array(91);
  const numberUsage = new Int32Array(91);
  for (let i = 0; i < poolNumbers.length; i++) {
    const n = poolNumbers[i];
    if (n >= 1 && n <= 90) {
      poolMask[n] = 1;
    }
  }

  const targetNumberPresence = (targetCount * 6) / Math.max(poolNumbers.length, 1);

  // Flat O(1) reference-counted lookup arrays replacing Set<string>:
  // coveredPairs: index = a * 91 + b (max 90 * 91 + 90 = 8280 < 8281)
  // coveredTriplets: index = a * 8281 + b * 91 + c (max 90 * 8281 + 90 * 91 + 90 = 753570 < 753571)
  const coveredPairs = new Uint8Array(8281);
  const coveredTriplets = new Uint8Array(753571);

  // Pre-calculate static soft-filter penalties and 3x30-bit masks for all candidates once
  const filterPenalties = new Float64Array(numCandidates);
  const candM0 = new Int32Array(numCandidates);
  const candM1 = new Int32Array(numCandidates);
  const candM2 = new Int32Array(numCandidates);

  for (let i = 0; i < numCandidates; i++) {
    const c = candidates[i];
    if (filters) {
      filterPenalties[i] = computeFilterPenalty(c, filters);
    }
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    for (let k = 0; k < 6; k++) {
      const num = c[k];
      if (num <= 30) m0 |= 1 << (num - 1);
      else if (num <= 60) m1 |= 1 << (num - 31);
      else m2 |= 1 << (num - 61);
    }
    candM0[i] = m0;
    candM1[i] = m1;
    candM2[i] = m2;
  }

  const usedCandidate = new Uint8Array(numCandidates);
  const selectedIndices: number[] = [];
  const overUseMultiplier = coverageTarget === 'terni' ? 6 : 15;
  const underUseBonus = coverageTarget === 'terni' ? 4 : 10;

  function evaluateCandidate(candIdx: number): number {
    const combo = candidates[candIdx];
    const filterPenalty = filterPenalties[candIdx];
    let score = 0;
    let balancePenalty = 0;

    for (let i = 0; i < 6; i++) {
      const num = combo[i];
      const currentCount = numberUsage[num];
      if (currentCount >= targetNumberPresence) {
        const diff = currentCount - targetNumberPresence + 1;
        balancePenalty += diff * diff * overUseMultiplier;
      } else {
        score += underUseBonus;
      }
    }

    // Check maximum shared numbers (Hamming overlap) with already selected columns
    let overlapPenalty = 0;
    const m0 = candM0[candIdx];
    const m1 = candM1[candIdx];
    const m2 = candM2[candIdx];
    for (let s = 0; s < selectedIndices.length; s++) {
      const sIdx = selectedIndices[s];
      const shared =
        popcnt32(m0 & candM0[sIdx]) +
        popcnt32(m1 & candM1[sIdx]) +
        popcnt32(m2 & candM2[sIdx]);
      if (shared >= 5) {
        overlapPenalty += 90;
      } else if (shared === 4 && targetCount <= 16) {
        overlapPenalty += 12;
      }
    }

    let newPairs = 0;
    let newTriplets = 0;
    let repeatedTriplets = 0;

    for (let i = 0; i < 6; i++) {
      const a = combo[i];
      const aPairOffset = a * 91;
      const aTripOffset = a * 8281;
      for (let j = i + 1; j < 6; j++) {
        const b = combo[j];
        const pairIdx = aPairOffset + b;
        if (coveredPairs[pairIdx] === 0) {
          newPairs++;
        }
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < 6; m++) {
          const c = combo[m];
          const tripIdx = abTripOffset + c;
          if (coveredTriplets[tripIdx] === 0) {
            newTriplets++;
          } else {
            repeatedTriplets++;
          }
        }
      }
    }

    if (coverageTarget === 'terni') {
      // Orthogonal C(v, 6, 3) mode: prioritize new triplets (t=3), penalize triplet collisions,
      // and subtract soft filterPenalty while ensuring candidates with newTriplets > 0 always beat 0-triplet candidates.
      const coverageProgressBonus = newTriplets > 0 ? 120 : 0;
      score +=
        coverageProgressBonus +
        newTriplets * 14 +
        newPairs * 1.5 -
        repeatedTriplets * 6 -
        balancePenalty -
        overlapPenalty -
        filterPenalty;
    } else {
      // Orthogonal C(v, 6, 2) mode: prioritize new pairs (t=2) and subtract soft filterPenalty
      const coverageProgressBonus = newPairs > 0 ? 120 : 0;
      score +=
        coverageProgressBonus +
        newPairs * 8 +
        newTriplets * 2 -
        balancePenalty -
        overlapPenalty -
        filterPenalty;
    }

    return score;
  }

  function addColumnToCover(candIdx: number) {
    const chosen = candidates[candIdx];
    for (let i = 0; i < 6; i++) {
      const a = chosen[i];
      if (poolMask[a] === 1) {
        numberUsage[a]++;
      }
      const aPairOffset = a * 91;
      const aTripOffset = a * 8281;
      for (let j = i + 1; j < 6; j++) {
        const b = chosen[j];
        const pairIdx = aPairOffset + b;
        if (coveredPairs[pairIdx] < 255) coveredPairs[pairIdx]++;
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < 6; m++) {
          const c = chosen[m];
          const tripIdx = abTripOffset + c;
          if (coveredTriplets[tripIdx] < 255) coveredTriplets[tripIdx]++;
        }
      }
    }
  }

  function removeColumnFromCover(candIdx: number): { lostPairs: number; lostTriplets: number } {
    const chosen = candidates[candIdx];
    let lostPairs = 0;
    let lostTriplets = 0;
    for (let i = 0; i < 6; i++) {
      const a = chosen[i];
      if (poolMask[a] === 1) {
        numberUsage[a]--;
      }
      const aPairOffset = a * 91;
      const aTripOffset = a * 8281;
      for (let j = i + 1; j < 6; j++) {
        const b = chosen[j];
        const pairIdx = aPairOffset + b;
        if (coveredPairs[pairIdx] > 0) {
          coveredPairs[pairIdx]--;
          if (coveredPairs[pairIdx] === 0) lostPairs++;
        }
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < 6; m++) {
          const c = chosen[m];
          const tripIdx = abTripOffset + c;
          if (coveredTriplets[tripIdx] > 0) {
            coveredTriplets[tripIdx]--;
            if (coveredTriplets[tripIdx] === 0) lostTriplets++;
          }
        }
      }
    }
    return { lostPairs, lostTriplets };
  }

  while (selectedIndices.length < targetCount) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < numCandidates; i++) {
      if (usedCandidate[i] === 1) continue;
      const score = evaluateCandidate(i);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      break;
    }

    usedCandidate[bestIdx] = 1;
    selectedIndices.push(bestIdx);
    addColumnToCover(bestIdx);
  }

  // Phase 2: 2-Opt Kempe-Swap Monotonic Local Search Refinement
  // Attempts 1-for-1 swaps that strictly increase covered triplets/pairs without increasing filter penalty
  if (selectedIndices.length >= 2 && numCandidates <= 5500) {
    const maxRefinementPasses = numCandidates <= 1500 ? 2 : 1;
    for (let pass = 0; pass < maxRefinementPasses; pass++) {
      let improvedInPass = false;
      for (let slot = 0; slot < selectedIndices.length; slot++) {
        const oldIdx = selectedIndices[slot];
        const oldPenalty = filterPenalties[oldIdx];
        const { lostPairs, lostTriplets } = removeColumnFromCover(oldIdx);

        let bestReplacementIdx = -1;
        let bestGainPrimary = coverageTarget === 'terni' ? lostTriplets : lostPairs;
        let bestGainSecondary = coverageTarget === 'terni' ? lostPairs : lostTriplets;
        let bestReplacementPenalty = oldPenalty;

        for (let i = 0; i < numCandidates; i++) {
          if (usedCandidate[i] === 1) continue;
          const candPen = filterPenalties[i];
          if (candPen > oldPenalty) continue;

          // Check max overlap with remaining selected columns
          const m0 = candM0[i];
          const m1 = candM1[i];
          const m2 = candM2[i];
          let hasExcessiveOverlap = false;
          for (let s = 0; s < selectedIndices.length; s++) {
            if (s === slot) continue;
            const sIdx = selectedIndices[s];
            const shared =
              popcnt32(m0 & candM0[sIdx]) +
              popcnt32(m1 & candM1[sIdx]) +
              popcnt32(m2 & candM2[sIdx]);
            if (shared >= 5) {
              hasExcessiveOverlap = true;
              break;
            }
          }
          if (hasExcessiveOverlap) continue;

          const combo = candidates[i];
          let gainedPairs = 0;
          let gainedTriplets = 0;
          for (let aIdx = 0; aIdx < 6; aIdx++) {
            const a = combo[aIdx];
            const aPairOffset = a * 91;
            const aTripOffset = a * 8281;
            for (let bIdx = aIdx + 1; bIdx < 6; bIdx++) {
              const b = combo[bIdx];
              if (coveredPairs[aPairOffset + b] === 0) gainedPairs++;
              const abTripOffset = aTripOffset + b * 91;
              for (let cIdx = bIdx + 1; cIdx < 6; cIdx++) {
                const c = combo[cIdx];
                if (coveredTriplets[abTripOffset + c] === 0) gainedTriplets++;
              }
            }
          }

          const primary = coverageTarget === 'terni' ? gainedTriplets : gainedPairs;
          const secondary = coverageTarget === 'terni' ? gainedPairs : gainedTriplets;

          const isBetterCoverage =
            primary > bestGainPrimary ||
            (primary === bestGainPrimary && secondary > bestGainSecondary) ||
            (primary === bestGainPrimary &&
              secondary === bestGainSecondary &&
              candPen < bestReplacementPenalty);

          if (isBetterCoverage) {
            bestGainPrimary = primary;
            bestGainSecondary = secondary;
            bestReplacementPenalty = candPen;
            bestReplacementIdx = i;
          }
        }

        if (bestReplacementIdx !== -1) {
          usedCandidate[oldIdx] = 0;
          usedCandidate[bestReplacementIdx] = 1;
          selectedIndices[slot] = bestReplacementIdx;
          addColumnToCover(bestReplacementIdx);
          improvedInPass = true;
        } else {
          // Restore original column
          addColumnToCover(oldIdx);
        }
      }
      if (!improvedInPass) break;
    }
  }

  return selectedIndices.map((idx) => candidates[idx]);
}

/**
 * Calculate coverage metrics for the chosen columns using flat Uint8Array indexing
 */
export function computeCoverageMetrics(
  columns: number[][],
  poolNumbers: number[]
) {
  const sortedPool = [...poolNumbers].sort((a, b) => a - b);
  const v = sortedPool.length;
  const pairsTotalInPool = v >= 2 ? (v * (v - 1)) / 2 : 0;
  const tripletsTotalInPool = v >= 3 ? (v * (v - 1) * (v - 2)) / 6 : 0;

  const poolMask = new Uint8Array(91);
  const presence: Record<number, number> = {};
  for (let i = 0; i < sortedPool.length; i++) {
    const n = sortedPool[i];
    poolMask[n] = 1;
    presence[n] = 0;
  }

  const coveredPairs = new Uint8Array(8281);
  const coveredTriplets = new Uint8Array(753571);
  let pairsCoveredCount = 0;
  let tripletsCoveredCount = 0;

  for (const col of columns) {
    for (let i = 0; i < col.length; i++) {
      const a = col[i];
      if (poolMask[a] === 1) {
        presence[a]++;
      }
      const aPairOffset = a * 91;
      const aTripOffset = a * 8281;
      for (let j = i + 1; j < col.length; j++) {
        const b = col[j];
        if (poolMask[a] === 1 && poolMask[b] === 1) {
          const pairIdx = aPairOffset + b;
          if (coveredPairs[pairIdx] === 0) {
            coveredPairs[pairIdx] = 1;
            pairsCoveredCount++;
          }
        }
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < col.length; m++) {
          const c = col[m];
          if (poolMask[a] === 1 && poolMask[b] === 1 && poolMask[c] === 1) {
            const tripIdx = abTripOffset + c;
            if (coveredTriplets[tripIdx] === 0) {
              coveredTriplets[tripIdx] = 1;
              tripletsCoveredCount++;
            }
          }
        }
      }
    }
  }

  // Compute maximum overlap between any pair of columns and minimum Hamming distance
  let maxColumnOverlap = 0;
  if (columns.length >= 2) {
    const colM0 = new Int32Array(columns.length);
    const colM1 = new Int32Array(columns.length);
    const colM2 = new Int32Array(columns.length);
    for (let c = 0; c < columns.length; c++) {
      let m0 = 0, m1 = 0, m2 = 0;
      for (const num of columns[c]) {
        if (num <= 30) m0 |= 1 << (num - 1);
        else if (num <= 60) m1 |= 1 << (num - 31);
        else m2 |= 1 << (num - 61);
      }
      colM0[c] = m0;
      colM1[c] = m1;
      colM2[c] = m2;
    }
    for (let i = 0; i < columns.length; i++) {
      for (let j = i + 1; j < columns.length; j++) {
        const shared =
          popcnt32(colM0[i] & colM0[j]) +
          popcnt32(colM1[i] & colM1[j]) +
          popcnt32(colM2[i] & colM2[j]);
        if (shared > maxColumnOverlap) maxColumnOverlap = shared;
      }
    }
  }
  const minHammingDistance = columns.length >= 2 ? 12 - 2 * maxColumnOverlap : 12;

  const presenceValues = Object.values(presence);
  const avgPresence =
    presenceValues.length > 0
      ? presenceValues.reduce((a, b) => a + b, 0) / presenceValues.length
      : 0;

  return {
    poolSize: sortedPool.length,
    pairsCoveredCount,
    pairsTotalInPool,
    tripletsCoveredCount,
    tripletsTotalInPool,
    averagePresence: Number(avgPresence.toFixed(2)),
    presenceHistogram: presence,
    maxColumnOverlap,
    minHammingDistance
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

export interface FunnelCandidateScore {
  num: number;
  score: number;
  sameDecadeCount: number;
  sameCadenceCount: number;
  adjacentCount: number;
  isPolarized: boolean;
  dispersionPenalty: number;
}

export interface FunnelPoolSelectionResult {
  geneticCandidates: number[];
  chaosNumbers: number[];
  pool30: number[];
  scoredPool: FunnelCandidateScore[];
  top12Numbers: number[];
}

/**
 * Extracts the top N (default 25) numbers from a scored number ranking.
 */
export function generateGeneticTopNumbers(
  scoredNumbers: Array<NumberStat | { number: number; score?: number; compositeScore?: number } | number>,
  count: number = 25
): number[] {
  const result: number[] = [];
  for (const item of scoredNumbers) {
    const num = typeof item === 'number' ? item : item.number;
    if (num >= 1 && num <= 90 && !result.includes(num)) {
      result.push(num);
      if (result.length === count) break;
    }
  }
  for (let n = 1; n <= 90 && result.length < count; n++) {
    if (!result.includes(n)) result.push(n);
  }
  return result;
}

/**
 * Scores a 30-number candidate pool in Pure Competition (Opzione 1):
 * - Bonus Clustering: +20 per same decade mate, +15 per same cadence mate, +30 per adjacent (±1 / ±2) mate
 * - Bonus Polarizzazione: +35 for extreme ranges (1–15 and 76–90)
 * - Penalità Dispersione: -60 for completely isolated numbers (0 decade mates & 0 adjacent),
 *   -25 for single-decade without decade mates, and -20 for isolated middle-board numbers (31–60 with 0 adjacent)
 */
export function scorePool30InPureCompetition(pool30: number[]): FunnelCandidateScore[] {
  return pool30.map((num) => {
    let score = 0;

    const decade = Math.floor((num - 1) / 10);
    const cadence = num % 10;

    // Conta i compagni nel pool dei 30
    const sameDecadeCount = pool30.filter(
      (n) => n !== num && Math.floor((n - 1) / 10) === decade
    ).length;
    const sameCadenceCount = pool30.filter(
      (n) => n !== num && n % 10 === cadence
    ).length;
    const adjacentCount = pool30.filter(
      (n) => n !== num && Math.abs(n - num) <= 2
    ).length;

    // BONUS CLUSTERING
    score += sameDecadeCount * 20;
    score += sameCadenceCount * 15;
    score += adjacentCount * 30;

    // BONUS POLARIZZAZIONE (Estremi del tabellone)
    const isPolarized = num <= 15 || num >= 76;
    if (isPolarized) {
      score += 35;
    }

    // PENALITÀ DISPERSIONE (Isolati e fascia centrale senza cluster)
    let dispersionPenalty = 0;
    if (sameDecadeCount === 0 && adjacentCount === 0) {
      score -= 60; // Penalità pesante per numeri completamente isolati
      dispersionPenalty += 60;
    } else if (sameDecadeCount === 0) {
      score -= 25; // Penalità media per decina singola
      dispersionPenalty += 25;
    }

    if (num >= 31 && num <= 60 && adjacentCount === 0) {
      score -= 20; // Penalizza la "pancia" dispersa del tabellone
      dispersionPenalty += 20;
    }

    return {
      num,
      score,
      sameDecadeCount,
      sameCadenceCount,
      adjacentCount,
      isPolarized,
      dispersionPenalty
    };
  });
}

/**
 * Pipeline a Imbuto (90 -> 30 -> 12) in Competizione Pura con Polarizzazione e Penalità Dispersione:
 * 1. Estrae i 25 migliori candidati dal motore genetico/statistico esistente
 * 2. Inietta 5 numeri casuali (Math.random() univoci tra 1 e 90) per formare un pool di 30 candidati
 * 3. Valuta tutti e 30 i candidati alla pari con scorePool30InPureCompetition (Clustering + Polarizzazione - Dispersione)
 * 4. Seleziona i Top 12 (o targetSize) ordinati in modo crescente da passare alla matrice ortogonale C(12,6,3)
 */
export function selectFunnelPool30To12(
  scoredOrRankedInput: Array<NumberStat | { number: number; score?: number; compositeScore?: number } | number>,
  targetSize: number = 12,
  rng: () => number = Math.random
): FunnelPoolSelectionResult {
  // 1. Genera i 25 candidati dal motore genetico esistente
  const geneticCandidates: number[] = generateGeneticTopNumbers(scoredOrRankedInput, 25);

  // 2. Inietta 5 numeri di puro caos (senza duplicati) per arrivare a 30
  const pool30: number[] = [...geneticCandidates];
  const chaosNumbers: number[] = [];
  let safetyCounter = 0;
  while (pool30.length < 30 && safetyCounter < 1000) {
    safetyCounter++;
    const randomNum = Math.floor(rng() * 90) + 1;
    if (!pool30.includes(randomNum)) {
      pool30.push(randomNum);
      chaosNumbers.push(randomNum);
    }
  }
  for (let n = 1; n <= 90 && pool30.length < 30; n++) {
    if (!pool30.includes(n)) {
      pool30.push(n);
      chaosNumbers.push(n);
    }
  }

  // 3. Scoring in Competizione Pura (Clustering + Polarizzazione + Penalità Dispersione)
  const scoredPool = scorePool30InPureCompetition(pool30);

  // 4. Estrazione Top 12 (o targetSize) finali per la matrice C(12,6,3)
  const clampedTargetSize = Math.min(30, Math.max(6, Math.round(targetSize || 12)));
  const top12Numbers: number[] = [...scoredPool]
    .sort((a, b) => b.score - a.score)
    .slice(0, clampedTargetSize)
    .map((item) => item.num)
    .sort((a, b) => a - b);

  return {
    geneticCandidates,
    chaosNumbers,
    pool30,
    scoredPool,
    top12Numbers
  };
}

/**
 * Full Pipeline: Generates the optimized SuperEnalotto system using Soft-Penalty Orthogonal Reduction.
 * Disables the legacy Dispersione Decine filter weight in the final reduction phase so that
 * clustered/polarized pairs from the 30->12 funnel can form optimal triplets in C(12,6,3).
 */
export function generateOptimizedSystem(
  poolNumbers: number[],
  filters: FilterOptions,
  targetColumnsCount: number,
  superstarPool?: number[],
  coverageTarget: CoverageTarget = 'terni'
): SystemGenerationResult {
  const startTime = performance.now();
  const sortedPool = [...poolNumbers].sort((a, b) => a - b);

  // Disable legacy decade dispersion filter during final reduction (Fase 2 specification)
  const effectiveFilters: FilterOptions = {
    ...filters,
    decades: false
  };

  // 1. Generate all C(v, 6) integral combinations
  const allCombos = generateCombinations(sortedPool, 6);

  // 2. Count zero-penalty combinations for diagnostic reporting, while passing ALL combinations
  // to greedyCoveringReduction with soft-penalty scoring so the mathematical covering matrix is never broken
  let zeroPenaltyCount = 0;
  for (let i = 0; i < allCombos.length; i++) {
    if (computeFilterPenalty(allCombos[i], effectiveFilters) === 0) {
      zeroPenaltyCount++;
    }
  }

  // 3. Greedy Covering Design (t=3 for terni or t=2 for ambi) with integrated Soft-Filter Penalty
  const selectedCombos = greedyCoveringReduction(
    allCombos,
    sortedPool,
    targetColumnsCount,
    coverageTarget,
    effectiveFilters
  );

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
    filteredCombinationsCount: zeroPenaltyCount,
    executionTimeMs: Math.round(endTime - startTime),
    coverageTarget,
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

export const MIN_ARCHIVE_COMPARISON_DRAWS = 10;
export const MAX_ARCHIVE_COMPARISON_DRAWS = 200;
export const PRESET_ARCHIVE_COMPARISON_COUNTS = [10, 25, 50, 100, 150, 200] as const;

export function clampArchiveComparisonDrawsCount(count: number): number {
  if (!Number.isFinite(count) || Number.isNaN(count)) return 50;
  return Math.max(
    MIN_ARCHIVE_COMPARISON_DRAWS,
    Math.min(MAX_ARCHIVE_COMPARISON_DRAWS, Math.round(count))
  );
}

export interface ArchiveDrawPlayComparisonRow {
  draw: Draw;
  matchedNumbersInPlay: number[];
  jollyMatchedInPlay: boolean;
  superstarMatchedInPlay: boolean;
  playResult: PlayResult;
  winningColumnsCount: number;
  bestColumnId: number | null;
  bestPrizeTier: string;
  costForDraw: number;
  grossWinForDraw: number;
  netReturnForDraw: number;
}

export interface SavedPlayArchiveComparisonSummary {
  playId: string;
  drawsRequested: number;
  drawsEvaluatedCount: number;
  costPerDraw: number;
  totalSpent: number; // Quanto ho speso
  grossWinnings: number; // Utile Lordo (Quanto ho guadagnato al lordo)
  netProfitLoss: number; // Utile Netto (Utile Lordo - Spesa Totale)
  roiPercentage: number;
  winningDrawsCount: number;
  totalMatchedNumbersCount: number;
  tierBreakdown: {
    points2: number;
    points3: number;
    points4: number;
    points5: number;
    points5plus1: number;
    points6: number;
    superstarHits: number;
  };
  numberHitCounts: Record<number, number>;
  playNumbersSet: number[];
  playSuperstarsSet: number[];
  rows: ArchiveDrawPlayComparisonRow[];
}

/**
 * Confronta una giocata registrata in Verifica & Bilancio con le ultime N estrazioni (10..200).
 * Evidenzia i numeri estratti presenti nella giocata e calcola Spesa Totale, Utile Lordo e Utile Netto.
 */
export function compareSavedPlayAgainstRecentDraws(
  play: SavedPlay,
  allDraws: Draw[],
  requestedDrawsCount: number
): SavedPlayArchiveComparisonSummary {
  const clampedCount = clampArchiveComparisonDrawsCount(requestedDrawsCount);
  const sortedDraws = [...allDraws].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const recentDraws = sortedDraws.slice(0, clampedCount);

  const playNumsSet = new Set<number>();
  const playStarsSet = new Set<number>();
  const numberHitCounts: Record<number, number> = {};

  for (const col of play.columns) {
    for (const n of col.numbers) {
      playNumsSet.add(n);
      numberHitCounts[n] = 0;
    }
    if (col.superstar !== undefined) {
      playStarsSet.add(col.superstar);
    }
  }
  for (const n of play.poolNumbers || []) {
    playNumsSet.add(n);
    if (numberHitCounts[n] === undefined) numberHitCounts[n] = 0;
  }

  const costPerDraw =
    typeof play.cost === 'number' && play.cost > 0
      ? Number(play.cost.toFixed(2))
      : Number(
          (
            play.columns.length *
            (play.columns.some((c) => c.superstar !== undefined) ? 1.5 : 1.0)
          ).toFixed(2)
        );

  let totalSpent = 0;
  let grossWinnings = 0;
  let winningDrawsCount = 0;
  let totalMatchedNumbersCount = 0;

  const tierBreakdown = {
    points2: 0,
    points3: 0,
    points4: 0,
    points5: 0,
    points5plus1: 0,
    points6: 0,
    superstarHits: 0
  };

  const rows: ArchiveDrawPlayComparisonRow[] = [];

  for (const draw of recentDraws) {
    const evalRes = evaluatePlayedSystem(play.columns, draw, costPerDraw);
    const matchedNumbersInPlay = draw.numbers.filter((n) => playNumsSet.has(n));
    for (const m of matchedNumbersInPlay) {
      numberHitCounts[m] = (numberHitCounts[m] || 0) + 1;
    }
    totalMatchedNumbersCount += matchedNumbersInPlay.length;

    const jollyMatchedInPlay = playNumsSet.has(draw.jolly);
    const superstarMatchedInPlay =
      draw.superstar !== undefined && playStarsSet.has(draw.superstar);

    let winningColumnsCount = 0;
    let bestColumnId: number | null = null;
    let bestPrizeTier = 'Nessun Punto';
    let highestColPrize = -1;

    for (const colMatch of evalRes.matchesPerColumn) {
      if (colMatch.estimatedPrize > 0) {
        winningColumnsCount++;
      }
      if (colMatch.estimatedPrize > highestColPrize && colMatch.estimatedPrize > 0) {
        highestColPrize = colMatch.estimatedPrize;
        bestColumnId = colMatch.columnId;
        bestPrizeTier = colMatch.prizeTier;
      } else if (bestColumnId === null && colMatch.matchCount > 0) {
        bestColumnId = colMatch.columnId;
      }

      if (colMatch.matchCount === 6) tierBreakdown.points6++;
      else if (colMatch.matchCount === 5 && colMatch.hasJolly) tierBreakdown.points5plus1++;
      else if (colMatch.matchCount === 5) tierBreakdown.points5++;
      else if (colMatch.matchCount === 4) tierBreakdown.points4++;
      else if (colMatch.matchCount === 3) tierBreakdown.points3++;
      else if (colMatch.matchCount === 2) tierBreakdown.points2++;

      if (colMatch.hasSuperstar) {
        tierBreakdown.superstarHits++;
      }
    }

    const grossWinForDraw = Number(evalRes.totalWinning.toFixed(2));
    const netReturnForDraw = Number((grossWinForDraw - costPerDraw).toFixed(2));

    totalSpent = Number((totalSpent + costPerDraw).toFixed(2));
    grossWinnings = Number((grossWinnings + grossWinForDraw).toFixed(2));
    if (grossWinForDraw > 0) {
      winningDrawsCount++;
    }

    rows.push({
      draw,
      matchedNumbersInPlay,
      jollyMatchedInPlay,
      superstarMatchedInPlay,
      playResult: evalRes,
      winningColumnsCount,
      bestColumnId,
      bestPrizeTier,
      costForDraw: costPerDraw,
      grossWinForDraw,
      netReturnForDraw
    });
  }

  const netProfitLoss = Number((grossWinnings - totalSpent).toFixed(2));
  const roiPercentage =
    totalSpent > 0 ? Number(((netProfitLoss / totalSpent) * 100).toFixed(2)) : 0;

  return {
    playId: play.id,
    drawsRequested: clampedCount,
    drawsEvaluatedCount: recentDraws.length,
    costPerDraw,
    totalSpent,
    grossWinnings,
    netProfitLoss,
    roiPercentage,
    winningDrawsCount,
    totalMatchedNumbersCount,
    tierBreakdown,
    numberHitCounts,
    playNumbersSet: Array.from(playNumsSet).sort((a, b) => a - b),
    playSuperstarsSet: Array.from(playStarsSet).sort((a, b) => a - b),
    rows
  };
}

