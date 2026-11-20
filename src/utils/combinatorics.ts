/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Draw,
  SisalDrawRecord,
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
 * Cryptographically strong unbiased random integer in [0, maxExclusive - 1]
 * using window.crypto.getRandomValues() / globalThis.crypto.getRandomValues() with rejection sampling.
 */
export function getCryptoRandomInt(maxExclusive: number): number {
  const n = Math.floor(maxExclusive);
  if (n <= 1) return 0;
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    const maxUint32 = 0x100000000;
    const limit = maxUint32 - (maxUint32 % n);
    while (true) {
      cryptoObj.getRandomValues(buf);
      const val = buf[0];
      if (val < limit) {
        return val % n;
      }
    }
  }
  return Math.floor(Math.random() * n);
}

/**
 * Cryptographically strong random float in (0, 1) using crypto.getRandomValues()
 */
export function getCryptoRandomFloat(): number {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    cryptoObj.getRandomValues(buf);
    return (buf[0] + 0.5) / 0x100000000;
  }
  return Math.random();
}

/**
 * Authentic Fisher-Yates shuffle without replacement using crypto.getRandomValues().
 * Every permutation is strictly equiprobable; no bias on decades, parity, or central/extreme numbers.
 */
export function fisherYatesCryptoShuffle(items: readonly number[]): number[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = getCryptoRandomInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export type PoolSelectionMode = 'pure_uniform' | 'real_archive_weighted';

export interface FairPoolSelectionResult {
  selectedNumbers: number[];
  modeUsed: PoolSelectionMode;
  effectiveArchiveDrawsCount: number;
  numberWeights: Record<number, number>;
}

/**
 * Selezione Equa e Non Truccata del Pool (default 12 numeri da 1 a 90):
 * - Nessun limite forzato sulle decine (es. nessun "max 2" o "max 3 per decina")
 * - Nessun filtro forzato su Pari/Dispari o Alto/Basso
 * - Nessun bonus o penalità arbitraria su numeri centrali o estremi
 * - Campionamento senza reinserimento tramite window.crypto.getRandomValues() (Fisher-Yates)
 * - Modalità 'pure_uniform': 100% equiprobabile pura su 1..90
 * - Modalità 'real_archive_weighted': attiva solo se draws.length > 0; applica una lieve pesatura
 *   basata esclusivamente sulle estrazioni reali in archivio senza mai escludere alcun numero.
 */
export function selectFairPoolNumbers(params?: {
  draws?: Draw[];
  weights?: ScoringWeights;
  targetSize?: number;
  mode?: PoolSelectionMode;
  universeMax?: number;
}): FairPoolSelectionResult {
  const universeMax = Math.max(6, Math.round(params?.universeMax || 90));
  const targetSize = Math.min(universeMax, Math.max(6, Math.round(params?.targetSize || 12)));
  const draws = Array.isArray(params?.draws) ? params!.draws : [];
  const requestedMode: PoolSelectionMode = params?.mode || 'pure_uniform';
  const effectiveMode: PoolSelectionMode =
    requestedMode === 'real_archive_weighted' && draws.length > 0
      ? 'real_archive_weighted'
      : 'pure_uniform';

  const universe: number[] = [];
  const numberWeights: Record<number, number> = {};
  for (let n = 1; n <= universeMax; n++) {
    universe.push(n);
    numberWeights[n] = 1.0;
  }

  if (effectiveMode === 'pure_uniform') {
    const shuffled = fisherYatesCryptoShuffle(universe);
    const selectedNumbers = shuffled.slice(0, targetSize).sort((a, b) => a - b);
    return {
      selectedNumbers,
      modeUsed: 'pure_uniform',
      effectiveArchiveDrawsCount: draws.length,
      numberWeights
    };
  }

  // Modalità 'real_archive_weighted' (solo con estrazioni reali in archivio):
  // Lieve pesatura basata esclusivamente sulle estrazioni reali, senza mai escludere alcun numero
  const weights: ScoringWeights = params?.weights || {
    wDelay: 0.5,
    wFrequency: 0.3,
    wAffinity: 0.2
  };
  const stats = calculateNumberStatistics(draws, 36);
  const scored = scoreAllNumbers(stats, weights, 36);
  for (const s of scored) {
    if (s.number >= 1 && s.number <= universeMax) {
      // Peso base 1.0 + modulazione morbida [0..0.75] dallo storico reale:
      // ogni numero mantiene dignità e probabilità positiva di estrazione
      numberWeights[s.number] = Number((1.0 + Math.max(0, s.compositeScore) * 0.75).toFixed(4));
    }
  }

  // Campionamento ponderato senza reinserimento con entropia crittografica (crypto.getRandomValues)
  const remaining = [...universe];
  const selected: number[] = [];

  for (let pick = 0; pick < targetSize && remaining.length > 0; pick++) {
    let totalWeight = 0;
    for (let i = 0; i < remaining.length; i++) {
      totalWeight += numberWeights[remaining[i]] || 1.0;
    }

    let threshold = getCryptoRandomFloat() * totalWeight;
    let chosenIdx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      threshold -= numberWeights[remaining[i]] || 1.0;
      if (threshold <= 0) {
        chosenIdx = i;
        break;
      }
    }

    selected.push(remaining[chosenIdx]);
    // Rimozione O(1) estilo Fisher-Yates
    remaining[chosenIdx] = remaining[remaining.length - 1];
    remaining.pop();
  }

  return {
    selectedNumbers: selected.sort((a, b) => a - b),
    modeUsed: 'real_archive_weighted',
    effectiveArchiveDrawsCount: draws.length,
    numberWeights
  };
}

/**
 * Validazione rigorosa di un'estrazione reale SuperEnalotto secondo lo schema ufficiale Sisal:
 * {
 *   "concorso": number,
 *   "data": "YYYY-MM-DD",
 *   "sestina": [n1, n2, n3, n4, n5, n6],
 *   "jolly": number,
 *   "superstar": number
 * }
 * - `sestina`: esattamente 6 interi univoci compresi tra 1 e 90, ordinati in modo crescente.
 * - `jolly`: intero tra 1 e 90 non presente in `sestina`.
 * - `superstar`: intero tra 1 e 90 (obbligatorio).
 * - `data`: stringa valida nel formato "YYYY-MM-DD".
 * - `concorso`: intero positivo (> 0).
 */
export function validateRealDrawInput(input: {
  id?: string;
  contestNumber?: number;
  concorso?: number;
  year?: number;
  date?: string;
  data?: string;
  numbers?: number[];
  sestina?: number[];
  jolly?: number;
  superstar?: number;
}): { valid: boolean; draw?: Draw; sisalRecord?: SisalDrawRecord; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Record estrazione mancante o non valido.' };
  }

  const rawNumbers = Array.isArray(input.sestina)
    ? input.sestina
    : Array.isArray(input.numbers)
    ? input.numbers
    : null;

  if (!rawNumbers) {
    return { valid: false, error: 'Inserire esattamente 6 numeri estratti validi (1–90).' };
  }

  const parsedNums = rawNumbers.map((n) => Number(n));
  if (
    parsedNums.length !== 6 ||
    parsedNums.some((n) => !Number.isInteger(n) || n < 1 || n > 90)
  ) {
    return {
      valid: false,
      error: 'I 6 numeri della sestina devono essere numeri interi compresi tra 1 e 90.'
    };
  }

  const uniqueNums = new Set(parsedNums);
  if (uniqueNums.size !== 6) {
    return {
      valid: false,
      error: 'I 6 numeri della sestina estratta devono essere tutti distinti (nessun duplicato).'
    };
  }

  const jolly = Number(input.jolly);
  if (!Number.isInteger(jolly) || jolly < 1 || jolly > 90) {
    return {
      valid: false,
      error: 'Il numero Jolly deve essere un intero compreso tra 1 e 90.'
    };
  }

  if (uniqueNums.has(jolly)) {
    return {
      valid: false,
      error: 'Il numero Jolly non può essere presente nella sestina estratta.'
    };
  }

  if (input.superstar === undefined || input.superstar === null || String(input.superstar).trim() === '') {
    return {
      valid: false,
      error: 'Il numero SuperStar è obbligatorio e deve essere un intero compreso tra 1 e 90.'
    };
  }

  const superstar = Number(input.superstar);
  if (!Number.isInteger(superstar) || superstar < 1 || superstar > 90) {
    return {
      valid: false,
      error: 'Il numero SuperStar deve essere un intero compreso tra 1 e 90.'
    };
  }

  const rawDateCandidate = String(input.data ?? input.date ?? '').trim();
  const rawDate = rawDateCandidate || new Date().toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return {
      valid: false,
      error: 'La data deve rispettare il formato YYYY-MM-DD.'
    };
  }

  const parsedDateYear = parseInt(rawDate.slice(0, 4), 10);
  const year =
    typeof input.year === 'number' && Number.isInteger(input.year) && input.year >= 1997
      ? input.year
      : parsedDateYear;

  const rawConcorso = input.concorso ?? input.contestNumber;
  let contestNumber = 1;
  if (rawConcorso !== undefined && rawConcorso !== null && String(rawConcorso).trim() !== '') {
    const parsedConcorso = Number(rawConcorso);
    if (!Number.isInteger(parsedConcorso) || parsedConcorso <= 0) {
      return {
        valid: false,
        error: 'Il numero di concorso deve essere un intero positivo.'
      };
    }
    contestNumber = parsedConcorso;
  } else if (typeof input.id === 'string' && /^\d{4}-\d+$/.test(input.id.trim())) {
    contestNumber = parseInt(input.id.trim().split('-')[1], 10) || 1;
  }

  const id = (input.id || '').trim() || `${year}-${String(contestNumber).padStart(3, '0')}`;

  const sortedNumbers = [...parsedNums].sort((a, b) => a - b) as [
    number,
    number,
    number,
    number,
    number,
    number
  ];

  const sisalRecord: SisalDrawRecord = {
    concorso: contestNumber,
    data: rawDate,
    sestina: sortedNumbers,
    jolly,
    superstar
  };

  return {
    valid: true,
    draw: {
      id,
      contestNumber,
      year,
      date: rawDate,
      numbers: sortedNumbers,
      jolly,
      superstar
    },
    sisalRecord
  };
}

/**
 * Converte un oggetto Draw nel formato ufficiale Sisal per estrazioni_sisal.json
 */
export function drawToSisalRecord(draw: Draw | SisalDrawRecord): SisalDrawRecord | null {
  const check = validateRealDrawInput(draw as Parameters<typeof validateRealDrawInput>[0]);
  return check.valid && check.sisalRecord ? check.sisalRecord : null;
}

function columnKey(col: readonly number[]): string {
  return [...col].sort((a, b) => a - b).join(',');
}

/**
 * Simmetria Matematica e Riduzione Onesta (Covering Design Ortogonale Bilanciato):
 * - Garantisce la rotazione perfettamente bilanciata: per un pool di v numeri ridotto in m sestine,
 *   ogni numero compare tra floor(6*m/v) e ceil(6*m/v) volte.
 *   In particolare, per 12 numeri in 10 sestine (12 x 5 = 60 = 10 x 6), OGNI numero compare ESATTAMENTE 5 VOLTE.
 * - Garantisce ZERO sestine duplicate.
 * - Massimizza la copertura uniforme di ambi (coppie) e terni (terzine) tra i numeri scelti
 *   senza scartare combinazioni valide per somma o decina.
 */
export function greedyCoveringReduction(
  candidates: number[][],
  poolNumbers: number[],
  targetCount: number,
  coverageTarget: CoverageTarget = 'terni',
  filters?: FilterOptions
): number[][] {
  const uniquePool = Array.from(new Set(poolNumbers.filter((n) => n >= 1 && n <= 90))).sort(
    (a, b) => a - b
  );
  const v = uniquePool.length;

  // Ensure we always work on the complete integral C(v, 6) space if candidates were pre-filtered too aggressively
  const fullPoolCombos =
    v >= 6 && candidates.length < targetCount ? generateCombinations(uniquePool, 6) : candidates;

  const numCandidates = fullPoolCombos.length;
  if (numCandidates === 0 || targetCount <= 0) {
    return [];
  }
  if (numCandidates <= targetCount) {
    return fullPoolCombos.map((c) => [...c].sort((a, b) => a - b));
  }

  const poolMask = new Uint8Array(91);
  const numberUsage = new Int32Array(91);
  for (let i = 0; i < uniquePool.length; i++) {
    poolMask[uniquePool[i]] = 1;
  }

  // Exact degree symmetry bounds: L = floor(6*m/v), U = ceil(6*m/v).
  // For v = 12, targetCount = 10: L = 5, U = 5 (every number MUST appear exactly 5 times).
  const exactQuota = (targetCount * 6) / Math.max(v, 1);
  const minDegreeL = Math.floor(exactQuota + 1e-9);
  const maxDegreeU = Math.ceil(exactQuota - 1e-9);

  const coveredPairs = new Uint8Array(8281);
  const coveredTriplets = new Uint8Array(753571);

  const filterPenalties = new Float64Array(numCandidates);
  const candM0 = new Int32Array(numCandidates);
  const candM1 = new Int32Array(numCandidates);
  const candM2 = new Int32Array(numCandidates);

  const hasActiveFilter = Boolean(
    filters &&
      (filters.evenOdd ||
        filters.highLow ||
        filters.sumRange ||
        filters.consecutive ||
        filters.decades ||
        filters.cadences)
  );

  for (let i = 0; i < numCandidates; i++) {
    const c = fullPoolCombos[i];
    if (hasActiveFilter && filters) {
      // Soft tie-breaker only: never overrides symmetry or pair/triplet coverage
      filterPenalties[i] = computeFilterPenalty(c, filters) * 0.02;
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

  function evaluateCandidate(candIdx: number): number {
    const combo = fullPoolCombos[candIdx];
    const filterPenalty = filterPenalties[candIdx];
    let score = 0;
    let balancePenalty = 0;

    for (let i = 0; i < 6; i++) {
      const num = combo[i];
      const currentCount = numberUsage[num];
      if (currentCount >= maxDegreeU) {
        // Hard deterrent against exceeding upper degree bound U
        const excess = currentCount - maxDegreeU + 1;
        balancePenalty += 2500 * excess * excess;
      } else if (currentCount < minDegreeL) {
        // Priority bonus to numbers still below lower degree bound L
        score += (minDegreeL - currentCount) * 35;
      } else {
        score += 10;
      }
    }

    // Overlap check with already selected columns (strictly forbid duplicates, penalize high overlap)
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
      if (shared === 6) {
        return -1e12; // Never select a duplicate sestina
      } else if (shared === 5) {
        overlapPenalty += 180;
      } else if (shared === 4) {
        overlapPenalty += 35;
      }
    }

    let newPairs = 0;
    let newTriplets = 0;
    let repeatedPairs = 0;
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
        } else {
          repeatedPairs += coveredPairs[pairIdx];
        }
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < 6; m++) {
          const c = combo[m];
          const tripIdx = abTripOffset + c;
          if (coveredTriplets[tripIdx] === 0) {
            newTriplets++;
          } else {
            repeatedTriplets += coveredTriplets[tripIdx];
          }
        }
      }
    }

    if (coverageTarget === 'terni') {
      score +=
        newTriplets * 28 +
        newPairs * 18 -
        repeatedTriplets * 6 -
        repeatedPairs * 1.5 -
        balancePenalty -
        overlapPenalty -
        filterPenalty;
    } else {
      score +=
        newPairs * 32 +
        newTriplets * 14 -
        repeatedPairs * 4 -
        repeatedTriplets * 3 -
        balancePenalty -
        overlapPenalty -
        filterPenalty;
    }

    return score;
  }

  function addColumnByNumbers(col: readonly number[]) {
    for (let i = 0; i < 6; i++) {
      const a = col[i];
      if (poolMask[a] === 1) {
        numberUsage[a]++;
      }
      const aPairOffset = a * 91;
      const aTripOffset = a * 8281;
      for (let j = i + 1; j < 6; j++) {
        const b = col[j];
        const pairIdx = aPairOffset + b;
        if (coveredPairs[pairIdx] < 255) coveredPairs[pairIdx]++;
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < 6; m++) {
          const c = col[m];
          const tripIdx = abTripOffset + c;
          if (coveredTriplets[tripIdx] < 255) coveredTriplets[tripIdx]++;
        }
      }
    }
  }

  function removeColumnByNumbers(col: readonly number[]) {
    for (let i = 0; i < 6; i++) {
      const a = col[i];
      if (poolMask[a] === 1) {
        numberUsage[a]--;
      }
      const aPairOffset = a * 91;
      const aTripOffset = a * 8281;
      for (let j = i + 1; j < 6; j++) {
        const b = col[j];
        const pairIdx = aPairOffset + b;
        if (coveredPairs[pairIdx] > 0) coveredPairs[pairIdx]--;
        const abTripOffset = aTripOffset + b * 91;
        for (let m = j + 1; m < 6; m++) {
          const c = col[m];
          const tripIdx = abTripOffset + c;
          if (coveredTriplets[tripIdx] > 0) coveredTriplets[tripIdx]--;
        }
      }
    }
  }

  // Step 1: Constrained Greedy Covering Selection
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

    if (bestIdx === -1) break;

    usedCandidate[bestIdx] = 1;
    selectedIndices.push(bestIdx);
    addColumnByNumbers(fullPoolCombos[bestIdx]);
  }

  // Mutable working copy of selected columns for exact degree balancing & 2-Opt Kempe swaps
  const workingColumns: number[][] = selectedIndices.map((idx) =>
    [...fullPoolCombos[idx]].sort((a, b) => a - b)
  );

  // Step 2: Deterministic Exact-Symmetry Repair Loop
  // Guarantees every pool number n has minDegreeL <= numberUsage[n] <= maxDegreeU
  // (for v = 12, targetCount = 10: every number appears EXACTLY 5 times) without creating duplicate columns.
  if (v >= 6 && workingColumns.length === targetCount) {
    const columnSet = new Set<string>(workingColumns.map(columnKey));
    let safetyIter = 0;

    while (safetyIter < 500) {
      safetyIter++;
      let overNum = -1;
      let underNum = -1;

      // Find any number exceeding maxDegreeU or below minDegreeL
      for (const n of uniquePool) {
        if (numberUsage[n] > maxDegreeU) {
          overNum = n;
          break;
        }
      }
      for (const n of uniquePool) {
        if (numberUsage[n] < minDegreeL) {
          underNum = n;
          break;
        }
      }

      // If no number violates L or U, exact symmetry is achieved!
      if (overNum === -1 && underNum === -1) {
        break;
      }

      // If overNum exists but all others are >= minDegreeL, pick any number with usage < maxDegreeU
      if (overNum !== -1 && underNum === -1) {
        for (const n of uniquePool) {
          if (numberUsage[n] < maxDegreeU) {
            underNum = n;
            break;
          }
        }
      }
      // If underNum exists but all others are <= maxDegreeU, pick any number with usage > minDegreeL
      if (underNum !== -1 && overNum === -1) {
        for (const n of uniquePool) {
          if (numberUsage[n] > minDegreeL) {
            overNum = n;
            break;
          }
        }
      }

      if (overNum === -1 || underNum === -1 || overNum === underNum) {
        break;
      }

      // Find the best column containing overNum and not containing underNum to replace overNum -> underNum
      let bestColIdx = -1;
      let bestCoverageScore = -Infinity;

      for (let cIdx = 0; cIdx < workingColumns.length; cIdx++) {
        const col = workingColumns[cIdx];
        if (!col.includes(overNum) || col.includes(underNum)) continue;

        const candidateCol = col.map((x) => (x === overNum ? underNum : x)).sort((a, b) => a - b);
        const key = columnKey(candidateCol);
        if (columnSet.has(key)) continue; // Never create duplicate sestine

        // Temporarily evaluate coverage change
        removeColumnByNumbers(col);
        let gainScore = 0;
        for (let i = 0; i < 6; i++) {
          const a = candidateCol[i];
          const aPairOffset = a * 91;
          const aTripOffset = a * 8281;
          for (let j = i + 1; j < 6; j++) {
            const b = candidateCol[j];
            if (coveredPairs[aPairOffset + b] === 0) gainScore += 25;
            const abTripOffset = aTripOffset + b * 91;
            for (let m = j + 1; m < 6; m++) {
              const c = candidateCol[m];
              if (coveredTriplets[abTripOffset + c] === 0) gainScore += 30;
            }
          }
        }
        addColumnByNumbers(col);

        if (gainScore > bestCoverageScore) {
          bestCoverageScore = gainScore;
          bestColIdx = cIdx;
        }
      }

      if (bestColIdx !== -1) {
        const oldCol = workingColumns[bestColIdx];
        const newCol = oldCol.map((x) => (x === overNum ? underNum : x)).sort((a, b) => a - b);
        columnSet.delete(columnKey(oldCol));
        removeColumnByNumbers(oldCol);
        workingColumns[bestColIdx] = newCol;
        addColumnByNumbers(newCol);
        columnSet.add(columnKey(newCol));
      } else {
        break;
      }
    }
  }

  // Step 3: Degree-Preserving 2-Opt Kempe Element Swaps
  // Swapping x in Col A with y in Col B (where x not in B and y not in A)
  // STRICTLY PRESERVES the exact frequency of every single number (e.g. 5x each)
  // while maximizing total covered pairs and triplets and minimizing max column overlap.
  if (workingColumns.length >= 2 && workingColumns.length <= 40) {
    const columnSet = new Set<string>(workingColumns.map(columnKey));

    function computeCurrentObjective(): { pairs: number; triplets: number; maxOverlap: number } {
      let pairs = 0;
      let triplets = 0;
      for (let i = 0; i < uniquePool.length; i++) {
        const a = uniquePool[i];
        const aPairOffset = a * 91;
        const aTripOffset = a * 8281;
        for (let j = i + 1; j < uniquePool.length; j++) {
          const b = uniquePool[j];
          if (coveredPairs[aPairOffset + b] > 0) pairs++;
          const abTripOffset = aTripOffset + b * 91;
          for (let m = j + 1; m < uniquePool.length; m++) {
            const c = uniquePool[m];
            if (coveredTriplets[abTripOffset + c] > 0) triplets++;
          }
        }
      }
      let maxOverlap = 0;
      for (let i = 0; i < workingColumns.length; i++) {
        for (let j = i + 1; j < workingColumns.length; j++) {
          let shared = 0;
          const colA = workingColumns[i];
          const colB = workingColumns[j];
          let pA = 0;
          let pB = 0;
          while (pA < 6 && pB < 6) {
            if (colA[pA] === colB[pB]) {
              shared++;
              pA++;
              pB++;
            } else if (colA[pA] < colB[pB]) {
              pA++;
            } else {
              pB++;
            }
          }
          if (shared > maxOverlap) maxOverlap = shared;
        }
      }
      return { pairs, triplets, maxOverlap };
    }

    let currentObj = computeCurrentObjective();
    const maxKempePasses = 6;

    for (let pass = 0; pass < maxKempePasses; pass++) {
      let improved = false;

      for (let c1 = 0; c1 < workingColumns.length; c1++) {
        for (let c2 = c1 + 1; c2 < workingColumns.length; c2++) {
          const col1 = workingColumns[c1];
          const col2 = workingColumns[c2];
          const onlyIn1 = col1.filter((x) => !col2.includes(x));
          const onlyIn2 = col2.filter((y) => !col1.includes(y));

          for (const x of onlyIn1) {
            for (const y of onlyIn2) {
              const newCol1 = col1.map((n) => (n === x ? y : n)).sort((a, b) => a - b);
              const newCol2 = col2.map((n) => (n === y ? x : n)).sort((a, b) => a - b);
              const key1 = columnKey(newCol1);
              const key2 = columnKey(newCol2);
              if (key1 === key2) continue;

              const oldKey1 = columnKey(col1);
              const oldKey2 = columnKey(col2);
              if ((key1 !== oldKey1 && key1 !== oldKey2 && columnSet.has(key1)) ||
                  (key2 !== oldKey1 && key2 !== oldKey2 && columnSet.has(key2))) {
                continue;
              }

              // Apply tentative swap
              removeColumnByNumbers(col1);
              removeColumnByNumbers(col2);
              workingColumns[c1] = newCol1;
              workingColumns[c2] = newCol2;
              addColumnByNumbers(newCol1);
              addColumnByNumbers(newCol2);

              const nextObj = computeCurrentObjective();
              const primaryCur = coverageTarget === 'terni' ? currentObj.triplets : currentObj.pairs;
              const primaryNext = coverageTarget === 'terni' ? nextObj.triplets : nextObj.pairs;
              const secondaryCur = coverageTarget === 'terni' ? currentObj.pairs : currentObj.triplets;
              const secondaryNext = coverageTarget === 'terni' ? nextObj.pairs : nextObj.triplets;

              const isBetter =
                primaryNext > primaryCur ||
                (primaryNext === primaryCur && secondaryNext > secondaryCur) ||
                (primaryNext === primaryCur &&
                  secondaryNext === secondaryCur &&
                  nextObj.maxOverlap < currentObj.maxOverlap);

              if (isBetter) {
                columnSet.delete(oldKey1);
                columnSet.delete(oldKey2);
                columnSet.add(key1);
                columnSet.add(key2);
                currentObj = nextObj;
                improved = true;
                break;
              } else {
                // Revert swap
                removeColumnByNumbers(newCol1);
                removeColumnByNumbers(newCol2);
                workingColumns[c1] = col1;
                workingColumns[c2] = col2;
                addColumnByNumbers(col1);
                addColumnByNumbers(col2);
              }
            }
            if (improved) break;
          }
        }
      }
      if (!improved) break;
    }
  }

  return workingColumns;
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
  const minPresence = presenceValues.length > 0 ? Math.min(...presenceValues) : 0;
  const maxPresence = presenceValues.length > 0 ? Math.max(...presenceValues) : 0;

  return {
    poolSize: sortedPool.length,
    pairsCoveredCount,
    pairsTotalInPool,
    tripletsCoveredCount,
    tripletsTotalInPool,
    averagePresence: Number(avgPresence.toFixed(2)),
    minPresence,
    maxPresence,
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
  decade: number;
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
 * Valutazione neutra e imparziale del pool candidati (Zero Bias):
 * Ogni numero da 1 a 90 ha identica dignità di selezione (punteggio base uniforme = 100),
 * senza penalità per numeri isolati/centrali e senza bonus artificiali su decine o estremi.
 */
export function scorePool30InPureCompetition(pool30: number[]): FunnelCandidateScore[] {
  return pool30.map((num) => {
    const decade = Math.floor((num - 1) / 10);
    const cadence = num % 10;

    const sameDecadeCount = pool30.filter(
      (n) => n !== num && Math.floor((n - 1) / 10) === decade
    ).length;
    const sameCadenceCount = pool30.filter(
      (n) => n !== num && n % 10 === cadence
    ).length;
    const adjacentCount = pool30.filter(
      (n) => n !== num && Math.abs(n - num) <= 2
    ).length;

    return {
      num,
      decade,
      score: 100,
      sameDecadeCount,
      sameCadenceCount,
      adjacentCount,
      isPolarized: false,
      dispersionPenalty: 0
    };
  });
}

/**
 * Selezione Equa e Imparziale di targetCount numeri dal pool fornito tramite Fisher-Yates con crypto.getRandomValues():
 * - Nessun limite forzato sulle decine (sono ammessi 3 o più numeri nella stessa decina come nelle estrazioni reali)
 * - Nessun filtro forzato su Pari/Dispari
 * - Nessun bias su numeri centrali o estremi
 */
export function selectBalancedTopNumbers(pool30: number[], targetCount: number): number[] {
  const uniqueCandidates = Array.from(
    new Set(pool30.filter((n) => Number.isInteger(n) && n >= 1 && n <= 90))
  );
  const clampedTarget = Math.min(uniqueCandidates.length, Math.max(1, Math.round(targetCount)));
  const shuffled = fisherYatesCryptoShuffle(uniqueCandidates);
  return shuffled.slice(0, clampedTarget).sort((a, b) => a - b);
}

/**
 * Selezione Equa del Pool (default 12 numeri da 1 a 90) con Campionamento Fisher-Yates (crypto.getRandomValues):
 * - Nessun vincolo forzato sulle decine e nessun bias sui numeri centrali o estremi.
 * - Se l'input contiene pesi differenziati da archivio reale, effettua un campionamento ponderato
 *   senza reinserimento tramite crypto.getRandomValues() senza mai escludere alcun numero.
 * - Se i pesi sono uniformi (archivio vuoto o modalità pura), applica Fisher-Yates equiprobabile puro su 1..90.
 */
export function selectFunnelPool30To12(
  scoredOrRankedInput: Array<NumberStat | { number: number; score?: number; compositeScore?: number } | number>,
  targetSize: number = 12,
  rng: () => number = getCryptoRandomFloat,
  mode: PoolSelectionMode = 'pure_uniform'
): FunnelPoolSelectionResult {
  const clampedTargetSize = Math.min(30, Math.max(6, Math.round(targetSize || 12)));

  // Costruiamo la mappa dei pesi reali se disponibili e se non siamo in modalità pura
  const weightMap: Record<number, number> = {};
  let hasVariedScores = false;
  let firstScore: number | null = null;

  for (const item of scoredOrRankedInput || []) {
    if (typeof item === 'object' && item !== null && 'number' in item) {
      const n = item.number;
      const rawScore =
        typeof item.compositeScore === 'number'
          ? item.compositeScore
          : typeof (item as { score?: number }).score === 'number'
          ? (item as { score: number }).score
          : 0;
      if (n >= 1 && n <= 90) {
        weightMap[n] = 1.0 + Math.max(0, rawScore) * 0.75;
        if (firstScore === null) firstScore = rawScore;
        else if (Math.abs(rawScore - firstScore) > 1e-6) hasVariedScores = true;
      }
    }
  }

  const universe90: number[] = [];
  for (let n = 1; n <= 90; n++) universe90.push(n);

  let pool30: number[];
  let top12Numbers: number[];

  if (mode === 'real_archive_weighted' && hasVariedScores) {
    // Campionamento ponderato senza reinserimento su tutti i 90 numeri (nessun numero escluso, zero vincoli decina)
    const remaining = [...universe90];
    const picked30: number[] = [];
    for (let k = 0; k < 30 && remaining.length > 0; k++) {
      let totalW = 0;
      for (let i = 0; i < remaining.length; i++) {
        totalW += weightMap[remaining[i]] ?? 1.0;
      }
      let thresh = rng() * totalW;
      let chosenIdx = remaining.length - 1;
      for (let i = 0; i < remaining.length; i++) {
        thresh -= weightMap[remaining[i]] ?? 1.0;
        if (thresh <= 0) {
          chosenIdx = i;
          break;
        }
      }
      picked30.push(remaining[chosenIdx]);
      remaining[chosenIdx] = remaining[remaining.length - 1];
      remaining.pop();
    }
    pool30 = picked30;
    top12Numbers = picked30.slice(0, clampedTargetSize).sort((a, b) => a - b);
  } else {
    // Modalità Equiprobabile Pura (Fisher-Yates con crypto.getRandomValues su 1..90)
    const shuffled = fisherYatesCryptoShuffle(universe90);
    pool30 = shuffled.slice(0, 30);
    top12Numbers = pool30.slice(0, clampedTargetSize).sort((a, b) => a - b);
  }

  const geneticCandidates = pool30.slice(0, 25);
  const chaosNumbers = pool30.slice(25, 30);
  const scoredPool = scorePool30InPureCompetition(pool30);

  return {
    geneticCandidates,
    chaosNumbers,
    pool30,
    scoredPool,
    top12Numbers
  };
}

export interface BalancedFunnelUiLabels {
  targetCount: number;
  maxPerParity: number;
  title: string;
  shortBadge: string;
  subtitle: string;
  weightsDetail: string;
  recalcButton: string;
  recalcDoneButton: string;
}

/**
 * Etichette UI per la Selezione Equa del Pool (Fisher-Yates Crypto RNG senza bias su decine o centro)
 */
export function getBalancedFunnelUiLabels(targetCount: number): BalancedFunnelUiLabels {
  const n = Math.max(6, Math.round(targetCount || 12));
  return {
    targetCount: n,
    maxPerParity: n,
    title: `Selezione Equa ${n} Numeri (Fisher-Yates Crypto RNG)`,
    shortBadge: `Pool ${n} Numeri (Zero Bias Decine • Crypto RNG)`,
    subtitle: `Campionamento Senza Reinserimento (1–90 → ${n}): Nessun limite forzato su decine o estremi`,
    weightsDetail:
      `Estrazione imparziale tramite window.crypto.getRandomValues() (algoritmo Fisher-Yates): ogni numero da 1 a 90 ha identica dignità senza blocchi sulle decine o penalità sui numeri centrali/estremi.`,
    recalcButton: `Estrai Nuovi ${n} Numeri Equi`,
    recalcDoneButton: `${n} Numeri Estratti!`
  };
}

/**
 * Full Pipeline: Generates the optimized SuperEnalotto system using Exact Mathematical Symmetry Reduction.
 * For 12 numbers in 10 sestine, guarantees that each of the 12 numbers appears EXACTLY 5 times (12 x 5 = 60),
 * with zero duplicate sestine and maximal uniform pair/triplet coverage.
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

  //Nessuna esclusione artificiale per somma o decina durante la riduzione combinatoria simmetrica
  const effectiveFilters: FilterOptions = {
    ...filters,
    decades: false
  };

  // 1. Generate all C(v, 6) integral combinations
  const allCombos = generateCombinations(sortedPool, 6);

  // 2. Count combinations matching optional diagnostic filters, while passing ALL combinations
  // to greedyCoveringReduction so that mathematical symmetry (5x each) is always exact
  let zeroPenaltyCount = allCombos.length;
  const anyFilterEnabled = Boolean(
    effectiveFilters.evenOdd ||
      effectiveFilters.highLow ||
      effectiveFilters.sumRange ||
      effectiveFilters.consecutive ||
      effectiveFilters.cadences
  );
  if (anyFilterEnabled) {
    zeroPenaltyCount = 0;
    for (let i = 0; i < allCombos.length; i++) {
      if (computeFilterPenalty(allCombos[i], effectiveFilters) === 0) {
        zeroPenaltyCount++;
      }
    }
  }

  // 3. Exact Symmetric Covering Design (12 numbers -> 10 sestine => every number appears exactly 5 times)
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

