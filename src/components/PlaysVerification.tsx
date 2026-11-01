/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Trophy,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Trash2,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Sparkles,
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import { SavedPlay, Draw, PlayResult } from '../types/lottery';
import { evaluatePlayedSystem } from '../utils/combinatorics';

interface PlaysVerificationProps {
  plays: SavedPlay[];
  draws: Draw[];
  onUpdatePlay: (play: SavedPlay) => void;
  onDeletePlay: (id: string) => void;
}

export const PlaysVerification: React.FC<PlaysVerificationProps> = ({
  plays,
  draws,
  onUpdatePlay,
  onDeletePlay
}) => {
  const [selectedPlayId, setSelectedPlayId] = useState<string | null>(
    plays.length > 0 ? plays[0].id : null
  );

  // Economic Ledger calculations
  const ledger = useMemo(() => {
    let totalSpent = 0;
    let totalWon = 0;
    let piggybankBalance = 0;
    let verifiedCount = 0;

    for (const p of plays) {
      totalSpent += p.cost;
      piggybankBalance += p.savedAmount || 0;
      if (p.status === 'VERIFICATA' && p.result) {
        totalWon += p.result.totalWinning;
        verifiedCount++;
      }
    }

    const netProfit = totalWon - totalSpent;
    const roiPercentage = totalSpent > 0 ? (netProfit / totalSpent) * 100 : 0;

    return {
      totalPlays: plays.length,
      verifiedCount,
      totalSpent,
      totalWon,
      piggybankBalance,
      netProfit,
      roiPercentage
    };
  }, [plays]);

  // Selected play
  const activePlay = useMemo(() => {
    return plays.find((p) => p.id === selectedPlayId) || plays[0] || null;
  }, [plays, selectedPlayId]);

  // Handler to verify a play against an extraction
  const handleVerifyPlay = (play: SavedPlay, targetDraw: Draw) => {
    const result: PlayResult = evaluatePlayedSystem(play.columns, targetDraw);
    const updatedPlay: SavedPlay = {
      ...play,
      status: 'VERIFICATA',
      result
    };
    onUpdatePlay(updatedPlay);
  };

  return (
    <div className="space-y-6">
      {/* Economic Ledger Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span>Controllo Budget & Bilancio Economico</span>
            </h2>
            <p className="text-xs text-slate-400">
              Tracciamento del piano da 10,00 € a settimana, calcolo automatico vincite e ritorno sull'investimento (ROI).
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-950 text-slate-300 border border-slate-800 font-mono">
            {ledger.totalPlays} giocate registrate ({ledger.verifiedCount} verificate)
          </span>
        </div>

        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/90">
            <span className="text-[11px] text-slate-400 block font-semibold uppercase">Spesa Cumulata</span>
            <span className="text-xl font-extrabold text-white font-mono block mt-1">
              {ledger.totalSpent.toFixed(2)} €
            </span>
            <span className="text-[10px] text-slate-500">10,00 € / settimana</span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/90">
            <span className="text-[11px] text-slate-400 block font-semibold uppercase">Vincite Totali</span>
            <span className="text-xl font-extrabold text-emerald-400 font-mono block mt-1">
              {ledger.totalWon.toFixed(2)} €
            </span>
            <span className="text-[10px] text-emerald-500/80">Premi accreditati</span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/90">
            <span className="text-[11px] text-slate-400 block font-semibold uppercase">Bilancio Netto</span>
            <div className="flex items-center gap-1.5 mt-1">
              {ledger.netProfit >= 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-rose-400" />
              )}
              <span
                className={`text-xl font-extrabold font-mono ${
                  ledger.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {ledger.netProfit > 0 ? '+' : ''}
                {ledger.netProfit.toFixed(2)} €
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              ROI: {ledger.roiPercentage.toFixed(1)}%
            </span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/90">
            <span className="text-[11px] text-slate-400 block font-semibold uppercase flex items-center gap-1">
              <PiggyBank className="w-3.5 h-3.5 text-purple-400" />
              Salvadanaio Virtuale
            </span>
            <span className="text-xl font-extrabold text-purple-300 font-mono block mt-1">
              {ledger.piggybankBalance.toFixed(2)} €
            </span>
            <span className="text-[10px] text-purple-400/80">Avanzo 1€ SuperStar</span>
          </div>
        </div>
      </div>

      {/* Plays Master-Detail View */}
      {plays.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Plays List (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              Storico Schedine Settimanali
            </h3>

            <div className="space-y-2">
              {plays.map((play) => {
                const isSelected = activePlay?.id === play.id;
                const isVerified = play.status === 'VERIFICATA';
                const hasWin = play.result && play.result.totalWinning > 0;

                return (
                  <div
                    key={play.id}
                    onClick={() => setSelectedPlayId(play.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800 border-amber-500/50 shadow-md'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-white">
                        Concorso {play.targetContestId}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          isVerified
                            ? hasWin
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {isVerified ? (hasWin ? `Vinti ${play.result?.totalWinning}€` : 'Nessun Punto') : 'In Attesa'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400 mt-2 font-mono">
                      <span>{play.columns.length} colonne ({play.cost.toFixed(2)}€)</span>
                      <span>{play.createdAt.split('T')[0]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Selected Play Detail & Match Verification (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            {activePlay && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-5">
                {/* Detail Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-extrabold text-white">
                        Giocata Concorso {activePlay.targetContestId}
                      </h3>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-950 text-slate-300 border border-slate-800 font-mono">
                        {activePlay.mode === 'pure_coverage' ? 'Copertura Pura (10€)' : 'SuperStar (9€)'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Pool di base: {activePlay.poolNumbers.join(' - ')} | Creata il {activePlay.createdAt.split('T')[0]}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Eliminare questa schedina dallo storico?')) {
                          onDeletePlay(activePlay.id);
                        }
                      }}
                      className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Elimina schedina"
                      aria-label="Elimina schedina"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Verification Trigger Bar */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Verifica contro:</span>
                    <select
                      id="select-target-draw"
                      defaultValue={draws[0]?.id || ''}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      {draws.slice(0, 15).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id} ({d.date}) - {d.numbers.join(', ')}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const sel = document.getElementById('select-target-draw') as HTMLSelectElement;
                      const chosenId = sel ? sel.value : draws[0]?.id;
                      const drawToMatch = draws.find((d) => d.id === chosenId) || draws[0];
                      if (drawToMatch) {
                        handleVerifyPlay(activePlay, drawToMatch);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-xs shadow-md hover:from-amber-400 hover:to-amber-500 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confronta ed Evidenzia Vincite</span>
                  </button>
                </div>

                {/* Columns Match Breakdown */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Dettaglio 10 Colonne & Esito Punteggi
                  </h4>

                  {activePlay.columns.map((col, idx) => {
                    const matchInfo = activePlay.result?.matchesPerColumn[idx];
                    const matchedSet = new Set(matchInfo?.matchedNumbers || []);
                    const isWinningCol = (matchInfo?.estimatedPrize || 0) > 0;

                    return (
                      <div
                        key={col.id}
                        className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isWinningCol
                            ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                            : 'bg-slate-950/60 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                            {col.id}
                          </span>

                          {/* Six balls with match highlighting */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {col.numbers.map((n) => {
                              const isHit = matchedSet.has(n);
                              return (
                                <div
                                  key={n}
                                  className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center font-mono transition-all ${
                                    isHit
                                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-950 shadow-lg shadow-emerald-500/30 scale-105 border-2 border-emerald-300 ring-2 ring-emerald-400/40'
                                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                                  }`}
                                >
                                  {n}
                                </div>
                              );
                            })}

                            {col.superstar && (
                              <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-800">
                                <div
                                  className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center font-mono ${
                                    matchInfo?.hasSuperstar
                                      ? 'bg-gradient-to-br from-purple-400 to-indigo-500 text-white shadow-lg shadow-purple-500/40 ring-2 ring-purple-400'
                                      : 'bg-slate-800 text-purple-300 border border-purple-800'
                                  }`}
                                >
                                  ★ {col.superstar}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Result badge on each column */}
                        {matchInfo ? (
                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <span
                              className={`text-xs px-2.5 py-1 rounded-lg font-bold font-mono ${
                                isWinningCol
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-slate-900 text-slate-500 border border-slate-800'
                              }`}
                            >
                              {matchInfo.matchCount} Punti
                              {matchInfo.hasSuperstar ? ' + Stella' : ''}
                              {isWinningCol ? ` (${matchInfo.estimatedPrize} €)` : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-mono self-end sm:self-center">
                            In attesa di verifica
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center mx-auto">
            <Trophy className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">Nessuna Giocata Registrata</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Usa la scheda "Generatore Ottimizzato" per calcolare il tuo sistema da 10,00 € e clicca su "Registra Giocata Settimanale" per iniziare il tracciamento del bilancio.
          </p>
        </div>
      )}
    </div>
  );
};
