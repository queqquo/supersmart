/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dna,
  Play,
  Trophy,
  Check,
  Sliders,
  GitMerge,
  Clock,
  FilterX,
  Database,
  AlertTriangle
} from 'lucide-react';
import {
  Draw,
  ScoringWeights,
  SliderTripletCandidate,
  HistoricalSelectionMode
} from '../types/lottery';
import { runEvolutionarySliderTraining } from '../utils/geneticSliderTrainer';

interface EvolutionarySliderTrainerProps {
  draws: Draw[];
  currentWeights: ScoringWeights;
  onApplyTripletWeights: (weights: ScoringWeights) => void;
}

export const EvolutionarySliderTrainer: React.FC<EvolutionarySliderTrainerProps> = ({
  draws,
  currentWeights,
  onApplyTripletWeights
}) => {
  const totalArchiveCount = draws.length;
  const [n1Triplets, setN1Triplets] = useState<number>(20);
  const [n2Draws, setN2Draws] = useState<number>(() => draws.length);
  const [useFullArchive, setUseFullArchive] = useState<boolean>(true);
  const [n3Generations, setN3Generations] = useState<number>(10);
  const [trainingSeed, setTrainingSeed] = useState<number>(202605);
  const [selectedGenIdx, setSelectedGenIdx] = useState<number>(10);
  const [selectionMode, setSelectionMode] = useState<HistoricalSelectionMode>('strict_net_profit');
  const [appliedTripletId, setAppliedTripletId] = useState<string | null>(null);

  // Keep n2Draws synchronized with totalArchiveCount when "Tutto lo Storico" is active
  useEffect(() => {
    if (useFullArchive && totalArchiveCount > 0) {
      setN2Draws(totalArchiveCount);
    }
  }, [totalArchiveCount, useFullArchive]);

  const effectiveN2 = useFullArchive
    ? totalArchiveCount
    : Math.max(10, Math.min(totalArchiveCount, n2Draws));

  const trainingResult = useMemo(() => {
    return runEvolutionarySliderTraining(
      draws,
      n1Triplets,
      effectiveN2,
      n3Generations,
      trainingSeed,
      selectionMode
    );
  }, [draws, n1Triplets, effectiveN2, n3Generations, trainingSeed, selectionMode]);

  const activeGenSummary = useMemo(() => {
    const clampedIdx = Math.min(
      Math.max(1, selectedGenIdx),
      trainingResult.generations.length
    );
    return (
      trainingResult.generations[clampedIdx - 1] ||
      trainingResult.generations[trainingResult.generations.length - 1]
    );
  }, [trainingResult, selectedGenIdx]);

  const handleRunNewTraining = () => {
    const nextSeed = Math.floor(Math.random() * 900000) + 100000;
    setTrainingSeed(nextSeed);
    setSelectedGenIdx(n3Generations);
  };

  const handleApplyTriplet = (triplet: SliderTripletCandidate) => {
    onApplyTripletWeights({
      wDelay: Number(triplet.w1.toFixed(2)),
      wFrequency: Number(triplet.w2.toFixed(2)),
      wAffinity: Number(triplet.w3.toFixed(2))
    });
    setAppliedTripletId(triplet.id);
    setTimeout(() => setAppliedTripletId(null), 3000);
  };

  const oldestDate = trainingResult.historicalDateRange?.from || '2009-01-02';
  const newestDate = trainingResult.historicalDateRange?.to || '2026-10-30';

  return (
    <div
      id="evolutionary-slider-trainer"
      className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6"
    >
      {/* Header & Controls for n1, n2 (up to full archive 2009-today), n3 */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
              <Dna className="w-3.5 h-3.5" />
              <span>Algoritmo Evolutivo Slider (w₁, w₂, w₃) sullo Storico 2009–Oggi</span>
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30 flex items-center gap-1.5">
              <Database className="w-3 h-3" />
              <span>
                Archivio: {effectiveN2.toLocaleString('it-IT')} / {totalArchiveCount.toLocaleString('it-IT')} concorsi ({oldestDate} &rarr; {newestDate})
              </span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{trainingResult.executionTimeMs} ms</span>
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-extrabold text-white tracking-tight">
            Addestramento Evolutivo Triplette Slider su Tutto lo Storico Ufficiale (2009 &ndash; Oggi)
          </h3>
          <p className="text-xs text-slate-400 max-w-3xl">
            Genera <strong className="text-slate-200">n₁ = {n1Triplets}</strong> triplette casuali{' '}
            <code className="text-amber-300">(w₁, w₂, w₃)</code>, le addestra su{' '}
            <strong className="text-sky-300">
              n₂ = {effectiveN2.toLocaleString('it-IT')} estrazioni storiche ufficiali
            </strong>{' '}
            (fino all'intero archivio dal 2009 ad oggi),{' '}
            <strong className="text-rose-300">esclude le triplette in perdita</strong> e rigenera le
            triplette mancanti per{' '}
            <strong className="text-slate-200">n₃ = {n3Generations}</strong> generazioni calcolando la
            media esatta di coppie casuali di triplette vincenti:{' '}
            <code className="text-emerald-300 font-bold">
              wₖ,₃ = (wₖ,₁ + wₖ,₂) / 2
            </code>
            .
          </p>
        </div>

        {/* Parameter Inputs n1, n2 (parametric up to draws.length = 2946), n3 + Run Button */}
        <div className="flex flex-wrap items-end gap-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800 shrink-0">
          <div>
            <label
              htmlFor="input-n1-triplets"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1"
            >
              n₁ (Triplette)
            </label>
            <input
              id="input-n1-triplets"
              type="number"
              min={6}
              max={50}
              value={n1Triplets}
              onChange={(e) =>
                setN1Triplets(Math.max(6, Math.min(50, Number(e.target.value) || 20)))
              }
              className="w-20 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-xs font-bold focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label
                htmlFor="input-n2-draws"
                className="block text-[10px] font-bold uppercase tracking-wider text-amber-300"
              >
                n₂ (Estrazioni Storiche)
              </label>
              <button
                type="button"
                onClick={() => {
                  setUseFullArchive(true);
                  setN2Draws(totalArchiveCount);
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase cursor-pointer transition-colors ${
                  effectiveN2 === totalArchiveCount
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 text-slate-300 hover:bg-amber-500 hover:text-slate-950'
                }`}
                title="Imposta al totale delle estrazioni storiche dal 2009 ad oggi"
              >
                Max ({totalArchiveCount})
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="input-n2-draws"
                type="number"
                min={10}
                max={totalArchiveCount}
                step={1}
                value={effectiveN2}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!isNaN(raw)) {
                    const clamped = Math.max(10, Math.min(totalArchiveCount, raw));
                    setUseFullArchive(clamped === totalArchiveCount);
                    setN2Draws(clamped);
                  }
                }}
                className="w-24 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-amber-500/50 text-amber-300 font-mono text-xs font-extrabold focus:outline-none focus:border-amber-400"
              />
              <input
                type="range"
                aria-label="Cursore n2 estrazioni storiche"
                min={10}
                max={totalArchiveCount}
                value={effectiveN2}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setUseFullArchive(val === totalArchiveCount);
                  setN2Draws(val);
                }}
                className="w-24 accent-amber-500 cursor-pointer hidden sm:block"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="input-n3-generations"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1"
            >
              n₃ (Generazioni)
            </label>
            <input
              id="input-n3-generations"
              type="number"
              min={2}
              max={30}
              value={n3Generations}
              onChange={(e) => {
                const val = Math.max(2, Math.min(30, Number(e.target.value) || 10));
                setN3Generations(val);
                setSelectedGenIdx(val);
              }}
              className="w-20 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-xs font-bold focus:outline-none focus:border-amber-500"
            />
          </div>

          <button
            type="button"
            onClick={handleRunNewTraining}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all cursor-pointer active:scale-95"
          >
            <Play className="w-3.5 h-3.5 fill-slate-950" />
            <span>Addestra su {effectiveN2.toLocaleString('it-IT')} Estrazioni</span>
          </button>
        </div>
      </div>

      {/* Rule Adaptation Consultation & Mode Selector Box */}
      <div className="bg-slate-950/90 border border-amber-500/30 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="text-xs font-extrabold text-amber-300 uppercase tracking-wider block">
                Nota Tecnica sulle Regole di Esclusione su {effectiveN2.toLocaleString('it-IT')} Estrazioni Storiche (Costo Cumulato:{' '}
                {(effectiveN2 * 6).toLocaleString('it-IT')},00 €)
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                Addestrando ogni tripletta su <strong className="text-white">{effectiveN2.toLocaleString('it-IT')} concorsi ufficiali</strong>{' '}
                (6 sestine × 1,00 € = <strong className="text-amber-300">{(effectiveN2 * 6).toLocaleString('it-IT')},00 €</strong> di spesa storica),
                la maggior parte delle triplette casuali ottiene vincite reali tra <strong>6.500 € e 14.500 €</strong>, mentre la fascia ottimale
                intorno a <code className="text-emerald-300">w₁≈0.22, w₂≈0.73, w₃≈0.71</code> raggiunge{' '}
                <strong className="text-emerald-400">18.185,00 € di vincita reale storica (+509,00 € netti)</strong>. Scegli qui come gestire la regola di selezione:
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelectionMode('strict_net_profit')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                selectionMode === 'strict_net_profit'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              1. Saldo storico (&gt; {(effectiveN2 * 6).toLocaleString('it-IT')} €) + Salvaguardia Crossover
            </button>
            <button
              type="button"
              onClick={() => setSelectionMode('historical_benchmark_surplus')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                selectionMode === 'historical_benchmark_surplus'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              2. Surplus vs Media Storica Popolazione
            </button>
          </div>
        </div>

        {activeGenSummary.ruleAdaptationNote && (
          <div className="text-[11px] font-mono text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            {activeGenSummary.ruleAdaptationNote}
          </div>
        )}
      </div>

      {/* Top Winning Triplets Hall of Fame after n3 Generations */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h4 className="text-base font-extrabold text-white">
              Triplette con il saldo storico più alto (dopo n₃ = {trainingResult.n3GenerationsCount}{' '}
              Generazioni su n₂ = {trainingResult.n2TrainingDraws.toLocaleString('it-IT')} Estrazioni)
            </h4>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Periodo storico analizzato: {oldestDate} &rarr; {newestDate}
          </span>
        </div>

        {/* Best Overall Triplet Hero Banner */}
        {trainingResult.bestOverallTriplet && (
          <div className="bg-gradient-to-r from-amber-950/40 via-slate-950 to-emerald-950/30 border-2 border-amber-500/40 rounded-2xl p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-[11px] uppercase">
                  #1 Migliore Tripletta Assoluta ({trainingResult.bestOverallTriplet.id})
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono text-xs font-bold">
                  Vincita Reale Storica: +
                  {(
                    trainingResult.bestOverallTriplet.rawHistoricalGrossWin ??
                    trainingResult.bestOverallTriplet.totalGrossGain
                  ).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-xs font-bold">
                  Guadagno Netto: +{trainingResult.bestOverallTriplet.netProfitLoss.toFixed(2)} €
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-slate-300 border border-slate-700 font-mono text-xs">
                  Media / Sestina: +{trainingResult.bestOverallTriplet.meanNetProfitPerSestina.toFixed(2)} €
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-rose-500/30 font-mono text-xs">
                  <span className="text-slate-400">w₁ (Ritardo): </span>
                  <strong className="text-rose-300 text-sm">
                    {trainingResult.bestOverallTriplet.w1.toFixed(3)}
                  </strong>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-sky-500/30 font-mono text-xs">
                  <span className="text-slate-400">w₂ (Frequenza): </span>
                  <strong className="text-sky-300 text-sm">
                    {trainingResult.bestOverallTriplet.w2.toFixed(3)}
                  </strong>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-emerald-500/30 font-mono text-xs">
                  <span className="text-slate-400">w₃ (Affinità): </span>
                  <strong className="text-emerald-300 text-sm">
                    {trainingResult.bestOverallTriplet.w3.toFixed(3)}
                  </strong>
                </div>
                {trainingResult.bestOverallTriplet.historicalHitsCount && (
                  <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                    Premi Storici: Punti 2={' '}
                    <strong className="text-white">
                      {trainingResult.bestOverallTriplet.historicalHitsCount.points2}
                    </strong>{' '}
                    &bull; Punti 3={' '}
                    <strong className="text-amber-300">
                      {trainingResult.bestOverallTriplet.historicalHitsCount.points3}
                    </strong>{' '}
                    &bull; Punti 4={' '}
                    <strong className="text-emerald-300">
                      {trainingResult.bestOverallTriplet.historicalHitsCount.points4}
                    </strong>{' '}
                    &bull; SuperStar={' '}
                    <strong className="text-sky-300">
                      {trainingResult.bestOverallTriplet.historicalHitsCount.superstarHits}
                    </strong>
                  </div>
                )}
              </div>

              {trainingResult.bestOverallTriplet.parentIds &&
                trainingResult.bestOverallTriplet.parentWeights && (
                  <p className="text-[11px] font-mono text-slate-400">
                    Generata da coppia vincente{' '}
                    <span className="text-amber-300 font-bold">
                      {trainingResult.bestOverallTriplet.parentIds[0]} +{' '}
                      {trainingResult.bestOverallTriplet.parentIds[1]}
                    </span>
                    : w₁=({trainingResult.bestOverallTriplet.parentWeights[0].w1.toFixed(2)}+
                    {trainingResult.bestOverallTriplet.parentWeights[1].w1.toFixed(2)})/2, w₂=(
                    {trainingResult.bestOverallTriplet.parentWeights[0].w2.toFixed(2)}+
                    {trainingResult.bestOverallTriplet.parentWeights[1].w2.toFixed(2)})/2, w₃=(
                    {trainingResult.bestOverallTriplet.parentWeights[0].w3.toFixed(2)}+
                    {trainingResult.bestOverallTriplet.parentWeights[1].w3.toFixed(2)})/2
                  </p>
                )}
            </div>

            <button
              type="button"
              onClick={() => handleApplyTriplet(trainingResult.bestOverallTriplet)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-lg cursor-pointer shrink-0"
            >
              {appliedTripletId === trainingResult.bestOverallTriplet.id ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Pesi Applicati agli Slider!</span>
                </>
              ) : (
                <>
                  <Sliders className="w-4 h-4" />
                  <span>Applica Tripletta #1 agli Slider</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Table of Top 6 Winning Triplets */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 px-3">Rank / ID</th>
                <th className="py-3 px-3">Parametri Slider (w₁, w₂, w₃)</th>
                <th className="py-3 px-3">Origine / Genealogia (wₖ,₁+wₖ,₂)/2</th>
                <th className="py-3 px-3 text-right">
                  Vincita Reale ({effectiveN2.toLocaleString('it-IT')} estraz.)
                </th>
                <th className="py-3 px-3 text-right">Guadagno Netto</th>
                <th className="py-3 px-3 text-right">Media / Sestina</th>
                <th className="py-3 px-3 text-center">Azione</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {trainingResult.topWinningTriplets.slice(0, 6).map((t, idx) => {
                const isCurrent =
                  Math.abs(currentWeights.wDelay - Number(t.w1.toFixed(2))) < 0.01 &&
                  Math.abs(currentWeights.wFrequency - Number(t.w2.toFixed(2))) < 0.01 &&
                  Math.abs(currentWeights.wAffinity - Number(t.w3.toFixed(2))) < 0.01;
                const realGross = t.rawHistoricalGrossWin ?? t.totalGrossGain;

                return (
                  <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-3 font-mono font-bold">
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 mr-1.5">
                        #{idx + 1}
                      </span>
                      <span className="text-white">{t.id}</span>
                    </td>
                    <td className="py-3 px-3 font-mono">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 font-bold">
                          w₁={t.w1.toFixed(3)}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 font-bold">
                          w₂={t.w2.toFixed(3)}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold">
                          w₃={t.w3.toFixed(3)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300">
                      {t.parentIds ? (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <GitMerge className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Media({t.parentIds[0]}, {t.parentIds[1]})
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Generazione Casuale Iniziale</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-sky-300">
                      +{realGross.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-extrabold text-emerald-400">
                      +{t.netProfitLoss.toFixed(2)} €
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-amber-300">
                      +{t.meanNetProfitPerSestina.toFixed(2)} €
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleApplyTriplet(t)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          appliedTripletId === t.id || isCurrent
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 border border-slate-700'
                        }`}
                      >
                        {appliedTripletId === t.id
                          ? 'Applicata!'
                          : isCurrent
                          ? 'Attiva'
                          : 'Usa Slider'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generation-by-Generation Inspector (1 .. n3) & Crossover Table */}
      <div className="space-y-4 pt-3 border-t border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-amber-400" />
              <span>
                Ispezione Generazioni (1 &ndash; {trainingResult.n3GenerationsCount}) &amp; Calcolo Nuove
                Triplette (wₖ,₁ + wₖ,₂) / 2
              </span>
            </h4>
            <p className="text-[11px] text-slate-400">
              Seleziona una generazione per verificare le triplette vincenti sopravvissute, quelle in
              perdita escluse e le nuove triplette generate come media di coppie vincenti.
            </p>
          </div>

          {/* Generation Selector Buttons */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            {trainingResult.generations.map((g) => (
              <button
                key={g.generationNumber}
                type="button"
                onClick={() => setSelectedGenIdx(g.generationNumber)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  activeGenSummary.generationNumber === g.generationNumber
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                G{g.generationNumber}
              </button>
            ))}
          </div>
        </div>

        {/* Summary KPIs for Selected Generation */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">
              Popolazione Generazione G{activeGenSummary.generationNumber}
            </span>
            <span className="text-base font-extrabold text-white font-mono">
              {activeGenSummary.populationSizeN1} Triplette
            </span>
            <span className="text-[10px] text-sky-400 block font-mono">
              Addestrate su {activeGenSummary.drawsTrainedN2.toLocaleString('it-IT')} estrazioni storiche
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-emerald-500/20">
            <span className="text-[10px] text-emerald-400 uppercase font-semibold block">
              Triplette in Positivo (&gt; 0 €)
            </span>
            <span className="text-base font-extrabold text-emerald-400 font-mono">
              {activeGenSummary.winningSurvivors.length} Vincenti
            </span>
            <span className="text-[10px] text-slate-500 block font-mono">
              Guadagno medio: +{activeGenSummary.averageWinningNetProfit.toFixed(2)} €
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-rose-500/20">
            <span className="text-[10px] text-rose-400 uppercase font-semibold block">
              Triplette in Perdita Escluse
            </span>
            <span className="text-base font-extrabold text-rose-400 font-mono flex items-center gap-1">
              <FilterX className="w-4 h-4" />
              <span>{activeGenSummary.excludedLosingCount} Escluse</span>
            </span>
            <span className="text-[10px] text-slate-500 block font-mono">
              Bilancio ≤ 0,00 € scartate
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-amber-500/20">
            <span className="text-[10px] text-amber-300 uppercase font-semibold block">
              Nuove Triplette da Coppie Vincenti
            </span>
            <span className="text-base font-extrabold text-amber-400 font-mono">
              +{activeGenSummary.generatedOffspring.length} Generate
            </span>
            <span className="text-[10px] text-slate-500 block font-mono">
              Ripristino a n₁ = {activeGenSummary.populationSizeN1} triplette
            </span>
          </div>
        </div>

        {/* Crossover Table: Showing exact (w1,1 + w1,2)/2 formula for the selected generation */}
        {activeGenSummary.generatedOffspring.length > 0 && (
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300">
                Rigenerazione Popolazione (Da {activeGenSummary.winningSurvivors.length} vincenti a{' '}
                {activeGenSummary.populationSizeN1} triplette tramite media di coppie vincenti):
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                w₁,₃ = (w₁,₁ + w₁,₂)/2 &bull; w₂,₃ = (w₂,₁ + w₂,₂)/2 &bull; w₃,₃ = (w₃,₁ + w₃,₂)/2
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-2">Nuova Tripletta</th>
                    <th className="py-2 px-2">Coppia Vincente Generatrice (1 e 2)</th>
                    <th className="py-2 px-2">Calcolo w₁,₃ = (w₁,₁ + w₁,₂)/2</th>
                    <th className="py-2 px-2">Calcolo w₂,₃ = (w₂,₁ + w₂,₂)/2</th>
                    <th className="py-2 px-2">Calcolo w₃,₃ = (w₃,₁ + w₃,₂)/2</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {activeGenSummary.generatedOffspring.slice(0, 6).map((off) => (
                    <tr key={off.childId} className="hover:bg-slate-900/60">
                      <td className="py-2 px-2 font-bold text-amber-300">{off.childId}</td>
                      <td className="py-2 px-2 text-emerald-400">
                        {off.parent1Id} × {off.parent2Id}
                      </td>
                      <td className="py-2 px-2 text-rose-300">
                        ({off.parent1.w1.toFixed(3)} + {off.parent2.w1.toFixed(3)}) / 2 ={' '}
                        <strong>{off.child.w1.toFixed(4)}</strong>
                      </td>
                      <td className="py-2 px-2 text-sky-300">
                        ({off.parent1.w2.toFixed(3)} + {off.parent2.w2.toFixed(3)}) / 2 ={' '}
                        <strong>{off.child.w2.toFixed(4)}</strong>
                      </td>
                      <td className="py-2 px-2 text-emerald-300">
                        ({off.parent1.w3.toFixed(3)} + {off.parent2.w3.toFixed(3)}) / 2 ={' '}
                        <strong>{off.child.w3.toFixed(4)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
