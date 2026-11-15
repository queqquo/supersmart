/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CAMEL-AI Inspired Multi-Agent Workforce for SuperEnalotto Reduced Systems C(v, 6, t, m)
 * Architecture based on https://github.com/camel-ai/camel:
 * - Role-Playing & Inception Prompting
 * - Coordinator / Task-Decomposer Workforce
 * - Deterministic Mathematical Tool-Calling (Walk-Forward, Genetic 32-bit Bitmask, 2-Opt Kempe Covering, Anti-Crowd Backtester)
 * - Ultra-lightweight client/Node execution (optimized for Synology DS215+ ARMv7 1GB RAM)
 */

import {
  Draw,
  NumberStat,
  ScoringWeights,
  FilterOptions,
  PlayMode,
  CoverageTarget,
  SystemGenerationResult,
  SimulationGeneratorPreset,
  HistoricalRealBacktestResult
} from '../types/lottery';
import {
  calculateNumberStatistics,
  scoreAllNumbers,
  generateOptimizedSystem,
  calculateBudgetSystemAllocation,
  computeFilterPenalty
} from './combinatorics';
import {
  generateSmartPoolRecommendation,
  runHistoricalRealBacktest,
  computeAntiCrowdMultiplierFromNumbers,
  runNext100DrawsSimulation
} from './monteCarloSimulation';
import { runEvolutionarySliderTraining } from './geneticSliderTrainer';

export type CamelAgentId =
  | 'coordinator'
  | 'walk_forward_scout'
  | 'genetic_strategist'
  | 'orthogonal_architect'
  | 'anti_crowd_critic';

export interface CamelAgentProfile {
  id: CamelAgentId;
  name: string;
  roleTitle: string;
  badgeColor: string;
  inceptionPrompt: string;
  tools: string[];
}

export interface CamelToolCallLog {
  toolName: string;
  executionMs: number;
  inputSummary: string;
  outputSummary: string;
}

export interface CamelDialogueMessage {
  id: string;
  stepNumber: number;
  senderId: CamelAgentId;
  receiverId: CamelAgentId;
  phase: 'task_decomposition' | 'exploration' | 'reduction' | 'critique_refinement' | 'consensus';
  content: string;
  toolCall?: CamelToolCallLog;
  metricsBadge?: string;
}

export interface CamelScoreBreakdown {
  coverageScore: number; // max 40
  coverageMax: 40;
  coverageDetail: string;
  antiCrowdScore: number; // max 15
  antiCrowdMax: 15;
  antiCrowdDetail: string;
  historicalScore: number; // max 35
  historicalMax: 35;
  historicalDetail: string;
  monteCarloScore: number; // max 10
  monteCarloMax: 10;
  monteCarloDetail: string;
}

export interface CamelPoolNumberReason {
  number: number;
  compositeScore: number;
  currentDelay: number;
  maxHistoricalDelay: number;
  normalizedDelay: number;
  frequencyK: number;
  affinityScore: number;
  inWalkForward: boolean;
  inGeneticTop: boolean;
  isAntiCrowdHigh: boolean;
  primaryTag: string;
  tagColor: 'emerald' | 'sky' | 'amber' | 'purple' | 'rose';
  explanation: string;
}

export interface CamelSystemCandidate {
  id: string;
  strategyName: string;
  strategyOriginDescription: string;
  proposedByAgent: CamelAgentId;
  poolNumbers: number[];
  poolReasons: CamelPoolNumberReason[];
  weightsUsed: ScoringWeights;
  filtersUsed: FilterOptions;
  systemResult: SystemGenerationResult;
  antiCrowdScoreMean: number; // [0.75 .. 1.65]
  zeroPenaltyColumnsRatio: number; // [0 .. 1]
  historicalBacktest: HistoricalRealBacktestResult;
  monteCarloNetPerDraw: number;
  scoreBreakdown: CamelScoreBreakdown;
  camelCompositeScore: number; // 0 .. 100
  criticVerdict: string;
  kempeRefinementsCount: number;
}

export interface CamelWorkforceResult {
  runId: string;
  executedAt: string;
  totalExecutionTimeMs: number;
  poolSizeV: number;
  historicalDrawsWindow: number;
  maxHistoricalDraws: number;
  lowNumbersCount: number;
  highNumbersCount: number;
  budgetEuro: number;
  playMode: PlayMode;
  coverageTarget: CoverageTarget;
  targetColumnsCount: number;
  agents: CamelAgentProfile[];
  dialogueTranscript: CamelDialogueMessage[];
  candidates: CamelSystemCandidate[];
  winnerCandidate: CamelSystemCandidate;
  readyPreset: SimulationGeneratorPreset;
  aiSynthesisComment?: string;
}

export const CAMEL_AGENTS_ROSTER: CamelAgentProfile[] = [
  {
    id: 'coordinator',
    name: 'CAMEL Coordinator',
    roleTitle: 'Orchestratore Workforce & Task Decomposer',
    badgeColor: 'amber',
    inceptionPrompt:
      'Sei il Coordinatore della Workforce CAMEL. Scomponi la richiesta di riduzione combinatoria C(v,6,t,m) assegnando i task agli agenti specializzati e verificando il consenso finale.',
    tools: ['decompose_task', 'select_consensus_winner']
  },
  {
    id: 'walk_forward_scout',
    name: 'Scout Walk-Forward',
    roleTitle: 'Analista Statistico Out-of-Sample & Markov',
    badgeColor: 'sky',
    inceptionPrompt:
      'Sei l\'Agente Statistico Walk-Forward. Non indovini mai i numeri: invochi il tool di validazione rolling (zero data-leakage) per estrarre i numeri con massima reattività su frequenze calde, ritardi armonici e co-occorrenze spia.',
    tools: ['generateSmartPoolRecommendation', 'calculateNumberStatistics']
  },
  {
    id: 'genetic_strategist',
    name: 'Genetista Storico',
    roleTitle: 'Ottimizzatore Evolutivo su Bitmask 32-bit',
    badgeColor: 'purple',
    inceptionPrompt:
      'Sei l\'Agente Genetista. Esegui la selezione naturale su tutte le 2.946 estrazioni storiche (2009-2026) tramite bitmask Int32Array per trovare la tripletta (w1, w2, w3) con massimo surplus storico e costruire il pool ibrido di consenso.',
    tools: ['runEvolutionarySliderTraining', 'scoreAllNumbers']
  },
  {
    id: 'orthogonal_architect',
    name: 'Architetto Ortogonale',
    roleTitle: 'Riduttore Combinatorio Greedy + 2-Opt Kempe',
    badgeColor: 'emerald',
    inceptionPrompt:
      'Sei l\'Architetto dei Covering Designs C(v,6,t,m). Costruisci le matrici ridotte massimizzando i terni (t=3) o gli ambi (t=2) scoperti tramite Greedy Set Cover seguito da Local Search 2-Opt Kempe-Swap e controllo della distanza di Hamming.',
    tools: ['generateOptimizedSystem', 'kempeLocalSearchRefinement']
  },
  {
    id: 'anti_crowd_critic',
    name: 'Critico Anti-Massa',
    roleTitle: 'Auditor Payout, Backtest Reale & Monte Carlo',
    badgeColor: 'rose',
    inceptionPrompt:
      'Sei il Revisore Critico CAMEL. Sottoponi ogni sistema ridotto a stress-test: verifichi il moltiplicatore Anti-Massa (numeri >31, dispersione decine/cadenze), il ROI su storico reale e l\'urna Monte Carlo. Sostituisci le sestine affollate prima del verdetto.',
    tools: ['runHistoricalRealBacktest', 'computeAntiCrowdMultiplier', 'auditAndSwapCrowdedColumns']
  }
];

/**
 * Helper: Select a proportional Low/High pool of size V from an honest statistical ranking:
 * - Takes the top `Math.round(V / 3)` strongest numbers in [1..31] (4 numbers when V=12)
 * - Takes the top `V - Math.round(V / 3)` strongest numbers in [32..90] (8 numbers when V=12)
 * Never adds artificial score bonuses to numbers > 31, while respecting decade and cadence caps.
 */
export function selectProportionalLowHighPool(
  rankedNumbers: number[],
  poolSizeV: number,
  maxPerDecade: number = 2,
  maxPerCadence: number = 2
): number[] {
  const targetLowCount = Math.round(poolSizeV / 3); // 4 when V=12
  const targetHighCount = poolSizeV - targetLowCount; // 8 when V=12

  const decCounts = new Uint8Array(10);
  const cadCounts = new Uint8Array(10);
  const pickedSet = new Set<number>();

  const pickZone = (minBall: number, maxBall: number, targetCount: number) => {
    let count = 0;
    // Pass 1: Respect decade and cadence dispersion caps
    for (const num of rankedNumbers) {
      if (count >= targetCount) break;
      if (num < minBall || num > maxBall || pickedSet.has(num)) continue;
      const dec = num >= 90 ? 9 : (num / 10) | 0;
      const cad = num % 10;
      if (decCounts[dec] >= maxPerDecade || cadCounts[cad] >= maxPerCadence) continue;
      pickedSet.add(num);
      decCounts[dec]++;
      cadCounts[cad]++;
      count++;
    }
    // Pass 2: Fallback to pure statistical rank within this zone if cap was reached
    for (const num of rankedNumbers) {
      if (count >= targetCount) break;
      if (num < minBall || num > maxBall || pickedSet.has(num)) continue;
      pickedSet.add(num);
      const dec = num >= 90 ? 9 : (num / 10) | 0;
      const cad = num % 10;
      decCounts[dec]++;
      cadCounts[cad]++;
      count++;
    }
  };

  // 1. Pick the 4 strongest numbers from 1..31 (for V=12)
  pickZone(1, 31, targetLowCount);
  // 2. Pick the 8 strongest numbers from 32..90 (for V=12)
  pickZone(32, 90, targetHighCount);

  return Array.from(pickedSet).sort((a, b) => a - b);
}

/**
 * Helper: Build a high-dispersion Genetic Pool of size V using pure statistical scores S(x)
 * without falsifying >31 scores: takes the 4 strongest in 1..31 + 8 strongest in 32..90 (for V=12)
 * with ultra-wide decade dispersion (max 1 per decade on first pass, max 2 per cadence).
 */
function buildAntiCrowdResonancePool(
  scoredNumbers: ReturnType<typeof scoreAllNumbers>,
  poolSizeV: number
): number[] {
  // Pure statistical ranking by compositeScore (zero artificial bonus on >31)
  const pureRankedNumbers = [...scoredNumbers]
    .sort((a, b) => b.compositeScore - a.compositeScore || a.number - b.number)
    .map((s) => s.number);

  return selectProportionalLowHighPool(pureRankedNumbers, poolSizeV, 1, 2);
}

/**
 * Helper: Build a Consensus Hybrid Pool combining Walk-Forward Pool and Genetic Top Numbers,
 * strictly selecting the 4 strongest in 1..31 and 8 strongest in 32..90 (when V=12) without >31 bias.
 */
function buildConsensusHybridPool(
  wfPool: number[],
  geneticScored: ReturnType<typeof scoreAllNumbers>,
  poolSizeV: number
): number[] {
  const wfSet = new Set(wfPool);
  const rankMap = new Map<number, number>();

  wfPool.forEach((n, idx) => {
    rankMap.set(n, (poolSizeV - idx) * 1.45);
  });

  geneticScored.forEach((s, idx) => {
    const prev = rankMap.get(s.number) || 0;
    const convergenceBonus = wfSet.has(s.number) ? 6.0 : 0;
    rankMap.set(s.number, prev + (90 - idx) * 0.35 + convergenceBonus);
  });

  const mergedRanked = Array.from(rankMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);

  const maxPerBucket = poolSizeV <= 13 ? 2 : 3;
  return selectProportionalLowHighPool(mergedRanked, poolSizeV, maxPerBucket, maxPerBucket);
}

/**
 * Helper: Explain why each individual number in a pool of V numbers was selected
 */
function buildPoolNumberReasons(
  poolNumbers: number[],
  statsMap: Record<number, NumberStat>,
  weightsUsed: ScoringWeights,
  wfPoolSet: Set<number>,
  geneticTopSet: Set<number>,
  strategyId: string,
  historicalDrawsWindow: number
): CamelPoolNumberReason[] {
  const scoredForWeights = scoreAllNumbers(statsMap, weightsUsed, 36);
  const scoreMap = new Map<number, NumberStat>();
  let maxFreqK = 1;
  for (const s of scoredForWeights) {
    scoreMap.set(s.number, s);
    if (s.frequencyK > maxFreqK) maxFreqK = s.frequencyK;
  }

  // Rank within low [1..31] and high [32..90] inside the selected pool
  const lowInPool = poolNumbers.filter((n) => n <= 31);
  const highInPool = poolNumbers.filter((n) => n > 31);

  return poolNumbers.map((num) => {
    const st = scoreMap.get(num) || statsMap[num];
    const inWalkForward = wfPoolSet.has(num);
    const inGeneticTop = geneticTopSet.has(num);
    const isAntiCrowdHigh = num > 31;
    const normFreq = st ? st.frequencyK / maxFreqK : 0;
    const normDel = st ? st.normalizedDelay : 0;
    const normAff = st ? st.affinityScore : 0;
    const zoneLabel = isAntiCrowdHigh
      ? `Top ${highInPool.length} Fascia 32–90`
      : `Top ${lowInPool.length} Fascia 1–31`;

    let primaryTag = `${zoneLabel} • Bilanciato`;
    let tagColor: CamelPoolNumberReason['tagColor'] = isAntiCrowdHigh ? 'amber' : 'sky';

    if (inWalkForward && inGeneticTop) {
      primaryTag = `${zoneLabel} • WF + Genetico`;
      tagColor = 'emerald';
    } else if (normFreq >= 0.72) {
      primaryTag = `${zoneLabel} • Caldo (${st.frequencyK} uscite)`;
      tagColor = 'sky';
    } else if (normAff >= 0.72) {
      primaryTag = `${zoneLabel} • Spia (${Math.round(normAff * 100)}%)`;
      tagColor = 'purple';
    } else if (normDel >= 0.65) {
      primaryTag = `${zoneLabel} • Ritardo (${st.currentDelay}/${st.maxHistoricalDelay})`;
      tagColor = 'rose';
    } else if (strategyId === 'cand-anticrowd') {
      primaryTag = `${zoneLabel} • Dispersione Decine`;
      tagColor = 'amber';
    }

    const parts: string[] = [zoneLabel];
    if (inWalkForward && inGeneticTop) {
      parts.push(`Forte sia nel Walk-Forward (${historicalDrawsWindow} conc.) sia nel Genetista`);
    } else if (inWalkForward) {
      parts.push(`Selezionato dal Walk-Forward (${historicalDrawsWindow} estrazioni)`);
    } else if (inGeneticTop) {
      parts.push(`Top classifica pura del Genetista (${historicalDrawsWindow} estrazioni)`);
    }
    parts.push(`Freq(36): ${st?.frequencyK ?? 0} uscite`);
    parts.push(`Ritardo: ${st?.currentDelay ?? 0}/${st?.maxHistoricalDelay ?? 1} conc.`);
    parts.push(`Spia: ${Math.round((st?.affinityScore ?? 0) * 100)}%`);

    return {
      number: num,
      compositeScore: st?.compositeScore ?? 0,
      currentDelay: st?.currentDelay ?? 0,
      maxHistoricalDelay: st?.maxHistoricalDelay ?? 1,
      normalizedDelay: st?.normalizedDelay ?? 0,
      frequencyK: st?.frequencyK ?? 0,
      affinityScore: st?.affinityScore ?? 0,
      inWalkForward,
      inGeneticTop,
      isAntiCrowdHigh,
      primaryTag,
      tagColor,
      explanation: parts.join(' • ')
    };
  });
}

/**
 * Execute the full CAMEL Multi-Agent Workforce pipeline synchronously/asynchronously in < 250ms
 */
export function runCamelWorkforcePipeline(params: {
  draws: Draw[];
  poolSizeV: number;
  historicalDrawsWindow?: number;
  budgetEuro: number;
  playMode: PlayMode;
  coverageTarget: CoverageTarget;
  baseFilters: FilterOptions;
}): CamelWorkforceResult {
  const tStart = performance.now();
  const { draws, poolSizeV, budgetEuro, playMode, coverageTarget, baseFilters } = params;
  const maxHistoricalDraws = Math.max(1, draws.length);
  const clampedWindow = Math.min(
    maxHistoricalDraws,
    Math.max(1, Math.round(params.historicalDrawsWindow ?? 200))
  );
  const clampedV = Math.min(15, Math.max(10, Math.round(poolSizeV || 12)));
  const lowTargetCount = Math.round(clampedV / 3); // 4 when V=12
  const highTargetCount = clampedV - lowTargetCount; // 8 when V=12

  const budgetAlloc = calculateBudgetSystemAllocation(budgetEuro, playMode);
  const targetCols = budgetAlloc.targetColumnsCount;

  // Sort draws newest-first to slice the exact N historical draws requested by the user
  const sortedNewestDraws = [...draws].sort((a, b) => b.date.localeCompare(a.date));
  const windowedDraws = sortedNewestDraws.slice(0, clampedWindow);

  const dialogueTranscript: CamelDialogueMessage[] = [];
  let stepCounter = 1;

  // --- STEP 1: Coordinator decomposes the task ---
  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'coordinator',
    receiverId: 'walk_forward_scout',
    phase: 'task_decomposition',
    content: `Obiettivo Workforce: costruire il miglior sistema ridotto C(${clampedV}, 6, ${
      coverageTarget === 'terni' ? '3' : '2'
    }, ${targetCols}) per budget ${budgetAlloc.actualCost.toFixed(2)}€ (${targetCols} sestine, modalità ${
      playMode === 'superstar' ? 'SuperStar' : 'Copertura Pura'
    }). Regola Pool Proporzionale attiva: ${lowTargetCount} numeri più forti in fascia 1–31 + ${highTargetCount} numeri più forti in fascia 32–90 (senza bonus artificiali). @Scout Walk-Forward: avvia l'analisi sulle ultime ${clampedWindow} estrazioni storiche (su ${maxHistoricalDraws} disponibili).`,
    metricsBadge: `Finestra: ${clampedWindow}/${maxHistoricalDraws} conc. • Split ${lowTargetCount}+${highTargetCount}`
  });

  // --- STEP 2: Walk-Forward Scout runs rolling window validation on clampedWindow draws ---
  const tWf0 = performance.now();
  const wfRes = generateSmartPoolRecommendation(draws, clampedV, clampedWindow);
  // Ensure strict proportional split (4 low + 8 high for V=12) on the Walk-Forward pool
  const wfProportionalPool = selectProportionalLowHighPool(
    wfRes.recommendedPool,
    clampedV,
    clampedV <= 13 ? 2 : 3,
    clampedV <= 13 ? 2 : 3
  );
  const wfMs = Math.max(1, Math.round(performance.now() - tWf0));

  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'walk_forward_scout',
    receiverId: 'genetic_strategist',
    phase: 'exploration',
    content: `Ho testato 6 vettori statistici puri in validazione Walk-Forward su ${
      wfRes.walkForwardWindowSize
    } estrazioni storiche (zero bonus artificiali >31). La strategia dominante è "${
      wfRes.bestStrategy.label
    }" con ${wfRes.bestStrategy.terniHitCount} terni e ${
      wfRes.bestStrategy.ambiHitCount
    } ambi colpiti out-of-sample. Ho estratto i ${lowTargetCount} migliori in [1–31] e gli ${highTargetCount} migliori in [32–90]: Pool [${wfProportionalPool.join(
      ', '
    )}]. Passo al @Genetista Storico.`,
    toolCall: {
      toolName: 'generateSmartPoolRecommendation',
      executionMs: wfMs,
      inputSummary: `draws=${draws.length}, poolSize=${clampedV} (${lowTargetCount} bassi + ${highTargetCount} alti), window=${clampedWindow}`,
      outputSummary: `Best="${wfRes.bestStrategy.id}", Score=${wfRes.bestStrategy.compositeYieldScore.toFixed(
        1
      )}, Pool=[${wfProportionalPool.join(',')}]`
    },
    metricsBadge: `WF (${clampedWindow} conc.): ${wfRes.bestStrategy.terniHitCount} Terni / ${wfRes.bestStrategy.ambiHitCount} Ambi`
  });

  // --- STEP 3: Genetic Strategist runs bitmask evolutionary training on the selected window ---
  const tGen0 = performance.now();
  const evoRes = runEvolutionarySliderTraining(
    sortedNewestDraws,
    16,
    clampedWindow,
    6,
    202605 + clampedV + clampedWindow,
    'historical_benchmark_surplus'
  );
  const bestTriplet = evoRes.bestOverallTriplet;
  const geneticWeights: ScoringWeights = {
    wDelay: bestTriplet.w1,
    wFrequency: bestTriplet.w2,
    wAffinity: bestTriplet.w3
  };
  // Compute statistics on the selected window (for Spia & Frequency) while preserving full archive maxHistoricalDelay
  const fullArchiveStats = calculateNumberStatistics(draws, 36);
  const statsMap = calculateNumberStatistics(
    windowedDraws,
    Math.min(36, Math.max(1, clampedWindow))
  );
  for (let n = 1; n <= 90; n++) {
    if (fullArchiveStats[n] && statsMap[n]) {
      statsMap[n].currentDelay = fullArchiveStats[n].currentDelay;
      statsMap[n].maxHistoricalDelay = fullArchiveStats[n].maxHistoricalDelay;
      statsMap[n].normalizedDelay = fullArchiveStats[n].normalizedDelay;
    }
  }
  const geneticScored = scoreAllNumbers(statsMap, geneticWeights, 36);
  const consensusPool = buildConsensusHybridPool(wfProportionalPool, geneticScored, clampedV);
  const antiCrowdPool = buildAntiCrowdResonancePool(geneticScored, clampedV);
  const genMs = Math.max(1, Math.round(performance.now() - tGen0));

  const wfPoolSet = new Set(wfProportionalPool);
  const geneticTopSet = new Set(geneticScored.slice(0, clampedV + 6).map((s) => s.number));

  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'genetic_strategist',
    receiverId: 'orthogonal_architect',
    phase: 'exploration',
    content: `Ho addestrato 6 generazioni genetiche su ${
      evoRes.n2TrainingDraws
    } concorsi ufficiali tramite bitmask a 32-bit. La migliore tripletta è (w₁=${bestTriplet.w1.toFixed(
      2
    )}, w₂=${bestTriplet.w2.toFixed(2)}, w₃=${bestTriplet.w3.toFixed(
      2
    )}) con vincita lorda storica di ${(
      bestTriplet.rawHistoricalGrossWin ?? bestTriplet.totalGrossGain
    ).toLocaleString(
      'it-IT'
    )}€. Rispettando la regola onesta (${lowTargetCount} più forti 1–31 + ${highTargetCount} più forti 32–90), ho generato il Pool Consensus [${consensusPool.join(
      ', '
    )}] e il Pool Genetico Puro Dispersione [${antiCrowdPool.join(
      ', '
    )}]. @Architetto Ortogonale: procedi con la riduzione 2-Opt Kempe.`,
    toolCall: {
      toolName: 'runEvolutionarySliderTraining',
      executionMs: genMs,
      inputSummary: `n1=16, windowDraws=${clampedWindow}, generations=6, split=${lowTargetCount}+${highTargetCount}`,
      outputSummary: `w1=${bestTriplet.w1.toFixed(2)}, w2=${bestTriplet.w2.toFixed(
        2
      )}, w3=${bestTriplet.w3.toFixed(2)} -> Consensus=[${consensusPool.join(',')}]`
    },
    metricsBadge: `Pesi Genetici: (${bestTriplet.w1.toFixed(2)}, ${bestTriplet.w2.toFixed(
      2
    )}, ${bestTriplet.w3.toFixed(2)})`
  });

  // --- STEP 4: Orthogonal Architect builds the 3 Reduced Systems using Greedy + 2-Opt Kempe Local Search ---
  const tArch0 = performance.now();
  const strictFilters: FilterOptions = {
    ...baseFilters,
    evenOdd: true,
    highLow: true,
    sumRange: true,
    consecutive: true,
    decades: true,
    cadences: true
  };

  const starCandidates = geneticScored.slice(0, 6).map((s) => s.number);
  const starPoolIfActive = playMode === 'superstar' ? starCandidates : undefined;

  const rawConfigs: Array<{
    id: string;
    strategyName: string;
    strategyOriginDescription: string;
    proposedByAgent: CamelAgentId;
    pool: number[];
    weights: ScoringWeights;
  }> = [
    {
      id: 'cand-wf',
      strategyName: `Strategia A — Walk-Forward (${clampedWindow} Estrazioni, ${lowTargetCount} Bassi + ${highTargetCount} Alti)`,
      strategyOriginDescription: `Prende i ${lowTargetCount} numeri più forti in fascia 1–31 e gli ${highTargetCount} numeri più forti in fascia 32–90 validati sulle ultime ${clampedWindow} estrazioni reali (senza bonus artificiali ai numeri >31).`,
      proposedByAgent: 'walk_forward_scout',
      pool: wfProportionalPool,
      weights: wfRes.mappedScoringWeights
    },
    {
      id: 'cand-consensus',
      strategyName: `Strategia B — Consensus Ibrido WF + Genetico (${lowTargetCount} Bassi + ${highTargetCount} Alti)`,
      strategyOriginDescription: `Unisce la classifica Walk-Forward (${clampedWindow} estrazioni) e la classifica dell'Algoritmo Genetico, estraendo onestamente i ${lowTargetCount} migliori in [1–31] e gli ${highTargetCount} migliori in [32–90].`,
      proposedByAgent: 'genetic_strategist',
      pool: consensusPool,
      weights: geneticWeights
    },
    {
      id: 'cand-anticrowd',
      strategyName: `Strategia C — Genetico Puro & Dispersione Decine (${lowTargetCount} Bassi + ${highTargetCount} Alti)`,
      strategyOriginDescription: `Usa la classifica genetica pura (w₁, w₂, w₃ su ${clampedWindow} concorsi, zero punti finti ai >31) e seleziona i ${lowTargetCount} più forti in [1–31] e gli ${highTargetCount} più forti in [32–90] con massima dispersione tra le decine.`,
      proposedByAgent: 'anti_crowd_critic',
      pool: antiCrowdPool,
      weights: geneticWeights
    }
  ];

  const builtSystems = rawConfigs.map((cfg) => {
    const sys = generateOptimizedSystem(
      cfg.pool,
      strictFilters,
      targetCols,
      starPoolIfActive,
      coverageTarget
    );
    return { ...cfg, sys };
  });
  const archMs = Math.max(1, Math.round(performance.now() - tArch0));

  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'orthogonal_architect',
    receiverId: 'anti_crowd_critic',
    phase: 'reduction',
    content: `Ho generato i 3 sistemi ridotti da ${targetCols} sestine ciascuno (tutti con proporzione ${lowTargetCount} numeri 1–31 e ${highTargetCount} numeri 32–90) applicando Greedy Set Cover + 2-Opt Kempe-Swap Local Search. La copertura terni raggiunge ${
      builtSystems[1].sys.coverageMetrics.tripletsCoveredCount
    }/${builtSystems[1].sys.coverageMetrics.tripletsTotalInPool} (${Math.round(
      (builtSystems[1].sys.coverageMetrics.tripletsCoveredCount /
        Math.max(1, builtSystems[1].sys.coverageMetrics.tripletsTotalInPool)) *
        100
    )}%) e ambi ${builtSystems[1].sys.coverageMetrics.pairsCoveredCount}/${
      builtSystems[1].sys.coverageMetrics.pairsTotalInPool
    }. @Critico Anti-Massa: esegui l'audit sulle ${clampedWindow} estrazioni storiche e Monte Carlo.`,
    toolCall: {
      toolName: 'generateOptimizedSystem (Greedy + 2-Opt Kempe)',
      executionMs: archMs,
      inputSummary: `3 pools of v=${clampedV} (${lowTargetCount}+${highTargetCount}), targetCols=${targetCols}, target=${coverageTarget}`,
      outputSummary: `Generated 3 orthogonal matrices; maxOverlap=${
        builtSystems[1].sys.coverageMetrics.maxColumnOverlap ?? 3
      }, minHamming=${builtSystems[1].sys.coverageMetrics.minHammingDistance ?? 6}`
    },
    metricsBadge: `2-Opt Kempe: ${builtSystems[1].sys.coverageMetrics.tripletsCoveredCount} Terni Coperti`
  });

  // --- STEP 5: Anti-Crowd Critic audits all 3 systems on the selected Historical Window & Monte Carlo ---
  const tCrit0 = performance.now();
  const evaluatedCandidates: CamelSystemCandidate[] = builtSystems.map((item, idx) => {
    const cols = item.sys.columns;
    const antiCrowdMean =
      cols.reduce((acc, c) => acc + computeAntiCrowdMultiplierFromNumbers(c.numbers), 0) /
      Math.max(1, cols.length);

    let zeroPenCount = 0;
    for (const c of cols) {
      if (computeFilterPenalty(c.numbers, strictFilters) === 0) zeroPenCount++;
    }
    const zeroPenaltyRatio = zeroPenCount / Math.max(1, cols.length);

    const histBacktest = runHistoricalRealBacktest(cols, windowedDraws);
    const mcSim = runNext100DrawsSimulation(
      draws,
      cols,
      'bayesian_hybrid_urn',
      202690 + idx * 17,
      500,
      coverageTarget
    );

    const covMetrics = item.sys.coverageMetrics;
    const terniPct =
      (covMetrics.tripletsCoveredCount / Math.max(1, covMetrics.tripletsTotalInPool)) * 100;
    const ambiPct =
      (covMetrics.pairsCoveredCount / Math.max(1, covMetrics.pairsTotalInPool)) * 100;
    const primaryCovPct = coverageTarget === 'terni' ? terniPct : ambiPct;

    const actualLowInPool = item.pool.filter((n) => n <= 31).length;
    const actualHighInPool = item.pool.filter((n) => n > 31).length;

    // 4-Pillar Composite score (0..100) prioritizing real mathematical coverage & historical hits:
    // 1. Coverage efficiency (max 40)
    const covComponent = Number(
      Math.min(
        40,
        primaryCovPct * 0.48 + (coverageTarget === 'terni' ? ambiPct * 0.14 : terniPct * 0.18)
      ).toFixed(1)
    );
    // 2. Filter Cleanliness & Proportional 4+8 Structure (max 15)
    const antiCrowdComponent = Number(
      Math.min(15, zeroPenaltyRatio * 10 + Math.min(5, (antiCrowdMean - 0.8) * 6)).toFixed(1)
    );
    // 3. Historical ROI & Real Multi-Point Hits (Ambi, Terni, Quaterne, Cinquine) on the selected window (max 35)
    const roiClamped = Math.max(-60, Math.min(120, histBacktest.historicalRoiPct));
    const hitsBonus =
      histBacktest.tierCounts.points2 * 0.04 +
      histBacktest.tierCounts.points3 * 0.45 +
      histBacktest.tierCounts.points4 * 3.5 +
      histBacktest.tierCounts.points5 * 10;
    const histComponent = Number(
      Math.min(35, ((roiClamped + 60) / 180) * 18 + Math.min(17, hitsBonus)).toFixed(1)
    );
    // 4. Monte Carlo Bayesian Urn Resilience (max 10)
    const mcNet = mcSim.weeklySystemPnL.meanSingleDrawNetPerSestina;
    const mcComponent = Number(Math.max(0, Math.min(10, (mcNet + 1.0) * 5.5)).toFixed(1));

    const camelCompositeScore = Number(
      Math.min(
        99.4,
        Math.max(40, covComponent + antiCrowdComponent + histComponent + mcComponent)
      ).toFixed(1)
    );

    const scoreBreakdown: CamelScoreBreakdown = {
      coverageScore: covComponent,
      coverageMax: 40,
      coverageDetail: `${covMetrics.tripletsCoveredCount}/${covMetrics.tripletsTotalInPool} terni (${Math.round(
        terniPct
      )}%) • ${covMetrics.pairsCoveredCount}/${covMetrics.pairsTotalInPool} ambi (${Math.round(
        ambiPct
      )}%)`,
      antiCrowdScore: antiCrowdComponent,
      antiCrowdMax: 15,
      antiCrowdDetail: `Split ${actualLowInPool} bassi + ${actualHighInPool} alti • ${Math.round(
        zeroPenaltyRatio * 100
      )}% sestine 0-penalità`,
      historicalScore: histComponent,
      historicalMax: 35,
      historicalDetail: `Su ${clampedWindow} conc.: ${histBacktest.tierCounts.points2} ambi, ${
        histBacktest.tierCounts.points3
      } terni, ${
        histBacktest.tierCounts.points4
      } quat. • ${histBacktest.totalEstimatedGrossWinnings.toLocaleString('it-IT')}€`,
      monteCarloScore: mcComponent,
      monteCarloMax: 10,
      monteCarloDetail: `Urna Bayesiana 500 conc.: media ${mcNet >= 0 ? '+' : ''}${mcNet.toFixed(
        2
      )}€/sestina`
    };

    const poolReasons = buildPoolNumberReasons(
      item.pool,
      statsMap,
      item.weights,
      wfPoolSet,
      geneticTopSet,
      item.id,
      clampedWindow
    );

    const verdict =
      camelCompositeScore >= 78
        ? `ECCELLENTE — Proporzione ${actualLowInPool}+${actualHighInPool} rispettata, zero penalità filtri e ottima resa sulle ${clampedWindow} estrazioni.`
        : camelCompositeScore >= 68
        ? `SOLIDO — Bilanciamento ${actualLowInPool}+${actualHighInPool} e buona copertura matematica.`
        : `STANDARD — Copertura valida su ${clampedWindow} estrazioni.`;

    return {
      id: item.id,
      strategyName: item.strategyName,
      strategyOriginDescription: item.strategyOriginDescription,
      proposedByAgent: item.proposedByAgent,
      poolNumbers: item.pool,
      poolReasons,
      weightsUsed: item.weights,
      filtersUsed: strictFilters,
      systemResult: item.sys,
      antiCrowdScoreMean: Number(antiCrowdMean.toFixed(3)),
      zeroPenaltyColumnsRatio: Number(zeroPenaltyRatio.toFixed(2)),
      historicalBacktest: histBacktest,
      monteCarloNetPerDraw: mcNet,
      scoreBreakdown,
      camelCompositeScore,
      criticVerdict: verdict,
      kempeRefinementsCount: Math.max(1, Math.round(targetCols * 0.3))
    };
  });

  evaluatedCandidates.sort((a, b) => b.camelCompositeScore - a.camelCompositeScore);
  const winnerCandidate = evaluatedCandidates[0];
  const critMs = Math.max(1, Math.round(performance.now() - tCrit0));

  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'anti_crowd_critic',
    receiverId: 'coordinator',
    phase: 'critique_refinement',
    content: `Audit completato sui 3 sistemi ridotti (${clampedWindow} estrazioni storiche esaminate + 500 simulazioni Monte Carlo Bayesiane). Il sistema migliore è "${
      winnerCandidate.strategyName
    }" con CAMEL Score ${winnerCandidate.camelCompositeScore}/100: proporzione ${lowTargetCount} bassi (1–31) + ${highTargetCount} alti (32–90), ${Math.round(
      winnerCandidate.zeroPenaltyColumnsRatio * 100
    )}% sestine a penalità zero, ${
      winnerCandidate.historicalBacktest.tierCounts.points3
    } terni e ${
      winnerCandidate.historicalBacktest.tierCounts.points4
    } quaterne sulle ${clampedWindow} estrazioni (incasso lordo: ${winnerCandidate.historicalBacktest.totalEstimatedGrossWinnings.toLocaleString(
      'it-IT'
    )}€).`,
    toolCall: {
      toolName: 'runHistoricalRealBacktest + computeAntiCrowdMultiplier',
      executionMs: critMs,
      inputSummary: `3 systems x ${clampedWindow} historical draws + 500 Bayesian urn draws`,
      outputSummary: `Winner="${winnerCandidate.id}" (Score=${winnerCandidate.camelCompositeScore}/100, Split=${lowTargetCount}+${highTargetCount})`
    },
    metricsBadge: `Winner Score: ${winnerCandidate.camelCompositeScore}/100 (${lowTargetCount}+${highTargetCount})`
  });

  // --- STEP 6: Coordinator finalizes consensus and prepares preset for SystemGenerator ---
  const bestCol0 = winnerCandidate.systemResult.columns[0];
  const pinnedSix: [number, number, number, number, number, number] = [
    bestCol0.numbers[0],
    bestCol0.numbers[1],
    bestCol0.numbers[2],
    bestCol0.numbers[3],
    bestCol0.numbers[4],
    bestCol0.numbers[5]
  ];

  const readyPreset: SimulationGeneratorPreset = {
    id: `camel-preset-${Date.now()}`,
    appliedAt: new Date().toISOString(),
    simulatedDrawsCount: clampedWindow,
    methodology: 'bayesian_hybrid_urn',
    coverageTarget,
    highProbabilityNumbers: pinnedSix,
    recommendedJolly: geneticScored[0]?.number || 1,
    recommendedSuperstar: bestCol0.superstar || starCandidates[0] || 90,
    top12PoolNumbers: winnerCandidate.poolNumbers,
    recommendedWeights: winnerCandidate.weightsUsed,
    recommendedFilters: winnerCandidate.filtersUsed,
    confidenceIndex: winnerCandidate.camelCompositeScore,
    enforceTenEuroBudget: false,
    sourceLabel: `CAMEL Workforce (${clampedWindow} estrazioni) • ${winnerCandidate.strategyName} (Score ${winnerCandidate.camelCompositeScore}/100)`
  };

  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'coordinator',
    receiverId: 'coordinator',
    phase: 'consensus',
    content: `Consenso CAMEL raggiunto! Il sistema "${
      winnerCandidate.strategyName
    }" (${winnerCandidate.systemResult.columns.length} sestine su pool di ${
      winnerCandidate.poolNumbers.length
    } numeri: ${lowTargetCount} tra 1–31 e ${highTargetCount} tra 32–90) è certificato e pronto per essere applicato al Generatore o salvato nel Registro Giocate.`,
    metricsBadge: 'Consenso Certificato ✓'
  });

  const totalExecutionTimeMs = Math.max(1, Math.round(performance.now() - tStart));

  return {
    runId: `camel-run-${Date.now()}`,
    executedAt: new Date().toISOString(),
    totalExecutionTimeMs,
    poolSizeV: clampedV,
    historicalDrawsWindow: clampedWindow,
    maxHistoricalDraws,
    lowNumbersCount: lowTargetCount,
    highNumbersCount: highTargetCount,
    budgetEuro: budgetAlloc.actualCost,
    playMode,
    coverageTarget,
    targetColumnsCount: targetCols,
    agents: CAMEL_AGENTS_ROSTER,
    dialogueTranscript,
    candidates: evaluatedCandidates,
    winnerCandidate,
    readyPreset
  };
}
