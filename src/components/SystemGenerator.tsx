/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Sliders,
  Sparkles,
  Layers,
  ShieldCheck,
  Check,
  Copy,
  RotateCcw,
  Clock,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  BookmarkPlus,
  DollarSign,
  Dices,
  Calculator,
  History,
  Award,
  ChevronLeft,
  ChevronRight,
  Lock
} from 'lucide-react';
import {
  Draw,
  ScoringWeights,
  FilterOptions,
  PlayMode,
  SystemGenerationResult,
  SavedPlay,
  NumberStat,
  GeneratedColumn,
  SimulationGeneratorPreset,
  CoverageTarget,
  HistoricalRealBacktestResult
} from '../types/lottery';
import {
  calculateNumberStatistics,
  scoreAllNumbers,
  selectFunnelPool30To12,
  FunnelPoolSelectionResult,
  PoolSelectionMode,
  getBalancedFunnelUiLabels,
  generateOptimizedSystem,
  calculateBudgetSystemAllocation,
  MAX_REDUCED_SYSTEM_BUDGET,
  PRESET_SYSTEM_BUDGETS,
  buildGeneratedColumn
} from '../utils/combinatorics';
import {
  runNext100DrawsSimulation,
  runHistoricalRealBacktest
} from '../utils/monteCarloSimulation';
import {
  DEFAULT_WEIGHTS,
  saveWeights,
  saveFilters,
  loadUserGeneratedSystem,
  saveUserGeneratedSystem,
  syncUserGeneratedSystem,
  cacheUserGeneratedSystemLocally
} from '../utils/storage';
import { subscribeCloudUserSystem } from '../utils/firebase';
import { EvolutionarySliderTrainer } from './EvolutionarySliderTrainer';

interface SystemGeneratorProps {
  userEmail: string;
  draws: Draw[];
  weights: ScoringWeights;
  onUpdateWeights: (weights: ScoringWeights) => void;
  filters: FilterOptions;
  onUpdateFilters: (filters: FilterOptions) => void;
  onSavePlay: (play: SavedPlay) => void;
  onOpenSmartPaste: () => void;
  onColumnsGenerated?: (columns: GeneratedColumn[]) => void;
  onOpenSimulationTab?: () => void;
  appliedSimPreset?: SimulationGeneratorPreset | null;
  onClearSimPreset?: () => void;
  coverageTarget?: CoverageTarget;
  onUpdateCoverageTarget?: (target: CoverageTarget) => void;
}

export const SystemGenerator: React.FC<SystemGeneratorProps> = ({
  userEmail,
  draws,
  weights,
  onUpdateWeights,
  filters,
  onUpdateFilters,
  onSavePlay,
  onColumnsGenerated,
  onOpenSimulationTab,
  appliedSimPreset,
  onClearSimPreset,
  coverageTarget = 'terni',
  onUpdateCoverageTarget
}) => {
  // Load existing persisted system for this specific user (if any)
  const initialUserRecord = useMemo(
    () => loadUserGeneratedSystem(userEmail),
    [userEmail]
  );

  // Config state initialized from the user's persisted system (default N=12 per 10 sestine simmetriche 5x)
  const [poolSizeV, setPoolSizeV] = useState<number>(() => {
    if (appliedSimPreset && appliedSimPreset.top12PoolNumbers.length >= 6) {
      return appliedSimPreset.top12PoolNumbers.length;
    }
    if (initialUserRecord && initialUserRecord.selectedPool.length >= 6) {
      return initialUserRecord.selectedPool.length;
    }
    return initialUserRecord?.poolSizeV ?? 12;
  });
  const [poolSelectionMode, setPoolSelectionMode] = useState<PoolSelectionMode>(() =>
    draws.length > 0 ? 'real_archive_weighted' : 'pure_uniform'
  );
  const effectivePoolSelectionMode: PoolSelectionMode =
    draws.length > 0 ? poolSelectionMode : 'pure_uniform';
  const [playMode, setPlayMode] = useState<PlayMode>(
    () => initialUserRecord?.playMode ?? 'pure_coverage'
  );
  const [localCoverageTarget, setLocalCoverageTarget] = useState<CoverageTarget>(
    () => initialUserRecord?.coverageTarget ?? coverageTarget
  );
  const activeCoverageTarget = onUpdateCoverageTarget ? coverageTarget : localCoverageTarget;

  const [budgetMode, setBudgetMode] = useState<'preset' | 'custom'>(
    () => initialUserRecord?.budgetMode ?? 'preset'
  );
  const [selectedBudget, setSelectedBudget] = useState<number>(
    () => initialUserRecord?.selectedBudget ?? 10
  );
  const [customBudgetInput, setCustomBudgetInput] = useState<string>(() =>
    String(initialUserRecord?.selectedBudget ?? 25)
  );
  const [budgetCappedWarning, setBudgetCappedWarning] = useState<boolean>(false);
  const [selectedPool, setSelectedPool] = useState<number[]>(() => {
    if (appliedSimPreset && appliedSimPreset.top12PoolNumbers.length >= 6) {
      return appliedSimPreset.top12PoolNumbers;
    }
    if (initialUserRecord && initialUserRecord.selectedPool.length >= 6) {
      return initialUserRecord.selectedPool;
    }
    return [];
  });
  const [systemResult, setSystemResult] = useState<SystemGenerationResult | null>(
    () => initialUserRecord?.systemResult ?? null
  );
  const [lastCalculatedAt, setLastCalculatedAt] = useState<string | null>(
    () => initialUserRecord?.updatedAt ?? null
  );
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [manualPoolEdit, setManualPoolEdit] = useState<boolean>(() =>
    Boolean(
      (appliedSimPreset && appliedSimPreset.top12PoolNumbers.length >= 6) ||
        initialUserRecord?.manualPoolEdit
    )
  );
  const [recalcFeedback, setRecalcFeedback] = useState(false);

  // Backtest Reale Istantaneo filter & pagination state (Point 4)
  const [backtestFilter, setBacktestFilter] = useState<'all' | 'terni' | 'quaternePlus'>('all');
  const [backtestPage, setBacktestPage] = useState<number>(1);
  const backtestPageSize = 8;

  // Calculate budget allocation (columns count, actual cost, piggybank remainder)
  const budgetAllocation = useMemo(
    () => calculateBudgetSystemAllocation(selectedBudget, playMode),
    [selectedBudget, playMode]
  );

  const pureAllocationForBadge = useMemo(
    () => calculateBudgetSystemAllocation(selectedBudget, 'pure_coverage'),
    [selectedBudget]
  );

  const starAllocationForBadge = useMemo(
    () => calculateBudgetSystemAllocation(selectedBudget, 'superstar'),
    [selectedBudget]
  );

  const handleSelectCoverageTarget = (target: CoverageTarget) => {
    setLocalCoverageTarget(target);
    onUpdateCoverageTarget?.(target);
    setHasPendingChanges(true);
  };

  const handleSelectPresetBudget = (preset: number) => {
    setBudgetMode('preset');
    setBudgetCappedWarning(false);
    setSelectedBudget(preset);
    setHasPendingChanges(true);
  };

  const handleSelectCustomBudgetMode = () => {
    setBudgetMode('custom');
    const parsed = parseFloat(customBudgetInput.replace(',', '.'));
    if (!Number.isNaN(parsed) && parsed >= 1) {
      const capped = parsed > MAX_REDUCED_SYSTEM_BUDGET;
      setBudgetCappedWarning(capped);
      const clamped = Math.min(MAX_REDUCED_SYSTEM_BUDGET, Math.max(1, Math.round(parsed)));
      setSelectedBudget(clamped);
      if (capped) setCustomBudgetInput(String(MAX_REDUCED_SYSTEM_BUDGET));
    } else {
      setCustomBudgetInput(String(selectedBudget));
    }
    setHasPendingChanges(true);
  };

  const handleCustomBudgetChange = (rawVal: string) => {
    setCustomBudgetInput(rawVal);
    const parsed = parseFloat(rawVal.replace(',', '.'));
    if (Number.isNaN(parsed)) {
      return;
    }
    if (parsed > MAX_REDUCED_SYSTEM_BUDGET) {
      setBudgetCappedWarning(true);
      setSelectedBudget(MAX_REDUCED_SYSTEM_BUDGET);
    } else if (parsed >= 1) {
      setBudgetCappedWarning(false);
      setSelectedBudget(Math.round(parsed));
    }
    setHasPendingChanges(true);
  };

  const handleCustomBudgetBlur = () => {
    const parsed = parseFloat(customBudgetInput.replace(',', '.'));
    if (Number.isNaN(parsed) || parsed < 1) {
      setCustomBudgetInput('1');
      setSelectedBudget(1);
      setBudgetCappedWarning(false);
    } else if (parsed > MAX_REDUCED_SYSTEM_BUDGET) {
      setCustomBudgetInput(String(MAX_REDUCED_SYSTEM_BUDGET));
      setSelectedBudget(MAX_REDUCED_SYSTEM_BUDGET);
      setBudgetCappedWarning(true);
    } else {
      const rounded = Math.round(parsed);
      setCustomBudgetInput(String(rounded));
      setSelectedBudget(rounded);
    }
  };

  // Calculate stats from draws
  const numberStatsMap = useMemo(() => {
    return calculateNumberStatistics(draws, 36);
  }, [draws]);

  // Recalculate scored ranking whenever weights, draws, or numberStatsMap changes
  const scoredNumbers = useMemo(() => {
    return scoreAllNumbers(numberStatsMap, weights, 36);
  }, [numberStatsMap, weights]);

  // Map number -> updated NumberStat with live compositeScore
  const scoredByNumber = useMemo(() => {
    const map: Record<number, NumberStat> = {};
    for (const s of scoredNumbers) {
      map[s.number] = s;
    }
    return map;
  }, [scoredNumbers]);

  // Selezione Equa del Pool (Fisher-Yates con crypto.getRandomValues)
  const [funnelSelection, setFunnelSelection] = useState<FunnelPoolSelectionResult>(() =>
    selectFunnelPool30To12(scoredNumbers, poolSizeV, undefined, effectivePoolSelectionMode)
  );

  const defaultTopVNumbers = useMemo(() => {
    return funnelSelection.top12Numbers;
  }, [funnelSelection]);

  // Initialize selectedPool only if it is currently empty
  useEffect(() => {
    if (selectedPool.length === 0 && defaultTopVNumbers.length >= 6) {
      setSelectedPool(defaultTopVNumbers);
    }
  }, [defaultTopVNumbers, selectedPool.length]);

  const handleSelectPoolMode = (nextMode: PoolSelectionMode) => {
    if (nextMode === 'real_archive_weighted' && draws.length === 0) return;
    setPoolSelectionMode(nextMode);
    setManualPoolEdit(false);
    const freshScored = scoreAllNumbers(numberStatsMap, weights, 36);
    const freshFunnel = selectFunnelPool30To12(freshScored, poolSizeV, undefined, nextMode);
    setFunnelSelection(freshFunnel);
    setSelectedPool(freshFunnel.top12Numbers);
    setHasPendingChanges(true);
  };

  // Slider handlers: update weights and Pool Base preview, but DO NOT change sestine until user clicks "Calcola Sistema Ottimizzato"
  const handleWeightChange = (key: keyof ScoringWeights, val: number) => {
    const updated = { ...weights, [key]: Number(val.toFixed(2)) };
    setManualPoolEdit(false);
    onUpdateWeights(updated);
    saveWeights(updated);
    const freshScored = scoreAllNumbers(numberStatsMap, updated, 36);
    const freshFunnel = selectFunnelPool30To12(
      freshScored,
      poolSizeV,
      undefined,
      effectivePoolSelectionMode
    );
    setFunnelSelection(freshFunnel);
    setSelectedPool(freshFunnel.top12Numbers);
    setHasPendingChanges(true);
  };

  const handleResetWeights = () => {
    setManualPoolEdit(false);
    onUpdateWeights(DEFAULT_WEIGHTS);
    saveWeights(DEFAULT_WEIGHTS);
    const freshScored = scoreAllNumbers(numberStatsMap, DEFAULT_WEIGHTS, 36);
    const freshFunnel = selectFunnelPool30To12(
      freshScored,
      poolSizeV,
      undefined,
      effectivePoolSelectionMode
    );
    setFunnelSelection(freshFunnel);
    setSelectedPool(freshFunnel.top12Numbers);
    setHasPendingChanges(true);
  };

  const handleApplyTripletWeights = (newWeights: ScoringWeights) => {
    setManualPoolEdit(false);
    onUpdateWeights(newWeights);
    saveWeights(newWeights);
    const freshScored = scoreAllNumbers(numberStatsMap, newWeights, 36);
    const freshFunnel = selectFunnelPool30To12(
      freshScored,
      poolSizeV,
      undefined,
      effectivePoolSelectionMode
    );
    setFunnelSelection(freshFunnel);
    setSelectedPool(freshFunnel.top12Numbers);
    setHasPendingChanges(true);
  };

  const activeFunnelTargetCount =
    !manualPoolEdit && selectedPool.length >= 6 ? selectedPool.length : poolSizeV;
  const funnelUiLabels = useMemo(
    () => getBalancedFunnelUiLabels(activeFunnelTargetCount),
    [activeFunnelTargetCount]
  );

  // Explicit "Estrai Nuovi N Numeri Equi" action: refreshes Pool Base via Fisher-Yates Crypto RNG
  const handleRecalculateFromWeights = () => {
    const targetV = activeFunnelTargetCount;
    if (poolSizeV !== targetV) {
      setPoolSizeV(targetV);
    }
    const freshScored = scoreAllNumbers(numberStatsMap, weights, 36);
    const freshFunnel = selectFunnelPool30To12(
      freshScored,
      targetV,
      undefined,
      effectivePoolSelectionMode
    );
    setFunnelSelection(freshFunnel);
    setManualPoolEdit(false);
    onClearSimPreset?.();
    setSelectedPool(freshFunnel.top12Numbers);
    setHasPendingChanges(true);
    setRecalcFeedback(true);
    setTimeout(() => setRecalcFeedback(false), 2500);
  };

  // Generate / Run Optimization — ONLY called when user explicitly clicks "Calcola Sistema Ottimizzato" (or once if brand-new user has no system)
  const handleRunOptimization = (
    overridePool?: number[],
    pinnedFirstSestina?: number[] | null,
    pinnedSuperstar?: number,
    overrideTargetCount?: number,
    overrideCoverageTarget?: CoverageTarget
  ) => {
    const targetCount = overrideTargetCount ?? budgetAllocation.targetColumnsCount;
    const covTarget = overrideCoverageTarget ?? activeCoverageTarget;
    const poolToUse =
      Array.isArray(overridePool) && overridePool.length >= 6
        ? overridePool
        : selectedPool.length >= 6
        ? selectedPool
        : defaultTopVNumbers;

    if (selectedPool.length < 6 && defaultTopVNumbers.length >= 6) {
      setSelectedPool(defaultTopVNumbers);
    }

    // SuperStar candidates from highest scoring stats
    const superstarPool = scoredNumbers.slice(0, 6).map((s) => s.number);

    const result = generateOptimizedSystem(
      poolToUse,
      filters,
      targetCount,
      playMode === 'superstar' ? superstarPool : undefined,
      covTarget
    );

    // If a simulation preset is active with a 6-number pinned sestina, ensure Colonna #1 is that sestina
    const activePinnedSestina =
      pinnedFirstSestina !== undefined
        ? pinnedFirstSestina
        : appliedSimPreset?.highProbabilityNumbers ?? null;
    const activePinnedSuperstar =
      pinnedSuperstar !== undefined
        ? pinnedSuperstar
        : appliedSimPreset?.recommendedSuperstar;

    if (activePinnedSestina && activePinnedSestina.length === 6 && result.columns.length > 0) {
      const pinnedKey = [...activePinnedSestina].sort((a, b) => a - b).join('-');
      const existingIdx = result.columns.findIndex(
        (c) => [...c.numbers].sort((a, b) => a - b).join('-') === pinnedKey
      );
      const firstCol = buildGeneratedColumn(
        1,
        activePinnedSestina,
        playMode === 'superstar' ? activePinnedSuperstar : undefined
      );

      if (firstCol) {
        let updatedCols: GeneratedColumn[];
        if (existingIdx >= 0) {
          const others = result.columns.filter((_, idx) => idx !== existingIdx);
          updatedCols = [firstCol, ...others].map((c, idx) => ({ ...c, id: idx + 1 }));
        } else {
          const others = result.columns.slice(0, Math.max(0, targetCount - 1));
          updatedCols = [firstCol, ...others].map((c, idx) => ({ ...c, id: idx + 1 }));
        }
        result.columns = updatedCols;
      }
    }

    const nowIso = new Date().toISOString();
    setSystemResult(result);
    setLastCalculatedAt(nowIso);
    setHasPendingChanges(false);
    setBacktestPage(1);
    onColumnsGenerated?.(result.columns);
    setSavedSuccess(false);

    // Persist this user's generated system so it stays locked for this user across sessions and browsers
    saveUserGeneratedSystem({
      userEmail,
      updatedAt: nowIso,
      poolSizeV: poolToUse.length,
      playMode,
      coverageTarget: covTarget,
      selectedBudget,
      budgetMode,
      selectedPool: poolToUse,
      manualPoolEdit,
      weights,
      filters,
      systemResult: result
    });
  };

  // Compute expected gains/losses mean per individual sestina across 100 simulated draws (Pure Physical Urn)
  const expectedWeeklyPnL = useMemo(() => {
    if (!systemResult || systemResult.columns.length === 0) return null;
    return runNext100DrawsSimulation(
      draws,
      systemResult.columns,
      'hypergeometric_pure_urn',
      202604,
      100,
      systemResult.coverageTarget || activeCoverageTarget
    ).weeklySystemPnL;
  }, [draws, systemResult, activeCoverageTarget]);

  // Punto 4: Verifica Vincite su Storico Reale (Backtest Reale Istantaneo con moltiplicatore Anti-Crowd)
  const realHistoricalBacktest: HistoricalRealBacktestResult | null = useMemo(() => {
    if (!systemResult || systemResult.columns.length === 0 || draws.length === 0) return null;
    return runHistoricalRealBacktest(systemResult.columns, draws);
  }, [systemResult, draws]);

  const filteredWinningContests = useMemo(() => {
    if (!realHistoricalBacktest) return [];
    if (backtestFilter === 'terni') {
      return realHistoricalBacktest.winningContests.filter((w) => w.points3Count > 0);
    }
    if (backtestFilter === 'quaternePlus') {
      return realHistoricalBacktest.winningContests.filter(
        (w) =>
          w.points4Count + w.points5Count + w.points5Plus1Count + w.points6Count > 0
      );
    }
    return realHistoricalBacktest.winningContests;
  }, [realHistoricalBacktest, backtestFilter]);

  const totalBacktestPages = Math.max(
    1,
    Math.ceil(filteredWinningContests.length / backtestPageSize)
  );
  const currentBacktestContests = useMemo(() => {
    const start = (backtestPage - 1) * backtestPageSize;
    return filteredWinningContests.slice(start, start + backtestPageSize);
  }, [filteredWinningContests, backtestPage]);

  // Set of all numbers present in the generated system columns for highlighting in historical backtest
  const systemNumbersSet = useMemo(() => {
    const s = new Set<number>();
    if (systemResult) {
      for (const col of systemResult.columns) {
        for (const n of col.numbers) s.add(n);
      }
    }
    return s;
  }, [systemResult]);

  // Apply imported simulation / Walk-Forward preset into controls (user clicks "Calcola Sistema Ottimizzato" to update sestine)
  useEffect(() => {
    if (appliedSimPreset && appliedSimPreset.top12PoolNumbers.length >= 6) {
      setPoolSizeV(appliedSimPreset.top12PoolNumbers.length);
      setManualPoolEdit(true);
      setSelectedPool(appliedSimPreset.top12PoolNumbers);

      const targetCov = appliedSimPreset.coverageTarget || 'terni';
      setLocalCoverageTarget(targetCov);

      if (appliedSimPreset.enforceTenEuroBudget) {
        setBudgetMode('preset');
        setSelectedBudget(10);
        setPlayMode('pure_coverage');
      }
      setHasPendingChanges(true);
    }
  }, [appliedSimPreset]);

  // Load and synchronize this specific user's saved system on mount or when userEmail changes.
  // Never auto-recalculate if the user already has a saved system!
  useEffect(() => {
    let active = true;
    const localRec = loadUserGeneratedSystem(userEmail);

    const applySavedRecordToState = (rec: NonNullable<typeof localRec>) => {
      setSystemResult(rec.systemResult);
      setLastCalculatedAt(rec.updatedAt);
      onColumnsGenerated?.(rec.systemResult.columns);

      if (!appliedSimPreset) {
        setPoolSizeV(rec.poolSizeV);
        setPlayMode(rec.playMode);
        setLocalCoverageTarget(rec.coverageTarget);
        onUpdateCoverageTarget?.(rec.coverageTarget);
        setBudgetMode(rec.budgetMode);
        setSelectedBudget(rec.selectedBudget);
        setCustomBudgetInput(String(rec.selectedBudget));
        setSelectedPool(rec.selectedPool);
        setManualPoolEdit(rec.manualPoolEdit);
        if (rec.weights) onUpdateWeights(rec.weights);
        if (rec.filters) onUpdateFilters(rec.filters);
        setHasPendingChanges(false);
      }
    };

    if (localRec) {
      applySavedRecordToState(localRec);
    }

    syncUserGeneratedSystem(userEmail).then((syncedRec) => {
      if (!active) return;
      if (syncedRec) {
        const currentLocal = loadUserGeneratedSystem(userEmail);
        if (!currentLocal || !localRec || syncedRec.updatedAt > localRec.updatedAt) {
          applySavedRecordToState(syncedRec);
        }
      } else if (!localRec && defaultTopVNumbers.length >= 6) {
        // Brand-new user with no saved system anywhere: generate initial system once and lock it for this user
        handleRunOptimization(defaultTopVNumbers);
      }
    });

    const unsubUserSystem = subscribeCloudUserSystem(userEmail, (cloudRec) => {
      if (!active || !cloudRec) return;
      const currentLocal = loadUserGeneratedSystem(userEmail);
      if (!currentLocal || cloudRec.updatedAt > currentLocal.updatedAt) {
        cacheUserGeneratedSystemLocally(cloudRec);
        applySavedRecordToState(cloudRec);
      }
    });

    return () => {
      active = false;
      unsubUserSystem();
    };
  }, [userEmail]);

  // Save Play to Ledger
  const handleSaveToLedger = () => {
    if (!systemResult) return;

    // Latest draw contest number + 1 as target
    const latestDraw = draws[0];
    const targetContestNumber = latestDraw ? latestDraw.contestNumber + 1 : 46;
    const targetYear = latestDraw ? latestDraw.year : 2026;
    const targetId = `${targetYear}-${String(targetContestNumber).padStart(3, '0')}`;

    const play: SavedPlay = {
      id: `play-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId: targetId,
      mode: playMode,
      cost: budgetAllocation.actualCost,
      savedAmount: budgetAllocation.savedAmount,
      poolNumbers: systemResult.poolNumbers,
      columns: systemResult.columns,
      status: 'IN_ATTESA'
    };

    onSavePlay(play);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  };

  // Copy columns text for online play
  const handleCopyColumns = () => {
    if (!systemResult) return;
    const lines = systemResult.columns.map((c) => {
      const colStr = `Colonna ${c.id}: ${c.numbers.join(' - ')}`;
      return c.superstar ? `${colStr} [SuperStar: ${c.superstar}]` : colStr;
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Toggle number in custom pool
  const toggleNumberInPool = (num: number) => {
    setManualPoolEdit(true);
    if (selectedPool.includes(num)) {
      if (selectedPool.length > 6) {
        setSelectedPool(selectedPool.filter((n) => n !== num));
        setHasPendingChanges(true);
      }
    } else {
      if (selectedPool.length < 15) {
        setSelectedPool([...selectedPool, num].sort((a, b) => a - b));
        setHasPendingChanges(true);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner when High-Probability Sestina or Walk-Forward Smart Pool is imported */}
      {appliedSimPreset && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-amber-950/50 border-2 border-emerald-500/50 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-emerald-500 text-slate-950 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {appliedSimPreset.sourceLabel
                  ? appliedSimPreset.sourceLabel
                  : `Parametri & Sestina Importati dalla Simulazione (${appliedSimPreset.simulatedDrawsCount.toLocaleString('it-IT')} Estrazioni)`}
              </span>
              {appliedSimPreset.highProbabilityNumbers ? (
                <span className="text-xs font-mono text-amber-300 font-bold">
                  Colonna #01 Fissata: {appliedSimPreset.highProbabilityNumbers.join(' - ')} (★
                  {appliedSimPreset.recommendedSuperstar})
                </span>
              ) : (
                <span className="text-xs font-mono text-sky-300 font-bold">
                  Modalità Attiva: Garanzia Terno (t = 3 &bull; 10€ / 10 Colonne)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              Pool consigliato ({appliedSimPreset.top12PoolNumbers.length} numeri:{' '}
              {appliedSimPreset.top12PoolNumbers.join(', ')}) e pesi S(x) impostati a{' '}
              <strong className="text-white font-mono">
                w₁={appliedSimPreset.recommendedWeights.wDelay.toFixed(2)}, w₂=
                {appliedSimPreset.recommendedWeights.wFrequency.toFixed(2)}, w₃=
                {appliedSimPreset.recommendedWeights.wAffinity.toFixed(2)}
              </strong>
              .
            </p>
          </div>
          {onClearSimPreset && (
            <button
              type="button"
              onClick={handleRecalculateFromWeights}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-bold shrink-0 cursor-pointer"
            >
              Ripristina Pool da Storico
            </button>
          )}
        </div>
      )}

      {/* Top Banner / Budget Overview & Budget Selector */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-amber-950/30 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden space-y-4">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Budget {budgetAllocation.clampedBudget.toFixed(2).replace('.', ',')} € / Settimana
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Covering Design C({poolSizeV}, 6, {activeCoverageTarget === 'terni' ? '3' : '2'},{' '}
                {budgetAllocation.targetColumnsCount})
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
              Ottimizzatore Combinatorio SuperEnalotto
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Algoritmo ortogonale a costo zero che massimizza la copertura di{' '}
              <strong className="text-amber-300">
                {activeCoverageTarget === 'terni' ? 'terni (t = 3, Punto 3)' : 'ambi (t = 2, Punto 2)'}
              </strong>{' '}
              da un pool di <strong className="text-slate-200">{poolSizeV} numeri</strong> con
              matrici bitmask <code className="text-sky-300">Uint8Array</code> e filtri Anti-Massa{' '}
              <strong className="text-emerald-300">Soft-Penalty</strong>.
            </p>
          </div>

          {/* Mode Selector Tabs */}
          <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => {
                setPlayMode('pure_coverage');
                setHasPendingChanges(true);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                playMode === 'pure_coverage'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Copertura Pura</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-950/20">
                {pureAllocationForBadge.targetColumnsCount}{' '}
                {pureAllocationForBadge.targetColumnsCount === 1 ? 'Sestina' : 'Sestine'} (
                {pureAllocationForBadge.actualCost.toFixed(0)}€)
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPlayMode('superstar');
                setHasPendingChanges(true);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                playMode === 'superstar'
                  ? 'bg-purple-600 text-white shadow-md font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Modalità SuperStar</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/20">
                {starAllocationForBadge.targetColumnsCount}{' '}
                {starAllocationForBadge.targetColumnsCount === 1 ? 'Sestina' : 'Sestine'} (
                {starAllocationForBadge.actualCost.toFixed(2).replace('.00', '')}€
                {starAllocationForBadge.savedAmount > 0
                  ? ` + ${starAllocationForBadge.savedAmount.toFixed(2).replace('.00', '')}€`
                  : ''}
                )
              </span>
            </button>
          </div>
        </div>

        {/* Budget Selection Bar: 10€, 15€, 20€, or Scelta Libera (max 100€) */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1 mr-1">
              <DollarSign className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Budget Sistema Ridotto:</span>
            </span>

            {PRESET_SYSTEM_BUDGETS.map((preset) => {
              const isSelected = budgetMode === 'preset' && selectedBudget === preset;
              const presetCols =
                playMode === 'pure_coverage' ? preset : Math.floor(preset / 1.5);
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectPresetBudget(preset)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md shadow-amber-500/20 font-extrabold'
                      : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-amber-500/40 hover:text-amber-300'
                  }`}
                >
                  <span>{preset} €</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded ${
                      isSelected
                        ? 'bg-slate-950/20 text-slate-950 font-extrabold'
                        : 'bg-slate-900 text-slate-400'
                    }`}
                  >
                    {presetCols} col.
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={handleSelectCustomBudgetMode}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                budgetMode === 'custom'
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md shadow-amber-500/20 font-extrabold'
                  : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              <span>Scelta Libera (max {MAX_REDUCED_SYSTEM_BUDGET} €)</span>
            </button>
          </div>

          {/* Custom Budget Input + Slider (when Scelta Libera is selected) or Summary */}
          {budgetMode === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2.5 bg-slate-950/90 px-3.5 py-2 rounded-xl border border-amber-500/40">
              <label
                htmlFor="custom-budget-input"
                className="text-xs font-bold text-amber-300 whitespace-nowrap"
              >
                Budget Libero (€):
              </label>
              <input
                id="custom-budget-input"
                type="number"
                min={1}
                max={MAX_REDUCED_SYSTEM_BUDGET}
                step={1}
                value={customBudgetInput}
                onChange={(e) => handleCustomBudgetChange(e.target.value)}
                onBlur={handleCustomBudgetBlur}
                aria-label="Importo budget libero (max 100€)"
                className="w-20 rounded-lg bg-slate-900 border border-amber-500/50 px-2.5 py-1 text-center font-mono font-extrabold text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <input
                type="range"
                min={1}
                max={MAX_REDUCED_SYSTEM_BUDGET}
                step={1}
                value={budgetAllocation.clampedBudget}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomBudgetInput(val);
                  setBudgetCappedWarning(false);
                  setSelectedBudget(parseInt(val, 10) || 10);
                  setHasPendingChanges(true);
                }}
                aria-label="Slider budget libero (1-100€)"
                className="w-28 sm:w-36 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <span className="text-xs font-mono text-slate-300 whitespace-nowrap">
                &rarr;{' '}
                <strong className="text-amber-400">
                  {budgetAllocation.targetColumnsCount}{' '}
                  {budgetAllocation.targetColumnsCount === 1 ? 'sestina' : 'sestine'}
                </strong>{' '}
                ({budgetAllocation.actualCost.toFixed(2).replace('.', ',')} €)
              </span>
              {budgetCappedWarning && (
                <span className="text-[11px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                  Limitato al massimo di {MAX_REDUCED_SYSTEM_BUDGET} €
                </span>
              )}
            </div>
          ) : (
            <div className="text-xs font-mono text-slate-400 flex items-center gap-2 shrink-0">
              <span>
                Sviluppo attivo:{' '}
                <strong className="text-amber-400">
                  {budgetAllocation.targetColumnsCount} colonne ridotte
                </strong>{' '}
                (Costo:{' '}
                <strong className="text-white">
                  {budgetAllocation.actualCost.toFixed(2).replace('.', ',')} €
                </strong>
                {budgetAllocation.savedAmount > 0
                  ? ` + ${budgetAllocation.savedAmount.toFixed(2).replace('.', ',')} € salvadanaio`
                  : ''}
                )
              </span>
            </div>
          )}
        </div>

        {/* Coverage Target Quick Selector: Massimizza Ambi (t = 2) vs Massimizza Terni (t = 3) */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mr-1 shrink-0">
              <span>Obiettivo Copertura:</span>
            </span>

            <button
              type="button"
              onClick={() => handleSelectCoverageTarget('ambi')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 border transition-all shrink-0 ${
                activeCoverageTarget === 'ambi'
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md shadow-amber-500/20 font-extrabold'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              <span>🎯 Massimizza Ambi (t = 2)</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                  activeCoverageTarget === 'ambi'
                    ? 'bg-slate-950/20 text-slate-950 font-extrabold'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                Garanzia Punto 2
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectCoverageTarget('terni')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 border transition-all shrink-0 ${
                activeCoverageTarget === 'terni'
                  ? 'bg-sky-500 text-slate-950 border-sky-300 shadow-md shadow-sky-500/20 font-extrabold'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-sky-500/40 hover:text-sky-300'
              }`}
            >
              <span>🚀 Massimizza Terni (t = 3)</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                  activeCoverageTarget === 'terni'
                    ? 'bg-slate-950/20 text-slate-950 font-extrabold'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                Ortogonale Punto 3
              </span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-400">
            {activeCoverageTarget === 'terni' ? (
              <span>
                Modalità <strong className="text-sky-400">C({poolSizeV}, 6, 3)</strong>: priorità
                triplette inedite (&times;14) e penalità collisione terni
              </span>
            ) : (
              <span>
                Modalità <strong className="text-amber-400">C({poolSizeV}, 6, 2)</strong>: priorità
                coppie inedite (&times;8) per saturazione 100% ambi
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Controls & Scoring on Left, Output on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Sliders, Filters, Pool Selection (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Section: Scoring Weights Sliders */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Pesi Funzione di Scoring S(x)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleResetWeights}
                className="text-xs text-slate-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                title="Reimposta pesi predefiniti (0.50, 0.30, 0.20)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Default</span>
              </button>
            </div>

            {/* Formula display */}
            <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/80 text-[11px] font-mono text-slate-300 flex items-center justify-between">
              <span>S(x) = w₁·Rit(x) + w₂·Freq(x) + w₃·Aff(x)</span>
              <span className="text-amber-400 font-bold">
                Σ = {(weights.wDelay + weights.wFrequency + weights.wAffinity).toFixed(2)}
              </span>
            </div>

            {/* Slider 1: w1 - Delay (Ritardo Storico) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="weight-delay-slider" className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  w₁: Ritardo Cronologico (Rit)
                </label>
                <span className="font-mono font-bold text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                  {weights.wDelay.toFixed(2)}
                </span>
              </div>
              <input
                id="weight-delay-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={weights.wDelay}
                onChange={(e) => handleWeightChange('wDelay', parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
              <p className="text-[10px] text-slate-500 flex justify-between">
                <span>Rapporto ritardo attuale / max storico</span>
                <span>Priorità numeri ritardatari</span>
              </p>
            </div>

            {/* Slider 2: w2 - Frequency (Frequenza Ciclica K=36) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="weight-freq-slider" className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  w₂: Frequenza Ciclica (Freq, K=36)
                </label>
                <span className="font-mono font-bold text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                  {weights.wFrequency.toFixed(2)}
                </span>
              </div>
              <input
                id="weight-freq-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={weights.wFrequency}
                onChange={(e) => handleWeightChange('wFrequency', parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
              />
              <p className="text-[10px] text-slate-500 flex justify-between">
                <span>Uscite negli ultimi 36 concorsi</span>
                <span>Priorità numeri "caldi"</span>
              </p>
            </div>

            {/* Slider 3: w3 - Affinity (Affinità / Spia) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="weight-aff-slider" className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  w₃: Affinità Spia / Simpatia (Aff)
                </label>
                <span className="font-mono font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {weights.wAffinity.toFixed(2)}
                </span>
              </div>
              <input
                id="weight-aff-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={weights.wAffinity}
                onChange={(e) => handleWeightChange('wAffinity', parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <p className="text-[10px] text-slate-500 flex justify-between">
                <span>Correlazione con l'ultima estrazione</span>
                <span>Numeri simpatici / spia</span>
              </p>
            </div>

            {/* Selettore Modalità di Selezione Equa del Pool: Selezione Pura vs Pesatura su Archivio Reale */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  Modalità Selezione Pool (Crypto RNG Fisher-Yates):
                </span>
                {draws.length === 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Nessuna estrazione reale in archivio
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectPoolMode('pure_uniform')}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all text-left border cursor-pointer ${
                    effectivePoolSelectionMode === 'pure_uniform'
                      ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-md font-extrabold'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>Selezione Pura (Equiprobabile 1-90)</span>
                    {effectivePoolSelectionMode === 'pure_uniform' && (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </div>
                  <span
                    className={`block text-[10px] mt-0.5 font-normal ${
                      effectivePoolSelectionMode === 'pure_uniform'
                        ? 'text-slate-900 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    100% uniforme Fisher-Yates (crypto.getRandomValues) • Zero bias decine
                  </span>
                </button>

                <button
                  type="button"
                  disabled={draws.length === 0}
                  onClick={() => handleSelectPoolMode('real_archive_weighted')}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all text-left border ${
                    draws.length === 0
                      ? 'bg-slate-950/50 text-slate-600 border-slate-800/60 cursor-not-allowed opacity-60'
                      : effectivePoolSelectionMode === 'real_archive_weighted'
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md font-extrabold cursor-pointer'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-amber-500/40 cursor-pointer'
                  }`}
                  title={
                    draws.length === 0
                      ? 'Carica o inserisci almeno un’estrazione reale in Archivio Storico per abilitare la pesatura storica'
                      : `Pesatura morbida su ${draws.length} estrazioni reali senza mai escludere alcun numero`
                  }
                >
                  <div className="flex items-center justify-between">
                    <span>Pesatura su Archivio Reale</span>
                    {effectivePoolSelectionMode === 'real_archive_weighted' && (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </div>
                  <span
                    className={`block text-[10px] mt-0.5 font-normal ${
                      effectivePoolSelectionMode === 'real_archive_weighted'
                        ? 'text-slate-900 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    {draws.length > 0
                      ? `Attiva su ${draws.length} estrazioni reali (nessun numero escluso)`
                      : 'Disabilitata: nessuna estrazione reale in archivio'}
                  </span>
                </button>
              </div>
            </div>

            {/* Pool size selector */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <label htmlFor="pool-size-select" className="text-xs font-semibold text-slate-300">
                Dimensione Pool v (Lunghetta):
              </label>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                {[10, 11, 12, 13, 14, 15].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setPoolSizeV(v);
                      setManualPoolEdit(false);
                      const freshFunnel = selectFunnelPool30To12(
                        scoredNumbers,
                        v,
                        undefined,
                        effectivePoolSelectionMode
                      );
                      setFunnelSelection(freshFunnel);
                      setSelectedPool(freshFunnel.top12Numbers);
                      setHasPendingChanges(true);
                    }}
                    className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${
                      poolSizeV === v
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section: Base Pool Preview (v numbers selected) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Pool Base ({selectedPool.length} Numeri)
                </h3>
                {manualPoolEdit ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                    Personalizzato
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-bold">
                    {effectivePoolSelectionMode === 'pure_uniform'
                      ? 'Equiprobabile Pura 1–90 (Crypto RNG)'
                      : `Pesatura Archivio Reale (${draws.length} estr.)`}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleRecalculateFromWeights}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                  recalcFeedback
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800/90 hover:bg-slate-800 text-amber-300 border-slate-700 hover:border-amber-500/40'
                }`}
                title={`${funnelUiLabels.title} — ${funnelUiLabels.subtitle}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  {recalcFeedback ? funnelUiLabels.recalcDoneButton : funnelUiLabels.recalcButton}
                </span>
              </button>
            </div>

            <div className="px-3 py-2.5 rounded-xl bg-slate-950/90 border border-emerald-500/25 text-[11px] text-slate-300 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-bold text-emerald-300">
                  {effectivePoolSelectionMode === 'pure_uniform'
                    ? 'Modalità Equiprobabile Pura (Fisher-Yates • window.crypto.getRandomValues)'
                    : `Modalità Pesatura su Archivio Reale (${draws.length} concorsi reali • Zero numeri esclusi)`}
                </span>
                <span className="font-mono text-[10px] text-amber-300 font-semibold">
                  Nessun vincolo forzato sulle decine • Identica dignità 1–90
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                {funnelUiLabels.weightsDetail}
              </p>
            </div>

            {/* Balls of the selected pool with exact presence count in the reduced system */}
            <div className="flex flex-wrap gap-2.5 p-3 bg-slate-950 rounded-xl border border-slate-800 min-h-[68px]">
              {selectedPool.map((num) => {
                const stat = scoredByNumber[num] || numberStatsMap[num];
                const presenceInSystem = systemResult?.coverageMetrics?.presenceHistogram?.[num];
                return (
                  <div
                    key={num}
                    onClick={() => toggleNumberInPool(num)}
                    className="group relative cursor-pointer flex flex-col items-center"
                    title={`Numero ${num}${
                      presenceInSystem !== undefined ? ` | Presenze nel sistema: ${presenceInSystem}x` : ''
                    } | S(x): ${stat?.compositeScore?.toFixed(3)} | Rit: ${stat?.normalizedDelay?.toFixed(2)} (${stat?.currentDelay}/${stat?.maxHistoricalDelay}) | Freq(36): ${stat?.frequencyK}`}
                  >
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full font-extrabold text-sm flex items-center justify-center font-mono shadow-md border group-hover:scale-110 transition-transform bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 border-amber-300">
                        {num}
                      </div>
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-900 border border-slate-700 text-[8px] font-bold text-slate-400 flex items-center justify-center">
                        ×
                      </span>
                    </div>
                    <span className="text-[9px] font-mono text-emerald-400 font-bold mt-1">
                      {presenceInSystem !== undefined
                        ? `${presenceInSystem}x`
                        : draws.length > 0 && stat?.compositeScore !== undefined
                        ? stat.compositeScore.toFixed(2)
                        : '1.00'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Candidate replacement numbers if user removed a ball from the pool */}
            {selectedPool.length < poolSizeV && (
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-1.5">
                <div className="text-[10px] text-amber-300 font-semibold flex items-center justify-between">
                  <span>
                    Hai rimosso {poolSizeV - selectedPool.length} numero/i: clicca un candidato per aggiungerlo oppure clicca "{funnelUiLabels.recalcButton}"
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {scoredNumbers
                    .filter((s) => !selectedPool.includes(s.number))
                    .slice(0, 8)
                    .map((s) => (
                      <button
                        key={s.number}
                        type="button"
                        onClick={() => toggleNumberInPool(s.number)}
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-amber-500/20 border border-slate-700 hover:border-amber-500/40 text-xs font-mono font-bold text-slate-200 hover:text-amber-300 transition-colors cursor-pointer"
                        title={`Aggiungi ${s.number} (Score S(x) = ${s.compositeScore.toFixed(3)})`}
                      >
                        +{s.number}{' '}
                        <span className="text-[9px] text-slate-400">({s.compositeScore.toFixed(2)})</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>Combinazioni integrali C({selectedPool.length}, 6):</span>
              <span className="font-mono font-bold text-white">
                {(() => {
                  const n = selectedPool.length;
                  if (n < 6) return '0 sestine';
                  let res = 1;
                  for (let i = 1; i <= 6; i++) {
                    res = (res * (n - i + 1)) / i;
                  }
                  return `${Math.round(res).toLocaleString('it-IT')} sestine`;
                })()}
              </span>
            </div>
          </div>

          {/* Section: Statistical Conditioning Filters (Soft-Penalty) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Filtri Statistici Condizionanti
                </h3>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                  Soft-Penalty • 5 Filtri
                </span>
                {showAdvancedFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {showAdvancedFilters && (
              <div className="space-y-2.5 pt-2 border-t border-slate-800 text-xs">
                {/* Filter 1 */}
                <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <div>
                    <span className="font-semibold text-slate-200">Bilanciamento Pari/Dispari</span>
                    <p className="text-[10px] text-slate-400">Accetta solo 3/3, 4/2 o 2/4 (penalità soft -45 pt)</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.evenOdd}
                    onChange={(e) => {
                      const updated = { ...filters, evenOdd: e.target.checked };
                      onUpdateFilters(updated);
                      saveFilters(updated);
                      setHasPendingChanges(true);
                    }}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>

                {/* Filter 2 */}
                <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <div>
                    <span className="font-semibold text-slate-200">Bilanciamento Alti/Bassi</span>
                    <p className="text-[10px] text-slate-400">Suddivide 1-45 (Bassi) e 46-90 (Alti): 3/3, 4/2, 2/4 (-45 pt)</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.highLow}
                    onChange={(e) => {
                      const updated = { ...filters, highLow: e.target.checked };
                      onUpdateFilters(updated);
                      saveFilters(updated);
                      setHasPendingChanges(true);
                    }}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>

                {/* Filter 3 */}
                <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <div>
                    <span className="font-semibold text-slate-200">Somma Gaussiana Sestina [190 - 350]</span>
                    <p className="text-[10px] text-slate-400">Penalizza sestine estreme fuori dal range (media 273, -40 pt)</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.sumRange}
                    onChange={(e) => {
                      const updated = { ...filters, sumRange: e.target.checked };
                      onUpdateFilters(updated);
                      saveFilters(updated);
                      setHasPendingChanges(true);
                    }}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>

                {/* Filter 4 */}
                <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <div>
                    <span className="font-semibold text-slate-200">Consecutività & Decine</span>
                    <p className="text-[10px] text-slate-400">Max 2 consecutivi (-60 pt) e max 2 numeri per decina (-55 pt)</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.consecutive && filters.decades}
                    onChange={(e) => {
                      const updated = {
                        ...filters,
                        consecutive: e.target.checked,
                        decades: e.target.checked
                      };
                      onUpdateFilters(updated);
                      saveFilters(updated);
                      setHasPendingChanges(true);
                    }}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>

                {/* Filter 5: Cadences (num % 10) */}
                <label className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <div>
                    <span className="font-semibold text-slate-200">Dispersione Cadenze (Unità Finali 0-9)</span>
                    <p className="text-[10px] text-slate-400">Max 2 numeri con la stessa cifra finale num % 10 (-50 pt)</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={filters.cadences !== false}
                    onChange={(e) => {
                      const updated = {
                        ...filters,
                        cadences: e.target.checked
                      };
                      onUpdateFilters(updated);
                      saveFilters(updated);
                      setHasPendingChanges(true);
                    }}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Pending changes notice when parameters were modified but sestine are still locked */}
          {hasPendingChanges && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Parametri modificati: le sestine attuali restano bloccate per{' '}
                  <strong className="font-mono text-white">{userEmail}</strong> finché non premi il
                  pulsante qui sotto.
                </span>
              </div>
            </div>
          )}

          {/* Trigger Button: Calcola Sistema */}
          <button
            type="button"
            onClick={() => handleRunOptimization()}
            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 font-extrabold text-base shadow-xl shadow-amber-500/25 hover:from-amber-400 hover:to-amber-300 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer border border-amber-300/40"
          >
            <Sparkles className="w-5 h-5 fill-slate-950" />
            <span>
              Calcola Sistema Ottimizzato ({budgetAllocation.actualCost.toFixed(2).replace('.', ',')} € &bull;{' '}
              {budgetAllocation.targetColumnsCount}{' '}
              {budgetAllocation.targetColumnsCount === 1 ? 'Sestina' : 'Sestine'})
            </span>
          </button>
        </div>

        {/* Right Column: Generated System Output & Coverage Metrics (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {systemResult ? (
            <>
              {/* Coverage Metrics Header */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex flex-wrap items-center gap-2">
                      <span>Sistema Ortogonale a Riduzione Greedy</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 font-mono border border-amber-500/30">
                        {systemResult.columns.length} Colonne
                      </span>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono border border-emerald-500/30 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>Bloccato per {userEmail}</span>
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Sviluppo da {systemResult.totalCombinations} integrali ({systemResult.filteredCombinationsCount} a penalità zero) → {systemResult.columns.length} colonne ottimali (Soft-Penalty Bitmask)
                      {lastCalculatedAt && (
                        <span className="ml-2 text-slate-500 font-mono">
                          &bull; Calcolato il{' '}
                          {new Date(lastCalculatedAt).toLocaleString('it-IT', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Execution time indicator */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{systemResult.executionTimeMs} ms (&lt;500ms)</span>
                  </div>
                </div>

                {/* Metrics Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div
                    className={`bg-slate-950/80 p-3 rounded-xl border ${
                      activeCoverageTarget === 'ambi'
                        ? 'border-amber-500/60 ring-1 ring-amber-500/30'
                        : 'border-slate-800'
                    }`}
                  >
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">
                      Copertura Ambi {activeCoverageTarget === 'ambi' ? '🎯' : ''}
                    </span>
                    <span className="text-base font-bold text-amber-400 font-mono">
                      {systemResult.coverageMetrics.pairsCoveredCount} /{' '}
                      {systemResult.coverageMetrics.pairsTotalInPool}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {Math.round(
                        (systemResult.coverageMetrics.pairsCoveredCount /
                          Math.max(systemResult.coverageMetrics.pairsTotalInPool, 1)) *
                          100
                      )}
                      % del pool
                    </span>
                  </div>

                  <div
                    className={`bg-slate-950/80 p-3 rounded-xl border ${
                      activeCoverageTarget === 'terni'
                        ? 'border-sky-500/60 ring-1 ring-sky-500/30'
                        : 'border-slate-800'
                    }`}
                  >
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">
                      Copertura Terni {activeCoverageTarget === 'terni' ? '🚀' : ''}
                    </span>
                    <span className="text-base font-bold text-sky-400 font-mono">
                      {systemResult.coverageMetrics.tripletsCoveredCount} /{' '}
                      {systemResult.coverageMetrics.tripletsTotalInPool}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {Math.round(
                        (systemResult.coverageMetrics.tripletsCoveredCount /
                          Math.max(systemResult.coverageMetrics.tripletsTotalInPool, 1)) *
                          100
                      )}
                      % del pool
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-emerald-500/30">
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Simmetria Rotazione</span>
                    <span className="text-base font-bold text-emerald-400 font-mono">
                      {systemResult.coverageMetrics.minPresence === systemResult.coverageMetrics.maxPresence
                        ? `${systemResult.coverageMetrics.minPresence}x Esatta`
                        : `${systemResult.coverageMetrics.minPresence}x–${systemResult.coverageMetrics.maxPresence}x`}
                    </span>
                    <span className="text-[10px] text-emerald-300/80 block">
                      {systemResult.coverageMetrics.minPresence === systemResult.coverageMetrics.maxPresence
                        ? `ogni numero ${systemResult.coverageMetrics.minPresence} volte (0 dup.)`
                        : `media ${systemResult.coverageMetrics.averagePresence}x (0 dup.)`}
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Costo Giocata</span>
                    <span className="text-base font-bold text-white font-mono">
                      {budgetAllocation.actualCost.toFixed(2).replace('.', ',')} €
                    </span>
                    <span className="text-[10px] text-amber-400 block">
                      {playMode === 'pure_coverage'
                        ? `${budgetAllocation.targetColumnsCount} x 1,00€`
                        : `${budgetAllocation.targetColumnsCount} x 1,50€${
                            budgetAllocation.savedAmount > 0
                              ? ` (+${budgetAllocation.savedAmount.toFixed(2).replace('.', ',')}€ salv.)`
                              : ''
                          }`}
                    </span>
                  </div>
                </div>
              </div>

              {/* The Columns: Schedina View */}
              <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
                {systemResult.columns.map((col) => (
                  <div
                    key={col.id}
                    className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                        {String(col.id).padStart(2, '0')}
                      </span>

                      {/* Six balls */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {col.numbers.map((n) => (
                          <div
                            key={n}
                            className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-bold text-xs flex items-center justify-center shadow-md font-mono border border-amber-300"
                          >
                            {n}
                          </div>
                        ))}

                        {/* SuperStar if present */}
                        {col.superstar && (
                          <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-800">
                            <span className="text-[10px] font-bold text-purple-400">★</span>
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-md font-mono border border-purple-400">
                              {col.superstar}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Metadata tags: Sum, Evens/Odds, Lows/Highs */}
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 self-end sm:self-center">
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                        Σ {col.sum}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                        P/D {col.evens}/{col.odds}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                        A/B {col.highs}/{col.lows}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Expected Gains & Losses Card (Mean across each individual Sestina) */}
              {expectedWeeklyPnL && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-5 h-5 text-amber-400 shrink-0" />
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Guadagni e Perdite Presunte (Media Calcolata su Ogni Singola Sestina)
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Valore generato come media aritmetica (1/{expectedWeeklyPnL.sestineCount} Σ) delle perdite e dei guadagni su ciascuna sestina (100 estrazioni su Urna Fisica Pura)
                        </p>
                      </div>
                    </div>
                    {onOpenSimulationTab && (
                      <button
                        type="button"
                        onClick={onOpenSimulationTab}
                        className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <Dices className="w-3.5 h-3.5" />
                        <span>Dettaglio Simulazione &rarr;</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-950/90 p-3 rounded-xl border border-emerald-500/20">
                      <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                        Media Guadagni / Sestina
                      </span>
                      <span className="text-base font-extrabold text-emerald-400 font-mono">
                        +{expectedWeeklyPnL.meanTotalGainPerSestina.toFixed(2)} €
                      </span>
                      <span className="text-[10px] text-slate-500 block font-mono">
                        +{expectedWeeklyPnL.meanSingleDrawGainPerSestina.toFixed(2)} € / estr.
                      </span>
                    </div>

                    <div className="bg-slate-950/90 p-3 rounded-xl border border-rose-500/20">
                      <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                        Media Perdite / Sestina
                      </span>
                      <span className="text-base font-extrabold text-rose-400 font-mono">
                        -{expectedWeeklyPnL.meanTotalLossPerSestina.toFixed(2)} €
                      </span>
                      <span className="text-[10px] text-slate-500 block font-mono">
                        -{expectedWeeklyPnL.meanSingleDrawLossPerSestina.toFixed(2)} € / estr.
                      </span>
                    </div>

                    <div className="bg-slate-950/90 p-3 rounded-xl border border-amber-500/30">
                      <span className="text-[10px] text-amber-300 block uppercase font-bold">
                        Bilancio Medio / Sestina (100 Estr.)
                      </span>
                      <span
                        className={`text-base font-extrabold font-mono ${
                          expectedWeeklyPnL.meanNetProfitLossPerSestina >= 0
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {expectedWeeklyPnL.meanNetProfitLossPerSestina >= 0 ? '+' : ''}
                        {expectedWeeklyPnL.meanNetProfitLossPerSestina.toFixed(2)} €
                      </span>
                      <span className="text-[10px] text-slate-500 block font-mono">
                        Costo medio: {expectedWeeklyPnL.meanTotalCostPerSestina.toFixed(2)} €
                      </span>
                    </div>

                    <div className="bg-slate-950/90 p-3 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                        Media Netta / Sestina (1 Estr.)
                      </span>
                      <span
                        className={`text-base font-extrabold font-mono ${
                          expectedWeeklyPnL.meanSingleDrawNetPerSestina >= 0
                            ? 'text-emerald-400'
                            : 'text-slate-200'
                        }`}
                      >
                        {expectedWeeklyPnL.meanSingleDrawNetPerSestina >= 0 ? '+' : ''}
                        {expectedWeeklyPnL.meanSingleDrawNetPerSestina.toFixed(2)} €
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        per singola sestina / settimana
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCopyColumns}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copiato negli Appunti!' : 'Copia Sestine per Gioco Online'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveToLedger}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer ${
                    savedSuccess
                      ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                      : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-amber-500/20 hover:from-amber-400 hover:to-amber-500'
                  }`}
                >
                  {savedSuccess ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                  <span>
                    {savedSuccess
                      ? 'Giocata Salvata con Successo!'
                      : `Registra Giocata Settimanale (${budgetAllocation.actualCost.toFixed(2).replace('.', ',')} €)`}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">Pronto per il Calcolo Combinatorio</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Fai clic su "Calcola Sistema Ottimizzato" per sviluppare le combinazioni ortogonali a{' '}
                {budgetAllocation.targetColumnsCount} colonne nel rispetto del budget di{' '}
                {budgetAllocation.clampedBudget.toFixed(2).replace('.', ',')} €.
              </p>
              <button
                type="button"
                onClick={() => handleRunOptimization()}
                className="px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all shadow-md"
              >
                Calcola Ora
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Empty Archive Notice when draws.length === 0 */}
      {draws.length === 0 && (
        <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <History className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-extrabold text-amber-300">
                Nessuna estrazione reale in archivio
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                L&apos;app parte con archivio vuoto (Zero Mock Data) e opera in{' '}
                <strong className="text-emerald-300">Modalità Equiprobabile Pura (Fisher-Yates via crypto.getRandomValues)</strong>{' '}
                senza inventare statistiche inesistenti. Inserisci o importa estrazioni reali nella scheda{' '}
                <strong className="text-white">Archivio Storico</strong> per attivare il Backtest Reale e la Pesatura su Archivio Reale.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* PUNTO 4: Verifica Vincite su Storico Reale (Backtest Reale Istantaneo) */}
      {realHistoricalBacktest && systemResult && (
        <div className="bg-slate-900 border-2 border-emerald-500/30 rounded-2xl p-6 shadow-2xl space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-emerald-500 text-slate-950 flex items-center gap-1">
                  <History className="w-3.5 h-3.5" />
                  Backtest Reale Istantaneo &bull; Archivio Ufficiale
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-950 text-emerald-400 border border-slate-800">
                  {realHistoricalBacktest.totalContestsEvaluated.toLocaleString('it-IT')} Concorsi Reali
                  Verificati
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20">
                  Moltiplicatore Anti-Crowd Medio: {realHistoricalBacktest.averageAntiCrowdMultiplier}x
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-extrabold text-white">
                Verifica Vincite su Storico Reale ({systemResult.columns.length} Sestine Generate)
              </h3>
              <p className="text-xs text-slate-400 max-w-3xl">
                Verifica istantanea delle <strong className="text-white">{systemResult.columns.length} sestine</strong>{' '}
                attualmente generate contro tutti i{' '}
                <strong className="text-emerald-300">
                  {realHistoricalBacktest.totalContestsEvaluated.toLocaleString('it-IT')} concorsi
                  storici reali
                </strong>{' '}
                presenti in archivio, calcolando per ciascun concorso il moltiplicatore dinamico
                delle quote <strong className="text-sky-300">Anti-Crowd</strong>.
              </p>
            </div>

            {/* Filter tabs for winning contests */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setBacktestFilter('all');
                  setBacktestPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  backtestFilter === 'all'
                    ? 'bg-emerald-500 text-slate-950 font-extrabold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Tutti i Premi ({realHistoricalBacktest.winningContests.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setBacktestFilter('terni');
                  setBacktestPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  backtestFilter === 'terni'
                    ? 'bg-sky-500 text-slate-950 font-extrabold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Concorsi con Terno (
                {realHistoricalBacktest.winningContests.filter((w) => w.points3Count > 0).length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setBacktestFilter('quaternePlus');
                  setBacktestPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  backtestFilter === 'quaternePlus'
                    ? 'bg-amber-500 text-slate-950 font-extrabold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Quaterne / Cinquine (
                {
                  realHistoricalBacktest.winningContests.filter(
                    (w) =>
                      w.points4Count + w.points5Count + w.points5Plus1Count + w.points6Count > 0
                  ).length
                }
                )
              </button>
            </div>
          </div>

          {/* 4 Summary Metrics Cards for Real Historical Backtest */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Vincita Storica Reale Stimata (Anti-Crowd)
              </span>
              <span className="text-2xl font-black text-emerald-400 font-mono block pt-1">
                {realHistoricalBacktest.totalEstimatedGrossWinnings.toLocaleString('it-IT', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}{' '}
                €
              </span>
              <span className="text-[11px] text-slate-400 block font-mono">
                Spesa storica: {realHistoricalBacktest.totalHistoricalCost.toLocaleString('it-IT')} €
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-sky-500/30 space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300 block">
                Totale Terni (Punto 3) Centrati
              </span>
              <span className="text-2xl font-black text-sky-400 font-mono block pt-1">
                {realHistoricalBacktest.tierCounts.points3.toLocaleString('it-IT')} Terni
              </span>
              <span className="text-[11px] text-slate-400 block font-mono">
                + {realHistoricalBacktest.tierCounts.points2.toLocaleString('it-IT')} Ambi (Punto 2)
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 block">
                Quaterne & Cinquine Storiche
              </span>
              <span className="text-2xl font-black text-amber-400 font-mono block pt-1">
                {(
                  realHistoricalBacktest.tierCounts.points4 +
                  realHistoricalBacktest.tierCounts.points5 +
                  realHistoricalBacktest.tierCounts.points5plus1 +
                  realHistoricalBacktest.tierCounts.points6
                ).toLocaleString('it-IT')}{' '}
                Premi Maggiori
              </span>
              <span className="text-[11px] text-slate-400 block font-mono">
                {realHistoricalBacktest.tierCounts.points4} Quaterne &bull;{' '}
                {realHistoricalBacktest.tierCounts.points5 +
                  realHistoricalBacktest.tierCounts.points5plus1 +
                  realHistoricalBacktest.tierCounts.points6}{' '}
                Cinquine+
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                ROI Storico & Concorsi a Premio
              </span>
              <div className="flex items-center gap-2 pt-1">
                {realHistoricalBacktest.historicalRoiPct >= 0 ? (
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Award className="w-5 h-5 text-amber-400" />
                )}
                <span className="text-2xl font-black text-white font-mono">
                  {(
                    (realHistoricalBacktest.totalEstimatedGrossWinnings /
                      Math.max(1, realHistoricalBacktest.totalHistoricalCost)) *
                    100
                  ).toFixed(1)}
                  % Recupero
                </span>
              </div>
              <span className="text-[11px] text-emerald-400 block font-mono">
                {realHistoricalBacktest.totalWinningContests} concorsi reali andati a premio
              </span>
            </div>
          </div>

          {/* Table of Real Historical Winning Contests */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Concorso Reale</th>
                  <th className="py-3 px-4">Data Estrazione</th>
                  <th className="py-3 px-4">Sestina Ufficiale Estratta (Oro = Indovinato)</th>
                  <th className="py-3 px-4 text-center">Molt. Anti-Crowd</th>
                  <th className="py-3 px-4 text-center">Dettaglio Vincite Sistema</th>
                  <th className="py-3 px-4 text-right">Vincita Concorso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {currentBacktestContests.length > 0 ? (
                  currentBacktestContests.map((contest) => {
                    const highCount =
                      contest.points4Count +
                      contest.points5Count +
                      contest.points5Plus1Count +
                      contest.points6Count;
                    return (
                      <tr key={contest.drawId} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-white">
                          Conc. #{contest.contestNumber}/{contest.year}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">{contest.date}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            {contest.drawnNumbers.map((n) => {
                              const isMatched = systemNumbersSet.has(n);
                              return (
                                <span
                                  key={n}
                                  className={`w-6 h-6 rounded-full font-mono font-bold text-[11px] flex items-center justify-center ${
                                    isMatched
                                      ? 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-300'
                                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                                  }`}
                                >
                                  {n}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono">
                          <span
                            className={`px-2 py-0.5 rounded font-bold ${
                              contest.antiCrowdMultiplier >= 1.15
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : contest.antiCrowdMultiplier <= 0.9
                                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-950 text-sky-300 border border-slate-800'
                            }`}
                          >
                            {contest.antiCrowdMultiplier.toFixed(2)}x
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono">
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            {highCount > 0 && (
                              <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-extrabold">
                                {highCount}x (4+ pt)
                              </span>
                            )}
                            {contest.points3Count > 0 && (
                              <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold">
                                {contest.points3Count}x Terno (3 pt)
                              </span>
                            )}
                            {contest.points2Count > 0 && (
                              <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
                                {contest.points2Count}x Ambo (2 pt)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-extrabold text-emerald-400">
                          +{contest.contestGrossPrize.toFixed(2)} €
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400 font-mono">
                      Nessun concorso storico trovato per il filtro selezionato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination for Real Historical Backtest */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400 font-mono">
              Pagina {backtestPage} di {totalBacktestPages} &bull; Evidenziati in{' '}
              <strong className="text-amber-400">oro</strong> i numeri estratti presenti nelle{' '}
              {systemResult.columns.length} sestine generate
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBacktestPage((p) => Math.max(1, p - 1))}
                disabled={backtestPage === 1}
                className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-40 hover:border-emerald-500/40 text-xs flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prec.</span>
              </button>
              <button
                type="button"
                onClick={() => setBacktestPage((p) => Math.min(totalBacktestPages, p + 1))}
                disabled={backtestPage === totalBacktestPages}
                className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-40 hover:border-emerald-500/40 text-xs flex items-center gap-1 cursor-pointer"
              >
                <span>Succ.</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evolutionary Slider Trainer (n1 triplets, n2 draws, n3 generations, pairwise mean crossover) */}
      <EvolutionarySliderTrainer
        draws={draws}
        currentWeights={weights}
        onApplyTripletWeights={handleApplyTripletWeights}
      />
    </div>
  );
};
