/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dices,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  BookmarkPlus,
  RefreshCw,
  Clock,
  Award,
  BarChart2,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Sliders,
  ArrowRightCircle,
  Cpu,
  ShieldCheck
} from 'lucide-react';
import {
  Draw,
  GeneratedColumn,
  SimulationMethodology,
  HundredDrawsSimulationResult,
  SavedPlay,
  SimulationGeneratorPreset,
  CoverageTarget,
  SmartPoolRecommendationResult
} from '../types/lottery';
import {
  runNext100DrawsSimulation,
  generateSmartPoolRecommendation,
  MIN_SIMULATION_DRAWS,
  MAX_SIMULATION_DRAWS,
  PRESET_SIMULATION_COUNTS,
  clampSimulationDrawsCount
} from '../utils/monteCarloSimulation';
import { runSimulationInWorker } from '../utils/simulationWorkerClient';
import { DEFAULT_FILTERS } from '../utils/storage';

interface SimulationEngineProps {
  draws: Draw[];
  weeklyColumns: GeneratedColumn[];
  onSavePlay: (play: SavedPlay) => void;
  onApplyToGenerator?: (preset: SimulationGeneratorPreset) => void;
  coverageTarget?: CoverageTarget;
  onUpdateCoverageTarget?: (target: CoverageTarget) => void;
}

export const SimulationEngine: React.FC<SimulationEngineProps> = ({
  draws,
  weeklyColumns,
  onSavePlay,
  onApplyToGenerator,
  coverageTarget = 'terni',
  onUpdateCoverageTarget
}) => {
  // Punto 3: Urna ipergeometrica pura ('hypergeometric_pure_urn') come default per evitare data leakage
  const [methodology, setMethodology] = useState<SimulationMethodology>('hypergeometric_pure_urn');
  const [localCoverageTarget, setLocalCoverageTarget] = useState<CoverageTarget>(coverageTarget);
  const activeCoverageTarget = onUpdateCoverageTarget ? coverageTarget : localCoverageTarget;

  const handleSelectCoverageTarget = (target: CoverageTarget) => {
    setLocalCoverageTarget(target);
    onUpdateCoverageTarget?.(target);
    setAppliedToGen(false);
    setAppliedSmartPoolToGen(false);
    setSavedHighProb(false);
  };

  const [numDrawsToSimulate, setNumDrawsToSimulate] = useState<number>(100);
  const [customDrawsInput, setCustomDrawsInput] = useState<string>('100');
  const [drawsRangeWarning, setDrawsRangeWarning] = useState<string | null>(null);
  const [simSeed, setSimSeed] = useState<number>(() => Date.now());
  const [copiedSestina, setCopiedSestina] = useState(false);
  const [savedHighProb, setSavedHighProb] = useState(false);
  const [appliedToGen, setAppliedToGen] = useState(false);
  const [simPage, setSimPage] = useState(1);
  const pageSize = 10;

  // Punto 3: Walk-Forward Smart Pool (10-15 numeri consigliati per il prossimo concorso)
  const [smartPoolSize, setSmartPoolSize] = useState<number>(12);
  const [appliedSmartPoolToGen, setAppliedSmartPoolToGen] = useState<boolean>(false);

  const smartPoolRec: SmartPoolRecommendationResult = useMemo(() => {
    return generateSmartPoolRecommendation(draws, smartPoolSize);
  }, [draws, smartPoolSize]);

  const smartPoolDecadesCount = useMemo(
    () =>
      Object.values(smartPoolRec.decadeDistribution).filter((cnt) => cnt > 0).length,
    [smartPoolRec]
  );

  const smartPoolCadencesCount = useMemo(
    () =>
      Object.values(smartPoolRec.cadenceDistribution).filter((cnt) => cnt > 0).length,
    [smartPoolRec]
  );

  // Punto 5: Web Worker simulation state + initial synchronous baseline
  const [simResult, setSimResult] = useState<HundredDrawsSimulationResult>(() =>
    runNext100DrawsSimulation(
      draws,
      weeklyColumns,
      'hypergeometric_pure_urn',
      simSeed,
      100,
      activeCoverageTarget
    )
  );
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simProgress, setSimProgress] = useState<{ completed: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    setIsSimulating(true);
    setSimProgress({ completed: 0, total: numDrawsToSimulate });

    runSimulationInWorker(
      {
        historicalDraws: draws,
        weeklyColumns,
        methodology,
        seed: simSeed,
        numDrawsToSimulate,
        coverageTarget: activeCoverageTarget
      },
      (completedDraws, totalDraws) => {
        if (!cancelled) {
          setSimProgress({ completed: completedDraws, total: totalDraws });
        }
      }
    )
      .then((res) => {
        if (!cancelled) {
          setSimResult(res);
          setIsSimulating(false);
          setSimProgress(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = runNext100DrawsSimulation(
            draws,
            weeklyColumns,
            methodology,
            simSeed,
            numDrawsToSimulate,
            activeCoverageTarget
          );
          setSimResult(fallback);
          setIsSimulating(false);
          setSimProgress(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draws, weeklyColumns, methodology, simSeed, numDrawsToSimulate, activeCoverageTarget]);

  const totalDrawsCount = simResult.totalSimulatedDrawsCount;
  const formattedDrawsCount = totalDrawsCount.toLocaleString('it-IT');

  // Top 12 most frequent numbers in the N simulated draws
  const topSimulatedNumbers = useMemo(() => {
    return Object.entries(simResult.numberFrequenciesInSim)
      .map(([num, count]) => ({ number: Number(num), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [simResult]);

  // Paginated simulated draws
  const totalSimPages = Math.ceil(simResult.simulatedDraws.length / pageSize) || 1;
  const currentSimulatedDraws = useMemo(() => {
    const start = (simPage - 1) * pageSize;
    return simResult.simulatedDraws.slice(start, start + pageSize);
  }, [simResult.simulatedDraws, simPage]);

  const handleSelectPresetCount = (count: number) => {
    setDrawsRangeWarning(null);
    setNumDrawsToSimulate(count);
    setCustomDrawsInput(String(count));
    setSimPage(1);
    setSavedHighProb(false);
    setAppliedToGen(false);
  };

  const handleCustomDrawsInputChange = (rawVal: string) => {
    setCustomDrawsInput(rawVal);
    const cleaned = rawVal.replace(/\./g, '').replace(/,/g, '').trim();
    if (!cleaned) return;
    const parsed = parseInt(cleaned, 10);
    if (Number.isNaN(parsed)) return;

    if (parsed > MAX_SIMULATION_DRAWS) {
      setDrawsRangeWarning(
        `Limite massimo consentito: ${MAX_SIMULATION_DRAWS.toLocaleString('it-IT')} estrazioni`
      );
      setNumDrawsToSimulate(MAX_SIMULATION_DRAWS);
      setSimPage(1);
    } else if (parsed >= MIN_SIMULATION_DRAWS) {
      setDrawsRangeWarning(null);
      setNumDrawsToSimulate(parsed);
      setSimPage(1);
    } else {
      setDrawsRangeWarning(
        `Minimo ${MIN_SIMULATION_DRAWS} estrazioni (verrà applicato ${MIN_SIMULATION_DRAWS})`
      );
    }
  };

  const handleCustomDrawsInputBlur = () => {
    const cleaned = customDrawsInput.replace(/\./g, '').replace(/,/g, '').trim();
    const parsed = parseInt(cleaned, 10);
    const clamped = clampSimulationDrawsCount(parsed);
    if (parsed > MAX_SIMULATION_DRAWS) {
      setDrawsRangeWarning(
        `Limitato al massimo di ${MAX_SIMULATION_DRAWS.toLocaleString('it-IT')} estrazioni`
      );
    } else if (parsed < MIN_SIMULATION_DRAWS || Number.isNaN(parsed)) {
      setDrawsRangeWarning(`Impostato al minimo di ${MIN_SIMULATION_DRAWS} estrazioni`);
    } else {
      setDrawsRangeWarning(null);
    }
    setNumDrawsToSimulate(clamped);
    setCustomDrawsInput(String(clamped));
    setSimPage(1);
  };

  const handleRerunSimulation = () => {
    setSimSeed(Date.now() + Math.floor(Math.random() * 100000));
    setSimPage(1);
    setSavedHighProb(false);
    setAppliedToGen(false);
  };

  const handleCopyHighProbSestina = () => {
    const hp = simResult.highProbabilitySestina;
    const rw = simResult.recommendedWeights;
    const text = [
      `Sestina Alta Probabilità (${formattedDrawsCount} Simulazioni): ${hp.numbers.join(' - ')}`,
      `Jolly Consigliato: ${hp.recommendedJolly} | SuperStar: ${hp.recommendedSuperstar}`,
      `Pool Top 12 Simulato: ${simResult.top12PoolNumbers.join(', ')}`,
      `Parametri Pesi S(x): w1(Rit)=${rw.wDelay.toFixed(2)}, w2(Freq)=${rw.wFrequency.toFixed(2)}, w3(Aff)=${rw.wAffinity.toFixed(2)}`,
      `Equilibrio: Somma=${hp.sum}, Pari/Dispari=${hp.evens}/${hp.odds}, Alti/Bassi=${hp.highs}/${hp.lows}`
    ].join(' | ');
    navigator.clipboard.writeText(text);
    setCopiedSestina(true);
    setTimeout(() => setCopiedSestina(false), 2500);
  };

  const handleApplySestinaAndParamsToGenerator = () => {
    const hp = simResult.highProbabilitySestina;
    const preset: SimulationGeneratorPreset = {
      id: `sim-preset-${Date.now()}`,
      appliedAt: new Date().toISOString(),
      simulatedDrawsCount: totalDrawsCount,
      methodology,
      coverageTarget: activeCoverageTarget,
      highProbabilityNumbers: [...hp.numbers] as [
        number,
        number,
        number,
        number,
        number,
        number
      ],
      recommendedJolly: hp.recommendedJolly,
      recommendedSuperstar: hp.recommendedSuperstar,
      top12PoolNumbers: [...simResult.top12PoolNumbers],
      recommendedWeights: { ...simResult.recommendedWeights },
      recommendedFilters: { ...simResult.recommendedFilters },
      confidenceIndex: hp.confidenceIndex,
      sourceLabel: `Simulazione Monte Carlo (${formattedDrawsCount} estrazioni)`
    };
    setAppliedToGen(true);
    onApplyToGenerator?.(preset);
  };

  // Punto 3: Copia Pool Consigliato (10-15 num) nel Generatore Sestine con Garanzia Terno (coverageTarget = 'terni', 10€ / 10 colonne)
  const handleApplySmartPoolToGenerator = () => {
    const preset: SimulationGeneratorPreset = {
      id: `walk-forward-pool-${Date.now()}`,
      appliedAt: new Date().toISOString(),
      simulatedDrawsCount: smartPoolRec.walkForwardWindowSize,
      methodology: 'hypergeometric_pure_urn',
      coverageTarget: 'terni',
      recommendedJolly: simResult.highProbabilitySestina.recommendedJolly,
      recommendedSuperstar: simResult.highProbabilitySestina.recommendedSuperstar,
      top12PoolNumbers: [...smartPoolRec.recommendedPool],
      recommendedWeights: { ...smartPoolRec.mappedScoringWeights },
      recommendedFilters: { ...DEFAULT_FILTERS, cadences: true },
      confidenceIndex: 92,
      enforceTenEuroBudget: true,
      sourceLabel: `Walk-Forward Optimization (${smartPoolRec.poolSize} numeri • Ultimi ${smartPoolRec.walkForwardWindowSize} Concorsi Reali)`
    };
    setLocalCoverageTarget('terni');
    onUpdateCoverageTarget?.('terni');
    setAppliedSmartPoolToGen(true);
    onApplyToGenerator?.(preset);
  };

  const handleSaveHighProbToLedger = () => {
    const hp = simResult.highProbabilitySestina;
    const latestDraw = draws[0];
    const targetContestNumber = latestDraw ? latestDraw.contestNumber + 1 : 46;
    const targetYear = latestDraw ? latestDraw.year : 2026;
    const targetId = `${targetYear}-${String(targetContestNumber).padStart(3, '0')}`;

    const col: GeneratedColumn = {
      id: 1,
      numbers: [...hp.numbers],
      superstar: hp.recommendedSuperstar,
      sum: hp.sum,
      evens: hp.evens,
      odds: hp.odds,
      lows: hp.lows,
      highs: hp.highs
    };

    const play: SavedPlay = {
      id: `play-sim-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId: targetId,
      mode: 'pure_coverage',
      cost: 1.0,
      savedAmount: 0,
      poolNumbers: [...hp.numbers],
      columns: [col],
      status: 'IN_ATTESA'
    };

    onSavePlay(play);
    setSavedHighProb(true);
    setTimeout(() => setSavedHighProb(false), 3000);
  };

  const hp = simResult.highProbabilitySestina;
  const pnl = simResult.weeklySystemPnL;
  const rw = simResult.recommendedWeights;
  const progressPct =
    simProgress && simProgress.total > 0
      ? Math.min(100, Math.round((simProgress.completed / simProgress.total) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Top Control Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-amber-950/30 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Motore Monte Carlo Web Worker &bull; {formattedDrawsCount} Concorsi Futuri
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {simResult.executionTimeMs} ms
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20">
                Payout Dinamico Anti-Crowd [0.75x &ndash; 1.65x]
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
              Simulatore Ufficiale ({formattedDrawsCount} Estrazioni) & Analisi Guadagni/Perdite
            </h2>
            <p className="text-xs text-slate-400 max-w-3xl">
              Riproduce fedelmente la metodologia di estrazione ufficiale del SuperEnalotto a{' '}
              <strong className="text-slate-200">2 Urne Separate senza reimmissione</strong> (Urna 1:
              90 sfere per i 6 numeri + 7ª sfera Jolly; Urna 2 indipendente: 90 sfere per il numero
              SuperStar) su un orizzonte da{' '}
              <strong className="text-amber-300">100 fino a 250.000 estrazioni consecutive</strong>{' '}
              con quote dinamiche <strong className="text-sky-300">Anti-Crowd</strong>.
            </p>
          </div>

          {/* Methodology Selector & Run Button */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setMethodology('hypergeometric_pure_urn')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  methodology === 'hypergeometric_pure_urn'
                    ? 'bg-sky-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Urna Fisica Ipergeometrica Pura (Fisher-Yates uniforme su 90 sfere senza data leakage)"
              >
                Urna Fisica Equiprobabile (Pura)
              </button>
              <button
                type="button"
                onClick={() => setMethodology('bayesian_hybrid_urn')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  methodology === 'bayesian_hybrid_urn'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Scenario secondario di stress-test con pesatura storica bayesiana"
              >
                Scenario Stress-Test Bayesiano
              </button>
            </div>

            <button
              type="button"
              onClick={handleRerunSimulation}
              disabled={isSimulating}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-60 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all cursor-pointer active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${isSimulating ? 'animate-spin' : ''}`} />
              <span>
                {isSimulating
                  ? `Calcolo Worker (${progressPct}%)...`
                  : `Risimula ${formattedDrawsCount} Estrazioni`}
              </span>
            </button>
          </div>
        </div>

        {/* Web Worker Progress Bar when running large simulations */}
        {isSimulating && simProgress && (
          <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/40 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-amber-300 font-bold flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 animate-pulse" />
                <span>
                  Web Worker Monte Carlo in esecuzione: {simProgress.completed.toLocaleString('it-IT')}{' '}
                  / {simProgress.total.toLocaleString('it-IT')} estrazioni
                </span>
              </span>
              <span className="text-emerald-400 font-extrabold">{progressPct}%</span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-sky-400 to-emerald-400 transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Simulation Draws Count Selector Bar (100 to 250,000 Draws) */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mr-1">
              <Dices className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Estrazioni da Simulare (100 &ndash; 250.000):</span>
            </span>

            {PRESET_SIMULATION_COUNTS.map((presetCount) => {
              const isSelected = numDrawsToSimulate === presetCount;
              return (
                <button
                  key={presetCount}
                  type="button"
                  onClick={() => handleSelectPresetCount(presetCount)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold cursor-pointer transition-all border shrink-0 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md shadow-amber-500/20 font-extrabold'
                      : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-amber-500/40 hover:text-amber-300'
                  }`}
                >
                  {presetCount.toLocaleString('it-IT')}
                </button>
              );
            })}
          </div>

          {/* Free Input + Range Slider (100 .. 250,000) */}
          <div className="flex flex-wrap items-center gap-2.5 bg-slate-950/90 px-3.5 py-2 rounded-xl border border-slate-800">
            <label
              htmlFor="sim-draws-count-input"
              className="text-xs font-bold text-amber-300 whitespace-nowrap"
            >
              Scelta Libera:
            </label>
            <input
              id="sim-draws-count-input"
              type="number"
              min={MIN_SIMULATION_DRAWS}
              max={MAX_SIMULATION_DRAWS}
              step={100}
              value={customDrawsInput}
              onChange={(e) => handleCustomDrawsInputChange(e.target.value)}
              onBlur={handleCustomDrawsInputBlur}
              aria-label="Numero di estrazioni da simulare (da 100 a 250000)"
              className="w-28 rounded-lg bg-slate-900 border border-amber-500/50 px-2.5 py-1 text-center font-mono font-extrabold text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <input
              type="range"
              min={MIN_SIMULATION_DRAWS}
              max={MAX_SIMULATION_DRAWS}
              step={100}
              value={numDrawsToSimulate}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 100;
                const clamped = clampSimulationDrawsCount(val);
                setDrawsRangeWarning(null);
                setNumDrawsToSimulate(clamped);
                setCustomDrawsInput(String(clamped));
                setSimPage(1);
              }}
              aria-label="Slider numero estrazioni da simulare (100-250000)"
              className="w-32 sm:w-44 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
              Attive: <strong className="text-amber-400">{formattedDrawsCount}</strong> estr.
            </span>
            {drawsRangeWarning && (
              <span className="text-[11px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                {drawsRangeWarning}
              </span>
            )}
          </div>
        </div>

        {/* Coverage Target Quick Selector in Simulation: Massimizza Ambi (t = 2) vs Massimizza Terni (t = 3) */}
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
                Sinergia Coppie (Punto 2)
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
                Sintesi orientata ai <strong className="text-sky-400">Terni (t = 3)</strong>:
                massimizza le triplette co-occorrenti nelle {formattedDrawsCount} simulazioni
              </span>
            ) : (
              <span>
                Sintesi orientata agli <strong className="text-amber-400">Ambi (t = 2)</strong>:
                massimizza le coppie co-occorrenti nelle {formattedDrawsCount} simulazioni
              </span>
            )}
          </div>
        </div>
      </div>

      {/* PUNTO 3: Motore Walk-Forward per i 10-15 Numeri Consigliati (Separato dall'Urna Fisica) */}
      <div className="bg-gradient-to-r from-slate-900 via-sky-950/25 to-slate-900 border-2 border-sky-500/40 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-sky-500 text-slate-950 flex items-center gap-1.5 shadow">
                <ShieldCheck className="w-3.5 h-3.5" />
                Walk-Forward Optimization &bull; Zero Data Leakage
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Finestra Mobile: Ultimi {smartPoolRec.walkForwardWindowSize} Concorsi Reali
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-950 text-sky-300 border border-slate-800">
                Dispersione: {smartPoolDecadesCount} Decine &bull; {smartPoolCadencesCount} Cadenze
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-extrabold text-white">
                  Pool Consigliato Walk-Forward ({smartPoolRec.poolSize} Numeri ad Alta Priorità
                  Statistica)
                </h3>
                <p className="text-xs text-slate-400 max-w-2xl">
                  Addestrato out-of-sample sui concorsi reali usando esclusivamente i dati fino al
                  concorso <code className="text-sky-300">t - 1</code> per predire il concorso{' '}
                  <code className="text-sky-300">t</code>, con vincolo di bilanciamento per decine e
                  cadenze.
                </p>
              </div>

              {/* Selector for Pool Size: 10 to 15 numbers */}
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shrink-0">
                <span className="text-xs font-bold text-slate-300 px-2">Dimensione Pool:</span>
                {[10, 11, 12, 13, 14, 15].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      setSmartPoolSize(sz);
                      setAppliedSmartPoolToGen(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-extrabold cursor-pointer transition-all ${
                      smartPoolSize === sz
                        ? 'bg-sky-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Recommended 10-15 Pool Balls */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {smartPoolRec.recommendedPool.map((num) => (
                <div key={num} className="flex flex-col items-center gap-1">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-sky-300 via-sky-500 to-blue-600 text-slate-950 font-black text-sm sm:text-base flex items-center justify-center shadow-lg shadow-sky-500/25 border-2 border-sky-200 font-mono">
                    {num}
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">
                    D{Math.min(Math.floor(num / 10), 9)}·C{num % 10}
                  </span>
                </div>
              ))}
            </div>

            {/* Optimal Walk-Forward Weights Summary */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                <span className="text-slate-400">Strategia Vincente ({smartPoolRec.bestStrategy.label}):</span>
                <span className="font-mono font-bold text-sky-300">
                  Hot={smartPoolRec.bestStrategy.wFreqHot.toFixed(2)} &bull; Cold=
                  {smartPoolRec.bestStrategy.wFreqCold.toFixed(2)} &bull; Rit=
                  {smartPoolRec.bestStrategy.wDelay.toFixed(2)} &bull; CoOcc=
                  {smartPoolRec.bestStrategy.wCoOccurrence.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                <span className="text-slate-400">
                  Risultato Walk-Forward ({smartPoolRec.walkForwardWindowSize} conc.):
                </span>
                <span className="font-mono font-bold text-emerald-400">
                  {smartPoolRec.bestStrategy.quaterneHitCount +
                    smartPoolRec.bestStrategy.cinquineHitCount}
                  x (4+pt) &bull; {smartPoolRec.bestStrategy.terniHitCount}x Terni &bull;{' '}
                  {smartPoolRec.bestStrategy.ambiHitCount}x Ambi
                </span>
              </div>
            </div>
          </div>

          {/* Right Action Box: Copia Pool Consigliato (10-15 num) nel Generatore Sestine */}
          <div className="bg-slate-950/90 border border-sky-500/30 rounded-2xl p-4 lg:w-96 shrink-0 space-y-3">
            <div className="text-xs font-bold text-sky-300 uppercase tracking-wider border-b border-slate-800 pb-2">
              Trasferimento Diretto Matrice Garanzia Terno
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Imposta i <strong className="text-white">{smartPoolRec.poolSize} numeri</strong>{' '}
              selezionati dal Walk-Forward nel Generatore Sestine e attiva automaticamente la
              modalità <strong className="text-sky-300">Garanzia Terno (t = 3, 10€ / 10 colonne)</strong>.
            </p>

            {onApplyToGenerator && (
              <button
                type="button"
                onClick={handleApplySmartPoolToGenerator}
                className={`w-full py-3 px-3.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
                  appliedSmartPoolToGen
                    ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                    : 'bg-gradient-to-r from-sky-400 via-sky-500 to-blue-600 hover:from-sky-300 hover:to-blue-500 text-slate-950 shadow-sky-500/25 border border-sky-300'
                }`}
              >
                {appliedSmartPoolToGen ? (
                  <Check className="w-4 h-4 shrink-0" />
                ) : (
                  <ArrowRightCircle className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {appliedSmartPoolToGen
                    ? `Pool (${smartPoolRec.poolSize} num) Applicato con Garanzia Terno!`
                    : `Copia Pool Consigliato (${smartPoolRec.poolSize} num) nel Generatore Sestine`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: High-Probability Sestina synthesized from the N simulations */}
      <div className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-amber-500 text-slate-950 flex items-center gap-1.5 shadow">
                <Award className="w-3.5 h-3.5" />
                Sestina ad Alta Probabilità di Vincita
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Indice Convergenza: {hp.confidenceIndex}%
              </span>
            </div>

            <h3 className="text-lg sm:text-xl font-extrabold text-white">
              Super-Sestina di Consenso Statistico ({formattedDrawsCount} Estrazioni Simulate)
            </h3>
            <p className="text-xs text-slate-400 max-w-2xl">
              Elaborata incrociando i picchi di frequenza delle {formattedDrawsCount} simulazioni, la
              matrice di co-occorrenza degli ambi/terni simulati e i filtri di equilibrio gaussiano
              (Somma <strong className="text-slate-200">{hp.sum}</strong>, Pari/Dispari{' '}
              <strong className="text-slate-200">
                {hp.evens}/{hp.odds}
              </strong>
              , Alti/Bassi{' '}
              <strong className="text-slate-200">
                {hp.highs}/{hp.lows}
              </strong>
              ).
            </p>

            {/* The 6 High-Probability Balls + Jolly + SuperStar */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              {hp.numbers.map((num) => (
                <div key={num} className="flex flex-col items-center gap-1">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-amber-600 text-slate-950 font-black text-base sm:text-lg flex items-center justify-center shadow-lg shadow-amber-500/30 border-2 border-amber-200 font-mono">
                    {num}
                  </div>
                  <span className="text-[10px] font-mono text-amber-300/90">
                    {(simResult.numberFrequenciesInSim[num] || 0).toLocaleString('it-IT')}x
                  </span>
                </div>
              ))}

              {/* Recommended Jolly */}
              <div className="flex flex-col items-center gap-1 ml-2 pl-3 border-l border-slate-800">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-white font-extrabold text-sm flex items-center justify-center shadow-lg border border-rose-300 font-mono">
                  {hp.recommendedJolly}
                </div>
                <span className="text-[10px] font-bold text-rose-400 uppercase">Jolly</span>
              </div>

              {/* Recommended SuperStar */}
              <div className="flex flex-col items-center gap-1 ml-1 pl-3 border-l border-slate-800">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-extrabold text-sm flex items-center justify-center shadow-lg border border-purple-300 font-mono">
                  ★ {hp.recommendedSuperstar}
                </div>
                <span className="text-[10px] font-bold text-purple-400 uppercase">SuperStar</span>
              </div>
            </div>

            {/* Derived Parameters Summary Box (for copying into SystemGenerator) */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Parametri & Pool Ottimali Estratti dalla Simulazione</span>
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  Pronti per il Generatore Ottimizzato
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
                  <span className="text-slate-400">Pesi S(x) Consigliati:</span>
                  <span className="font-mono font-bold text-white">
                    <span className="text-rose-300">w₁={rw.wDelay.toFixed(2)}</span> &bull;{' '}
                    <span className="text-sky-300">w₂={rw.wFrequency.toFixed(2)}</span> &bull;{' '}
                    <span className="text-emerald-300">w₃={rw.wAffinity.toFixed(2)}</span>
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-slate-400 shrink-0">Pool Top 12:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {simResult.top12PoolNumbers.join(' · ')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right side: Backtest on the N simulated draws & Actions */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 lg:w-96 shrink-0 space-y-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">
              Resa sulle {formattedDrawsCount} Estrazioni Simulate
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Punti 2 / 3+</span>
                <span className="font-bold text-emerald-400">
                  {hp.simulatedBacktestPnL.hitsBreakdown.points2.toLocaleString('it-IT')}x (2pt) /{' '}
                  {(
                    hp.simulatedBacktestPnL.hitsBreakdown.points3 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points4 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points5 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points5plus1 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points6
                  ).toLocaleString('it-IT')}
                  x (3+pt)
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Vincita Lorda Sim.</span>
                <span className="font-bold text-amber-400">
                  {hp.simulatedBacktestPnL.totalGrossGain.toLocaleString('it-IT', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}{' '}
                  €
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              {/* Primary Action Requested by User: Copy Sestina & Parameters into Optimized Generator */}
              {onApplyToGenerator && (
                <button
                  type="button"
                  onClick={handleApplySestinaAndParamsToGenerator}
                  className={`w-full py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
                    appliedToGen
                      ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                      : 'bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 shadow-amber-500/25 border border-amber-300'
                  }`}
                >
                  {appliedToGen ? (
                    <Check className="w-4 h-4 shrink-0" />
                  ) : (
                    <ArrowRightCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {appliedToGen
                      ? 'Applicato nel Generatore Ottimizzato!'
                      : 'Copia Sestina e Parametri nel Generatore'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyHighProbSestina}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                {copiedSestina ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedSestina
                    ? 'Sestina e Parametri Copiati!'
                    : 'Copia Sestina & Parametri (Appunti)'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleSaveHighProbToLedger}
                className={`w-full py-2 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer border ${
                  savedHighProb
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40'
                }`}
              >
                {savedHighProb ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <BookmarkPlus className="w-4 h-4" />
                )}
                <span>
                  {savedHighProb ? 'Salvata nel Bilancio!' : 'Registra Sestina nel Bilancio'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Guadagni e Perdite Presunte delle Sestine Settimanali (Media su Ogni Singola Sestina) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-extrabold text-white">
                Guadagni e Perdite Presunte delle Sestine Settimanali (Payout Dinamico Anti-Crowd)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Valore calcolato come{' '}
              <strong className="text-amber-300">
                media aritmetica delle perdite e dei guadagni su ogni singola sestina
              </strong>{' '}
              ({pnl.sestineCount} sestine settimanali testate sulle {formattedDrawsCount} estrazioni
              con moltiplicatore Anti-Crowd 0.75x&ndash;1.65x).
            </p>
          </div>

          <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
            Formula:{' '}
            <span className="text-amber-400 font-bold">
              μ = (1/{pnl.sestineCount}) · Σᵢ (Guadagnoᵢ - Perditaᵢ)
            </span>
          </div>
        </div>

        {/* 4 Highlight Cards: Mean Values per Single Sestina */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Primary Metric: Mean Net Profit/Loss per Sestina (over N draws) */}
          <div className="p-4 rounded-2xl bg-slate-950 border-2 border-amber-500/40 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 block">
              Media Guadagni/Perdite per Sestina ({formattedDrawsCount} Conc.)
            </span>
            <div className="flex items-center gap-2 pt-1">
              {pnl.meanNetProfitLossPerSestina >= 0 ? (
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-5 h-5 text-rose-400" />
              )}
              <span
                className={`text-2xl font-black font-mono ${
                  pnl.meanNetProfitLossPerSestina >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {pnl.meanNetProfitLossPerSestina > 0 ? '+' : ''}
                {pnl.meanNetProfitLossPerSestina.toFixed(2)} €
              </span>
            </div>
            <span className="text-[11px] text-slate-400 block font-mono">
              Per singola estrazione:{' '}
              <strong className="text-slate-200">
                {pnl.meanSingleDrawNetPerSestina > 0 ? '+' : ''}
                {pnl.meanSingleDrawNetPerSestina.toFixed(2)} € / sestina
              </strong>
            </span>
          </div>

          {/* Mean Gross Gain per Sestina */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Guadagno Lordo Medio per Singola Sestina
            </span>
            <span className="text-2xl font-extrabold text-emerald-400 font-mono block pt-1">
              +{pnl.meanTotalGainPerSestina.toFixed(2)} €
            </span>
            <span className="text-[11px] text-slate-500 block font-mono">
              Media a concorso: +{pnl.meanSingleDrawGainPerSestina.toFixed(2)} € / sestina
            </span>
          </div>

          {/* Mean Unrecovered Loss per Sestina */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Perdita Presunta Media per Singola Sestina
            </span>
            <span className="text-2xl font-extrabold text-rose-400 font-mono block pt-1">
              -{pnl.meanTotalLossPerSestina.toFixed(2)} €
            </span>
            <span className="text-[11px] text-slate-500 block font-mono">
              Media a concorso: -{pnl.meanSingleDrawLossPerSestina.toFixed(2)} € / sestina
            </span>
          </div>

          {/* Mean Cost & Best Sestina */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Spesa Media per Sestina ({formattedDrawsCount} Estrazioni)
            </span>
            <span className="text-2xl font-extrabold text-white font-mono block pt-1">
              {pnl.meanTotalCostPerSestina.toFixed(2)} €
            </span>
            <span className="text-[11px] text-amber-400 block font-mono">
              Migliore colonna: Sestina #{String(pnl.bestPerformingColumnId).padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* Detailed Breakdown Table for Each Individual Sestina */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Sestina</th>
                <th className="py-3 px-4">Numeri Giocati</th>
                <th className="py-3 px-4 text-center">Vincite (2pt / 3pt / 4+pt)</th>
                <th className="py-3 px-4 text-right">Spesa ({formattedDrawsCount} Conc.)</th>
                <th className="py-3 px-4 text-right">Guadagno Presunto</th>
                <th className="py-3 px-4 text-right">Perdita Presunta</th>
                <th className="py-3 px-4 text-right">Bilancio Netto Sestina</th>
                <th className="py-3 px-4 text-right">Media / Concorso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {pnl.perSestinaResults.map((row) => {
                const highHits =
                  row.hitsBreakdown.points4 +
                  row.hitsBreakdown.points5 +
                  row.hitsBreakdown.points5plus1 +
                  row.hitsBreakdown.points6;
                return (
                  <tr key={row.columnId} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-slate-300">
                      #{String(row.columnId).padStart(2, '0')}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {row.numbers.map((n) => (
                          <span
                            key={n}
                            className="w-6 h-6 shrink-0 rounded-full bg-slate-800 text-amber-300 border border-slate-700 font-mono font-bold text-[11px] flex items-center justify-center"
                          >
                            {n}
                          </span>
                        ))}
                        {row.superstar && (
                          <span className="ml-1 px-1.5 py-0.5 shrink-0 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold">
                            ★{row.superstar}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-slate-300">
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                        {row.hitsBreakdown.points2.toLocaleString('it-IT')} /{' '}
                        {row.hitsBreakdown.points3.toLocaleString('it-IT')} /{' '}
                        {highHits.toLocaleString('it-IT')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-400">
                      {row.totalCost.toFixed(2)} €
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                      +{row.totalGrossGain.toFixed(2)} €
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                      -{row.totalGrossLoss.toFixed(2)} €
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono font-extrabold ${
                        row.totalNetProfitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {row.totalNetProfitLoss > 0 ? '+' : ''}
                      {row.totalNetProfitLoss.toFixed(2)} €
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono ${
                        row.averageNetPerDraw >= 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {row.averageNetPerDraw > 0 ? '+' : ''}
                      {row.averageNetPerDraw.toFixed(2)} €
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-amber-500/10 border-t-2 border-amber-500/40 font-extrabold text-white">
                <td colSpan={3} className="py-3.5 px-4 text-amber-300 uppercase tracking-wider">
                  MEDIA CALCOLATA SU OGNI SINGOLA SESTINA ({pnl.sestineCount} Sestine)
                </td>
                <td className="py-3.5 px-4 text-right font-mono">
                  {pnl.meanTotalCostPerSestina.toFixed(2)} €
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-emerald-400">
                  +{pnl.meanTotalGainPerSestina.toFixed(2)} €
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-rose-400">
                  -{pnl.meanTotalLossPerSestina.toFixed(2)} €
                </td>
                <td
                  className={`py-3.5 px-4 text-right font-mono text-sm ${
                    pnl.meanNetProfitLossPerSestina >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {pnl.meanNetProfitLossPerSestina > 0 ? '+' : ''}
                  {pnl.meanNetProfitLossPerSestina.toFixed(2)} €
                </td>
                <td
                  className={`py-3.5 px-4 text-right font-mono ${
                    pnl.meanSingleDrawNetPerSestina >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {pnl.meanSingleDrawNetPerSestina > 0 ? '+' : ''}
                  {pnl.meanSingleDrawNetPerSestina.toFixed(2)} €
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* SECTION 3: Top Numbers & Simulated Extractions Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Top 12 Most Drawn Numbers in the N Simulations (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Picchi Frequenza ({formattedDrawsCount} Sim.)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Top 12 Estratti</span>
          </div>

          <div className="space-y-2.5">
            {topSimulatedNumbers.map((item, idx) => {
              const maxCount = topSimulatedNumbers[0]?.count || 15;
              const widthPct = Math.round((item.count / maxCount) * 100);
              return (
                <div key={item.number} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-4 text-[10px] font-mono text-slate-500">
                        {idx + 1}.
                      </span>
                      <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold text-xs flex items-center justify-center">
                        {item.number}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-white">
                      {item.count.toLocaleString('it-IT')}{' '}
                      <span className="text-[10px] text-slate-500">estrazioni</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Table of the Simulated Extractions (8 cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Dices className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Registro Estrazioni Future Simulate ({formattedDrawsCount} Totali)
                </h3>
                {totalDrawsCount > simResult.simulatedDraws.length && (
                  <p className="text-[10px] text-slate-400">
                    Visualizzate le prime {simResult.simulatedDraws.length} estrazioni nel registro
                    dettagliato; statistiche e bilanci calcolati su tutte le {formattedDrawsCount}{' '}
                    estrazioni.
                  </p>
                )}
              </div>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Pagina {simPage} di {totalSimPages}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Sim #</th>
                  <th className="py-2.5 px-3">Concorso Futuro</th>
                  <th className="py-2.5 px-3">Data Stimata</th>
                  <th className="py-2.5 px-3">Sestina Estratta (Urna 1)</th>
                  <th className="py-2.5 px-3 text-center">Jolly</th>
                  <th className="py-2.5 px-3 text-center">SuperStar (Urna 2)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {currentSimulatedDraws.map((draw, idx) => (
                  <tr key={draw.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-amber-400">
                      #{String((simPage - 1) * pageSize + idx + 1).padStart(3, '0')}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">
                      Conc. {draw.contestNumber}/{draw.year}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">{draw.date}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        {draw.numbers.map((n) => {
                          const isInHighProb = hp.numbers.includes(n);
                          return (
                            <span
                              key={n}
                              className={`w-6 h-6 rounded-full font-mono font-bold text-[11px] flex items-center justify-center ${
                                isInHighProb
                                  ? 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-300'
                                  : 'bg-slate-800 text-slate-200 border border-slate-700'
                              }`}
                            >
                              {n}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex w-6 h-6 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold text-[11px] items-center justify-center">
                        {draw.jolly}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono font-bold text-[11px] items-center justify-center">
                        ★{draw.superstar}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <span className="text-[11px] text-slate-400">
              Evidenziati in <strong className="text-amber-400">oro</strong> i numeri presenti nella
              Super-Sestina ad Alta Probabilità
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSimPage((p) => Math.max(1, p - 1))}
                disabled={simPage === 1}
                className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-40 hover:border-amber-500/40 text-xs flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prec.</span>
              </button>
              <button
                type="button"
                onClick={() => setSimPage((p) => Math.min(totalSimPages, p + 1))}
                disabled={simPage === totalSimPages}
                className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-40 hover:border-amber-500/40 text-xs flex items-center gap-1 cursor-pointer"
              >
                <span>Succ.</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
