/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Draw {
  id: string; // e.g. "2026-045"
  contestNumber: number;
  year: number;
  date: string; // YYYY-MM-DD
  numbers: [number, number, number, number, number, number];
  jolly: number;
  superstar?: number;
}

export interface NumberStat {
  number: number;
  currentDelay: number;
  maxHistoricalDelay: number;
  normalizedDelay: number; // currentDelay / maxHistoricalDelay
  frequencyK: number; // frequency in last K cycles (e.g. 36)
  totalFrequency: number;
  affinityScore: number; // correlation with latest draw
  compositeScore: number;
}

export interface ScoringWeights {
  wDelay: number;     // w1: default 0.50
  wFrequency: number; // w2: default 0.30
  wAffinity: number;  // w3: default 0.20
}

export interface FilterOptions {
  evenOdd: boolean;       // 2/4, 3/3, 4/2
  highLow: boolean;       // 1-45 vs 46-90: 2/4, 3/3, 4/2
  sumRange: boolean;      // 190 to 350
  minSum: number;
  maxSum: number;
  consecutive: boolean;   // max consecutive count <= 2
  decades: boolean;       // max numbers in same decade <= 2
  cadences?: boolean;     // max numbers with same final digit (num % 10) <= 2
}

export interface GeneratedColumn {
  id: number;
  numbers: number[]; // 6 numbers sorted
  superstar?: number;
  sum: number;
  evens: number;
  odds: number;
  lows: number;
  highs: number;
}

export type CoverageTarget = 'ambi' | 'terni';

export interface SystemGenerationResult {
  poolNumbers: number[];
  columns: GeneratedColumn[];
  totalCombinations: number;
  filteredCombinationsCount: number;
  executionTimeMs: number;
  coverageTarget?: CoverageTarget;
  coverageMetrics: {
    poolSize: number;
    pairsCoveredCount: number;
    pairsTotalInPool: number;
    tripletsCoveredCount: number;
    tripletsTotalInPool: number;
    averagePresence: number; // e.g. 5.0 for v=12 and 10 columns
    presenceHistogram: Record<number, number>;
  };
}

export interface ColumnMatchResult {
  columnId: number;
  numbers: number[];
  matchedNumbers: number[];
  matchCount: number;
  hasJolly: boolean;
  hasSuperstar: boolean;
  superstarPlayed?: number;
  prizeTier: string;
  estimatedPrize: number;
}

export interface PlayResult {
  matchesPerColumn: ColumnMatchResult[];
  totalWinning: number;
  netReturn: number; // totalWinning - cost
  bestMatch: number;
  hasWin: boolean;
  verifiedAt: string;
  isManualWinning?: boolean;
}

export type PlayMode = 'pure_coverage' | 'superstar' | 'manual';

export interface SavedPlay {
  id: string;
  createdAt: string;
  targetContestId: string;
  mode: PlayMode;
  cost: number; // e.g. 10.00 €, 9.00 €, or custom manual cost
  savedAmount: number; // 0.00 € or 1.00 € for piggybank
  poolNumbers: number[];
  columns: GeneratedColumn[];
  status: 'IN_ATTESA' | 'VERIFICATA';
  result?: PlayResult;
  manualNote?: string;
  userEmail?: string;
}

export interface LedgerSummary {
  totalPlays: number;
  totalSpent: number;
  totalWon: number;
  piggybankBalance: number;
  netProfit: number;
  roiPercentage: number;
  winsCount: {
    points2: number;
    points3: number;
    points4: number;
    points5: number;
    points5plus1: number;
    points6: number;
    superstarBonus: number;
  };
}

export type SimulationMethodology = 'bayesian_hybrid_urn' | 'hypergeometric_pure_urn';

export interface SingleSestinaPnL {
  columnId: number;
  numbers: number[];
  superstar?: number;
  costPerDraw: number;
  totalDrawsEvaluated: number;
  totalCost: number;
  totalGrossGain: number;
  totalGrossLoss: number; // sum of unrecovered cost across losing draws
  totalNetProfitLoss: number; // totalGrossGain - totalCost
  averageGainPerDraw: number; // totalGrossGain / totalDrawsEvaluated
  averageLossPerDraw: number; // totalGrossLoss / totalDrawsEvaluated
  averageNetPerDraw: number;  // (totalGrossGain - totalCost) / totalDrawsEvaluated
  hitsBreakdown: {
    points0or1: number;
    points2: number;
    points3: number;
    points4: number;
    points5: number;
    points5plus1: number;
    points6: number;
    superstarHits: number;
  };
}

export interface WeeklySestinePnLSummary {
  sestineCount: number;
  drawsCount: number;
  perSestinaResults: SingleSestinaPnL[];
  // Mean values calculated across each single sestina (1/C * sum_{i=1}^C)
  meanTotalGainPerSestina: number;
  meanTotalLossPerSestina: number;
  meanTotalCostPerSestina: number;
  meanNetProfitLossPerSestina: number; // <-- Primary requested metric: media delle perdite e dei guadagni calcolate su ogni singola sestina (su N estrazioni)
  meanSingleDrawGainPerSestina: number;
  meanSingleDrawLossPerSestina: number;
  meanSingleDrawNetPerSestina: number; // <-- Media per singola sestina per singola estrazione settimanale
  bestPerformingColumnId: number;
}

export interface HundredDrawsSimulationResult {
  methodology: SimulationMethodology;
  coverageTarget: CoverageTarget;
  totalSimulatedDrawsCount: number; // 100 to 100,000 simulated draws
  simulatedDraws: Draw[]; // Materialized simulated future draws for log table (up to 500)
  numberFrequenciesInSim: Record<number, number>; // 1..90 -> count in N draws
  jollyFrequenciesInSim: Record<number, number>;
  superstarFrequenciesInSim: Record<number, number>;
  top12PoolNumbers: number[];
  recommendedWeights: ScoringWeights;
  recommendedFilters: FilterOptions;
  highProbabilitySestina: {
    numbers: [number, number, number, number, number, number];
    recommendedJolly: number;
    recommendedSuperstar: number;
    sum: number;
    evens: number;
    odds: number;
    lows: number;
    highs: number;
    confidenceIndex: number; // percentage convergence index
    simulatedBacktestPnL: SingleSestinaPnL;
  };
  weeklySystemPnL: WeeklySestinePnLSummary;
  executionTimeMs: number;
}

export interface SimulationGeneratorPreset {
  id: string;
  appliedAt: string;
  simulatedDrawsCount: number;
  methodology: SimulationMethodology;
  coverageTarget: CoverageTarget;
  highProbabilityNumbers?: [number, number, number, number, number, number];
  recommendedJolly?: number;
  recommendedSuperstar?: number;
  top12PoolNumbers: number[]; // Pool of 10-15 recommended numbers
  recommendedWeights: ScoringWeights;
  recommendedFilters: FilterOptions;
  confidenceIndex: number;
  enforceTenEuroBudget?: boolean;
  sourceLabel?: string;
}

export type HistoricalSelectionMode = 'strict_net_profit' | 'historical_benchmark_surplus';

export interface SliderTripletCandidate {
  id: string;
  generation: number;
  indexInGeneration: number;
  w1: number; // wDelay
  w2: number; // wFrequency
  w3: number; // wAffinity
  origin: 'random_init' | 'survivor' | 'crossover_mean';
  parentIds?: [string, string];
  parentWeights?: [
    { w1: number; w2: number; w3: number },
    { w1: number; w2: number; w3: number }
  ];
  poolNumbers: number[];
  evaluatedDrawsCount: number; // Full archive count (e.g., 2,946 draws from 2009 to today)
  totalGrossGain: number;
  totalCost: number;
  netProfitLoss: number; // > 0 means winning triplet ("in positivo di guadagno")
  meanNetProfitPerSestina: number;
  meanGainPerSestina: number;
  meanLossPerSestina: number;
  isWinning: boolean; // netProfitLoss > 0
  rawHistoricalGrossWin?: number;
  rawHistoricalNetPnL?: number;
  historicalHitsCount?: {
    points2: number;
    points3: number;
    points4: number;
    points5plus: number;
    superstarHits: number;
  };
}

export interface CrossoverRecord {
  childId: string;
  parent1Id: string;
  parent2Id: string;
  parent1: { w1: number; w2: number; w3: number };
  parent2: { w1: number; w2: number; w3: number };
  child: { w1: number; w2: number; w3: number };
}

export interface GenerationTrainingSummary {
  generationNumber: number;
  populationSizeN1: number;
  drawsTrainedN2: number;
  evaluatedTriplets: SliderTripletCandidate[];
  winningSurvivors: SliderTripletCandidate[];
  excludedLosingCount: number;
  generatedOffspring: CrossoverRecord[];
  bestTripletInGeneration: SliderTripletCandidate;
  averageWinningNetProfit: number;
  strictPositiveCount?: number;
  ruleAdaptationApplied?: boolean;
  ruleAdaptationNote?: string;
}

export interface EvolutionarySliderTrainingResult {
  n1TripletsCount: number;
  n2TrainingDraws: number;
  n3GenerationsCount: number;
  generations: GenerationTrainingSummary[];
  topWinningTriplets: SliderTripletCandidate[];
  bestOverallTriplet: SliderTripletCandidate;
  executionTimeMs: number;
  selectionMode?: HistoricalSelectionMode;
  historicalDateRange?: {
    from: string;
    to: string;
    totalOfficialDraws: number;
  };
  ruleConstraintWarnings?: string[];
}

export interface WalkForwardWeightVector {
  id: string;
  label: string;
  wFreqHot: number;
  wFreqCold: number;
  wDelay: number;
  wCoOccurrence: number;
  wDecadeBalance: number;
  walkForwardDrawsEvaluated: number;
  ambiHitCount: number;
  terniHitCount: number;
  quaterneHitCount: number;
  cinquineHitCount: number;
  compositeYieldScore: number;
}

export interface SmartPoolRecommendationResult {
  poolSize: number; // 10..15
  recommendedPool: number[];
  bestStrategy: WalkForwardWeightVector;
  evaluatedStrategies: WalkForwardWeightVector[];
  walkForwardWindowSize: number;
  mappedScoringWeights: ScoringWeights;
  decadeDistribution: Record<number, number>;
  cadenceDistribution: Record<number, number>;
  executionTimeMs: number;
}

export interface HistoricalContestWinEntry {
  drawId: string;
  contestNumber: number;
  year: number;
  date: string;
  drawnNumbers: [number, number, number, number, number, number];
  jolly: number;
  superstar?: number;
  antiCrowdMultiplier: number;
  bestColumnId: number;
  bestMatchCount: number;
  bestMatchedNumbers: number[];
  winningColumnsCount: number;
  points2Count: number;
  points3Count: number;
  points4Count: number;
  points5Count: number;
  points5Plus1Count: number;
  points6Count: number;
  superstarHitsCount: number;
  contestGrossPrize: number;
  contestCost: number;
  contestNetReturn: number;
}

export interface HistoricalRealBacktestResult {
  totalContestsEvaluated: number;
  sestineCount: number;
  costPerContest: number;
  totalHistoricalCost: number;
  totalEstimatedGrossWinnings: number;
  netHistoricalPnL: number;
  historicalRoiPct: number;
  averageAntiCrowdMultiplier: number;
  totalWinningContests: number;
  tierCounts: {
    points2: number;
    points3: number;
    points4: number;
    points5: number;
    points5plus1: number;
    points6: number;
    superstarHits: number;
  };
  winningContests: HistoricalContestWinEntry[];
  executionTimeMs: number;
}

export interface UserGeneratedSystemRecord {
  userEmail: string;
  updatedAt: string;
  poolSizeV: number;
  playMode: PlayMode;
  coverageTarget: CoverageTarget;
  selectedBudget: number;
  budgetMode: 'preset' | 'custom';
  selectedPool: number[];
  manualPoolEdit: boolean;
  weights: ScoringWeights;
  filters: FilterOptions;
  systemResult: SystemGenerationResult;
}

export interface UserSimulationStateRecord {
  userEmail: string;
  updatedAt: string;
  simSeed: number;
  methodology: SimulationMethodology;
  numDrawsToSimulate: number;
  coverageTarget: CoverageTarget;
  smartPoolSize: number;
}



