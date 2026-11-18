/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  History,
  Upload,
  Search,
  Sparkles,
  RotateCcw,
  RefreshCw,
  Calendar,
  FileSpreadsheet,
  FileJson,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Clock,
  Activity,
  GitBranch,
  Dices,
  Dna,
  Trophy,
  TrendingUp,
  TrendingDown,
  Euro,
  Calculator,
  Check,
  BookmarkPlus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Layers,
  Crosshair,
  PlusCircle,
  AlertCircle
} from 'lucide-react';
import { Draw, SavedPlay, GeneratedColumn } from '../types/lottery';
import {
  exportBackupJSON,
  exportDrawsCSV,
  importBackupJSON,
  importDrawsCSV,
  syncOfficialDrawsFromLiveFeed
} from '../utils/storage';
import { generateFullHistoricalDataset } from '../data/seedDraws';
import {
  compareSavedPlayAgainstRecentDraws,
  clampArchiveComparisonDrawsCount,
  MIN_ARCHIVE_COMPARISON_DRAWS,
  MAX_ARCHIVE_COMPARISON_DRAWS,
  PRESET_ARCHIVE_COMPARISON_COUNTS,
  SavedPlayArchiveComparisonSummary
} from '../utils/combinatorics';
import {
  WinForItaliaDraw,
  loadWinForItaliaDraws,
  insertWinForItaliaDraw,
  parseWinForItaliaManualInput,
  syncWinForItaliaDrawsFromServer,
  isWinForItaliaPlay,
  compareSavedPlayAgainstWinForItaliaDraws
} from '../utils/winForItalia';

interface HistoricalArchiveProps {
  draws: Draw[];
  onUpdateDraws: (draws: Draw[]) => void;
  winForItaliaDraws?: WinForItaliaDraw[];
  onUpdateWinForItaliaDraws?: (draws: WinForItaliaDraw[]) => void;
  onOpenSmartPaste: () => void;
  savedPlays?: SavedPlay[];
  weeklyColumns?: GeneratedColumn[];
  onSavePlay?: (play: SavedPlay) => void;
  onOpenLedgerTab?: () => void;
}

export const HistoricalArchive: React.FC<HistoricalArchiveProps> = ({
  draws,
  onUpdateDraws,
  winForItaliaDraws: externalWfiDraws,
  onUpdateWinForItaliaDraws,
  onOpenSmartPaste,
  savedPlays = [],
  weeklyColumns = [],
  onSavePlay,
  onOpenLedgerTab
}) => {
  const [localWfiDraws, setLocalWfiDraws] = useState<WinForItaliaDraw[]>(() =>
    loadWinForItaliaDraws()
  );
  const wfiDraws =
    externalWfiDraws && externalWfiDraws.length > 0 ? externalWfiDraws : localWfiDraws;

  const updateWfiDraws = (nextWfi: WinForItaliaDraw[]) => {
    setLocalWfiDraws(nextWfi);
    if (onUpdateWinForItaliaDraws) {
      onUpdateWinForItaliaDraws(nextWfi);
    }
  };

  // Top-level Archive Switcher: 'superenalotto' (6/90) vs 'winforitalia' (Win for Italia Team / Win for Life 6/40)
  const [archiveGameMode, setArchiveGameMode] = useState<'superenalotto' | 'winforitalia'>(
    'superenalotto'
  );

  // Win for Italia Team / Win for Life (6/40) manual entry & search state
  const [wfiSearchTerm, setWfiSearchTerm] = useState<string>('');
  const [wfiPage, setWfiPage] = useState<number>(1);
  const [wfiManualInput, setWfiManualInput] = useState<string>('');
  const [wfiManualDate, setWfiManualDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [wfiManualError, setWfiManualError] = useState<string | null>(null);
  const [isSyncingWfi, setIsSyncingWfi] = useState<boolean>(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | 'ALL'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [isSyncingFeed, setIsSyncingFeed] = useState(false);
  const [showHowUsedGuide, setShowHowUsedGuide] = useState(false);
  const pageSize = 15;

  // --- State for Play vs Last 10-200 Draws Comparison ---
  const [selectedPlayId, setSelectedPlayId] = useState<string>(() =>
    savedPlays.length > 0 ? savedPlays[0].id : 'ALL_SAVED_PLAYS'
  );
  const [comparisonGameMode, setComparisonGameMode] = useState<'superenalotto' | 'winforitalia'>(
    'superenalotto'
  );
  const [comparisonDrawsCount, setComparisonDrawsCount] = useState<number>(50);
  const [customDrawsInput, setCustomDrawsInput] = useState<string>('50');
  const [comparisonFilter, setComparisonFilter] = useState<'all' | 'winning' | 'matched'>('all');
  const [comparisonPage, setComparisonPage] = useState<number>(1);
  const [expandedContestId, setExpandedContestId] = useState<string | null>(null);
  const [showPlayColumnsPreview, setShowPlayColumnsPreview] = useState<boolean>(false);
  const comparisonPageSize = 10;

  // Keep selectedPlayId valid when savedPlays list updates
  useEffect(() => {
    if (savedPlays.length === 0) return;
    if (
      selectedPlayId !== 'ALL_SAVED_PLAYS' &&
      !savedPlays.some((p) => p.id === selectedPlayId)
    ) {
      setSelectedPlayId(savedPlays[0].id);
    }
  }, [savedPlays, selectedPlayId]);

  // Build the active SavedPlay object to evaluate (either single selected play or combined plays from Verifica & Bilancio)
  const activePlayForComparison = useMemo<SavedPlay | null>(() => {
    if (savedPlays.length === 0) return null;
    if (selectedPlayId === 'ALL_SAVED_PLAYS') {
      const allCols: GeneratedColumn[] = [];
      const poolSet = new Set<number>();
      let totalCost = 0;
      let totalSaved = 0;
      let colIdx = 1;
      for (const p of savedPlays) {
        totalCost += p.cost;
        totalSaved += p.savedAmount || 0;
        for (const n of p.poolNumbers || []) poolSet.add(n);
        for (const c of p.columns) {
          for (const n of c.numbers) poolSet.add(n);
          allCols.push({
            ...c,
            id: colIdx++
          });
        }
      }
      return {
        id: 'ALL_SAVED_PLAYS',
        createdAt: savedPlays[0].createdAt,
        targetContestId: 'Tutte le Giocate',
        mode: 'manual',
        cost: Number(totalCost.toFixed(2)),
        savedAmount: Number(totalSaved.toFixed(2)),
        poolNumbers: Array.from(poolSet).sort((a, b) => a - b),
        columns: allCols,
        status: 'VERIFICATA',
        manualNote: `Unione di tutte le ${savedPlays.length} giocate registrate in Verifica & Bilancio`
      };
    }
    return savedPlays.find((p) => p.id === selectedPlayId) || savedPlays[0];
  }, [savedPlays, selectedPlayId]);

  // Automatically sync comparisonGameMode when selecting a Win for Italia Team play or switching archiveGameMode
  useEffect(() => {
    if (activePlayForComparison && selectedPlayId !== 'ALL_SAVED_PLAYS') {
      if (isWinForItaliaPlay(activePlayForComparison)) {
        setComparisonGameMode('winforitalia');
      } else {
        setComparisonGameMode('superenalotto');
      }
    }
  }, [activePlayForComparison?.id, selectedPlayId]);

  // Execute the comparison against the latest N (10..200) official draws of the selected game
  const comparisonSummary = useMemo<SavedPlayArchiveComparisonSummary | null>(() => {
    if (!activePlayForComparison) return null;
    if (comparisonGameMode === 'winforitalia') {
      if (wfiDraws.length === 0) return null;
      return compareSavedPlayAgainstWinForItaliaDraws(
        activePlayForComparison,
        wfiDraws,
        comparisonDrawsCount
      );
    }
    if (draws.length === 0) return null;
    return compareSavedPlayAgainstRecentDraws(
      activePlayForComparison,
      draws,
      comparisonDrawsCount
    );
  }, [activePlayForComparison, draws, wfiDraws, comparisonDrawsCount, comparisonGameMode]);

  const activePlayNumbersSet = useMemo(() => {
    return new Set<number>(comparisonSummary?.playNumbersSet || []);
  }, [comparisonSummary]);

  const activePlaySuperstarsSet = useMemo(() => {
    return new Set<number>(comparisonSummary?.playSuperstarsSet || []);
  }, [comparisonSummary]);

  const filteredComparisonRows = useMemo(() => {
    if (!comparisonSummary) return [];
    if (comparisonFilter === 'winning') {
      return comparisonSummary.rows.filter((r) => r.grossWinForDraw > 0);
    }
    if (comparisonFilter === 'matched') {
      return comparisonSummary.rows.filter(
        (r) => r.matchedNumbersInPlay.length > 0 || r.superstarMatchedInPlay
      );
    }
    return comparisonSummary.rows;
  }, [comparisonSummary, comparisonFilter]);

  const totalComparisonPages = Math.max(
    1,
    Math.ceil(filteredComparisonRows.length / comparisonPageSize)
  );

  const paginatedComparisonRows = useMemo(() => {
    const start = (comparisonPage - 1) * comparisonPageSize;
    return filteredComparisonRows.slice(start, start + comparisonPageSize);
  }, [filteredComparisonRows, comparisonPage]);

  const handleSelectComparisonDrawsCount = (val: number) => {
    const clamped = clampArchiveComparisonDrawsCount(val);
    setComparisonDrawsCount(clamped);
    setCustomDrawsInput(String(clamped));
    setComparisonPage(1);
  };

  const handleQuickRegisterCurrentSystem = () => {
    if (!onSavePlay || weeklyColumns.length === 0) return;
    const latest = draws[0];
    const targetContestNumber = latest ? latest.contestNumber + 1 : 46;
    const targetYear = latest ? latest.year : 2026;
    const targetId = `${targetYear}-${String(targetContestNumber).padStart(3, '0')}`;
    const poolSet = new Set<number>();
    for (const c of weeklyColumns) {
      for (const n of c.numbers) poolSet.add(n);
    }
    const hasStar = weeklyColumns.some((c) => c.superstar !== undefined);
    const cost = Number((weeklyColumns.length * (hasStar ? 1.5 : 1.0)).toFixed(2));

    const newPlay: SavedPlay = {
      id: `play-archive-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId: targetId,
      mode: hasStar ? 'superstar' : 'pure_coverage',
      cost,
      savedAmount: 0,
      poolNumbers: Array.from(poolSet).sort((a, b) => a - b),
      columns: weeklyColumns,
      status: 'IN_ATTESA',
      manualNote: `Sistema Ottimizzato (${weeklyColumns.length} sestine)`
    };
    onSavePlay(newPlay);
    setSelectedPlayId(newPlay.id);
    showNotice('Sistema attuale registrato in Verifica & Bilancio e selezionato per il confronto!');
  };

  // Filtered Win for Italia Team / Win for Life (6/40) Draws
  const filteredWfiDraws = useMemo(() => {
    if (!wfiSearchTerm.trim()) return wfiDraws;
    const term = wfiSearchTerm.toLowerCase().trim();
    const termNum = parseInt(term, 10);
    return wfiDraws.filter((d) => {
      if (d.id.toLowerCase().includes(term)) return true;
      if (d.date.includes(term)) return true;
      if (!Number.isNaN(termNum) && d.numbers.includes(termNum)) return true;
      return false;
    });
  }, [wfiDraws, wfiSearchTerm]);

  const totalWfiPages = Math.max(1, Math.ceil(filteredWfiDraws.length / pageSize));
  const currentWfiDraws = useMemo(() => {
    const start = (wfiPage - 1) * pageSize;
    return filteredWfiDraws.slice(start, start + pageSize);
  }, [filteredWfiDraws, wfiPage, pageSize]);

  const handleSyncWfiArchive = async () => {
    setIsSyncingWfi(true);
    try {
      const res = await syncWinForItaliaDrawsFromServer();
      updateWfiDraws(res.draws);
      showNotice(
        `Archivio Win for Italia Team / Win for Life (6/40) sincronizzato: ${res.draws.length} estrazioni (ultima: ${res.latestDate} ore 20:00)`
      );
    } catch {
      showNotice('Archivio Win for Italia Team (6/40) già allineato al database locale.');
    } finally {
      setIsSyncingWfi(false);
    }
  };

  const handleWfiManualInsert = (e: React.FormEvent) => {
    e.preventDefault();
    setWfiManualError(null);
    const parsed = parseWinForItaliaManualInput(wfiManualInput, wfiDraws, wfiManualDate);
    if (parsed.error || !parsed.draw) {
      setWfiManualError(parsed.error || 'Sestina 6/40 non valida.');
      return;
    }
    const updated = insertWinForItaliaDraw(parsed.draw);
    updateWfiDraws(updated);
    setWfiManualInput('');
    showNotice(
      `Estrazione Win for Italia / Win for Life ${parsed.draw.id} (${parsed.draw.date} ore 20:00) [${parsed.draw.numbers.join(', ')}] salvata nell'archivio!`
    );
  };

  const handleExportWfiJSON = () => {
    const jsonStr = JSON.stringify({ game: 'Win for Italia Team (6/40)', draws: wfiDraws }, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `winforitalia_6_40_archivio_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice('Archivio JSON Win for Italia Team / Win for Life (6/40) esportato con successo');
  };

  const handleExportWfiCSV = () => {
    const header = 'Concorso,Anno,Data,Ora,N1,N2,N3,N4,N5,N6\n';
    const body = wfiDraws
      .map(
        (d) =>
          `${d.id},${d.year},${d.date},${d.time || '20:00'},${d.numbers.join(',')}`
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `winforitalia_6_40_archivio_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice('Archivio CSV Win for Italia Team / Win for Life (6/40) esportato con successo');
  };

  // Extract distinct years sorted descending (2026 down to 2009)
  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    for (const d of draws) {
      yearsSet.add(d.year);
    }
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [draws]);

  const minYear = availableYears.length > 0 ? availableYears[availableYears.length - 1] : 2009;
  const maxYear = availableYears.length > 0 ? availableYears[0] : 2026;
  const latestDraw = draws[0];
  const oldestDraw = draws[draws.length - 1];

  const filteredDraws = useMemo(() => {
    return draws.filter((d) => {
      if (selectedYear !== 'ALL' && d.year !== selectedYear) {
        return false;
      }
      if (!searchTerm.trim()) return true;

      const term = searchTerm.toLowerCase().trim();
      const termNumber = parseInt(term, 10);

      if (d.id.toLowerCase().includes(term)) return true;
      if (d.date.includes(term)) return true;
      if (!isNaN(termNumber)) {
        if (d.numbers.includes(termNumber)) return true;
        if (d.jolly === termNumber) return true;
        if (d.superstar === termNumber) return true;
        if (d.contestNumber === termNumber) return true;
      }
      return false;
    });
  }, [draws, searchTerm, selectedYear]);

  const totalPages = Math.ceil(filteredDraws.length / pageSize) || 1;
  const currentDraws = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredDraws.slice(start, start + pageSize);
  }, [filteredDraws, currentPage, pageSize]);

  // Handle JSON export
  const handleExportJSON = () => {
    const jsonStr = exportBackupJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `superenalotto_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice('Backup JSON (2009-2026) scaricato con successo');
  };

  // Handle CSV export
  const handleExportCSV = () => {
    const csvStr = exportDrawsCSV();
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `superenalotto_archivio_2009_2026_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice('Archivio CSV completo (2009-2026) scaricato con successo');
  };

  // Handle JSON import
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const res = importBackupJSON(content);
        showNotice(`Importati ${res.importedDraws} concorsi e ${res.importedPlays} giocate`);
        window.location.reload();
      } catch {
        showNotice("Errore durante l'importazione del file JSON");
      }
    };
    reader.readAsText(file);
  };

  // Handle CSV import
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const count = importDrawsCSV(content);
        showNotice(`Importati ${count} concorsi da CSV`);
        window.location.reload();
      } catch {
        showNotice("Errore durante l'importazione del CSV");
      }
    };
    reader.readAsText(file);
  };

  // Sync live from Official Open-Data Feed
  const handleSyncLiveFeed = async () => {
    setIsSyncingFeed(true);
    try {
      const res = await syncOfficialDrawsFromLiveFeed();
      onUpdateDraws(res.draws);
      showNotice(
        `Archivio ufficiale sincronizzato: ${res.draws.length} concorsi reali fino al ${res.latestDate}`
      );
    } catch {
      showNotice("Archivio locale già aggiornato all'ultima estrazione disponibile");
    } finally {
      setIsSyncingFeed(false);
    }
  };

  // Reset to full fresh historical dataset (2009 - 2026)
  const handleReplenishArchive = () => {
    const full = generateFullHistoricalDataset();
    onUpdateDraws(full);
    setSelectedYear('ALL');
    setCurrentPage(1);
    showNotice(`Archivio storico ufficiale 2009–2026 ripristinato (${full.length} concorsi)`);
  };

  const showNotice = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  return (
    <div className="space-y-5">
      {/* ===================================================================== */}
      {/* TOP-LEVEL ARCHIVE SWITCHER: SUPERENALOTTO (6/90) vs WIN FOR ITALIA / WIN FOR LIFE (6/40) */}
      {/* ===================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <History className="w-4 h-4 text-amber-400" />
            <span>Seleziona Archivio Estrazioni da Consultare:</span>
          </span>
          <p className="text-[11px] text-slate-400">
            Passa tra l&apos;archivio storico <strong className="text-amber-300">SuperEnalotto (6/90)</strong> e l&apos;archivio giornaliero <strong className="text-emerald-300">Win for Italia Team / Win for Life (6/40 • Ore 20:00)</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="archive-switch-superenalotto"
            onClick={() => {
              setArchiveGameMode('superenalotto');
              setComparisonGameMode('superenalotto');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-2 border ${
              archiveGameMode === 'superenalotto'
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 border-amber-300 shadow-lg shadow-amber-500/20'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white hover:border-amber-500/40'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Archivio SuperEnalotto (6/90 • {draws.length.toLocaleString('it-IT')} Concorsi)</span>
          </button>

          <button
            type="button"
            data-testid="archive-switch-winforitalia"
            onClick={() => {
              setArchiveGameMode('winforitalia');
              setComparisonGameMode('winforitalia');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-2 border ${
              archiveGameMode === 'winforitalia'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 border-emerald-300 shadow-lg shadow-emerald-500/20'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white hover:border-emerald-500/40'
            }`}
          >
            <Crosshair className="w-4 h-4" />
            <span>Archivio Win for Italia / Win for Life (6/40 • {wfiDraws.length} Estr. Ore 20:00)</span>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* NEW FEATURE: CONFRONTO GIOCATE (VERIFICA & BILANCIO) SU 10-200 ESTRAZIONI */}
      {/* ===================================================================== */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 border-2 border-amber-500/40 rounded-2xl p-5 shadow-xl space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-amber-500 text-slate-950 flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5" />
                <span>Simulatore Storico Giocate Registrate</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Finestra Mobile: da {MIN_ARCHIVE_COMPARISON_DRAWS} a {MAX_ARCHIVE_COMPARISON_DRAWS}{' '}
                Estrazioni Reali
              </span>
            </div>
            <h2 className="text-lg md:text-xl font-extrabold text-white">
              Confronta Giocate di &ldquo;Verifica &amp; Bilancio&rdquo; sulle Ultime Estrazioni (10 &ndash; 200)
            </h2>
            <p className="text-xs text-slate-400">
              Seleziona una giocata salvata in <strong className="text-slate-200">Verifica &amp; Bilancio</strong>,
              scegli l&apos;archivio (<strong className="text-amber-300">SuperEnalotto 6/90</strong> o{' '}
              <strong className="text-emerald-300">Win for Italia / Win for Life 6/40</strong>) e visualizza i numeri
              estratti evidenziati insieme a <strong className="text-white">Spesa Totale</strong>,{' '}
              <strong className="text-emerald-300">Utile Lordo</strong> e{' '}
              <strong className="text-amber-300">Utile Netto</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {weeklyColumns.length > 0 && onSavePlay && (
              <button
                type="button"
                onClick={handleQuickRegisterCurrentSystem}
                className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                title="Salva il sistema ottimizzato attuale in Verifica & Bilancio e confrontalo subito"
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>Importa Sistema Attuale ({weeklyColumns.length} col.)</span>
              </button>
            )}
            {onOpenLedgerTab && (
              <button
                type="button"
                onClick={onOpenLedgerTab}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 text-amber-400" />
                <span>Gestisci in Verifica &amp; Bilancio</span>
              </button>
            )}
          </div>
        </div>

        {/* Controls Row: 1) Choose Play from Verifica & Bilancio  2) Choose 10..200 Draws */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Play Selector (6 cols) */}
          <div className="lg:col-span-6 bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <label
              htmlFor="archive-play-select"
              className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-amber-400" />
                <span>1. Scegli Giocata da Verifica &amp; Bilancio:</span>
              </span>
              <span className="font-mono text-amber-400">
                {savedPlays.length}{' '}
                {savedPlays.length === 1 ? 'giocata disponibile' : 'giocate disponibili'}
              </span>
            </label>

            {savedPlays.length > 0 ? (
              <div className="space-y-2">
                <select
                  id="archive-play-select"
                  value={selectedPlayId}
                  onChange={(e) => {
                    setSelectedPlayId(e.target.value);
                    setComparisonPage(1);
                    setExpandedContestId(null);
                  }}
                  className="w-full rounded-xl bg-slate-900 border border-amber-500/40 px-3.5 py-2.5 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {savedPlays.map((p, idx) => {
                    const dateFormatted = new Date(p.createdAt).toLocaleDateString('it-IT');
                    const isWfi = isWinForItaliaPlay(p);
                    const gameTag = isWfi ? 'Win for Italia 6/40' : 'SuperEnalotto 6/90';
                    return (
                      <option key={p.id} value={p.id}>
                        #{idx + 1} • [{gameTag}] Concorso {p.targetContestId} ({dateFormatted}) —{' '}
                        {p.columns.length} {p.columns.length === 1 ? 'sestina' : 'sestine'} • Costo{' '}
                        {p.cost.toFixed(2).replace('.', ',')} €
                        {p.manualNote ? ` — ${p.manualNote}` : ''}
                      </option>
                    );
                  })}
                  {savedPlays.length > 1 && (
                    <option value="ALL_SAVED_PLAYS">
                      ★ Tutte le {savedPlays.length} giocate registrate in Verifica &amp; Bilancio
                    </option>
                  )}
                </select>

                {/* Archive Game Selector for Comparison */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-slate-400 font-semibold">
                    Archivio di Confronto:
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setComparisonGameMode('superenalotto');
                        setComparisonPage(1);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${
                        comparisonGameMode === 'superenalotto'
                          ? 'bg-amber-500 text-slate-950 border-amber-300'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      SuperEnalotto (6/90)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComparisonGameMode('winforitalia');
                        setComparisonPage(1);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${
                        comparisonGameMode === 'winforitalia'
                          ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      Win for Italia / Win for Life (6/40)
                    </button>
                  </div>
                </div>

                {activePlayForComparison && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-1">
                    <span>
                      Sestine nella giocata:{' '}
                      <strong className="text-white font-mono">
                        {activePlayForComparison.columns.length}
                      </strong>{' '}
                      &bull; Costo per singolo concorso:{' '}
                      <strong className="text-amber-300 font-mono">
                        {activePlayForComparison.cost.toFixed(2).replace('.', ',')} €
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPlayColumnsPreview((prev) => !prev)}
                      className="text-amber-300 hover:text-amber-200 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <span>
                        {showPlayColumnsPreview ? 'Nascondi Sestine Giocata' : 'Mostra Sestine Giocata'}
                      </span>
                      {showPlayColumnsPreview ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-amber-500/30 text-xs text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-amber-300">
                    Nessuna giocata ancora presente in &ldquo;Verifica &amp; Bilancio&rdquo;
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Clicca su &ldquo;Importa Sistema Attuale&rdquo; qui sopra oppure registra una
                    schedina nella scheda Verifica &amp; Bilancio per avviare il confronto storico.
                  </p>
                </div>
                {weeklyColumns.length > 0 && onSavePlay && (
                  <button
                    type="button"
                    onClick={handleQuickRegisterCurrentSystem}
                    className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs shrink-0 cursor-pointer"
                  >
                    Registra e Confronta Ora
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right: Draw Count Selector 10..200 (6 cols) */}
          <div className="lg:col-span-6 bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="archive-draws-count-slider"
                className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5"
              >
                <Calculator className="w-4 h-4 text-emerald-400" />
                <span>2. Numero Ultime Estrazioni da Confrontare (10 &ndash; 200):</span>
              </label>
              <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-xs font-extrabold">
                Ultime {comparisonDrawsCount} Estrazioni
              </span>
            </div>

            {/* Preset pills: 10, 25, 50, 100, 150, 200 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_ARCHIVE_COMPARISON_COUNTS.map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => handleSelectComparisonDrawsCount(cnt)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer border ${
                    comparisonDrawsCount === cnt
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow font-extrabold'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-amber-500/40 hover:text-amber-300'
                  }`}
                >
                  {cnt} estr.
                </button>
              ))}

              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[11px] text-slate-400">Valore esatto:</span>
                <input
                  type="number"
                  min={MIN_ARCHIVE_COMPARISON_DRAWS}
                  max={MAX_ARCHIVE_COMPARISON_DRAWS}
                  value={customDrawsInput}
                  onChange={(e) => {
                    setCustomDrawsInput(e.target.value);
                    const parsed = parseInt(e.target.value, 10);
                    if (
                      !Number.isNaN(parsed) &&
                      parsed >= MIN_ARCHIVE_COMPARISON_DRAWS &&
                      parsed <= MAX_ARCHIVE_COMPARISON_DRAWS
                    ) {
                      setComparisonDrawsCount(parsed);
                      setComparisonPage(1);
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseInt(customDrawsInput, 10);
                    handleSelectComparisonDrawsCount(parsed);
                  }}
                  aria-label="Numero ultime estrazioni da confrontare (10-200)"
                  className="w-16 rounded-lg bg-slate-900 border border-amber-500/40 px-2 py-1 text-center font-mono font-bold text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Range Slider 10..200 */}
            <div className="space-y-1 pt-0.5">
              <input
                id="archive-draws-count-slider"
                type="range"
                min={MIN_ARCHIVE_COMPARISON_DRAWS}
                max={MAX_ARCHIVE_COMPARISON_DRAWS}
                step={1}
                value={comparisonDrawsCount}
                onChange={(e) => handleSelectComparisonDrawsCount(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>Min: 10 estrazioni</span>
                <span>50</span>
                <span>100</span>
                <span>150</span>
                <span>Max: 200 estrazioni</span>
              </div>
            </div>
          </div>
        </div>

        {/* Results Dashboard when a play is selected */}
        {comparisonSummary && activePlayForComparison && (
          <div className="space-y-4">
            {/* Collapsible preview of the selected play's sestine and pool hit frequencies */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <span>
                    Numeri Giocati ({comparisonSummary.playNumbersSet.length} numeri distinti) &amp;
                    Frequenza Uscite nelle Ultime {comparisonSummary.drawsEvaluatedCount} Estrazioni:
                  </span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">
                  Totale numeri estratti indovinati: {comparisonSummary.totalMatchedNumbersCount}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {comparisonSummary.playNumbersSet.map((num) => {
                  const hits = comparisonSummary.numberHitCounts[num] || 0;
                  return (
                    <div
                      key={num}
                      className={`px-2.5 py-1 rounded-xl border flex items-center gap-1.5 font-mono text-xs ${
                        hits > 0
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                      title={`Numero ${num}: estratto ${hits} volte nelle ultime ${comparisonSummary.drawsEvaluatedCount} estrazioni`}
                    >
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-extrabold text-[11px] flex items-center justify-center">
                        {num}
                      </span>
                      <span className="text-[11px]">
                        {hits} {hits === 1 ? 'uscita' : 'uscite'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {showPlayColumnsPreview && (
                <div className="pt-3 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {activePlayForComparison.columns.map((col) => (
                    <div
                      key={col.id}
                      className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs font-mono"
                    >
                      <span className="text-slate-400 font-bold">
                        Col. #{String(col.id).padStart(2, '0')}:
                      </span>
                      <div className="flex items-center gap-1.5">
                        {col.numbers.map((n) => (
                          <span
                            key={n}
                            className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold flex items-center justify-center text-[11px]"
                          >
                            {n}
                          </span>
                        ))}
                        {col.superstar !== undefined && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-bold">
                            ★{col.superstar}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4 Primary Economic Balance Cards: Speso, Utile Lordo, Utile Netto, Concorsi Vincenti */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* Card 1: Quanto Ho Speso */}
              <div className="bg-slate-950 border border-rose-500/30 rounded-xl p-4 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-bold">
                  <span>Quanto Ho Speso (Spesa Totale)</span>
                  <Euro className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-2xl font-extrabold font-mono text-rose-400">
                  -{comparisonSummary.totalSpent.toFixed(2).replace('.', ',')} €
                </div>
                <p className="text-[11px] font-mono text-slate-400">
                  {comparisonSummary.drawsEvaluatedCount} estrazioni &times;{' '}
                  {comparisonSummary.costPerDraw.toFixed(2).replace('.', ',')} € / concorso
                </p>
              </div>

              {/* Card 2: Utile Lordo (Quanto Ho Guadagnato) */}
              <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-4 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-bold">
                  <span>Utile Lordo (Quanto Ho Guadagnato)</span>
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-extrabold font-mono text-emerald-400">
                  +{comparisonSummary.grossWinnings.toFixed(2).replace('.', ',')} €
                </div>
                <p className="text-[11px] font-mono text-slate-400">
                  Somma vincite lorde su {comparisonSummary.winningDrawsCount} concorsi a premio
                </p>
              </div>

              {/* Card 3: Utile Netto (Utile Lordo - Spesa) */}
              <div
                className={`bg-slate-950 rounded-xl p-4 space-y-1 border-2 ${
                  comparisonSummary.netProfitLoss >= 0
                    ? 'border-emerald-500/60 bg-emerald-950/15'
                    : 'border-amber-500/50'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-amber-300 uppercase font-extrabold">
                  <span>Utile Netto (Guadagno &minus; Spesa)</span>
                  {comparisonSummary.netProfitLoss >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                <div
                  className={`text-2xl font-extrabold font-mono ${
                    comparisonSummary.netProfitLoss >= 0 ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {comparisonSummary.netProfitLoss >= 0 ? '+' : ''}
                  {comparisonSummary.netProfitLoss.toFixed(2).replace('.', ',')} €
                </div>
                <p className="text-[11px] font-mono text-slate-300 flex items-center justify-between">
                  <span>ROI: {comparisonSummary.roiPercentage.toFixed(1)}%</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      comparisonSummary.netProfitLoss >= 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {comparisonSummary.netProfitLoss >= 0 ? 'IN ATTIVO' : 'IN PASSIVO'}
                  </span>
                </p>
              </div>

              {/* Card 4: Dettaglio Categorie Vincenti */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-bold">
                  <span>Punti Realizzati ({comparisonSummary.drawsEvaluatedCount} Estr.)</span>
                  <Trophy className="w-4 h-4 text-amber-400" />
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs font-mono pt-0.5">
                  <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">Punti 2:</span>
                    <strong className="text-amber-300">
                      {comparisonSummary.tierBreakdown.points2}
                    </strong>
                  </div>
                  <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">Punti 3:</span>
                    <strong className="text-sky-300">
                      {comparisonSummary.tierBreakdown.points3}
                    </strong>
                  </div>
                  <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">Punti 4+:</span>
                    <strong className="text-emerald-300">
                      {comparisonSummary.tierBreakdown.points4 +
                        comparisonSummary.tierBreakdown.points5 +
                        comparisonSummary.tierBreakdown.points5plus1 +
                        comparisonSummary.tierBreakdown.points6}
                    </strong>
                  </div>
                  <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">SuperStar:</span>
                    <strong className="text-purple-300">
                      {comparisonSummary.tierBreakdown.superstarHits}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Table of the Compared 10-200 Draws with Highlighted Drawn Numbers */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-3.5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    Dettaglio Confronto sulle Ultime {comparisonSummary.drawsEvaluatedCount}{' '}
                    Estrazioni (Numeri Estratti Indovinati Evidenziati in Verde/Oro)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setComparisonFilter('all');
                      setComparisonPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      comparisonFilter === 'all'
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    Tutte ({comparisonSummary.drawsEvaluatedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComparisonFilter('matched');
                      setComparisonPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      comparisonFilter === 'matched'
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    Con Numeri Estratti (
                    {
                      comparisonSummary.rows.filter(
                        (r) => r.matchedNumbersInPlay.length > 0 || r.superstarMatchedInPlay
                      ).length
                    }
                    )
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComparisonFilter('winning');
                      setComparisonPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      comparisonFilter === 'winning'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    Solo Vincenti ({comparisonSummary.winningDrawsCount})
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="py-2.5 px-3">Concorso &amp; Data</th>
                      <th className="py-2.5 px-3">Sestina Estratta (Evidenziati i Numeri Giocati)</th>
                      <th className="py-2.5 px-3 text-center">Jolly / ★</th>
                      <th className="py-2.5 px-3">Numeri Indovinati &amp; Miglior Punto</th>
                      <th className="py-2.5 px-3 text-right">Spesa</th>
                      <th className="py-2.5 px-3 text-right">Utile Lordo</th>
                      <th className="py-2.5 px-3 text-right">Utile Netto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {paginatedComparisonRows.map((row) => {
                      const isExpanded = expandedContestId === row.draw.id;
                      const isWin = row.grossWinForDraw > 0;
                      return (
                        <React.Fragment key={row.draw.id}>
                          <tr
                            onClick={() =>
                              setExpandedContestId(isExpanded ? null : row.draw.id)
                            }
                            className={`transition-colors cursor-pointer ${
                              isWin
                                ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                                : 'hover:bg-slate-900/60'
                            }`}
                            title="Clicca per espandere la verifica di ogni singola sestina della giocata"
                          >
                            <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                              <div className="font-bold text-white flex items-center gap-1.5">
                                <span>{row.draw.id}</span>
                                {isWin && (
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-500 text-slate-950 text-[10px] font-extrabold">
                                    VINTA
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400">{row.draw.date}</div>
                            </td>

                            <td className="py-2.5 px-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {row.draw.numbers.map((n) => {
                                  const isMatched = activePlayNumbersSet.has(n);
                                  return (
                                    <span
                                      key={n}
                                      className={`w-7 h-7 rounded-full font-mono text-xs flex items-center justify-center transition-all ${
                                        isMatched
                                          ? 'bg-gradient-to-br from-emerald-400 to-amber-400 text-slate-950 font-extrabold ring-2 ring-emerald-300 shadow-md shadow-emerald-500/30 scale-105'
                                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                                      }`}
                                    >
                                      {n}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>

                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              {row.draw.jolly > 0 ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <span
                                    className={`w-6 h-6 rounded-full font-mono text-[11px] flex items-center justify-center ${
                                      row.jollyMatchedInPlay
                                        ? 'bg-rose-500 text-white font-extrabold ring-2 ring-rose-300'
                                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                    }`}
                                    title="Numero Jolly"
                                  >
                                    {row.draw.jolly}
                                  </span>
                                  {row.draw.superstar !== undefined && (
                                    <span
                                      className={`px-2 py-0.5 rounded-full font-mono text-[11px] ${
                                        row.superstarMatchedInPlay
                                          ? 'bg-purple-500 text-white font-extrabold ring-2 ring-purple-300'
                                          : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                      }`}
                                      title="Numero SuperStar"
                                    >
                                      ★{row.draw.superstar}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono text-[10px]">
                                  6/40 • 20:00
                                </span>
                              )}
                            </td>

                            <td className="py-2.5 px-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {row.matchedNumbersInPlay.length > 0 ? (
                                  <span className="text-emerald-300 font-mono font-bold">
                                    {row.matchedNumbersInPlay.length} num. ({row.matchedNumbersInPlay.join(', ')})
                                  </span>
                                ) : (
                                  <span className="text-slate-500">0 numeri</span>
                                )}
                                {row.bestPrizeTier !== 'Nessun Punto' && (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[10px] font-bold">
                                    {row.bestPrizeTier} (Col. #{String(row.bestColumnId).padStart(2, '0')})
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono text-rose-300 whitespace-nowrap">
                              -{row.costForDraw.toFixed(2).replace('.', ',')} €
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                              <span
                                className={
                                  row.grossWinForDraw > 0 ? 'text-emerald-400' : 'text-slate-500'
                                }
                              >
                                +{row.grossWinForDraw.toFixed(2).replace('.', ',')} €
                              </span>
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono font-extrabold whitespace-nowrap">
                              <span
                                className={
                                  row.netReturnForDraw >= 0 ? 'text-emerald-400' : 'text-amber-300'
                                }
                              >
                                {row.netReturnForDraw >= 0 ? '+' : ''}
                                {row.netReturnForDraw.toFixed(2).replace('.', ',')} €
                              </span>
                            </td>
                          </tr>

                          {/* Expanded Per-Column Breakdown for this Draw */}
                          {isExpanded && (
                            <tr className="bg-slate-950">
                              <td colSpan={7} className="p-3.5 border-b border-slate-800">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-[11px] text-slate-300 font-bold">
                                    <span>
                                      Dettaglio Sestine Giocate nel Concorso {row.draw.id} (
                                      {row.draw.date}) &mdash; Sestina Estratta:{' '}
                                      {row.draw.numbers.join(' - ')}
                                    </span>
                                    <span className="text-amber-300 font-mono">
                                      Utile Lordo Concorso: +{row.grossWinForDraw.toFixed(2)} € | Utile
                                      Netto: {row.netReturnForDraw >= 0 ? '+' : ''}
                                      {row.netReturnForDraw.toFixed(2)} €
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {row.playResult.matchesPerColumn.map((colMatch) => {
                                      const matchedSet = new Set(colMatch.matchedNumbers);
                                      return (
                                        <div
                                          key={colMatch.columnId}
                                          className={`p-2 rounded-lg border flex items-center justify-between text-xs font-mono ${
                                            colMatch.estimatedPrize > 0
                                              ? 'bg-emerald-950/30 border-emerald-500/40'
                                              : 'bg-slate-900 border-slate-800'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-slate-400 font-bold">
                                              #{String(colMatch.columnId).padStart(2, '0')}
                                            </span>
                                            <div className="flex items-center gap-1">
                                              {colMatch.numbers.map((num) => {
                                                const hit = matchedSet.has(num);
                                                return (
                                                  <span
                                                    key={num}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                                                      hit
                                                        ? 'bg-emerald-400 text-slate-950 font-extrabold ring-2 ring-amber-300'
                                                        : 'bg-slate-950 text-slate-400 border border-slate-800'
                                                    }`}
                                                  >
                                                    {num}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                                colMatch.estimatedPrize > 0
                                                  ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                                                  : 'text-slate-500'
                                              }`}
                                            >
                                              {colMatch.prizeTier}
                                            </span>
                                            {colMatch.estimatedPrize > 0 && (
                                              <span className="text-emerald-400 font-extrabold">
                                                +{colMatch.estimatedPrize.toFixed(2)} €
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {paginatedComparisonRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          Nessun concorso corrispondente al filtro selezionato.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Comparison Pagination */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-800 bg-slate-900/60 text-xs text-slate-400">
                <span>
                  Concorsi confrontati: {filteredComparisonRows.length} (clicca una riga per
                  vedere i numeri indovinati su ogni sestina)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={comparisonPage === 1}
                    onClick={() => setComparisonPage((p) => Math.max(1, p - 1))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-slate-200">
                    {comparisonPage} / {totalComparisonPages}
                  </span>
                  <button
                    type="button"
                    disabled={comparisonPage === totalComparisonPages}
                    onClick={() =>
                      setComparisonPage((p) => Math.min(totalComparisonPages, p + 1))
                    }
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Feedback message */}
      {feedbackMsg && (
        <div className="flex items-center gap-2 p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {archiveGameMode === 'winforitalia' ? (
        /* ===================================================================== */
        /* ARCHIVIO WIN FOR ITALIA TEAM / WIN FOR LIFE (6/40 — ORE 20:00)        */
        /* ===================================================================== */
        <div className="space-y-5" data-testid="wfi-historical-archive-section">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Crosshair className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-xl font-bold text-white">
                    Archivio Storico Win for Italia Team / Win for Life (6/40 &bull; Ore 20:00)
                  </h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/30">
                    {wfiDraws.length} estrazioni ufficiali
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-mono border border-amber-500/30">
                    Copertura: {wfiDraws[wfiDraws.length - 1]?.id || 'WFI-2026-001'} &rarr;{' '}
                    {wfiDraws[0]?.id || 'WFI-2026-060'} ({wfiDraws[0]?.date || '2026-04-19'})
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Archivio ufficiale delle estrazioni giornaliere Win for Italia Team / Win for Life (6 numeri da 1 a 40, senza Jolly/SuperStar). Premi: Punto 2 = 2,00 € &bull; Punto 3 = 8,00 € &bull; Punto 4 = 50,00 € &bull; Punto 5 = 440,00 € &bull; Punto 6 = 10.000,00 €.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncWfiArchive}
                  disabled={isSyncingWfi}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncingWfi ? 'animate-spin' : ''}`} />
                  <span>
                    {isSyncingWfi
                      ? 'Sincronizzazione 20:00...'
                      : 'Sincronizza Estrazione 20:00'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleExportWfiJSON}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <FileJson className="w-4 h-4 text-amber-400" />
                  <span>Esporta JSON 6/40</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportWfiCSV}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Esporta CSV 6/40</span>
                </button>
              </div>
            </div>

            {/* Rapid Manual Entry for Win for Italia Team / Win for Life (6/40) */}
            <form
              onSubmit={handleWfiManualInsert}
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <PlusCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Inserisci Estrazione Manuale Win for Italia / Win for Life (6/40):</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 flex-1 md:justify-end">
                <input
                  type="date"
                  value={wfiManualDate}
                  onChange={(e) => setWfiManualDate(e.target.value)}
                  aria-label="Data estrazione Win for Italia 6/40"
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  value={wfiManualInput}
                  onChange={(e) => setWfiManualInput(e.target.value)}
                  placeholder="6 numeri da 1 a 40 (es. 4, 11, 18, 25, 34, 39)"
                  aria-label="6 numeri da 1 a 40 separati da virgola"
                  className="flex-1 min-w-[230px] max-w-md bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs cursor-pointer transition-colors"
                >
                  Aggiungi all&apos;Archivio 6/40
                </button>
              </div>
            </form>

            {wfiManualError && (
              <div className="flex items-center gap-2 p-2.5 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{wfiManualError}</span>
              </div>
            )}

            {/* Search bar for Win for Italia Team / Win for Life (6/40) */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={wfiSearchTerm}
                onChange={(e) => {
                  setWfiSearchTerm(e.target.value);
                  setWfiPage(1);
                }}
                placeholder="Cerca nell'archivio Win for Italia / Win for Life (es. WFI-2026-060, data 2026-04 o numero estratto tra 1 e 40)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
          </div>

          {/* Table of Win for Italia Team / Win for Life (6/40) Draws */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="py-3 px-4">Concorso (6/40)</th>
                    <th className="py-3 px-4">Data &amp; Ora</th>
                    <th className="py-3 px-4">Sestina Vincente (1–40)</th>
                    <th className="py-3 px-4 text-center">Somma (&Sigma;)</th>
                    <th className="py-3 px-4 text-center">Pari / Dispari</th>
                    <th className="py-3 px-4 text-center">Estremi (1–8 / 33–40)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {currentWfiDraws.map((d) => {
                    const sum = d.numbers.reduce((acc, n) => acc + n, 0);
                    const evens = d.numbers.filter((n) => n % 2 === 0).length;
                    const odds = 6 - evens;
                    const extremes = d.numbers.filter((n) => n <= 8 || n >= 33).length;

                    return (
                      <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-emerald-300">{d.id}</td>
                        <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                          {d.date}{' '}
                          <span className="text-[10px] text-slate-500">
                            (ore {d.time || '20:00'})
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {d.numbers.map((n) => {
                              const inSelectedPlay = activePlayNumbersSet.has(n);
                              const isExt = n <= 8 || n >= 33;
                              return (
                                <span
                                  key={n}
                                  className={`w-7 h-7 rounded-full font-mono font-bold text-xs flex items-center justify-center shadow-sm ${
                                    inSelectedPlay
                                      ? 'bg-gradient-to-br from-emerald-400 to-amber-400 text-slate-950 ring-2 ring-emerald-300 font-extrabold'
                                      : isExt
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  }`}
                                >
                                  {n}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-300">
                          &Sigma; {sum}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-300">
                          {evens}P / {odds}D
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-emerald-300">
                          {extremes} estremi
                        </td>
                      </tr>
                    );
                  })}
                  {currentWfiDraws.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        Nessuna estrazione Win for Italia / Win for Life trovata con i filtri attuali.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination bar for Win for Italia Team (6/40) */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/60 text-xs text-slate-400">
              <span>
                Mostrate estrazioni {(wfiPage - 1) * pageSize + 1} -{' '}
                {Math.min(wfiPage * pageSize, filteredWfiDraws.length)} di{' '}
                {filteredWfiDraws.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={wfiPage === 1}
                  onClick={() => setWfiPage((p) => Math.max(p - 1, 1))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono text-slate-200">
                  {wfiPage} / {totalWfiPages}
                </span>
                <button
                  type="button"
                  disabled={wfiPage === totalWfiPages}
                  onClick={() => setWfiPage((p) => Math.min(p + 1, totalWfiPages))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Top action header for Full Historical Archive */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <History className="w-5 h-5 text-amber-400" />
                  <h2 className="text-xl font-bold text-white">
                    Archivio Storico Ufficiale SuperEnalotto ({minYear} &ndash; {maxYear})
                  </h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30">
                    {draws.length.toLocaleString('it-IT')} concorsi ufficiali
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono border border-emerald-500/30">
                    Copertura: {oldestDraw?.id || '2009-001'} &rarr; {latestDraw?.id || '2026-174'} (
                    {latestDraw?.date || '2026-10-30'})
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Serie storica reale delle estrazioni ufficiali del SuperEnalotto dal 02/01/2009 ad
                  oggi, con sincronizzazione live gratuita da feed Open-Data.
                </p>
              </div>

              {/* Quick buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncLiveFeed}
                  disabled={isSyncingFeed}
                  className="px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Sincronizza con il feed Open-Data ufficiale delle estrazioni SuperEnalotto"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncingFeed ? 'animate-spin' : ''}`} />
                  <span>{isSyncingFeed ? 'Sincronizzazione...' : 'Sincronizza Feed Ufficiale'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowHowUsedGuide((prev) => !prev)}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>{showHowUsedGuide ? 'Nascondi Guida Uso Storico' : 'Come Usiamo lo Storico'}</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenSmartPaste}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 fill-slate-950" />
                  <span>Incolla Rapido Smart</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Esporta backup completo in formato JSON"
                >
                  <FileJson className="w-4 h-4 text-amber-400" />
                  <span>Esporta JSON</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Esporta archivio in formato CSV"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Esporta CSV</span>
                </button>

                {/* Hidden inputs for imports */}
                <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-4 h-4 text-sky-400" />
                  <span>Importa</span>
                  <input
                    type="file"
                    accept=".json,.csv"
                    onChange={(e) => {
                      if (e.target.files?.[0]?.name.endsWith('.csv')) {
                        handleImportCSV(e);
                      } else {
                        handleImportJSON(e);
                      }
                    }}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleReplenishArchive}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-all cursor-pointer"
                  title="Ripristina archivio ufficiale completo 2009-2026"
                  aria-label="Ripristina archivio ufficiale completo 2009-2026"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Year Filter Pills (2026 down to 2009) */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  <span>Filtra per Anno Storico (2009 &ndash; 2026):</span>
                </span>
                <span className="font-mono text-slate-300">
                  {selectedYear === 'ALL'
                    ? `Tutti i ${draws.length} concorsi (2009–2026)`
                    : `Anno ${selectedYear}: ${filteredDraws.length} concorsi`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedYear('ALL');
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    selectedYear === 'ALL'
                      ? 'bg-amber-500 text-slate-950 shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  Tutti (2009-2026)
                </button>
                {availableYears.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => {
                      setSelectedYear(yr);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      selectedYear === yr
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900'
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>

            {/* Search bar */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Cerca per anno/concorso (es. 2009-001, 2015-120), data (es. 2009-01) o numero estratto (es. 7)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          {/* Mathematical Explanation Card: How the 2009-2026 Historical Archive is Used */}
          {showHowUsedGuide && (
            <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm md:text-base font-extrabold text-white">
                    Come il Motore Matematico Utilizza l&apos;Archivio Storico (2009 &ndash; 2026)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                  5 Moduli di Calcolo Attivi su {draws.length} Concorsi
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-rose-300 font-bold">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>1. Ritardo Storico &amp; Max (w₁)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Scansiona tutti i <strong className="text-slate-200">{draws.length} concorsi dal 2009</strong> per calcolare sia il ritardo attuale sia il <strong className="text-rose-300">Ritardo Massimo Storico</strong> (<code className="text-slate-300">Rit_max(x)</code>) di ciascuno dei 90 numeri, normalizzando <code className="text-rose-300">Rit(x) = Rit_att(x) / Rit_max(x)</code>.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sky-300 font-bold">
                    <Activity className="w-4 h-4 shrink-0" />
                    <span>2. Frequenza Ciclica &amp; Globale (w₂)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Misura le uscite nel ciclo breve (<strong className="text-sky-300">K = 36 concorsi</strong>) per la funzione di scoring <code className="text-sky-300">Freq(x)</code> e usa la frequenza totale 2009&ndash;2026 per la legge dei grandi numeri e lo spareggio statistico.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-bold">
                    <GitBranch className="w-4 h-4 shrink-0" />
                    <span>3. Matrice Spia / Affinità 90×90 (w₃)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Analizza tutte le estrazioni dal 2009 in cui è uscito almeno uno dei 6 numeri dell&apos;ultimo concorso per costruire la <strong className="text-emerald-300">matrice di co-occorrenza</strong> e individuare i numeri più simpatizzanti (<code className="text-emerald-300">Aff(x)</code>).
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                    <Dices className="w-4 h-4 shrink-0" />
                    <span>4. Priors Urna 100 Simulazioni</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Alimenta le <strong className="text-amber-300">priors Bayesiane di Dirichlet</strong> dell&apos;Urna 1 (sestina + Jolly) e dell&apos;Urna 2 (SuperStar) per simulare le prossime 100 estrazioni ed estrarre la Sestina ad Alta Probabilità.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-purple-300 font-bold">
                    <Dna className="w-4 h-4 shrink-0" />
                    <span>5. Addestramento Evolutivo Slider</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Addestra le <strong className="text-purple-300">n₁ triplette (w₁, w₂, w₃)</strong> sui parametri statistici 2009&ndash;2026 per scartare le combinazioni in perdita e generare nuove triplette vincenti via media <code className="text-purple-300">(w₁+w₂)/2</code>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Full Table of Draws */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="py-3 px-4">Concorso</th>
                    <th className="py-3 px-4">Anno</th>
                    <th className="py-3 px-4">Data</th>
                    <th className="py-3 px-4">Sestina Vincente</th>
                    <th className="py-3 px-4 text-center">Jolly</th>
                    <th className="py-3 px-4 text-center">SuperStar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {currentDraws.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-white">{d.id}</td>
                      <td className="py-3 px-4 font-mono text-amber-300 font-semibold">{d.year}</td>
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">{d.date}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {d.numbers.map((n) => {
                            const inSelectedPlay = activePlayNumbersSet.has(n);
                            return (
                              <span
                                key={n}
                                className={`w-7 h-7 rounded-full font-mono font-bold text-xs flex items-center justify-center shadow-sm ${
                                  inSelectedPlay
                                    ? 'bg-gradient-to-br from-emerald-400 to-amber-400 text-slate-950 ring-2 ring-emerald-300 font-extrabold'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                }`}
                              >
                                {n}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex w-7 h-7 rounded-full font-mono font-bold text-xs items-center justify-center ${
                            activePlayNumbersSet.has(d.jolly)
                              ? 'bg-rose-500 text-white ring-2 ring-rose-300'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {d.jolly}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {d.superstar !== undefined ? (
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full font-mono font-bold text-xs items-center justify-center whitespace-nowrap ${
                              activePlaySuperstarsSet.has(d.superstar)
                                ? 'bg-purple-500 text-white ring-2 ring-purple-300'
                                : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            }`}
                          >
                            ★ {d.superstar}
                          </span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {currentDraws.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        Nessun concorso corrispondente ai criteri di ricerca.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination bar */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/60 text-xs text-slate-400">
              <span>
                Mostrati concorsi {(currentPage - 1) * pageSize + 1} -{' '}
                {Math.min(currentPage * pageSize, filteredDraws.length)} di{' '}
                {filteredDraws.length.toLocaleString('it-IT')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 cursor-pointer"
                  aria-label="Pagina precedente"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono text-slate-200">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 cursor-pointer"
                  aria-label="Pagina successiva"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
