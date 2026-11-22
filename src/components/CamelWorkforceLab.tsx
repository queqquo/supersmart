/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bot,
  Sparkles,
  Play,
  Check,
  Copy,
  BookmarkPlus,
  Cpu,
  ShieldCheck,
  Terminal,
  Trophy,
  ArrowRight,
  Layers,
  Clock,
  Sliders,
  Info,
  Lock
} from 'lucide-react';
import {
  Draw,
  FilterOptions,
  PlayMode,
  CoverageTarget,
  SavedPlay,
  SimulationGeneratorPreset
} from '../types/lottery';
import {
  runCamelWorkforcePipeline,
  CamelWorkforceResult,
  CamelAgentId,
  CamelPoolNumberReason,
  UserCamelWorkforceRecord
} from '../utils/camelWorkforce';
import { getBalancedFunnelUiLabels } from '../utils/combinatorics';
import {
  loadUserCamelWorkforce,
  cacheUserCamelWorkforceLocally,
  saveUserCamelWorkforce,
  syncUserCamelWorkforce,
  getUserCamelStorageKey
} from '../utils/storage';
import { subscribeCloudUserCamelWorkforce } from '../utils/firebase';
import { GenerationDateNote } from './GenerationDateNote';

interface CamelWorkforceLabProps {
  userEmail: string;
  draws: Draw[];
  filters: FilterOptions;
  coverageTarget: CoverageTarget;
  onUpdateCoverageTarget: (target: CoverageTarget) => void;
  onApplyToGenerator: (preset: SimulationGeneratorPreset) => void;
  onSavePlay: (play: SavedPlay) => void;
}

const AGENT_COLOR_CLASSES: Record<
  CamelAgentId,
  { bg: string; border: string; text: string; badge: string }
> = {
  coordinator: {
    bg: 'bg-amber-950/30',
    border: 'border-amber-500/40',
    text: 'text-amber-300',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
  },
  walk_forward_scout: {
    bg: 'bg-sky-950/30',
    border: 'border-sky-500/40',
    text: 'text-sky-300',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30'
  },
  genetic_strategist: {
    bg: 'bg-purple-950/30',
    border: 'border-purple-500/40',
    text: 'text-purple-300',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30'
  },
  orthogonal_architect: {
    bg: 'bg-emerald-950/30',
    border: 'border-emerald-500/40',
    text: 'text-emerald-300',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  },
  anti_crowd_critic: {
    bg: 'bg-rose-950/30',
    border: 'border-rose-500/40',
    text: 'text-rose-300',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30'
  }
};

const TAG_COLOR_BADGE: Record<CamelPoolNumberReason['tagColor'], string> = {
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30'
};

export const CamelWorkforceLab: React.FC<CamelWorkforceLabProps> = ({
  userEmail,
  draws,
  filters,
  coverageTarget,
  onUpdateCoverageTarget,
  onApplyToGenerator,
  onSavePlay
}) => {
  const initialSavedRecord = useMemo(
    () => loadUserCamelWorkforce(userEmail),
    [userEmail]
  );

  const maxHistoricalDraws = Math.max(1, draws.length);
  const [poolSizeV, setPoolSizeV] = useState<number>(
    () => initialSavedRecord?.poolSizeV ?? 12
  );
  const [historicalDrawsWindow, setHistoricalDrawsWindow] = useState<number>(
    () => initialSavedRecord?.historicalDrawsWindow ?? 200
  );
  const [budgetEuro, setBudgetEuro] = useState<number>(
    () => initialSavedRecord?.budgetEuro ?? 10
  );
  const [playMode, setPlayMode] = useState<PlayMode>(
    () => initialSavedRecord?.playMode ?? 'pure_coverage'
  );
  const [localCoverageTarget, setLocalCoverageTarget] = useState<CoverageTarget>(
    () => initialSavedRecord?.coverageTarget ?? coverageTarget
  );
  const [workforceResult, setWorkforceResult] = useState<CamelWorkforceResult | null>(
    () => initialSavedRecord?.workforceResult ?? null
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    () =>
      initialSavedRecord?.selectedCandidateId ||
      initialSavedRecord?.workforceResult?.winnerCandidate?.id ||
      ''
  );
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(
    () =>
      initialSavedRecord?.updatedAt ??
      initialSavedRecord?.workforceResult?.executedAt ??
      null
  );
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(() => !initialSavedRecord);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const lastAppliedTimeRef = useRef<number>(
    initialSavedRecord ? new Date(initialSavedRecord.updatedAt || 0).getTime() : 0
  );

  const applySavedRecordToState = (rec: UserCamelWorkforceRecord) => {
    const recTime = new Date(rec.updatedAt || rec.workforceResult.executedAt || 0).getTime();
    lastAppliedTimeRef.current = Number.isFinite(recTime) ? recTime : Date.now();
    setPoolSizeV(rec.poolSizeV);
    setHistoricalDrawsWindow(rec.historicalDrawsWindow);
    setBudgetEuro(rec.budgetEuro);
    setPlayMode(rec.playMode);
    setLocalCoverageTarget(rec.coverageTarget);
    setWorkforceResult(rec.workforceResult);
    setSelectedCandidateId(
      rec.selectedCandidateId || rec.workforceResult.winnerCandidate.id
    );
    setLastGeneratedAt(rec.updatedAt || rec.workforceResult.executedAt);
    setHasPendingChanges(false);
  };

  // Synchronize this user's locked CAMEL analysis across LocalStorage, Server, and Cloud Firestore.
  // NEVER auto-generates numbers on mount, tab change, draws update, or new browser/session/device.
  useEffect(() => {
    let active = true;
    const localRec = loadUserCamelWorkforce(userEmail);

    if (localRec) {
      applySavedRecordToState(localRec);
      setIsSyncingCloud(false);
    } else {
      lastAppliedTimeRef.current = 0;
      setIsSyncingCloud(true);
    }

    syncUserCamelWorkforce(userEmail)
      .then((syncedRec) => {
        if (!active) return;
        if (syncedRec) {
          const syncedTime = new Date(syncedRec.updatedAt || 0).getTime();
          if (lastAppliedTimeRef.current === 0 || syncedTime > lastAppliedTimeRef.current) {
            applySavedRecordToState(syncedRec);
          }
        }
        setIsSyncingCloud(false);
      })
      .catch(() => {
        if (active) setIsSyncingCloud(false);
      });

    const unsubCloud = subscribeCloudUserCamelWorkforce(userEmail, (cloudRec) => {
      if (!active || !cloudRec) return;
      const cloudTime = new Date(cloudRec.updatedAt || 0).getTime();
      if (lastAppliedTimeRef.current === 0 || cloudTime > lastAppliedTimeRef.current) {
        cacheUserCamelWorkforceLocally(cloudRec);
        applySavedRecordToState(cloudRec);
        setIsSyncingCloud(false);
      }
    });

    const storageKey = getUserCamelStorageKey(userEmail);
    const handleStorageEvent = (e: StorageEvent) => {
      if (!active) return;
      if (e.key && e.key !== storageKey) return;
      const updatedLocal = loadUserCamelWorkforce(userEmail);
      if (updatedLocal) {
        const updatedTime = new Date(updatedLocal.updatedAt || 0).getTime();
        if (lastAppliedTimeRef.current === 0 || updatedTime > lastAppliedTimeRef.current) {
          applySavedRecordToState(updatedLocal);
          setIsSyncingCloud(false);
        }
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      active = false;
      unsubCloud();
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [userEmail]);

  const markPendingChanges = () => {
    if (workforceResult) {
      setHasPendingChanges(true);
    }
  };

  // Explicit generation ONLY when user clicks "Estrai Nuovi N Numeri Equi"
  const executeWorkforce = () => {
    const safeWindow = Math.min(
      maxHistoricalDraws,
      Math.max(1, Math.round(historicalDrawsWindow || 200))
    );
    setHistoricalDrawsWindow(safeWindow);
    setIsRunning(true);
    setTimeout(() => {
      const res = runCamelWorkforcePipeline({
        draws,
        poolSizeV,
        historicalDrawsWindow: safeWindow,
        budgetEuro,
        playMode,
        coverageTarget: localCoverageTarget,
        baseFilters: filters
      });
      const nowIso = res.executedAt || new Date().toISOString();
      lastAppliedTimeRef.current = new Date(nowIso).getTime();
      setWorkforceResult(res);
      setSelectedCandidateId(res.winnerCandidate.id);
      setLastGeneratedAt(nowIso);
      setHasPendingChanges(false);
      setIsSyncingCloud(false);
      setIsRunning(false);
      setSavedSuccess(false);

      saveUserCamelWorkforce({
        userEmail,
        updatedAt: nowIso,
        poolSizeV,
        historicalDrawsWindow: safeWindow,
        budgetEuro,
        playMode,
        coverageTarget: localCoverageTarget,
        selectedCandidateId: res.winnerCandidate.id,
        workforceResult: res
      });
    }, 20);
  };

  const handleSelectCandidate = (candidateId: string) => {
    setSelectedCandidateId(candidateId);
    if (workforceResult) {
      const existingLocal = loadUserCamelWorkforce(userEmail);
      cacheUserCamelWorkforceLocally({
        userEmail,
        updatedAt: existingLocal?.updatedAt || lastGeneratedAt || workforceResult.executedAt,
        poolSizeV: existingLocal?.poolSizeV ?? workforceResult.poolSizeV,
        historicalDrawsWindow:
          existingLocal?.historicalDrawsWindow ?? workforceResult.historicalDrawsWindow,
        budgetEuro: existingLocal?.budgetEuro ?? workforceResult.budgetEuro,
        playMode: existingLocal?.playMode ?? workforceResult.playMode,
        coverageTarget: existingLocal?.coverageTarget ?? workforceResult.coverageTarget,
        selectedCandidateId: candidateId,
        workforceResult
      });
    }
  };

  const activeCandidate =
    workforceResult?.candidates.find((c) => c.id === selectedCandidateId) ||
    workforceResult?.winnerCandidate ||
    null;

  const handleApplyCandidate = () => {
    if (!workforceResult || !activeCandidate) return;
    const bestCol0 = activeCandidate.systemResult.columns[0];
    const preset: SimulationGeneratorPreset = {
      ...workforceResult.readyPreset,
      id: `camel-preset-${Date.now()}`,
      appliedAt: new Date().toISOString(),
      coverageTarget: workforceResult.coverageTarget,
      highProbabilityNumbers: bestCol0
        ? [
            bestCol0.numbers[0],
            bestCol0.numbers[1],
            bestCol0.numbers[2],
            bestCol0.numbers[3],
            bestCol0.numbers[4],
            bestCol0.numbers[5]
          ]
        : undefined,
      top12PoolNumbers: activeCandidate.poolNumbers,
      recommendedWeights: activeCandidate.weightsUsed,
      recommendedFilters: activeCandidate.filtersUsed,
      confidenceIndex: activeCandidate.camelCompositeScore,
      sourceLabel: `CAMEL Workforce • ${activeCandidate.strategyName} (Score ${activeCandidate.camelCompositeScore}/100)`
    };
    onApplyToGenerator(preset);
  };

  const handleSaveCandidateToLedger = () => {
    if (!workforceResult || !activeCandidate) return;
    const latestDraw = draws[0];
    const targetContestNumber = latestDraw ? latestDraw.contestNumber + 1 : 46;
    const targetYear = latestDraw ? latestDraw.year : 2026;
    const targetId = `${targetYear}-${String(targetContestNumber).padStart(3, '0')}`;

    const play: SavedPlay = {
      id: `play-camel-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId: targetId,
      mode: workforceResult.playMode,
      cost: workforceResult.budgetEuro,
      savedAmount: 0,
      poolNumbers: activeCandidate.poolNumbers,
      columns: activeCandidate.systemResult.columns,
      status: 'IN_ATTESA',
      manualNote: `Generato da CAMEL Workforce (${activeCandidate.strategyName})`
    };
    onSavePlay(play);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  };

  const handleCopyCandidateColumns = () => {
    if (!activeCandidate) return;
    const lines = activeCandidate.systemResult.columns.map((c) => {
      const base = `Colonna ${c.id}: ${c.numbers.join(' - ')}`;
      return c.superstar ? `${base} [SuperStar: ${c.superstar}]` : base;
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/60 to-amber-950/30 border border-indigo-500/30 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" />
                <span>CAMEL-AI Role-Playing Workforce</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                2-Opt Kempe Local Search + Hamming d_H
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Synology DS215+ Ready (Zero-RAM Overhead)
              </span>
              {workforceResult && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>
                    Bloccato per {userEmail}
                    {lastGeneratedAt
                      ? ` • ${new Date(lastGeneratedAt).toLocaleString('it-IT', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}`
                      : ''}
                  </span>
                </span>
              )}
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
              Sistema Multi-Agente CAMEL per Sistemi Ridotti Ottimali
            </h2>
            <p className="text-xs text-slate-300 max-w-3xl">
              Ispirato a <code className="text-indigo-300">camel-ai/camel</code>: 5 agenti cooperativi
              (Coordinatore, Scout Walk-Forward, Genetista Bitmask, Architetto Ortogonale 2-Opt e Critico Anti-Massa)
              invocano il motore matematico, confrontano 3 architetture di riduzione e certificano il miglior sistema.
            </p>
          </div>

          <button
            type="button"
            onClick={executeWorkforce}
            disabled={isRunning}
            className={`px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-sm shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer shrink-0 transition-all active:scale-95 ${
              hasPendingChanges ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-950' : ''
            }`}
          >
            <Play className="w-4 h-4 fill-slate-950" />
            <span>
              {isRunning
                ? 'Agenti in Esecuzione...'
                : getBalancedFunnelUiLabels(poolSizeV).recalcButton}
            </span>
          </button>
        </div>

        {/* Workforce Parameters Bar */}
        <div className="pt-3 border-t border-slate-800/80 space-y-3">
          {/* Historical Draws Window Selector (1 to Max Historical, default 200) */}
          <div className="bg-slate-950/90 p-3.5 rounded-xl border border-indigo-500/30 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Estrazioni Storiche da considerare:</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  {historicalDrawsWindow.toLocaleString('it-IT')} / {maxHistoricalDraws.toLocaleString('it-IT')} concorsi
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {getBalancedFunnelUiLabels(poolSizeV).title}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Seleziona da <strong>1</strong> fino al massimo storico (<strong>{maxHistoricalDraws}</strong> estrazioni, default <strong>200</strong>).{' '}
                {getBalancedFunnelUiLabels(poolSizeV).weightsDetail}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap items-center gap-1">
                {[
                  { label: '1', val: 1 },
                  { label: '40', val: 40 },
                  { label: '100', val: 100 },
                  { label: '200', val: 200 },
                  { label: '500', val: 500 },
                  { label: '1000', val: 1000 },
                  { label: `Max (${maxHistoricalDraws})`, val: maxHistoricalDraws }
                ].map((preset) => {
                  const clampedPreset = Math.min(maxHistoricalDraws, Math.max(1, preset.val));
                  const isActive = historicalDrawsWindow === clampedPreset;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setHistoricalDrawsWindow(clampedPreset);
                        markPendingChanges();
                      }}
                      className={`px-2 py-1 rounded text-xs font-mono font-bold cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-indigo-500 text-white font-extrabold shadow'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Range Slider + Exact Number Input (1 .. maxHistoricalDraws) */}
              <div className="flex items-center gap-2 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                <input
                  type="range"
                  min={1}
                  max={Math.max(maxHistoricalDraws, historicalDrawsWindow)}
                  value={historicalDrawsWindow}
                  onChange={(e) => {
                    const nextVal = Math.min(
                      maxHistoricalDraws,
                      Math.max(1, Number(e.target.value) || 1)
                    );
                    setHistoricalDrawsWindow(nextVal);
                    markPendingChanges();
                  }}
                  className="w-24 sm:w-32 accent-indigo-500 cursor-pointer"
                  title="Trascina per scegliere il numero di estrazioni storiche (da 1 al massimo storico)"
                />
                <input
                  type="number"
                  min={1}
                  max={Math.max(maxHistoricalDraws, historicalDrawsWindow)}
                  value={historicalDrawsWindow}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    if (Number.isNaN(raw)) return;
                    const clamped = Math.min(maxHistoricalDraws, Math.max(1, raw));
                    setHistoricalDrawsWindow(clamped);
                    markPendingChanges();
                  }}
                  className="w-16 bg-slate-950 text-amber-300 font-mono font-bold text-xs px-2 py-1 rounded border border-slate-700 text-center focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Pool Size V */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-amber-400" />
                <span>Pool v:</span>
              </span>
              <div className="flex items-center gap-1">
                {[10, 11, 12, 13, 14, 15].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setPoolSizeV(v);
                      markPendingChanges();
                    }}
                    className={`px-2 py-1 rounded text-xs font-mono font-bold cursor-pointer ${
                      poolSizeV === v
                        ? 'bg-amber-500 text-slate-950 font-extrabold'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Budget Selector */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Budget:</span>
              <div className="flex items-center gap-1">
                {[10, 15, 20, 30, 50].map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => {
                      setBudgetEuro(b);
                      markPendingChanges();
                    }}
                    className={`px-2 py-1 rounded text-xs font-mono font-bold cursor-pointer ${
                      budgetEuro === b
                        ? 'bg-amber-500 text-slate-950 font-extrabold'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {b}€
                  </button>
                ))}
              </div>
            </div>

            {/* Coverage Target */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Garanzia:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setLocalCoverageTarget('terni');
                    onUpdateCoverageTarget('terni');
                    markPendingChanges();
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    localCoverageTarget === 'terni'
                      ? 'bg-sky-500 text-slate-950 font-extrabold'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Terni (t=3)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocalCoverageTarget('ambi');
                    onUpdateCoverageTarget('ambi');
                    markPendingChanges();
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    localCoverageTarget === 'ambi'
                      ? 'bg-amber-500 text-slate-950 font-extrabold'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Ambi (t=2)
                </button>
              </div>
            </div>

            {/* Play Mode */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Modalità:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setPlayMode('pure_coverage');
                    markPendingChanges();
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    playMode === 'pure_coverage'
                      ? 'bg-emerald-500 text-slate-950 font-extrabold'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Pura (1€)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlayMode('superstar');
                    markPendingChanges();
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    playMode === 'superstar'
                      ? 'bg-purple-500 text-white font-extrabold'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  ★ SuperStar
                </button>
              </div>
            </div>
          </div>

          {hasPendingChanges && workforceResult && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Parametri modificati: i numeri e le analisi CAMEL attuali restano bloccati per{' '}
                  <strong>{userEmail}</strong> (anche su altri browser o dispositivi) finché non
                  clicchi su <strong>{getBalancedFunnelUiLabels(poolSizeV).recalcButton}</strong>.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {!workforceResult && isSyncingCloud && (
        <div className="bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-8 text-center space-y-2 shadow-lg">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
            <Bot className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="text-base font-bold text-white">
            Sincronizzazione analisi CAMEL dal cloud...
          </h3>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            Recupero degli ultimi numeri bloccati per <strong>{userEmail}</strong> così da
            mantenerli identici su ogni browser, sessione o dispositivo senza rigenerarli.
          </p>
        </div>
      )}

      {!workforceResult && !isSyncingCloud && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center space-y-4 shadow-lg">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-extrabold text-white">
              Nessuna analisi CAMEL generata per {userEmail}
            </h3>
            <p className="text-xs text-slate-400 max-w-xl mx-auto">
              I numeri e le analisi CAMEL non vengono mai rigenerati automaticamente al cambio
              sezione o all&apos;accesso da altri browser/dispositivi. Imposta i parametri qui sopra
              e clicca su <strong>{getBalancedFunnelUiLabels(poolSizeV).recalcButton}</strong> per
              avviare la Workforce e bloccare i risultati nel cloud.
            </p>
          </div>
          <button
            type="button"
            onClick={executeWorkforce}
            disabled={isRunning}
            className="mx-auto px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-sm shadow-xl shadow-amber-500/20 inline-flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
          >
            <Play className="w-4 h-4 fill-slate-950" />
            <span>
              {isRunning
                ? 'Agenti in Esecuzione...'
                : getBalancedFunnelUiLabels(poolSizeV).recalcButton}
            </span>
          </button>
        </div>
      )}

      {workforceResult && (
        <>
          {/* Agent Roster Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {workforceResult.agents.map((ag) => {
              const colors = AGENT_COLOR_CLASSES[ag.id];
              return (
                <div
                  key={ag.id}
                  className={`${colors.bg} border ${colors.border} rounded-xl p-3.5 space-y-2`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-extrabold ${colors.text}`}>{ag.name}</span>
                    <Cpu className={`w-4 h-4 ${colors.text}`} />
                  </div>
                  <p className="text-[11px] font-semibold text-white">{ag.roleTitle}</p>
                  <p className="text-[10px] text-slate-400 line-clamp-3">{ag.inceptionPrompt}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {ag.tools.map((t) => (
                      <span
                        key={t}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-950/90 text-slate-300 border border-slate-800"
                      >
                        fn:{t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Main 2-Column Layout: Left = CAMEL Role-Playing Transcript, Right = 3 Candidate Systems & Champion */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Role-Playing & Tool Call Transcript (5 cols) */}
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Protocollo Role-Playing CAMEL
                  </h3>
                </div>
                <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {workforceResult.totalExecutionTimeMs} ms
                </span>
              </div>

              <div className="space-y-3">
                {workforceResult.dialogueTranscript.map((msg) => {
                  const senderProfile = workforceResult.agents.find((a) => a.id === msg.senderId)!;
                  const receiverProfile = workforceResult.agents.find(
                    (a) => a.id === msg.receiverId
                  )!;
                  const sColor = AGENT_COLOR_CLASSES[msg.senderId];

                  return (
                    <div
                      key={msg.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className={`px-2 py-0.5 rounded font-bold border ${sColor.badge}`}
                          >
                            {senderProfile.name}
                          </span>
                          {msg.senderId !== msg.receiverId && (
                            <>
                              <ArrowRight className="w-3 h-3 text-slate-500" />
                              <span className="text-slate-400 font-semibold">
                                {receiverProfile.name}
                              </span>
                            </>
                          )}
                        </div>
                        {msg.metricsBadge && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-amber-300 border border-slate-800">
                            {msg.metricsBadge}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">{msg.content}</p>

                      {msg.toolCall && (
                        <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] font-mono space-y-0.5">
                          <div className="flex items-center justify-between text-indigo-300">
                            <span>⚡ Tool: {msg.toolCall.toolName}</span>
                            <span className="text-emerald-400">{msg.toolCall.executionMs} ms</span>
                          </div>
                          <div className="text-slate-400 truncate">
                            In: {msg.toolCall.inputSummary}
                          </div>
                          <div className="text-slate-200 truncate">
                            Out: {msg.toolCall.outputSummary}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Candidate Systems Comparison & Selected System Sestine (7 cols) */}
            <div className="lg:col-span-7 space-y-5">
              {/* 3 Candidates Comparison Cards */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Confronto 3 Sistemi Ridotti Generati dagli Agenti
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400">
                    Clicca una strategia per vedere perché sono stati scelti i numeri
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {workforceResult.candidates.map((cand, idx) => {
                    const isWinner = cand.id === workforceResult.winnerCandidate.id;
                    const isSelected = cand.id === activeCandidate?.id;
                    const sb = cand.scoreBreakdown;

                    return (
                      <div
                        key={cand.id}
                        onClick={() => handleSelectCandidate(cand.id)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2.5 flex flex-col justify-between ${
                          isSelected
                            ? 'bg-slate-950 border-amber-400 ring-2 ring-amber-400/20 shadow-lg'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                isWinner
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {isWinner ? '★ Vincitore CAMEL' : `Candidato #${idx + 1}`}
                            </span>
                            <span className="text-sm font-mono font-extrabold text-emerald-400">
                              {cand.camelCompositeScore}/100
                            </span>
                          </div>

                          <div className="text-xs font-bold text-white leading-snug">
                            {cand.strategyName}
                          </div>

                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {cand.strategyOriginDescription}
                          </p>
                        </div>

                        {/* Mini 4-Pillar Score Breakdown inside Card */}
                        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono pt-2 border-t border-slate-800/80">
                          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block">1. Copertura</span>
                            <span className="text-sky-300 font-bold">
                              {sb.coverageScore} / {sb.coverageMax} pt
                            </span>
                          </div>
                          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block">2. Equilibrio Cluster / Estremi</span>
                            <span className="text-amber-300 font-bold">
                              {sb.antiCrowdScore} / {sb.antiCrowdMax} pt
                            </span>
                          </div>
                          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block">3. Storico Reale</span>
                            <span className="text-emerald-300 font-bold">
                              {sb.historicalScore} / {sb.historicalMax} pt
                            </span>
                          </div>
                          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block">4. Monte Carlo</span>
                            <span className="text-purple-300 font-bold">
                              {sb.monteCarloScore} / {sb.monteCarloMax} pt
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Active Candidate Detailed Sestine, Score Breakdown & Pool Reasons */}
              {activeCandidate && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-extrabold text-white">
                          {activeCandidate.strategyName}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Score {activeCandidate.camelCompositeScore}/100
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {activeCandidate.criticVerdict}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleCopyCandidateColumns}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-amber-400" />
                        )}
                        <span>{copied ? 'Copiato!' : 'Copia Sestine'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveCandidateToLedger}
                        className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        {savedSuccess ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <BookmarkPlus className="w-4 h-4" />
                        )}
                        <span>{savedSuccess ? 'Salvato in Bilancio!' : 'Salva Giocata'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleApplyCandidate}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <Sparkles className="w-4 h-4 fill-slate-950" />
                        <span>Applica al Generatore</span>
                      </button>
                    </div>
                  </div>

                  {/* NEW SECTION 1: Detailed 4-Pillar Score Breakdown */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Info className="w-4 h-4 text-amber-400" />
                        Come è stato calcolato il punteggio ({activeCandidate.camelCompositeScore} / 100 pt)
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        Somma di 4 prove matematiche e storiche
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {/* Pillar 1 */}
                      <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-sky-300">1. Copertura Ortogonale</span>
                          <span className="font-mono text-white">
                            {activeCandidate.scoreBreakdown.coverageScore} /{' '}
                            {activeCandidate.scoreBreakdown.coverageMax} pt
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-sky-400 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (activeCandidate.scoreBreakdown.coverageScore /
                                  activeCandidate.scoreBreakdown.coverageMax) *
                                  100
                              )}%`
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {activeCandidate.scoreBreakdown.coverageDetail}
                        </p>
                      </div>

                      {/* Pillar 2 */}
                      <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-amber-300">
                            2. Equilibrio Cluster / Estremi
                          </span>
                          <span className="font-mono text-white">
                            {activeCandidate.scoreBreakdown.antiCrowdScore} /{' '}
                            {activeCandidate.scoreBreakdown.antiCrowdMax} pt
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (activeCandidate.scoreBreakdown.antiCrowdScore /
                                  activeCandidate.scoreBreakdown.antiCrowdMax) *
                                  100
                              )}%`
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {activeCandidate.scoreBreakdown.antiCrowdDetail}
                        </p>
                      </div>

                      {/* Pillar 3 */}
                      <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-emerald-300">
                            3. Vincite Reali su Storico ({workforceResult.historicalDrawsWindow} conc.)
                          </span>
                          <span className="font-mono text-white">
                            {activeCandidate.scoreBreakdown.historicalScore} /{' '}
                            {activeCandidate.scoreBreakdown.historicalMax} pt
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-400 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (activeCandidate.scoreBreakdown.historicalScore /
                                  activeCandidate.scoreBreakdown.historicalMax) *
                                  100
                              )}%`
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {activeCandidate.scoreBreakdown.historicalDetail}
                        </p>
                      </div>

                      {/* Pillar 4 */}
                      <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-purple-300">4. Tenuta Monte Carlo Futura</span>
                          <span className="font-mono text-white">
                            {activeCandidate.scoreBreakdown.monteCarloScore} /{' '}
                            {activeCandidate.scoreBreakdown.monteCarloMax} pt
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-400 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (activeCandidate.scoreBreakdown.monteCarloScore /
                                  activeCandidate.scoreBreakdown.monteCarloMax) *
                                  100
                              )}%`
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {activeCandidate.scoreBreakdown.monteCarloDetail}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* NEW SECTION 2: Why each of the V Pool Numbers was picked */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">
                        Da dove arrivano i {activeCandidate.poolNumbers.length} Numeri di questa Strategia:
                      </span>
                      <span className="text-xs font-mono text-amber-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5" />
                        w₁={activeCandidate.weightsUsed.wDelay.toFixed(2)} • w₂=
                        {activeCandidate.weightsUsed.wFrequency.toFixed(2)} • w₃=
                        {activeCandidate.weightsUsed.wAffinity.toFixed(2)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-[11px] space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-bold text-emerald-300">
                          {getBalancedFunnelUiLabels(activeCandidate.poolNumbers.length).subtitle}
                        </span>
                        {activeCandidate.chaosNumbersInjected && activeCandidate.chaosNumbersInjected.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
                            <span className="text-amber-300 font-semibold">
                              5 Caos Iniettati: [{activeCandidate.chaosNumbersInjected.join(', ')}]
                            </span>
                            {activeCandidate.chaosNumbersInjected.map((cNum) => {
                              const survived = activeCandidate.poolNumbers.includes(cNum);
                              return (
                                <span
                                  key={cNum}
                                  className={`px-1.5 py-0.5 rounded border font-bold ${
                                    survived
                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                      : 'bg-slate-900 text-slate-500 border-slate-800'
                                  }`}
                                  title={
                                    survived
                                      ? `Numero Caos ${cNum} sopravvissuto nella selezione finale dei ${activeCandidate.poolNumbers.length} numeri`
                                      : `Numero Caos ${cNum} scartato nell'imbuto 30→${activeCandidate.poolNumbers.length}`
                                  }
                                >
                                  {survived ? `★${cNum}` : cNum}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <p className="text-slate-300">
                        {activeCandidate.strategyOriginDescription}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {getBalancedFunnelUiLabels(activeCandidate.poolNumbers.length).weightsDetail}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {activeCandidate.poolReasons.map((pr) => (
                        <div
                          key={pr.number}
                          className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/90 flex items-start gap-2.5"
                          title={pr.explanation}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-mono font-extrabold text-xs flex items-center justify-center shrink-0 shadow">
                            {pr.number}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <span
                              className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                TAG_COLOR_BADGE[pr.tagColor]
                              }`}
                            >
                              {pr.primaryTag}
                            </span>
                            <div className="text-[10px] font-mono text-slate-300 leading-tight">
                              Freq(36): <strong>{pr.frequencyK}</strong> • Rit:{' '}
                              <strong>
                                {pr.currentDelay}/{pr.maxHistoricalDelay}
                              </strong>{' '}
                              • Spia: <strong>{Math.round(pr.affinityScore * 100)}%</strong>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sestine Grid */}
                  <div className="space-y-2">
                    <GenerationDateNote
                      generatedAt={lastGeneratedAt}
                      subject="Sestine CAMEL generate"
                      regenerateLabel={getBalancedFunnelUiLabels(poolSizeV).recalcButton}
                      testId="camel-generated-at"
                    />
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Sestine Ridotte Generate ({activeCandidate.systemResult.columns.length} Colonne):
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {activeCandidate.systemResult.columns.map((col) => (
                        <div
                          key={col.id}
                          className="p-3 rounded-xl bg-slate-950 border border-slate-800/90 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-slate-400 w-7">
                              #{String(col.id).padStart(2, '0')}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {col.numbers.map((n) => (
                                <span
                                  key={n}
                                  className="w-7 h-7 rounded-lg bg-slate-900 border border-amber-500/30 text-amber-300 font-mono font-extrabold text-xs flex items-center justify-center"
                                >
                                  {n}
                                </span>
                              ))}
                              {col.superstar !== undefined && (
                                <span
                                  className="px-1.5 py-1 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 font-mono font-extrabold text-xs"
                                  title="SuperStar"
                                >
                                  ★{col.superstar}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-[10px] font-mono text-slate-400 text-right">
                            <div>Σ={col.sum}</div>
                            <div>
                              P/D {col.evens}/{col.odds}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Audit Metrics Footer */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">
                        Copertura Terni (t=3)
                      </span>
                      <span className="text-sm font-mono font-bold text-sky-400">
                        {activeCandidate.systemResult.coverageMetrics.tripletsCoveredCount} /{' '}
                        {activeCandidate.systemResult.coverageMetrics.tripletsTotalInPool}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">
                        Copertura Ambi (t=2)
                      </span>
                      <span className="text-sm font-mono font-bold text-amber-400">
                        {activeCandidate.systemResult.coverageMetrics.pairsCoveredCount} /{' '}
                        {activeCandidate.systemResult.coverageMetrics.pairsTotalInPool}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">
                        Terni / Quaterne Storiche
                      </span>
                      <span className="text-sm font-mono font-bold text-emerald-400">
                        {activeCandidate.historicalBacktest.tierCounts.points3} Terni •{' '}
                        {activeCandidate.historicalBacktest.tierCounts.points4} Quat.
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">
                        Sestine Zero-Penalità
                      </span>
                      <span className="text-sm font-mono font-bold text-white flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        {Math.round(activeCandidate.zeroPenaltyColumnsRatio * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
