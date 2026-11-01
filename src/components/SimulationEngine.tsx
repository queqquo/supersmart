/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  Layers
} from 'lucide-react';
import {
  Draw,
  GeneratedColumn,
  SimulationMethodology,
  HundredDrawsSimulationResult,
  SavedPlay
} from '../types/lottery';
import { runNext100DrawsSimulation } from '../utils/monteCarloSimulation';

interface SimulationEngineProps {
  draws: Draw[];
  weeklyColumns: GeneratedColumn[];
  onSavePlay: (play: SavedPlay) => void;
}

export const SimulationEngine: React.FC<SimulationEngineProps> = ({
  draws,
  weeklyColumns,
  onSavePlay
}) => {
  const [methodology, setMethodology] = useState<SimulationMethodology>('bayesian_hybrid_urn');
  const [simSeed, setSimSeed] = useState<number>(() => Date.now());
  const [copiedSestina, setCopiedSestina] = useState(false);
  const [savedHighProb, setSavedHighProb] = useState(false);
  const [simPage, setSimPage] = useState(1);
  const pageSize = 10;

  // Run the 100-draw official methodology simulation
  const simResult: HundredDrawsSimulationResult = useMemo(() => {
    return runNext100DrawsSimulation(draws, weeklyColumns, methodology, simSeed);
  }, [draws, weeklyColumns, methodology, simSeed]);

  // Top 12 most frequent numbers in the 100 simulated draws
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

  const handleRerunSimulation = () => {
    setSimSeed(Date.now() + Math.floor(Math.random() * 100000));
    setSimPage(1);
    setSavedHighProb(false);
  };

  const handleCopyHighProbSestina = () => {
    const hp = simResult.highProbabilitySestina;
    const text = `Sestina Alta Probabilità (100 Simulazioni): ${hp.numbers.join(
      ' - '
    )} | Jolly Consigliato: ${hp.recommendedJolly} | SuperStar: ${hp.recommendedSuperstar}`;
    navigator.clipboard.writeText(text);
    setCopiedSestina(true);
    setTimeout(() => setCopiedSestina(false), 2500);
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

  return (
    <div className="space-y-6">
      {/* Top Control Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-amber-950/30 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Motore Monte Carlo &bull; 100 Concorsi Futuri
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {simResult.executionTimeMs} ms
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
              Simulatore Ufficiale 100 Estrazioni & Analisi Guadagni/Perdite
            </h2>
            <p className="text-xs text-slate-400 max-w-3xl">
              Riproduce fedelmente la metodologia di estrazione ufficiale del SuperEnalotto a{' '}
              <strong className="text-slate-200">2 Urne Separate senza reimmissione</strong> (Urna 1:
              90 sfere per i 6 numeri + 7ª sfera Jolly; Urna 2 indipendente: 90 sfere per il numero
              SuperStar) per le prossime 100 estrazioni consecutive.
            </p>
          </div>

          {/* Methodology Selector & Run Button */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setMethodology('bayesian_hybrid_urn')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  methodology === 'bayesian_hybrid_urn'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Urna Statistica Bayesiana
              </button>
              <button
                type="button"
                onClick={() => setMethodology('hypergeometric_pure_urn')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  methodology === 'hypergeometric_pure_urn'
                    ? 'bg-sky-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Urna Fisica Equiprobabile
              </button>
            </div>

            <button
              type="button"
              onClick={handleRerunSimulation}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Risimula 100 Estrazioni</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 1: High-Probability Sestina synthesized from the 100 simulations */}
      <div className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
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
              Super-Sestina di Consenso Statistico (100 Estrazioni Simulate)
            </h3>
            <p className="text-xs text-slate-400 max-w-2xl">
              Elaborata incrociando i picchi di frequenza delle 100 simulazioni, la matrice di
              co-occorrenza degli ambi/terni simulati e i filtri di equilibrio gaussiano (Somma{' '}
              <strong className="text-slate-200">{hp.sum}</strong>, Pari/Dispari{' '}
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
                    {simResult.numberFrequenciesInSim[num]}x
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
          </div>

          {/* Right side: Backtest on the 100 simulated draws & Actions */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 lg:w-80 shrink-0 space-y-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">
              Resa sulle 100 Estrazioni Simulate
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Punti 2 / 3+</span>
                <span className="font-bold text-emerald-400">
                  {hp.simulatedBacktestPnL.hitsBreakdown.points2}x (2pt) /{' '}
                  {hp.simulatedBacktestPnL.hitsBreakdown.points3 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points4 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points5 +
                    hp.simulatedBacktestPnL.hitsBreakdown.points6}
                  x (3+pt)
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Vincita Lorda Sim.</span>
                <span className="font-bold text-amber-400">
                  {hp.simulatedBacktestPnL.totalGrossGain.toFixed(2)} €
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
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
                <span>{copiedSestina ? 'Sestina Copiata!' : 'Copia Sestina Alta Probabilità'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveHighProbToLedger}
                className={`w-full py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  savedHighProb
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md'
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
                Guadagni e Perdite Presunte delle Sestine Settimanali
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Valore calcolato come{' '}
              <strong className="text-amber-300">
                media aritmetica delle perdite e dei guadagni su ogni singola sestina
              </strong>{' '}
              ({pnl.sestineCount} sestine settimanali testate sulle {pnl.drawsCount} estrazioni
              casuali simulate).
            </p>
          </div>

          <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
            Formula: <span className="text-amber-400 font-bold">μ = (1/{pnl.sestineCount}) · Σᵢ (Guadagnoᵢ - Perditaᵢ)</span>
          </div>
        </div>

        {/* 4 Highlight Cards: Mean Values per Single Sestina */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Primary Metric: Mean Net Profit/Loss per Sestina (over 100 draws) */}
          <div className="p-4 rounded-2xl bg-slate-950 border-2 border-amber-500/40 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 block">
              Media Guadagni/Perdite per Sestina (100 Conc.)
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
              Spesa Media per Sestina (100 Estrazioni)
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
                <th className="py-3 px-4 text-right">Spesa (100 Conc.)</th>
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
                        {row.hitsBreakdown.points2} / {row.hitsBreakdown.points3} / {highHits}
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

      {/* SECTION 3: Top Numbers & 100 Simulated Extractions Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Top 12 Most Drawn Numbers in the 100 Simulations (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Picchi Frequenza (100 Sim.)
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
                      {item.count} <span className="text-[10px] text-slate-500">estrazioni</span>
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

        {/* Right: Table of the 100 Simulated Extractions (8 cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Dices className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Registro delle 100 Estrazioni Future Simulate
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Pagina {simPage} di {totalSimPages}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Concorso Sim.</th>
                  <th className="py-2.5 px-3">Data Stimata</th>
                  <th className="py-2.5 px-3">Sestina Estratta (Urna 1)</th>
                  <th className="py-2.5 px-3 text-center">Jolly (7ª Sfera)</th>
                  <th className="py-2.5 px-3 text-center">SuperStar (Urna 2)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {currentSimulatedDraws.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-200">{d.id}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">{d.date}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        {d.numbers.map((n) => (
                          <span
                            key={n}
                            className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold text-[11px] flex items-center justify-center"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex w-6 h-6 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold text-[11px] items-center justify-center">
                        {d.jolly}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono font-bold text-[11px] items-center justify-center">
                        ★ {d.superstar}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
            <span>
              Estrazioni {(simPage - 1) * pageSize + 1} –{' '}
              {Math.min(simPage * pageSize, simResult.simulatedDraws.length)} di{' '}
              {simResult.simulatedDraws.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={simPage === 1}
                onClick={() => setSimPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer"
                aria-label="Pagina precedente simulazioni"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono text-slate-200">
                {simPage} / {totalSimPages}
              </span>
              <button
                type="button"
                disabled={simPage === totalSimPages}
                onClick={() => setSimPage((p) => Math.min(totalSimPages, p + 1))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer"
                aria-label="Pagina successiva simulazioni"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
