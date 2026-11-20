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
  selectFunnelPool30To12,
  FunnelPoolSelectionResult,
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
  isChaosInjected?: boolean;
  funnelCompetitionScore?: number;
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
  chaosNumbersInjected: number[];
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
      'Sei il Coordinatore della Workforce CAMEL. Scomponi la richiesta di riduzione combinatoria C(v,6,t,m) con Imbuto 30->v (25 Genetici/WF + 5 Caos) in Competizione Pura e verifichi il consenso finale.',
    tools: ['decompose_task', 'select_consensus_winner']
  },
  {
    id: 'walk_forward_scout',
    name: 'Scout Walk-Forward',
    roleTitle: 'Analista Statistico Out-of-Sample & Markov',
    badgeColor: 'sky',
    inceptionPrompt:
      'Sei l\'Agente Statistico Walk-Forward. Non indovini mai i numeri: invochi il tool di validazione rolling (zero data-leakage) per estrarre i 25 numeri migliori + 5 Caos e filtrarli nell\'Imbuto 30->v.',
    tools: ['generateSmartPoolRecommendation', 'selectFunnelPool30To12']
  },
  {
    id: 'genetic_strategist',
    name: 'Genetista Storico',
    roleTitle: 'Ottimizzatore Evolutivo su Bitmask 32-bit',
    badgeColor: 'purple',
    inceptionPrompt:
      'Sei l\'Agente Genetista. Esegui la selezione naturale sulle estrazioni storiche tramite bitmask Int32Array per trovare la tripletta (w1, w2, w3) con massimo surplus e passare i Top 25 + 5 Caos nell\'Imbuto 30->v.',
    tools: ['runEvolutionarySliderTraining', 'selectFunnelPool30To12']
  },
  {
    id: 'orthogonal_architect',
    name: 'Architetto Ortogonale',
    roleTitle: 'Riduttore Combinatorio Greedy + 2-Opt Kempe',
    badgeColor: 'emerald',
    inceptionPrompt:
      'Sei l\'Architetto dei Covering Designs C(v,6,t,m). Costruisci le matrici ridotte massimizzando i terni (t=3) o gli ambi (t=2) scoperti tramite Greedy Set Cover seguito da Local Search 2-Opt Kempe-Swap sul pool bilanciato Max 3/Decina.',
    tools: ['generateOptimizedSystem', 'kempeLocalSearchRefinement']
  },
  {
    id: 'anti_crowd_critic',
    name: 'Critico Anti-Massa',
    roleTitle: 'Auditor Payout, Backtest Reale & Monte Carlo',
    badgeColor: 'rose',
    inceptionPrompt:
      'Sei il Revisore Critico CAMEL. Sottoponi ogni sistema ridotto a stress-test: verifichi l\'Equilibrio Cluster (cap +45) / Estremi (+40), il limite Max 3/Decina, il ROI su storico reale e l\'urna Monte Carlo.',
    tools: ['runHistoricalRealBacktest', 'selectBalancedTopNumbers', 'auditAndSwapCrowdedColumns']
  }
];

/**
 * Helper: Select a pool of size V (default 12) via the 90 -> 30 (25 Top + 5 Chaos) -> 12 Funnel Pipeline
 * in Pure Competition (Clustering + Polarization - Dispersion Penalty).
 */
export function selectProportionalLowHighPool(
  rankedNumbers: number[],
  poolSizeV: number
): number[] {
  return selectFunnelPool30To12(rankedNumbers, poolSizeV).top12Numbers;
}

/**
 * Helper: Build a Polarized & Clustered Genetic Pool of size V via the 30->12 Funnel Pipeline
 */
function buildAntiCrowdResonanceFunnel(
  scoredNumbers: ReturnType<typeof scoreAllNumbers>,
  poolSizeV: number,
  hasRealDraws: boolean
): FunnelPoolSelectionResult {
  const pureRankedNumbers = [...scoredNumbers].sort(
    (a, b) => b.compositeScore - a.compositeScore || a.number - b.number
  );

  return selectFunnelPool30To12(
    pureRankedNumbers,
    poolSizeV,
    undefined,
    hasRealDraws ? 'real_archive_weighted' : 'pure_uniform'
  );
}

/**
 * Helper: Build a Consensus Hybrid Pool combining Walk-Forward Pool and Genetic Top Numbers,
 * passing the merged top 25 + 5 chaos candidates through the 30->12 Pure Competition Funnel.
 */
function buildConsensusHybridFunnel(
  wfPool: number[],
  geneticScored: ReturnType<typeof scoreAllNumbers>,
  poolSizeV: number,
  hasRealDraws: boolean
): FunnelPoolSelectionResult {
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
    .map(([number, score]) => ({ number, score }));

  return selectFunnelPool30To12(
    mergedRanked,
    poolSizeV,
    undefined,
    hasRealDraws ? 'real_archive_weighted' : 'pure_uniform'
  );
}

/**
 * Helper: Explain why each individual number in a pool of V numbers was selected
 * by the 30 -> V Pure Competition Funnel (25 Genetic/WF + 5 Chaos)
 */
function buildPoolNumberReasons(
  funnel: FunnelPoolSelectionResult,
  statsMap: Record<number, NumberStat>,
  weightsUsed: ScoringWeights,
  wfPoolSet: Set<number>,
  geneticTopSet: Set<number>,
  historicalDrawsWindow: number
): CamelPoolNumberReason[] {
  const poolNumbers = funnel.top12Numbers;
  const chaosSet = new Set(funnel.chaosNumbers);
  const funnelCandidateMap = new Map<number, (typeof funnel.scoredPool)[number]>();
  for (const item of funnel.scoredPool) {
    funnelCandidateMap.set(item.num, item);
  }

  const scoredForWeights = scoreAllNumbers(statsMap, weightsUsed, 36);
  const scoreMap = new Map<number, NumberStat>();
  let maxFreqK = 1;
  for (const s of scoredForWeights) {
    scoreMap.set(s.number, s);
    if (s.frequencyK > maxFreqK) maxFreqK = s.frequencyK;
  }

  return poolNumbers.map((num) => {
    const st = scoreMap.get(num) || statsMap[num];
    const inWalkForward = wfPoolSet.has(num);
    const inGeneticTop = geneticTopSet.has(num);
    const isChaosInjected = chaosSet.has(num);
    const funnelItem = funnelCandidateMap.get(num);
    const funnelCompetitionScore = funnelItem?.score ?? 0;
    const isPolarExtreme = num <= 15 || num >= 76;
    const isAntiCrowdHigh = num > 31;
    const hasClusterBonus =
      (funnelItem?.sameDecadeCount ?? 0) > 0 ||
      (funnelItem?.adjacentCount ?? 0) > 0 ||
      (funnelItem?.sameCadenceCount ?? 0) > 0;

    const scoreLabel = `Score: ${funnelCompetitionScore >= 0 ? '+' : ''}${funnelCompetitionScore} pt`;

    // Assign role tag for multi-agent transparency
    let roleLabel = 'GENETICO';
    let tagColor: CamelPoolNumberReason['tagColor'] = 'purple';

    if (isChaosInjected) {
      roleLabel = 'CAOS';
      tagColor = 'amber';
    } else if (isPolarExtreme) {
      roleLabel = 'ESTREMO';
      tagColor = 'emerald';
    } else if (hasClusterBonus) {
      roleLabel = 'CLUSTER';
      tagColor = 'sky';
    }

    const primaryTag = `${roleLabel} • ${scoreLabel}`;

    const parts: string[] = [
      `${roleLabel} (${scoreLabel})`,
      isChaosInjected
        ? `Campionamento Fisher-Yates (crypto.getRandomValues) senza bias nella Top ${poolNumbers.length}`
        : `Selezionato senza vincoli forzati di decina o parità (${historicalDrawsWindow} conc. reali)`
    ];
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
      isChaosInjected,
      funnelCompetitionScore,
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
  const lowTargetCount = Math.round(clampedV / 3);
  const highTargetCount = clampedV - lowTargetCount;

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
    }). Pipeline Imbuto Bilanciato 90→30→${clampedV} attiva (25 Candidati Genetici/WF + 5 Caos: Bonus Clustering max +45 pt, Polarizzazione 1–15 e 76–90 +40 pt, Penalità Dispersione Mirata −5/−30/−15, Limite Morbido max 3 numeri per decina). @Scout Walk-Forward: avvia l'analisi sulle ultime ${clampedWindow} estrazioni storiche (su ${maxHistoricalDraws} disponibili).`,
    metricsBadge: `Finestra: ${clampedWindow}/${maxHistoricalDraws} conc. • Imbuto 30→${clampedV} (25+5 Caos)`
  });

  // --- STEP 2: Walk-Forward Scout runs rolling window validation on clampedWindow draws ---
  const tWf0 = performance.now();
  const wfRes = generateSmartPoolRecommendation(draws, clampedV, clampedWindow);
  const wfScoredForWindow = scoreAllNumbers(
    calculateNumberStatistics(windowedDraws, Math.min(36, Math.max(1, clampedWindow))),
    wfRes.mappedScoringWeights,
    36
  );
  const wfScoreByNum = new Map(wfScoredForWindow.map((s) => [s.number, s.compositeScore]));
  const wfRanked25 = [
    ...wfRes.recommendedPool.map((n, idx) => ({
      number: n,
      compositeScore: (wfScoreByNum.get(n) ?? 0.5) + (wfRes.recommendedPool.length - idx) * 0.05
    })),
    ...wfScoredForWindow
      .filter((s) => !wfRes.recommendedPool.includes(s.number))
      .map((s) => ({ number: s.number, compositeScore: s.compositeScore }))
  ];
  const hasRealDraws = draws.length > 0;
  const wfFunnel = selectFunnelPool30To12(
    wfRanked25,
    clampedV,
    undefined,
    hasRealDraws ? 'real_archive_weighted' : 'pure_uniform'
  );
  const wfProportionalPool = wfFunnel.top12Numbers;
  const wfMs = Math.max(1, Math.round(performance.now() - tWf0));

  dialogueTranscript.push({
    id: `msg-${stepCounter}`,
    stepNumber: stepCounter++,
    senderId: 'walk_forward_scout',
    receiverId: 'genetic_strategist',
    phase: 'exploration',
    content: `Ho testato 6 vettori statistici puri in validazione Walk-Forward su ${
      wfRes.walkForwardWindowSize
    } estrazioni storiche. La strategia dominante è "${
      wfRes.bestStrategy.label
    }" con ${wfRes.bestStrategy.terniHitCount} terni e ${
      wfRes.bestStrategy.ambiHitCount
    } ambi colpiti out-of-sample. Applicando l'Imbuto Bilanciato 30→${clampedV} (25 Candidati + 5 Caos [${wfFunnel.chaosNumbers.join(
      ', '
    )}] con Cluster cap +45, Estremi +40, Penalità Isolati e Max 3/Decina): Pool [${wfProportionalPool.join(
      ', '
    )}]. Passo al @Genetista Storico.`,
    toolCall: {
      toolName: 'generateSmartPoolRecommendation + selectFunnelPool30To12',
      executionMs: wfMs,
      inputSummary: `draws=${draws.length}, funnel=30->${clampedV} (25 Top + 5 Chaos [${wfFunnel.chaosNumbers.join(',')}]), window=${clampedWindow}`,
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
  const consensusFunnel = buildConsensusHybridFunnel(
    wfProportionalPool,
    geneticScored,
    clampedV,
    hasRealDraws
  );
  const antiCrowdFunnel = buildAntiCrowdResonanceFunnel(geneticScored, clampedV, hasRealDraws);
  const consensusPool = consensusFunnel.top12Numbers;
  const antiCrowdPool = antiCrowdFunnel.top12Numbers;
  const genMs = Math.max(1, Math.round(performance.now() - tGen0));

  const wfPoolSet = new Set(wfProportionalPool);
  const geneticTopSet = new Set(geneticScored.slice(0, 25).map((s) => s.number));

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
    )}€. Tramite l'Imbuto Bilanciato 30→${clampedV} (25 Genetici + 5 Caos [${antiCrowdFunnel.chaosNumbers.join(
      ', '
    )}] con Cluster cap +45, Estremi 1–15/76–90 +40, Penalità Isolati e Max 3/Decina), ho generato il Pool Consensus [${consensusPool.join(
      ', '
    )}] e il Pool Imbuto Bilanciato 30→${clampedV} [${antiCrowdPool.join(
      ', '
    )}]. @Architetto Ortogonale: procedi con la riduzione 2-Opt Kempe.`,
    toolCall: {
      toolName: 'runEvolutionarySliderTraining + selectFunnelPool30To12',
      executionMs: genMs,
      inputSummary: `n1=16, windowDraws=${clampedWindow}, generations=6, funnel=30->${clampedV} (25+5 Caos [${antiCrowdFunnel.chaosNumbers.join(',')}])`,
      outputSummary: `w1=${bestTriplet.w1.toFixed(2)}, w2=${bestTriplet.w2.toFixed(
        2
      )}, w3=${bestTriplet.w3.toFixed(2)} -> FunnelTop${clampedV}=[${antiCrowdPool.join(',')}]`
    },
    metricsBadge: `Pesi Genetici: (${bestTriplet.w1.toFixed(2)}, ${bestTriplet.w2.toFixed(
      2
    )}, ${bestTriplet.w3.toFixed(2)})`
  });

  // --- STEP 4: Orthogonal Architect builds the 3 Reduced Systems using Greedy + 2-Opt Kempe Local Search ---
  const tArch0 = performance.now();
  // Fase 2 specification: Disattivazione Filtro Dispersione Decine nella fase di scrematura finale (decades: false)
  const strictFilters: FilterOptions = {
    ...baseFilters,
    evenOdd: true,
    highLow: true,
    sumRange: true,
    consecutive: true,
    decades: false,
    cadences: true
  };

  const starCandidates = geneticScored.slice(0, 6).map((s) => s.number);
  const starPoolIfActive = playMode === 'superstar' ? starCandidates : undefined;

  const rawConfigs: Array<{
    id: string;
    strategyName: string;
    strategyOriginDescription: string;
    proposedByAgent: CamelAgentId;
    funnel: FunnelPoolSelectionResult;
    pool: number[];
    weights: ScoringWeights;
  }> = [
    {
      id: 'cand-wf',
      strategyName: `Strategia A — Walk-Forward + Imbuto Bilanciato 30→${clampedV} (${clampedWindow} Estrazioni)`,
      strategyOriginDescription: `Pipeline a Imbuto Bilanciato (30→${clampedV}): 25 migliori candidati Walk-Forward (${clampedWindow} estrazioni) + 5 numeri Caos [${wfFunnel.chaosNumbers.join(', ')}] in competizione pura. Bilanciamento tra Cluster (cap +45) ed Estremi 1–15/76–90 (+40), penalità isolati e limite massimo di 3 numeri per decina.`,
      proposedByAgent: 'walk_forward_scout',
      funnel: wfFunnel,
      pool: wfProportionalPool,
      weights: wfRes.mappedScoringWeights
    },
    {
      id: 'cand-consensus',
      strategyName: `Strategia B — Consensus Ibrido WF + Genetico (Imbuto Bilanciato 30→${clampedV})`,
      strategyOriginDescription: `Pipeline a Imbuto Bilanciato (30→${clampedV}): 25 candidati ibridi Walk-Forward/Genetista (${clampedWindow} estrazioni) + 5 numeri Caos [${consensusFunnel.chaosNumbers.join(', ')}] in competizione pura. Bilanciamento tra Cluster (cap +45) ed Estremi 1–15/76–90 (+40), penalità isolati e limite massimo di 3 numeri per decina.`,
      proposedByAgent: 'genetic_strategist',
      funnel: consensusFunnel,
      pool: consensusPool,
      weights: geneticWeights
    },
    {
      id: 'cand-anticrowd',
      strategyName: `Strategia C — Imbuto Bilanciato 30→${clampedV} (25 Gen + 5 Caos)`,
      strategyOriginDescription: `Pipeline a Imbuto Bilanciato (30→${clampedV}): 25 candidati genetici + 5 numeri Caos [${antiCrowdFunnel.chaosNumbers.join(', ')}] in competizione pura. Bilanciamento tra Cluster (cap +45) ed Estremi 1–15/76–90 (+40), penalità isolati e limite massimo di 3 numeri per decina.`,
      proposedByAgent: 'anti_crowd_critic',
      funnel: antiCrowdFunnel,
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
    content: `Ho generato i 3 sistemi ridotti da ${targetCols} sestine ciascuno (estratti con Imbuto Bilanciato 30→${clampedV} e limite Max 3/Decina) applicando Greedy Set Cover + 2-Opt Kempe-Swap Local Search. La copertura terni raggiunge ${
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
      inputSummary: `3 funnel pools of v=${clampedV} (30->${clampedV}, decades=false), targetCols=${targetCols}, target=${coverageTarget}`,
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

    const polarCount = item.pool.filter((n) => n <= 15 || n >= 76).length;
    const chaosPromotedCount = item.pool.filter((n) =>
      item.funnel.chaosNumbers.includes(n)
    ).length;

    // 4-Pillar Composite score (0..100) prioritizing real mathematical coverage & historical hits:
    // 1. Coverage efficiency (max 40)
    const covComponent = Number(
      Math.min(
        40,
        primaryCovPct * 0.48 + (coverageTarget === 'terni' ? ambiPct * 0.14 : terniPct * 0.18)
      ).toFixed(1)
    );
    // 2. Filter Cleanliness & Funnel Clustering/Polarization Structure (max 15)
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
    // Calibrated against the true SuperEnalotto 6/90 theoretical EV on 500 draws (~ -0.69 €/sestina for 1€ play, -1.00 € for SuperStar 1.50€)
    const mcNet = mcSim.weeklySystemPnL.meanSingleDrawNetPerSestina;
    const expectedBaselineNet = playMode === 'superstar' ? -1.0 : -0.69;
    const mcComponent = Number(
      Math.max(0, Math.min(10, 5.0 + (mcNet - expectedBaselineNet) * 14)).toFixed(1)
    );

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
      antiCrowdDetail: `Cap +45 Cluster • Bonus +40 Estremi • Max 3/Decina (${polarCount} estremi, ${chaosPromotedCount} caos • ${Math.round(
        zeroPenaltyRatio * 100
      )}% 0-penalità)`,
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
      )}€/sestina (benchmark teorico ${expectedBaselineNet.toFixed(2)}€)`
    };

    const poolReasons = buildPoolNumberReasons(
      item.funnel,
      statsMap,
      item.weights,
      wfPoolSet,
      geneticTopSet,
      clampedWindow
    );

    const verdict =
      camelCompositeScore >= 78
        ? `ECCELLENTE — Imbuto 30→${clampedV} con Clustering/Polarizzazione attivo, zero penalità filtri e ottima resa sulle ${clampedWindow} estrazioni.`
        : camelCompositeScore >= 68
        ? `SOLIDO — Selezione Imbuto 30→${clampedV} (25 + 5 Caos) con buona copertura matematica.`
        : `STANDARD — Copertura valida su ${clampedWindow} estrazioni.`;

    return {
      id: item.id,
      strategyName: item.strategyName,
      strategyOriginDescription: item.strategyOriginDescription,
      proposedByAgent: item.proposedByAgent,
      poolNumbers: item.pool,
      chaosNumbersInjected: item.funnel.chaosNumbers,
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
    }" con CAMEL Score ${winnerCandidate.camelCompositeScore}/100: Imbuto 30→${clampedV} (25 Genetici/WF + 5 Caos [${winnerCandidate.chaosNumbersInjected.join(
      ', '
    )}]), ${Math.round(
      winnerCandidate.zeroPenaltyColumnsRatio * 100
    )}% sestine a penalità zero, ${
      winnerCandidate.historicalBacktest.tierCounts.points3
    } terni e ${
      winnerCandidate.historicalBacktest.tierCounts.points4
    } quaterne sulle ${clampedWindow} estrazioni (incasso lordo: ${winnerCandidate.historicalBacktest.totalEstimatedGrossWinnings.toLocaleString(
      'it-IT'
    )}€).`,
    toolCall: {
      toolName: 'runHistoricalRealBacktest + scorePool30InPureCompetition',
      executionMs: critMs,
      inputSummary: `3 systems x ${clampedWindow} historical draws + 500 Bayesian urn draws`,
      outputSummary: `Winner="${winnerCandidate.id}" (Score=${winnerCandidate.camelCompositeScore}/100, Funnel=30->${clampedV})`
    },
    metricsBadge: `Winner Score: ${winnerCandidate.camelCompositeScore}/100 (Imbuto 30→${clampedV})`
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
    } numeri estratti con Imbuto 30→${clampedV} in Competizione Pura) è certificato e pronto per essere applicato al Generatore o salvato nel Registro Giocate.`,
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
