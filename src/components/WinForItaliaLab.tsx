/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Crosshair,
  RefreshCw,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Dices,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Layers,
  Copy,
  BookmarkCheck,
  Clock,
  Award,
  TrendingUp,
  Grid,
  ShieldCheck,
  Lock
} from 'lucide-react';
import { SavedPlay } from '../types/lottery';
import {
  WinForItaliaDraw,
  WinForItaliaRankedSestina,
  WinForItaliaPlayMode,
  UserWinForItaliaRecord,
  WIN_FOR_ITALIA_PRIZES,
  WIN_FOR_ITALIA_UI_LABELS,
  WIN_FOR_ITALIA_REDUCED3_UI_LABELS,
  loadWinForItaliaDraws,
  insertWinForItaliaDraw,
  parseWinForItaliaManualInput,
  syncWinForItaliaDrawsFromServer,
  calculateWinForItaliaStats,
  runWinForItaliaFunnel40To12,
  selectSniperSestinaFromTop12,
  generateReduced3Columns,
  runWinForItaliaWeeklyMonteCarlo
} from '../utils/winForItalia';
import {
  loadUserWinForItaliaState,
  cacheUserWinForItaliaStateLocally,
  saveUserWinForItaliaState,
  syncUserWinForItaliaState,
  getUserWinForItaliaStorageKey
} from '../utils/storage';
import { subscribeCloudUserWinForItalia } from '../utils/firebase';

interface WinForItaliaLabProps {
  userEmail: string;
  onSavePlay: (play: SavedPlay) => void;
  draws?: WinForItaliaDraw[];
  onUpdateDraws?: (draws: WinForItaliaDraw[]) => void;
}

const DECADE_LABELS: Record<number, string> = {
  0: 'Decina 1–10',
  1: 'Decina 11–20',
  2: 'Decina 21–30',
  3: 'Decina 31–40'
};

const WFI_PLAY_MODE_STORAGE_KEY = 'winforitalia_play_mode_v1';

export const WinForItaliaLab: React.FC<WinForItaliaLabProps> = ({
  userEmail,
  onSavePlay,
  draws: externalDraws,
  onUpdateDraws
}) => {
  const [localHistory, setLocalHistory] = useState<WinForItaliaDraw[]>(() => loadWinForItaliaDraws());
  const history = externalDraws && externalDraws.length > 0 ? externalDraws : localHistory;
  const updateHistory = (nextDraws: WinForItaliaDraw[]) => {
    setLocalHistory(nextDraws);
    if (onUpdateDraws) {
      onUpdateDraws(nextDraws);
    }
  };

  // Load existing persisted per-user Win for Italia / Win for Life state (if any)
  const initialSavedRecord = useMemo(
    () => loadUserWinForItaliaState(userEmail),
    [userEmail]
  );

  // Locked state: funnel + sniper sestine + reduced 3 sestine.
  // NEVER auto-generates on mount, tab switch, new draws sync, or across browsers/devices.
  // Changes ONLY when the user explicitly clicks the button to create/recalculate sestine.
  const [lockedState, setLockedState] = useState<UserWinForItaliaRecord | null>(
    () => initialSavedRecord ?? null
  );
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(() => !initialSavedRecord);

  // Mode Switcher: 'sniper' (2,00 € - 1 Sestina) | 'reduced3' (6,00 € - 3 Sestine su 9 numeri)
  const [playMode, setPlayMode] = useState<WinForItaliaPlayMode>(() => {
    if (initialSavedRecord?.playMode) return initialSavedRecord.playMode;
    try {
      const saved = localStorage.getItem(WFI_PLAY_MODE_STORAGE_KEY);
      if (saved === 'reduced3' || saved === 'sniper') return saved;
    } catch {
      // Ignore
    }
    return 'sniper';
  });

  const lastAppliedTimeRef = useRef<number>(
    initialSavedRecord ? new Date(initialSavedRecord.updatedAt || 0).getTime() : 0
  );

  const applySavedRecordToState = (rec: UserWinForItaliaRecord) => {
    const recTime = new Date(rec.updatedAt || 0).getTime();
    lastAppliedTimeRef.current = Number.isFinite(recTime) ? recTime : Date.now();
    setLockedState(rec);
    setPlayMode(rec.playMode);
    try {
      localStorage.setItem(WFI_PLAY_MODE_STORAGE_KEY, rec.playMode);
    } catch {
      // Ignore
    }
  };

  // Synchronize this user's locked Win for Italia state across LocalStorage, Server, and Cloud Firestore
  useEffect(() => {
    let active = true;
    const localRec = loadUserWinForItaliaState(userEmail);

    if (localRec) {
      applySavedRecordToState(localRec);
      setIsSyncingCloud(false);
    } else {
      lastAppliedTimeRef.current = 0;
      setIsSyncingCloud(true);
    }

    syncUserWinForItaliaState(userEmail)
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

    const unsubCloud = subscribeCloudUserWinForItalia(userEmail, (cloudRec) => {
      if (!active || !cloudRec) return;
      const cloudTime = new Date(cloudRec.updatedAt || 0).getTime();
      if (lastAppliedTimeRef.current === 0 || cloudTime > lastAppliedTimeRef.current) {
        cacheUserWinForItaliaStateLocally(cloudRec);
        applySavedRecordToState(cloudRec);
        setIsSyncingCloud(false);
      }
    });

    const storageKey = getUserWinForItaliaStorageKey(userEmail);
    const handleStorageEvent = (e: StorageEvent) => {
      if (!active) return;
      if (e.key && e.key !== storageKey) return;
      const updatedLocal = loadUserWinForItaliaState(userEmail);
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

  const handleSelectPlayMode = (nextMode: WinForItaliaPlayMode) => {
    setPlayMode(nextMode);
    try {
      localStorage.setItem(WFI_PLAY_MODE_STORAGE_KEY, nextMode);
    } catch {
      // Ignore
    }
    // Switching view mode never changes any locked numbers; only updates the view preference locally
    if (lockedState) {
      const updatedLocal: UserWinForItaliaRecord = {
        ...lockedState,
        playMode: nextMode
      };
      setLockedState(updatedLocal);
      cacheUserWinForItaliaStateLocally(updatedLocal);
    }
  };

  const [simSeed, setSimSeed] = useState<number>(2026040);

  // Sync & Rapid manual insertion state
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState<string>('');
  const [manualDate, setManualDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [manualFeedback, setManualFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Expandable drawer for Alternatives #2 and #3 (Cecchino mode)
  const [isAlternativesOpen, setIsAlternativesOpen] = useState<boolean>(false);
  const [copiedRank, setCopiedRank] = useState<number | 'all3' | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // 1. Dynamic Historical Window: Math.min(history.length, 50) (used for archive stats and ONLY when user clicks Create Sestina)
  const { windowSize, stats } = useMemo(() => {
    return calculateWinForItaliaStats(history);
  }, [history]);

  // 2. Explicit generation ONLY when the user chooses to create/recalculate sestine
  const handleCreateOrRecalculateSestina = () => {
    const generatedFunnel = runWinForItaliaFunnel40To12(stats, Math.random);
    const generatedSniper = selectSniperSestinaFromTop12(generatedFunnel.top12Numbers, stats);
    const generatedReduced3 = generateReduced3Columns(generatedFunnel.top9Numbers, stats);
    const nowIso = new Date().toISOString();

    const newRecord: UserWinForItaliaRecord = {
      userEmail: userEmail.trim().toLowerCase(),
      updatedAt: nowIso,
      playMode,
      latestDrawIdAtGeneration: history[0]?.id || '',
      windowSizeAtGeneration: windowSize,
      funnelResult: generatedFunnel,
      sniperSelection: generatedSniper,
      reduced3System: generatedReduced3
    };

    lastAppliedTimeRef.current = new Date(nowIso).getTime();
    setLockedState(newRecord);
    setIsSyncingCloud(false);
    saveUserWinForItaliaState(newRecord);
  };

  const funnelResult = lockedState?.funnelResult ?? null;
  const sniperSelection = lockedState?.sniperSelection ?? null;
  const reduced3System = lockedState?.reduced3System ?? null;

  const hasNewerDrawSinceGeneration = Boolean(
    lockedState &&
      history[0]?.id &&
      lockedState.latestDrawIdAtGeneration &&
      history[0].id !== lockedState.latestDrawIdAtGeneration
  );

  // 4. Dynamic Monte Carlo "Settimana Tipo" (7 Estrazioni = 14,00 € in sniper mode, 42,00 € in reduced3 mode)
  const monteCarloWeekly = useMemo(() => {
    if (!sniperSelection || !reduced3System) return null;
    const columnsToTest =
      playMode === 'reduced3'
        ? reduced3System.columns.map((c) => [...c.numbers])
        : sniperSelection.primarySestina.numbers;
    return runWinForItaliaWeeklyMonteCarlo(columnsToTest, 50000, simSeed);
  }, [playMode, reduced3System, sniperSelection, simSeed]);

  const chaosSet = useMemo(
    () => new Set(funnelResult ? funnelResult.chaos3 : []),
    [funnelResult]
  );
  const activePoolNumbers = useMemo(() => {
    if (!funnelResult) return [];
    return playMode === 'reduced3' ? funnelResult.top9Numbers : funnelResult.top12Numbers;
  }, [funnelResult, playMode]);
  const activeDecadeDist = useMemo<Record<number, number>>(() => {
    if (!funnelResult) return { 0: 0, 1: 0, 2: 0, 3: 0 };
    return playMode === 'reduced3'
      ? funnelResult.decadeDistributionTop9
      : funnelResult.decadeDistributionTop12;
  }, [funnelResult, playMode]);
  const activeUiLabels =
    playMode === 'reduced3' ? WIN_FOR_ITALIA_REDUCED3_UI_LABELS : WIN_FOR_ITALIA_UI_LABELS;

  const survivedChaos = useMemo(
    () => activePoolNumbers.filter((n) => chaosSet.has(n)),
    [activePoolNumbers, chaosSet]
  );

  const activePoolEvenCount = useMemo(
    () => activePoolNumbers.filter((n) => n % 2 === 0).length,
    [activePoolNumbers]
  );
  const activePoolOddCount = activePoolNumbers.length - activePoolEvenCount;

  // Set of all numbers played in current mode for highlighting in recent archive draws
  const playedNumbersSet = useMemo(() => {
    if (!funnelResult || !sniperSelection) return new Set<number>();
    if (playMode === 'reduced3') {
      return new Set(funnelResult.top9Numbers);
    }
    return new Set(sniperSelection.primarySestina.numbers);
  }, [playMode, funnelResult, sniperSelection]);

  const handleSyncOfficial2000 = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await syncWinForItaliaDrawsFromServer();
      updateHistory(res.draws);
      if (res.addedOrUpdated > 0) {
        setSyncMessage(
          `Archivio aggiornato: +${res.addedOrUpdated} nuove estrazioni (ultima: ${res.latestDate} ore 20:00).`
        );
      } else {
        setSyncMessage(
          `Archivio già allineato all'ultima estrazione disponibile (${res.latestDate} ore 20:00 • ${res.draws.length} concorsi).`
        );
      }
    } catch {
      setSyncMessage('Sincronizzazione completata con archivio locale JSON.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualInsertSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualFeedback(null);
    const parsed = parseWinForItaliaManualInput(manualInput, history, manualDate);
    if (parsed.error || !parsed.draw) {
      setManualFeedback({
        type: 'error',
        text: parsed.error || 'Formato non valido.'
      });
      return;
    }

    const updated = insertWinForItaliaDraw(parsed.draw);
    updateHistory(updated);
    setManualInput('');
    setManualFeedback({
      type: 'success',
      text: `Estrazione ${parsed.draw.id} (${parsed.draw.date} ore 20:00) [${parsed.draw.numbers.join(', ')}] salvata in localStorage e unita all'archivio!`
    });
  };

  const handleCopySestina = (sestina: WinForItaliaRankedSestina) => {
    const text = sestina.numbers.map((n) => String(n).padStart(2, '0')).join(' - ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedRank(sestina.rank);
    setTimeout(() => setCopiedRank(null), 2000);
  };

  const handleCopyAll3Sestine = () => {
    if (!reduced3System) return;
    const lines = reduced3System.columns.map(
      (col, idx) =>
        `#${String(idx + 1).padStart(2, '0')}: ${col.numbers
          .map((n) => String(n).padStart(2, '0'))
          .join(' - ')} (Σ ${col.sum} • ${col.evenCount}P/${col.oddCount}D)`
    );
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedRank('all3');
    setTimeout(() => setCopiedRank(null), 2200);
  };

  const handleRegisterSestinaPlay = (sestina: WinForItaliaRankedSestina) => {
    if (!funnelResult) return;
    const latestDraw = history[0];
    const nextContestNum = (latestDraw?.contestNumber || 1) + 1;
    const year = latestDraw?.year || new Date().getFullYear();

    const newPlay: SavedPlay = {
      id: `play-wfi-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId: `WFI-${year}-${String(nextContestNum).padStart(3, '0')}`,
      mode: 'manual',
      savedAmount: 0,
      manualNote: `Win for Italia Team (6/40) — Sestina Cecchino #${sestina.rank} (2,00 €)`,
      poolNumbers: funnelResult.top12Numbers,
      columns: [
        {
          id: sestina.rank,
          numbers: [...sestina.numbers],
          sum: sestina.sum,
          evens: sestina.evenCount,
          odds: sestina.oddCount,
          lows: sestina.numbers.filter((n) => n <= 20).length,
          highs: sestina.numbers.filter((n) => n >= 21).length
        }
      ],
      cost: 2.0,
      status: 'IN_ATTESA'
    };

    onSavePlay(newPlay);
    setSavedToast(
      `Sestina #${sestina.rank} [${sestina.numbers.join(', ')}] registrata in Verifica & Bilancio (Budget 2,00 €).`
    );
    setTimeout(() => setSavedToast(null), 4000);
  };

  const handleRegisterReduced3Play = () => {
    if (!reduced3System) return;
    const latestDraw = history[0];
    const nextContestNum = (latestDraw?.contestNumber || 1) + 1;
    const year = latestDraw?.year || new Date().getFullYear();

    const newPlay: SavedPlay = {
      id: `play-wfi-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId: `WFI-${year}-${String(nextContestNum).padStart(3, '0')}`,
      mode: 'manual',
      savedAmount: 0,
      manualNote: `Win for Italia Team (6/40) — Sistema Ridotto 3 Sestine su 9 Numeri (6,00 € • Copertura 2x Simmetrica)`,
      poolNumbers: [...reduced3System.top9Numbers],
      columns: reduced3System.columns.map((col, idx) => ({
        id: idx + 1,
        numbers: [...col.numbers],
        sum: col.sum,
        evens: col.evenCount,
        odds: col.oddCount,
        lows: col.numbers.filter((n) => n <= 20).length,
        highs: col.numbers.filter((n) => n >= 21).length
      })),
      cost: 6.0,
      status: 'IN_ATTESA'
    };

    onSavePlay(newPlay);
    setSavedToast(
      `Sistema Ridotto 3 Sestine (Pool 9: [${reduced3System.top9Numbers.join(', ')}]) registrato in Verifica & Bilancio (Budget 6,00 €).`
    );
    setTimeout(() => setSavedToast(null), 4000);
  };

  const renderNumberBadge = (
    num: number,
    size: 'lg' | 'md' | 'sm' = 'lg',
    freqBadge?: number
  ) => {
    const isExtreme = num <= 8 || num >= 33;
    const isChaos = chaosSet.has(num);

    const sizeClasses =
      size === 'lg'
        ? 'w-12 h-12 sm:w-14 sm:h-14 text-base sm:text-lg'
        : size === 'md'
        ? 'w-10 h-10 text-sm'
        : 'w-8 h-8 text-xs';

    return (
      <div
        key={num}
        className={`relative rounded-2xl font-mono font-black flex items-center justify-center border shadow-md transition-transform ${sizeClasses} ${
          isExtreme
            ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 border-emerald-300 shadow-emerald-500/20'
            : 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 border-amber-300 shadow-amber-500/20'
        }`}
        title={`${num <= 8 || num >= 33 ? 'Fascia Estrema (1–8 / 33–40)' : 'Fascia Centrale'} • Decina ${
          DECADE_LABELS[Math.floor((num - 1) / 10)]
        }${isChaos ? ' • Numero Caos Sopravvissuto' : ''}${
          freqBadge ? ` • Presenza: ${freqBadge}x nelle 3 sestine` : ''
        }`}
      >
        <span>{String(num).padStart(2, '0')}</span>
        {isChaos && (
          <span
            className="absolute -top-1.5 -right-1.5 px-1 py-0.2 rounded bg-purple-600 text-[9px] font-extrabold text-white border border-purple-300 shadow"
            title="Iniettato dal Caos (3 numeri casuali)"
          >
            ⚡
          </span>
        )}
        {typeof freqBadge === 'number' && (
          <span
            className="absolute -bottom-1.5 -right-1.5 px-1 py-0.2 rounded bg-slate-950 text-[9px] font-mono font-black text-emerald-300 border border-emerald-400/60 shadow"
            title={`Compare ${freqBadge} volte nel sistema da 3 sestine`}
          >
            {freqBadge}x
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Banner: Win for Italia Team (6/40) with Mode Switcher */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
                {playMode === 'sniper' ? (
                  <>
                    <Crosshair className="w-3.5 h-3.5" />
                    Modalità Cecchino 6/40
                  </>
                ) : (
                  <>
                    <Grid className="w-3.5 h-3.5" />
                    Sistema Ridotto 6/40 (3 Sestine)
                  </>
                )}
              </span>
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                data-testid="wfi-active-budget-badge"
              >
                {playMode === 'sniper'
                  ? 'Budget: 2,00 € (1 Sestina Secca)'
                  : 'Budget: 6,00 € (3 Sestine • Copertura 2x)'}
              </span>
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                data-testid="wfi-dynamic-window-badge"
              >
                Finestra Dinamica: {windowSize}/50 Estrazioni
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono text-slate-300 bg-slate-800/90 border border-slate-700 flex items-center gap-1">
                <Clock className="w-3 h-3 text-emerald-400" />
                Auto-Sync GitHub Actions: 02:00 UTC
              </span>
              {lockedState && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
                  data-testid="wfi-locked-badge"
                >
                  <Lock className="w-3 h-3" />
                  <span>
                    Bloccato per {userEmail}
                    {lockedState.updatedAt
                      ? ` • ${new Date(lockedState.updatedAt).toLocaleString('it-IT', {
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

            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Win for Italia Team (6/40) &mdash; {activeUiLabels.title}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Estrazione quotidiana ore <strong className="text-white">20:00</strong> (6 numeri su 40, senza Jolly/SuperStar).{' '}
              {playMode === 'sniper' ? (
                <>
                  Imbuto a competizione pura{' '}
                  <strong className="text-emerald-300">
                    40 &rarr; 16 (13 Gen + 3 Caos) &rarr; 12 &rarr; 1 Sestina
                  </strong>{' '}
                  con valutazione integrale delle <strong className="text-amber-300">C(12,6) = 924</strong> combinazioni.
                </>
              ) : (
                <>
                  Pipeline dedicata{' '}
                  <strong className="text-emerald-300">
                    40 &rarr; 16 (13 Gen + 3 Caos) &rarr; 9 &rarr; 3 Colonne
                  </strong>{' '}
                  su <strong className="text-amber-300">C(9,6) = 84</strong> combinazioni con{' '}
                  <strong className="text-teal-300">Copertura 2x Simmetrica</strong> (ogni numero compare esattamente 2 volte: 9 &times; 2 = 18).
                </>
              )}
            </p>
          </div>

          {/* Manual Sync & Explicit Create/Recalc Sestina Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleSyncOfficial2000}
              disabled={isSyncing}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizzazione...' : 'Sincronizza Estrazione 20:00'}</span>
            </button>

            <button
              type="button"
              onClick={handleCreateOrRecalculateSestina}
              data-testid="wfi-recalc-funnel-btn"
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {lockedState
                  ? playMode === 'sniper'
                    ? 'Crea Nuova Sestina (40→12→1)'
                    : 'Crea Nuove 3 Sestine (40→9→3)'
                  : playMode === 'sniper'
                  ? 'Crea Sestina (40→12→1)'
                  : 'Crea 3 Sestine (40→9→3)'}
              </span>
            </button>
          </div>
        </div>

        {hasNewerDrawSinceGeneration && (
          <div className="mt-3 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Nuova estrazione disponibile in archivio (<strong>{history[0]?.id}</strong>): i numeri
              e le sestine attuali restano bloccati per <strong>{userEmail}</strong> e cambieranno
              solo se scegli di cliccare su{' '}
              <strong>
                {playMode === 'sniper'
                  ? 'Crea Nuova Sestina (40→12→1)'
                  : 'Crea Nuove 3 Sestine (40→9→3)'}
              </strong>
              .
            </span>
          </div>
        )}

        {/* Mode Switcher Bar: Cecchino 2,00 € vs Sistema Ridotto 6,00 € */}
        <div
          className="mt-4 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          data-testid="wfi-mode-switcher"
        >
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            Seleziona Modalità di Gioco (6/40):
          </span>

          <div className="inline-flex rounded-xl bg-slate-950/90 p-1 border border-slate-800 gap-1">
            <button
              type="button"
              data-testid="wfi-mode-sniper"
              onClick={() => handleSelectPlayMode('sniper')}
              className={`px-3.5 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                playMode === 'sniper'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Cecchino &middot; 2,00 &euro; (1 Sestina)</span>
            </button>

            <button
              type="button"
              data-testid="wfi-mode-reduced3"
              onClick={() => handleSelectPlayMode('reduced3')}
              className={`px-3.5 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                playMode === 'reduced3'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Sistema Ridotto &middot; 6,00 &euro; (3 Sestine)</span>
            </button>
          </div>
        </div>

        {syncMessage && (
          <div className="mt-3 px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}

        {/* Rapid Manual Fallback Input (6 comma-separated numbers 1..40) */}
        <form
          onSubmit={handleManualInsertSubmit}
          className="mt-4 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300 shrink-0">
            <PlusCircle className="w-4 h-4 text-amber-400" />
            <label htmlFor="wfi-manual-numbers">Fallback Rapido (6 numeri 1&ndash;40):</label>
          </div>

          <input
            id="wfi-manual-numbers"
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Es. 4, 11, 18, 25, 34, 39 (separati da virgola)"
            className="flex-1 px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-700 text-xs text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
          />

          <input
            type="date"
            aria-label="Data estrazione Win for Italia Team"
            value={manualDate}
            onChange={(e) => setManualDate(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950/90 border border-slate-700 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-400"
          />

          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition-all cursor-pointer shrink-0"
          >
            Aggiungi Estrazione 6/40
          </button>
        </form>

        {manualFeedback && (
          <div
            className={`mt-2.5 px-3.5 py-2 rounded-xl text-xs flex items-center gap-2 border ${
              manualFeedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            {manualFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{manualFeedback.text}</span>
          </div>
        )}
      </div>

      {savedToast && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{savedToast}</span>
        </div>
      )}

      {/* Main Grid: Left = Active Play Card + Monte Carlo; Right = Imbuto 40 -> 16 -> 12/9 + Archive */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols */}
        <div className="lg:col-span-7 space-y-5">
          {!lockedState && isSyncingCloud && (
            <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-2 shadow-lg">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                <Lock className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="text-base font-bold text-white">
                Sincronizzazione sestine Win for Italia dal cloud...
              </h3>
              <p className="text-xs text-slate-400 max-w-lg mx-auto">
                Recupero degli ultimi numeri bloccati per <strong>{userEmail}</strong> così da
                mantenerli identici su ogni browser, sessione o dispositivo senza rigenerarli.
              </p>
            </div>
          )}

          {!lockedState && !isSyncingCloud && (
            <div
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center space-y-4 shadow-lg"
              data-testid="wfi-empty-state"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <Lock className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-white">
                  Nessuna sestina Win for Italia ancora creata per {userEmail}
                </h3>
                <p className="text-xs text-slate-400 max-w-xl mx-auto">
                  I numeri e le sestine Win for Life / Win for Italia (6/40) non vengono mai
                  generati o cambiati automaticamente al cambio sezione, all&apos;arrivo di nuove
                  estrazioni o su altri browser/dispositivi. Cambiano solo quando scegli di creare
                  una nuova sestina.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateOrRecalculateSestina}
                className="mx-auto px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-sm shadow-xl shadow-amber-500/20 inline-flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {playMode === 'sniper'
                    ? 'Crea Sestina (40→12→1)'
                    : 'Crea 3 Sestine (40→9→3)'}
                </span>
              </button>
            </div>
          )}

          {lockedState && funnelResult && sniperSelection && reduced3System && monteCarloWeekly && (
            <>
              {playMode === 'sniper' ? (
            /* MODE 1: Cecchino — 2,00 € (1 Sestina) */
            <div
              className="bg-slate-900/95 border-2 border-emerald-500/40 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden"
              data-testid="wfi-sniper-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-wider">
                      Sestina #1 &bull; Cecchino Top 1 / {sniperSelection.totalCombinationsEvaluated}
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-300">
                      Score: {sniperSelection.primarySestina.totalScore} pt
                    </span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-black text-white mt-1">
                    Sestina #1 da Giocare &mdash; Costo Schedina:{' '}
                    <span className="text-amber-400">2,00 &euro;</span>
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopySestina(sniperSelection.primarySestina)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-amber-400" />
                    <span>{copiedRank === 1 ? 'Copiata!' : 'Copia'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRegisterSestinaPlay(sniperSelection.primarySestina)}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer"
                  >
                    <BookmarkCheck className="w-4 h-4" />
                    <span>Registra in Verifica (2,00 €)</span>
                  </button>
                </div>
              </div>

              {/* 6 Numbers display */}
              <div
                className="py-6 flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4"
                data-testid="wfi-primary-sestina-numbers"
              >
                {sniperSelection.primarySestina.numbers.map((num) => renderNumberBadge(num, 'lg'))}
              </div>

              {/* Structural Metrics Bar for Sestina #1 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-3 border-t border-slate-800/80 text-xs">
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Somma (95&ndash;150)
                  </span>
                  <span className="font-mono font-black text-sm text-emerald-300">
                    &Sigma; {sniperSelection.primarySestina.sum}
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Pari / Dispari
                  </span>
                  <span className="font-mono font-black text-sm text-amber-300">
                    {sniperSelection.primarySestina.evenCount}P / {sniperSelection.primarySestina.oddCount}D
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Estremi (1-8 / 33-40)
                  </span>
                  <span className="font-mono font-black text-sm text-teal-300">
                    {sniperSelection.primarySestina.extremesCount} presenze
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Cluster &amp; Contigui
                  </span>
                  <span className="font-mono font-black text-sm text-indigo-300">
                    {sniperSelection.primarySestina.adjacentPairsCount} cont. &bull;{' '}
                    {sniperSelection.primarySestina.sameDecadePairsCount} ambi dec.
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Decine (Max 3)
                  </span>
                  <span className="font-mono font-black text-sm text-slate-200">
                    [{sniperSelection.primarySestina.decadeCounts.join('-')}] (max{' '}
                    {sniperSelection.primarySestina.maxPerDecade})
                  </span>
                </div>
              </div>

              {/* Expandable Drawer for Alternatives #2 and #3 */}
              <div className="mt-5 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  aria-expanded={isAlternativesOpen}
                  onClick={() => setIsAlternativesOpen((prev) => !prev)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-xs font-bold text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span>
                      Alternative Sestina #2 e #3 (dalle {sniperSelection.totalCombinationsEvaluated} combinazioni C(12,6))
                    </span>
                  </span>
                  {isAlternativesOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {isAlternativesOpen && (
                  <div className="mt-3 space-y-3" data-testid="wfi-alternatives-drawer">
                    {[sniperSelection.alternative2, sniperSelection.alternative3].map((alt) => (
                      <div
                        key={alt.rank}
                        className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-mono font-bold text-[11px]">
                              Alternativa #{alt.rank}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              Score: {alt.totalScore} pt &bull; &Sigma; {alt.sum} &bull; {alt.evenCount}P/{alt.oddCount}D &bull; Estremi: {alt.extremesCount}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {alt.numbers.map((n) => renderNumberBadge(n, 'md'))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => handleCopySestina(alt)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
                          >
                            {copiedRank === alt.rank ? 'Copiata!' : 'Copia'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRegisterSestinaPlay(alt)}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold cursor-pointer"
                          >
                            Gioca #{alt.rank} (2€)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* MODE 2: Sistema Ridotto — 6,00 € (3 Sestine su 9 Numeri con Copertura 2x Simmetrica) */
            <div
              className="bg-slate-900/95 border-2 border-amber-500/40 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden space-y-5"
              data-testid="wfi-reduced3-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-amber-500 text-slate-950 font-black text-[11px] uppercase tracking-wider">
                      Sistema Ridotto C(9,6) &rarr; 3 Colonne
                    </span>
                    <span
                      className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-extrabold text-[11px] flex items-center gap-1"
                      data-testid="wfi-symmetric-2x-badge"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Copertura 2x Simmetrica (9 &times; 2 = 18)
                    </span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-black text-white">
                    3 Sestine Ridotte (#01, #02, #03) &mdash; Costo Totale:{' '}
                    <span className="text-amber-400">6,00 &euro;</span>
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="wfi-copy-3-sestine-btn"
                    onClick={handleCopyAll3Sestine}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-amber-400" />
                    <span>{copiedRank === 'all3' ? '3 Sestine Copiate!' : 'Copia 3 Sestine'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="wfi-register-3-sestine-btn"
                    onClick={handleRegisterReduced3Play}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer"
                  >
                    <BookmarkCheck className="w-4 h-4" />
                    <span>Registra 3 Sestine (6,00 €)</span>
                  </button>
                </div>
              </div>

              {/* 3 Reduced Columns List */}
              <div className="space-y-3" data-testid="wfi-reduced3-columns-list">
                {reduced3System.columns.map((col, idx) => {
                  const colLabel = `#${String(idx + 1).padStart(2, '0')}`;
                  const lows = col.lowCount ?? col.numbers.filter((n) => n <= 20).length;
                  const highs = col.highCount ?? 6 - lows;
                  return (
                    <div
                      key={col.rank}
                      data-testid={`wfi-reduced-col-${idx + 1}`}
                      className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-amber-500/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-black text-sm">
                          {colLabel}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {col.numbers.map((num) => renderNumberBadge(num, 'md'))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono self-end sm:self-center">
                        <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-emerald-300 font-bold">
                          &Sigma; {col.sum}
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-amber-300 font-bold">
                          P/D {col.evenCount}/{col.oddCount}
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-indigo-300 font-bold">
                          B/A {lows}/{highs}
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-teal-300 font-bold">
                          Est: {col.extremesCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopySestina(col)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-sans font-bold cursor-pointer"
                        >
                          {copiedRank === col.rank ? 'Copiata!' : 'Copia'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mathematical Coverage Summary Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Bilanciamento Presenze (Top 9)
                  </span>
                  <span className="font-mono font-black text-sm text-emerald-300">
                    {reduced3System.isPerfect2x
                      ? '9/9 Numeri presenti esattamente 2x'
                      : 'Copertura Bilanciata 18/18'}
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Copertura Ambi su Top 9
                  </span>
                  <span className="font-mono font-black text-sm text-amber-300">
                    {reduced3System.uniquePairsCovered} / {reduced3System.totalPairsInTop9} coppie (
                    {Math.round(
                      (reduced3System.uniquePairsCovered / reduced3System.totalPairsInTop9) * 100
                    )}
                    %)
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Copertura Terni su Top 9
                  </span>
                  <span className="font-mono font-black text-sm text-indigo-300">
                    {reduced3System.uniqueTripletsCovered} / {reduced3System.totalTripletsInTop9} terne (
                    {Math.round(
                      (reduced3System.uniqueTripletsCovered / reduced3System.totalTripletsInTop9) *
                        100
                    )}
                    %)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Simulatore Monte Carlo "Settimana Tipo" Dinamico (14,00 € vs 42,00 €) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <Dices className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
                    Simulatore Monte Carlo &ldquo;Settimana Tipo&rdquo; (7 Estrazioni &bull; 50.000 Concorsi)
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {playMode === 'sniper' ? (
                    <>
                      Motore bitmask a 40 bit sulla Sestina #1 [
                      {sniperSelection.primarySestina.numbers.join(', ')}] &bull; Ciclo 7 giorni ={' '}
                      <strong className="text-white">14,00 &euro;</strong> spesi ({monteCarloWeekly.executionTimeMs} ms)
                    </>
                  ) : (
                    <>
                      Motore bitmask a 40 bit sulle <strong className="text-amber-300">3 Sestine Ridotte</strong> in simultanea (somma vincite multiple nella stessa serata) &bull; Ciclo 7 giorni ={' '}
                      <strong className="text-white">42,00 &euro;</strong> spesi ({monteCarloWeekly.executionTimeMs} ms)
                    </>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSimSeed((s) => s + 101)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 self-start sm:self-center cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                <span>Nuovo Seme 50k</span>
              </button>
            </div>

            {/* Key Weekly & Single Evening Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[11px] text-slate-400 font-bold block">
                  Spesa Ciclo 7 Giorni (7 &times; {monteCarloWeekly.ticketCost.toFixed(2).replace('.', ',')} €)
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  <span
                    className="text-lg font-mono font-black text-white"
                    data-testid="wfi-mc-weekly-cost"
                  >
                    {monteCarloWeekly.weeklyCost.toFixed(2).replace('.', ',')} &euro;
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400">
                    Ritorno medio: {monteCarloWeekly.averageWeeklyPayout.toFixed(2)} &euro;/sett.
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30">
                <span className="text-[11px] text-slate-400 font-bold block">
                  Tasso Medio Recupero (ROI %)
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  <span
                    className="text-lg font-mono font-black text-emerald-400"
                    data-testid="wfi-mc-recovery-rate"
                  >
                    {monteCarloWeekly.averageWeeklyRecoveryRatePct}%
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Settimana attiva: {monteCarloWeekly.probAtLeastOneWinPerWeekPct}%
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30">
                <span className="text-[11px] text-slate-400 font-bold block">
                  Prob. Serata &ge;1 Punto 2 (2,00 €)
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  <span
                    className="text-lg font-mono font-black text-amber-300"
                    data-testid="wfi-mc-evening-p2"
                  >
                    {monteCarloWeekly.probAtLeastOnePunto2PerDrawPct}% / sera
                  </span>
                  <span
                    className="text-[11px] font-mono text-slate-400"
                    data-testid="wfi-mc-punto2-freq"
                  >
                    {monteCarloWeekly.expectedPunto2PerWeek} P.2/sett. ({monteCarloWeekly.probAtLeastOnePunto2PerWeekPct}% sett.)
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-indigo-500/30">
                <span className="text-[11px] text-slate-400 font-bold block">
                  Prob. Serata &ge;1 Punto 3 (8,00 €)
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  <span
                    className="text-lg font-mono font-black text-indigo-300"
                    data-testid="wfi-mc-evening-p3"
                  >
                    {monteCarloWeekly.probAtLeastOnePunto3PerDrawPct}% / sera
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Prob. 7gg &ge;1 P.3: {monteCarloWeekly.probAtLeastOnePunto3PerWeekPct}%
                  </span>
                </div>
              </div>
            </div>

            {/* Prize Breakdown Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                    <th className="py-2 pr-2">Categoria</th>
                    <th className="py-2 px-2">Premio Ufficiale</th>
                    <th className="py-2 px-2">Vincite su 50.000</th>
                    <th className="py-2 px-2">Frequenza Media</th>
                    <th className="py-2 pl-2 text-right">Totale Incassato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  <tr>
                    <td className="py-2 pr-2 font-bold text-amber-300">Punto 2 (Rimborso)</td>
                    <td className="py-2 px-2">{WIN_FOR_ITALIA_PRIZES.PUNTO_2.toFixed(2)} &euro;</td>
                    <td className="py-2 px-2">{monteCarloWeekly.hitsByCategory.punto2}</td>
                    <td className="py-2 px-2">
                      1 ogni{' '}
                      {Math.max(
                        1,
                        Math.round(50000 / Math.max(1, monteCarloWeekly.hitsByCategory.punto2))
                      )}{' '}
                      estr.
                    </td>
                    <td className="py-2 pl-2 text-right text-slate-200">
                      {monteCarloWeekly.payoutByCategory.punto2.toLocaleString('it-IT', {
                        minimumFractionDigits: 2
                      })}{' '}
                      &euro;
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 font-bold text-emerald-300">Punto 3</td>
                    <td className="py-2 px-2">{WIN_FOR_ITALIA_PRIZES.PUNTO_3.toFixed(2)} &euro;</td>
                    <td className="py-2 px-2">{monteCarloWeekly.hitsByCategory.punto3}</td>
                    <td className="py-2 px-2">
                      1 ogni{' '}
                      {Math.max(
                        1,
                        Math.round(50000 / Math.max(1, monteCarloWeekly.hitsByCategory.punto3))
                      )}{' '}
                      estr.
                    </td>
                    <td className="py-2 pl-2 text-right text-slate-200">
                      {monteCarloWeekly.payoutByCategory.punto3.toLocaleString('it-IT', {
                        minimumFractionDigits: 2
                      })}{' '}
                      &euro;
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 font-bold text-teal-300">Punto 4</td>
                    <td className="py-2 px-2">{WIN_FOR_ITALIA_PRIZES.PUNTO_4.toFixed(2)} &euro;</td>
                    <td className="py-2 px-2">{monteCarloWeekly.hitsByCategory.punto4}</td>
                    <td className="py-2 px-2">
                      {monteCarloWeekly.hitsByCategory.punto4 > 0
                        ? `1 ogni ${Math.round(50000 / monteCarloWeekly.hitsByCategory.punto4)} estr.`
                        : '—'}
                    </td>
                    <td className="py-2 pl-2 text-right text-slate-200">
                      {monteCarloWeekly.payoutByCategory.punto4.toLocaleString('it-IT', {
                        minimumFractionDigits: 2
                      })}{' '}
                      &euro;
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 font-bold text-indigo-300">Punto 5</td>
                    <td className="py-2 px-2">{WIN_FOR_ITALIA_PRIZES.PUNTO_5.toFixed(2)} &euro;</td>
                    <td className="py-2 px-2">{monteCarloWeekly.hitsByCategory.punto5}</td>
                    <td className="py-2 px-2">
                      {monteCarloWeekly.hitsByCategory.punto5 > 0
                        ? `1 ogni ${Math.round(50000 / monteCarloWeekly.hitsByCategory.punto5)} estr.`
                        : '—'}
                    </td>
                    <td className="py-2 pl-2 text-right text-slate-200">
                      {monteCarloWeekly.payoutByCategory.punto5.toLocaleString('it-IT', {
                        minimumFractionDigits: 2
                      })}{' '}
                      &euro;
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 font-bold text-rose-300">Punto 6 (Jackpot)</td>
                    <td className="py-2 px-2">
                      {WIN_FOR_ITALIA_PRIZES.PUNTO_6.toLocaleString('it-IT', {
                        minimumFractionDigits: 2
                      })}{' '}
                      &euro;
                    </td>
                    <td className="py-2 px-2">{monteCarloWeekly.hitsByCategory.punto6}</td>
                    <td className="py-2 px-2">P = 1 / 3.838.380</td>
                    <td className="py-2 pl-2 text-right text-slate-200">
                      {monteCarloWeekly.payoutByCategory.punto6.toLocaleString('it-IT', {
                        minimumFractionDigits: 2
                      })}{' '}
                      &euro;
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
            </>
          )}
        </div>

        {/* Right 5 cols: Imbuto Bilanciato 40 -> 16 (13 Gen + 3 Caos) -> 12 or 9 */}
        <div className="lg:col-span-5 space-y-5">
          {funnelResult && reduced3System && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                <h3
                  className="text-sm font-extrabold text-white uppercase tracking-wide"
                  data-testid="wfi-pool-base-heading"
                >
                  {playMode === 'sniper'
                    ? 'Pool Base (12 Numeri • 40 → 16 → 12)'
                    : 'Pool Base (9 Numeri • 40 → 16 → 9)'}
                </h3>
              </div>
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                data-testid="wfi-pool-short-badge"
              >
                {activeUiLabels.shortBadge}
              </span>
            </div>

            {/* Unified Balanced Funnel Description Box */}
            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-emerald-500/25 space-y-1.5 text-xs">
              <div className="font-extrabold text-emerald-300">{activeUiLabels.subtitle}</div>
              <div className="font-mono text-amber-300 text-[11px]">
                3 Caos Iniettati (1&ndash;40): [{funnelResult.chaos3.join(', ')}] &bull; Sopravvissuti nei Top{' '}
                {activePoolNumbers.length}:{' '}
                {survivedChaos.length > 0 ? `[${survivedChaos.join(', ')}]` : 'Nessuno'}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {activeUiLabels.weightsDetail}
              </p>
            </div>

            {/* Top 12 or Top 9 Selected Pool Badges */}
            <div>
              <div className="flex flex-col gap-1 text-xs text-slate-400 mb-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-[11px] text-slate-200">
                    {playMode === 'sniper'
                      ? 'Top 12 Qualificati per C(12,6) = 924'
                      : 'Top 9 Qualificati per C(9,6) = 84 (2x ciascuno)'}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-amber-300 font-bold"
                    data-testid="wfi-pool-parity-ratio"
                  >
                    Equilibrio P/D: {activePoolEvenCount}P / {activePoolOddCount}D
                  </span>
                </div>
                <span className="font-mono text-[11px] text-emerald-300">
                  Decine (Max 3): [1-10: {activeDecadeDist[0] || 0} &bull; 11-20:{' '}
                  {activeDecadeDist[1] || 0} &bull; 21-30: {activeDecadeDist[2] || 0} &bull; 31-40:{' '}
                  {activeDecadeDist[3] || 0}]
                </span>
              </div>
              <div
                className={`grid ${playMode === 'reduced3' ? 'grid-cols-9' : 'grid-cols-6'} gap-2`}
                data-testid="wfi-active-pool-numbers"
              >
                {activePoolNumbers.map((num) =>
                  renderNumberBadge(
                    num,
                    'md',
                    playMode === 'reduced3' ? reduced3System.numberFrequencies[num] : undefined
                  )
                )}
              </div>
            </div>

            {/* Detailed Table of the 16 Candidates in Competition */}
            <div className="pt-3 border-t border-slate-800">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2 flex items-center justify-between">
                <span>Classifica Competizione Pura (16 Candidati)</span>
                <span className="text-slate-500 font-mono">Verde = Estremi 1-8/33-40</span>
              </div>
              <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
                {funnelResult.scoredPool16.map((item, idx) => {
                  const isSelected =
                    playMode === 'reduced3' ? Boolean(item.selectedInTop9) : item.selectedInTop12;
                  return (
                    <div
                      key={item.num}
                      className={`px-3 py-1.5 rounded-xl border text-xs flex items-center justify-between ${
                        isSelected
                          ? 'bg-slate-950/90 border-slate-800 text-slate-200'
                          : 'bg-slate-950/40 border-slate-900 text-slate-500 line-through'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-500 w-4">
                          #{idx + 1}
                        </span>
                        <span
                          className={`w-6 h-6 rounded-lg font-mono font-black text-xs flex items-center justify-center ${
                            item.isExtreme
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {String(item.num).padStart(2, '0')}
                        </span>
                        <span className="text-[11px] font-mono">
                          {item.isChaos ? '⚡ Caos' : '🧬 Gen'} &bull; Dec.{item.decade + 1} &bull;{' '}
                          {item.num % 2 === 0 ? 'P' : 'D'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-slate-400">
                          Cl:+{item.clusterBonus}
                          {item.extremeBonus > 0 ? ` Est:+${item.extremeBonus}` : ''}
                          {item.isolationPenalty < 0 ? ` Pen:${item.isolationPenalty}` : ''}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold ${
                            item.totalFunnelScore >= 40
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {item.totalFunnelScore >= 0
                            ? `+${item.totalFunnelScore}`
                            : item.totalFunnelScore}{' '}
                          pt
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          )}

          {/* Archive Preview: Ultimi Concorsi Win for Italia Team (6/40) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-extrabold text-white uppercase tracking-wide">
                  Ultime Estrazioni 6/40 (Ore 20:00)
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Totale archivio: {history.length}
              </span>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {history.slice(0, 10).map((draw) => (
                <div
                  key={draw.id}
                  className="px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-slate-200 block">
                      {draw.date} &bull; #{draw.contestNumber}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {draw.id} ({draw.time || '20:00'})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {draw.numbers.map((n) => {
                      const inActivePlay = playedNumbersSet.has(n);
                      return (
                        <span
                          key={n}
                          className={`w-7 h-7 rounded-lg font-mono font-bold text-xs flex items-center justify-center border ${
                            inActivePlay
                              ? 'bg-emerald-500 text-slate-950 border-emerald-300 font-black'
                              : 'bg-slate-900 text-slate-200 border-slate-700'
                          }`}
                          title={
                            inActivePlay
                              ? playMode === 'sniper'
                                ? 'Presente nella Sestina #1 Cecchino'
                                : 'Presente nel Pool Top 9 del Sistema Ridotto'
                              : undefined
                          }
                        >
                          {String(n).padStart(2, '0')}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                Top Frequenti ({windowSize} estr.):{' '}
                <strong className="text-slate-200 font-mono">
                  {stats
                    .slice()
                    .sort((a, b) => b.frequencyWindow - a.frequencyWindow)
                    .slice(0, 4)
                    .map((s) => `${s.number} (${s.frequencyWindow})`)
                    .join(', ')}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
