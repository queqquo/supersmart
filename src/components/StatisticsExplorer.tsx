/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Clock,
  Flame,
  Sparkles,
  Search,
  Sliders,
  TrendingUp,
  Info
} from 'lucide-react';
import { Draw, ScoringWeights } from '../types/lottery';
import { calculateNumberStatistics, scoreAllNumbers } from '../utils/combinatorics';

interface StatisticsExplorerProps {
  draws: Draw[];
  weights: ScoringWeights;
}

export const StatisticsExplorer: React.FC<StatisticsExplorerProps> = ({
  draws,
  weights
}) => {
  const [selectedBall, setSelectedBall] = useState<number | null>(null);

  const statsMap = useMemo(() => {
    return calculateNumberStatistics(draws, 36);
  }, [draws]);

  const scoredList = useMemo(() => {
    return scoreAllNumbers(statsMap, weights, 36);
  }, [statsMap, weights]);

  // Top 10 Ritardatari
  const topDelays = useMemo(() => {
    return Object.values(statsMap)
      .sort((a, b) => b.currentDelay - a.currentDelay)
      .slice(0, 10);
  }, [statsMap]);

  // Top 10 Frequent (K=36)
  const topFrequent = useMemo(() => {
    return Object.values(statsMap)
      .sort((a, b) => b.frequencyK - a.frequencyK)
      .slice(0, 10);
  }, [statsMap]);

  // Top 10 Affinity / Spia
  const topAffinity = useMemo(() => {
    return Object.values(statsMap)
      .sort((a, b) => b.affinityScore - a.affinityScore)
      .slice(0, 10);
  }, [statsMap]);

  const latestDraw = draws[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-white">
              Analisi Statistica dei 90 Numeri
            </h2>
          </div>
          {latestDraw ? (
            <div className="text-xs text-slate-400 font-mono">
              Ultimo concorso: <strong className="text-slate-200">{latestDraw.id}</strong> ({latestDraw.date})
            </div>
          ) : (
            <div className="text-xs text-amber-300 font-bold bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 rounded-full">
              Nessuna estrazione reale in archivio &bull; Modalità Equiprobabile Pura
            </div>
          )}
        </div>
        <p className="text-xs text-slate-400">
          {draws.length > 0
            ? `Calcolo matematico puro eseguito in locale su ${draws.length} concorsi reali. I tre pilastri (Ritardo, Frequenza, Affinità) alimentano il punteggio combinatorio S(x).`
            : "Nessuna estrazione reale in archivio: l'algoritmo lavora in Modalità Equiprobabile Pura (tutti i 90 numeri hanno identico peso base 0,00 senza inventare statistiche inesistenti). Inserisci o importa estrazioni reali nella scheda Archivio Storico."}
        </p>
      </div>

      {/* 3 Columns: Ritardatari, Frequenti, Affinità */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Top 10 Ritardatari */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-rose-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Top 10 Ritardatari
              </h3>
            </div>
            <span className="text-[10px] text-rose-300 font-mono">Ritardo attuale</span>
          </div>

          <div className="space-y-2">
            {topDelays.map((item, idx) => (
              <div
                key={item.number}
                onClick={() => setSelectedBall(item.number)}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 text-[10px] font-mono text-slate-500 font-bold">
                    {idx + 1}.
                  </span>
                  <div className="w-7 h-7 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold text-xs flex items-center justify-center">
                    {item.number}
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-white">
                    {item.currentDelay} <span className="text-[10px] text-slate-500">conc.</span>
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    max: {item.maxHistoricalDelay}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top 10 Frequenti (K=36) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Top 10 Più Frequenti
              </h3>
            </div>
            <span className="text-[10px] text-amber-300 font-mono">Ultimi 36 concorsi</span>
          </div>

          <div className="space-y-2">
            {topFrequent.map((item, idx) => (
              <div
                key={item.number}
                onClick={() => setSelectedBall(item.number)}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 text-[10px] font-mono text-slate-500 font-bold">
                    {idx + 1}.
                  </span>
                  <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold text-xs flex items-center justify-center">
                    {item.number}
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-white">
                    {item.frequencyK} <span className="text-[10px] text-slate-500">uscite</span>
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    totale: {item.totalFrequency}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top 10 Affinità Spia */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Affinità Spia / Simpatia
              </h3>
            </div>
            <span className="text-[10px] text-emerald-300 font-mono">Con ultima sestina</span>
          </div>

          <div className="space-y-2">
            {topAffinity.map((item, idx) => (
              <div
                key={item.number}
                onClick={() => setSelectedBall(item.number)}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 text-[10px] font-mono text-slate-500 font-bold">
                    {idx + 1}.
                  </span>
                  <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-xs flex items-center justify-center">
                    {item.number}
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-emerald-300">
                    {Math.round(item.affinityScore * 100)}%
                  </span>
                  <span className="text-[10px] text-slate-500 block">indice simpatia</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 90 Numbers Heat Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Mappa di Calore Completa dei 90 Numeri
            </h3>
            <p className="text-xs text-slate-400">
              Fai clic su un numero per visualizzare il dettaglio matematico completo.
            </p>
          </div>

          {selectedBall && (
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-amber-400 font-bold">Numero {selectedBall}:</span>
              <span className="text-slate-300">
                Rit: {statsMap[selectedBall]?.currentDelay} (max {statsMap[selectedBall]?.maxHistoricalDelay})
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">Freq 36: {statsMap[selectedBall]?.frequencyK}</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">Score: {statsMap[selectedBall]?.compositeScore}</span>
            </div>
          )}
        </div>

        {/* 90 balls grid */}
        <div className="grid grid-cols-6 sm:grid-cols-9 md:grid-cols-15 gap-2">
          {Array.from({ length: 90 }, (_, i) => i + 1).map((num) => {
            const stat = statsMap[num];
            const isSelected = selectedBall === num;

            // Color coding based on composite score
            const score = stat?.compositeScore || 0;
            let bgClass = 'bg-slate-950 text-slate-300 border-slate-800';
            if (score > 0.65) {
              bgClass = 'bg-amber-500/30 text-amber-200 border-amber-500/50 font-bold';
            } else if (score > 0.45) {
              bgClass = 'bg-sky-500/20 text-sky-200 border-sky-500/40';
            }

            return (
              <button
                key={num}
                type="button"
                onClick={() => setSelectedBall(num)}
                className={`w-9 h-9 rounded-xl border flex flex-col items-center justify-center text-xs font-mono transition-all hover:scale-110 cursor-pointer ${bgClass} ${
                  isSelected ? 'ring-2 ring-amber-400 scale-110 shadow-lg' : ''
                }`}
              >
                <span>{num}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
