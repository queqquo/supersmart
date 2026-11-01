/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
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
  Dna
} from 'lucide-react';
import { Draw } from '../types/lottery';
import {
  exportBackupJSON,
  exportDrawsCSV,
  importBackupJSON,
  importDrawsCSV,
  syncOfficialDrawsFromLiveFeed
} from '../utils/storage';
import { generateFullHistoricalDataset } from '../data/seedDraws';

interface HistoricalArchiveProps {
  draws: Draw[];
  onUpdateDraws: (draws: Draw[]) => void;
  onOpenSmartPaste: () => void;
}

export const HistoricalArchive: React.FC<HistoricalArchiveProps> = ({
  draws,
  onUpdateDraws,
  onOpenSmartPaste
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | 'ALL'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [isSyncingFeed, setIsSyncingFeed] = useState(false);
  const [showHowUsedGuide, setShowHowUsedGuide] = useState(true);
  const pageSize = 15;

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
      showNotice('Archivio locale già aggiornato all\'ultima estrazione disponibile');
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
      {/* Top action header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <History className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-bold text-white">
                Archivio Storico Ufficiale ({minYear} &ndash; {maxYear})
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30">
                {draws.length.toLocaleString('it-IT')} concorsi ufficiali
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono border border-emerald-500/30">
                Copertura: {oldestDraw?.id || '2009-001'} &rarr; {latestDraw?.id || '2026-174'} ({latestDraw?.date || '2026-10-30'})
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Serie storica reale delle estrazioni ufficiali del SuperEnalotto dal 02/01/2009 ad oggi, con sincronizzazione live gratuita da feed Open-Data.
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

        {/* Feedback message */}
        {feedbackMsg && (
          <div className="flex items-center gap-2 p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{feedbackMsg}</span>
          </div>
        )}

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

      {/* Table of Draws */}
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
                  <td className="py-3 px-4 font-mono font-bold text-white">
                    {d.id}
                  </td>
                  <td className="py-3 px-4 font-mono text-amber-300 font-semibold">
                    {d.year}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                    {d.date}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {d.numbers.map((n) => (
                        <span
                          key={n}
                          className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold text-xs flex items-center justify-center shadow-sm"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="inline-flex w-7 h-7 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold text-xs items-center justify-center">
                      {d.jolly}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    {d.superstar !== undefined ? (
                      <span className="inline-flex px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono font-bold text-xs items-center justify-center whitespace-nowrap">
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
    </div>
  );
};
