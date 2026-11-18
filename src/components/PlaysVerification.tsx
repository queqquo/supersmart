/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Trophy,
  CheckCircle2,
  AlertCircle,
  Trash2,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  PlusCircle,
  Plus,
  Dices,
  FileText,
  Euro,
  Save,
  X,
  Edit3,
  Crosshair
} from 'lucide-react';
import { SavedPlay, Draw, PlayResult, GeneratedColumn } from '../types/lottery';
import {
  evaluatePlayedSystem,
  buildGeneratedColumn,
  parseManualSestineText,
  createManualSavedPlay,
  applyManualCostAndWinning
} from '../utils/combinatorics';
import {
  WinForItaliaDraw,
  loadWinForItaliaDraws,
  isWinForItaliaPlay,
  evaluateWinForItaliaPlay
} from '../utils/winForItalia';

interface PlaysVerificationProps {
  plays: SavedPlay[];
  draws: Draw[];
  winForItaliaDraws?: WinForItaliaDraw[];
  onSavePlay: (play: SavedPlay) => void;
  onUpdatePlay: (play: SavedPlay) => void;
  onDeletePlay: (id: string) => void;
}

interface ManualRowInput {
  rowId: string;
  numbers: [string, string, string, string, string, string];
  superstar: string;
}

function createEmptyManualRow(index: number): ManualRowInput {
  return {
    rowId: `row-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    numbers: ['', '', '', '', '', ''],
    superstar: ''
  };
}

function createRandomManualRow(index: number, maxNum: number = 90): ManualRowInput {
  const chosen: number[] = [];
  while (chosen.length < 6) {
    const r = Math.floor(Math.random() * maxNum) + 1;
    if (!chosen.includes(r)) chosen.push(r);
  }
  chosen.sort((a, b) => a - b);
  return {
    rowId: `row-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    numbers: [
      String(chosen[0]),
      String(chosen[1]),
      String(chosen[2]),
      String(chosen[3]),
      String(chosen[4]),
      String(chosen[5])
    ],
    superstar: ''
  };
}

export const PlaysVerification: React.FC<PlaysVerificationProps> = ({
  plays,
  draws,
  winForItaliaDraws: externalWfiDraws,
  onSavePlay,
  onUpdatePlay,
  onDeletePlay
}) => {
  const wfiDraws = useMemo<WinForItaliaDraw[]>(() => {
    return externalWfiDraws && externalWfiDraws.length > 0
      ? externalWfiDraws
      : loadWinForItaliaDraws();
  }, [externalWfiDraws]);

  const [selectedPlayId, setSelectedPlayId] = useState<string | null>(
    plays.length > 0 ? plays[0].id : null
  );

  // Manual Registration Panel state
  const [isManualFormOpen, setIsManualFormOpen] = useState(false);
  const [manualGameType, setManualGameType] = useState<'superenalotto' | 'winforitalia'>(
    'superenalotto'
  );

  const defaultNextSuperEnalottoContest = useMemo(() => {
    const latest = draws[0];
    if (!latest) return `${new Date().getFullYear()}-001`;
    return `${latest.year}-${String(latest.contestNumber + 1).padStart(3, '0')}`;
  }, [draws]);

  const defaultNextWfiContest = useMemo(() => {
    const latest = wfiDraws[0];
    if (!latest) return `WFI-${new Date().getFullYear()}-001`;
    return `WFI-${latest.year}-${String(latest.contestNumber + 1).padStart(3, '0')}`;
  }, [wfiDraws]);

  const defaultNextContest =
    manualGameType === 'winforitalia'
      ? defaultNextWfiContest
      : defaultNextSuperEnalottoContest;

  const [manualContestId, setManualContestId] = useState<string>(defaultNextSuperEnalottoContest);
  const [manualRows, setManualRows] = useState<ManualRowInput[]>(() => [createEmptyManualRow(1)]);
  const [manualCost, setManualCost] = useState<string>('1.00');
  const [costManuallyEdited, setCostManuallyEdited] = useState<boolean>(false);
  const [manualWinning, setManualWinning] = useState<string>('0.00');
  const [manualSavedAmount, setManualSavedAmount] = useState<string>('0.00');
  const [manualStatus, setManualStatus] = useState<'VERIFICATA' | 'IN_ATTESA'>('VERIFICATA');
  const [manualNote, setManualNote] = useState<string>('');
  const [quickPasteText, setQuickPasteText] = useState<string>('');
  const [showQuickPaste, setShowQuickPaste] = useState<boolean>(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccessBanner, setManualSuccessBanner] = useState<string | null>(null);

  // Verification target game and target draw ID state
  const [verifyGameType, setVerifyGameType] = useState<'superenalotto' | 'winforitalia'>(
    'superenalotto'
  );
  const [selectedTargetDrawId, setSelectedTargetDrawId] = useState<string>(
    draws[0]?.id || ''
  );

  // Inline edit state for existing selected play
  const [editCostInput, setEditCostInput] = useState<string>('');
  const [editWinInput, setEditWinInput] = useState<string>('');
  const [inlineSaveFeedback, setInlineSaveFeedback] = useState<boolean>(false);

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

  // Sync inline edit inputs and verification game type when activePlay changes
  useEffect(() => {
    if (activePlay) {
      setEditCostInput(activePlay.cost.toFixed(2));
      setEditWinInput((activePlay.result?.totalWinning ?? 0).toFixed(2));
      const isWfi = isWinForItaliaPlay(activePlay);
      if (isWfi) {
        setVerifyGameType('winforitalia');
        const matchingWfi = wfiDraws.find((d) => d.id === activePlay.targetContestId);
        setSelectedTargetDrawId(matchingWfi?.id || wfiDraws[0]?.id || '');
      } else {
        setVerifyGameType('superenalotto');
        const matchingSe = draws.find((d) => d.id === activePlay.targetContestId);
        setSelectedTargetDrawId(matchingSe?.id || draws[0]?.id || '');
      }
    }
  }, [activePlay?.id, activePlay?.cost, activePlay?.result?.totalWinning, activePlay?.targetContestId, draws, wfiDraws]);

  const unitCostPerColumn = manualGameType === 'winforitalia' ? 2.0 : 1.0;
  const maxNumberForManualGame = manualGameType === 'winforitalia' ? 40 : 90;

  const handleSwitchManualGameType = (nextGame: 'superenalotto' | 'winforitalia') => {
    setManualGameType(nextGame);
    setManualError(null);
    const nextUnitCost = nextGame === 'winforitalia' ? 2.0 : 1.0;
    if (!costManuallyEdited) {
      setManualCost((manualRows.length * nextUnitCost).toFixed(2));
    }
    setManualContestId(
      nextGame === 'winforitalia' ? defaultNextWfiContest : defaultNextSuperEnalottoContest
    );
  };

  // Update auto cost when adding/removing rows unless user edited cost manually
  const updateRowsAndAutoCost = (nextRows: ManualRowInput[]) => {
    setManualRows(nextRows);
    if (!costManuallyEdited) {
      setManualCost((nextRows.length * unitCostPerColumn).toFixed(2));
    }
  };

  const handleAddRow = () => {
    setManualError(null);
    updateRowsAndAutoCost([...manualRows, createEmptyManualRow(manualRows.length + 1)]);
  };

  const handleAddRandomRow = () => {
    setManualError(null);
    if (
      manualRows.length === 1 &&
      manualRows[0].numbers.every((n) => n.trim() === '')
    ) {
      setManualRows([createRandomManualRow(1, maxNumberForManualGame)]);
      return;
    }
    updateRowsAndAutoCost([
      ...manualRows,
      createRandomManualRow(manualRows.length + 1, maxNumberForManualGame)
    ]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (manualRows.length <= 1) {
      setManualRows([createEmptyManualRow(1)]);
      return;
    }
    updateRowsAndAutoCost(manualRows.filter((r) => r.rowId !== rowId));
  };

  const handleNumberInputChange = (rowId: string, posIdx: number, val: string) => {
    setManualError(null);
    setManualRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const nextNums = [...row.numbers] as [string, string, string, string, string, string];
        nextNums[posIdx] = val;
        return { ...row, numbers: nextNums };
      })
    );
  };

  const handleSuperstarInputChange = (rowId: string, val: string) => {
    setManualError(null);
    setManualRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, superstar: val } : row))
    );
  };

  const handleImportQuickPaste = () => {
    setManualError(null);
    const parsedCols = parseManualSestineText(quickPasteText);
    if (parsedCols.length === 0) {
      setManualError(
        `Nessuna sestina valida trovata nel testo. Inserisci 6 numeri distinti tra 1 e ${maxNumberForManualGame} per riga.`
      );
      return;
    }

    if (
      manualGameType === 'winforitalia' &&
      parsedCols.some((c) => c.numbers.some((n) => n < 1 || n > 40))
    ) {
      setManualError(
        'Win for Italia Team / Win for Life (6/40) accetta solo numeri compresi tra 1 e 40.'
      );
      return;
    }

    const importedRows: ManualRowInput[] = parsedCols.map((col, idx) => ({
      rowId: `row-imported-${Date.now()}-${idx}`,
      numbers: [
        String(col.numbers[0]),
        String(col.numbers[1]),
        String(col.numbers[2]),
        String(col.numbers[3]),
        String(col.numbers[4]),
        String(col.numbers[5])
      ],
      superstar: manualGameType === 'superenalotto' && col.superstar ? String(col.superstar) : ''
    }));

    updateRowsAndAutoCost(importedRows);
    setShowQuickPaste(false);
    setQuickPasteText('');
  };

  const handleSaveManualPlay = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);

    const validatedColumns: GeneratedColumn[] = [];
    for (let i = 0; i < manualRows.length; i++) {
      const row = manualRows[i];
      const rawNums = row.numbers.map((s) => parseInt(s.trim(), 10));
      if (rawNums.some((n) => Number.isNaN(n) || n < 1 || n > maxNumberForManualGame)) {
        setManualError(
          `Sestina #${i + 1} incompleta o non valida: inserisci 6 numeri interi compresi tra 1 e ${maxNumberForManualGame}.`
        );
        return;
      }

      const uniqueCheck = new Set(rawNums);
      if (uniqueCheck.size !== 6) {
        setManualError(
          `Sestina #${i + 1} contiene numeri duplicati: ogni sestina deve avere 6 numeri tutti diversi (1-${maxNumberForManualGame}).`
        );
        return;
      }

      let starVal: number | undefined = undefined;
      if (manualGameType === 'superenalotto' && row.superstar.trim() !== '') {
        const parsedStar = parseInt(row.superstar.trim(), 10);
        if (Number.isNaN(parsedStar) || parsedStar < 1 || parsedStar > 90) {
          setManualError(
            `Sestina #${i + 1}: il numero SuperStar deve essere compreso tra 1 e 90.`
          );
          return;
        }
        starVal = parsedStar;
      }

      const col = buildGeneratedColumn(i + 1, rawNums, starVal);
      if (!col) {
        setManualError(`Errore nella validazione della Sestina #${i + 1}.`);
        return;
      }
      validatedColumns.push(col);
    }

    const parsedCost = parseFloat(manualCost.replace(',', '.'));
    if (Number.isNaN(parsedCost) || parsedCost < 0) {
      setManualError('Inserisci un Costo Giocata valido (€ >= 0).');
      return;
    }

    const parsedWin = parseFloat(manualWinning.replace(',', '.')) || 0;
    if (parsedWin < 0) {
      setManualError('Inserisci un importo Vincita valido (€ >= 0).');
      return;
    }

    const parsedSaved = parseFloat(manualSavedAmount.replace(',', '.')) || 0;

    const rawContestId = manualContestId.trim() || defaultNextContest;
    const finalContestId =
      manualGameType === 'winforitalia' &&
      !rawContestId.toUpperCase().startsWith('WFI') &&
      !rawContestId.toUpperCase().startsWith('WFL')
        ? `WFI-${rawContestId}`
        : rawContestId;

    const finalNote =
      manualGameType === 'winforitalia'
        ? manualNote.trim()
          ? `Win for Italia Team (6/40) — ${manualNote.trim()}`
          : 'Win for Italia Team / Win for Life (6/40)'
        : manualNote.trim() || undefined;

    const newPlay = createManualSavedPlay({
      targetContestId: finalContestId,
      columns: validatedColumns,
      cost: parsedCost,
      winningAmount: parsedWin,
      savedAmount: Math.max(0, parsedSaved),
      status: parsedWin > 0 ? 'VERIFICATA' : manualStatus,
      manualNote: finalNote
    });

    onSavePlay(newPlay);
    setSelectedPlayId(newPlay.id);
    setIsManualFormOpen(false);

    // Reset form for next time
    setManualRows([createEmptyManualRow(1)]);
    setManualCost((1 * unitCostPerColumn).toFixed(2));
    setCostManuallyEdited(false);
    setManualWinning('0.00');
    setManualSavedAmount('0.00');
    setManualNote('');
    setManualSuccessBanner(
      `Giocata manuale ${
        manualGameType === 'winforitalia' ? 'Win for Italia / Win for Life (6/40)' : 'SuperEnalotto (6/90)'
      } (${validatedColumns.length} ${
        validatedColumns.length === 1 ? 'sestina' : 'sestine'
      }, Costo ${newPlay.cost.toFixed(2)} €, Vincita ${(newPlay.result?.totalWinning ?? 0).toFixed(
        2
      )} €) registrata nel bilancio!`
    );
    setTimeout(() => setManualSuccessBanner(null), 5000);
  };

  // Handler to verify a play against a SuperEnalotto (6/90) extraction
  const handleVerifyPlay = (play: SavedPlay, targetDraw: Draw) => {
    const result: PlayResult = evaluatePlayedSystem(play.columns, targetDraw, play.cost);
    const updatedPlay: SavedPlay = {
      ...play,
      status: 'VERIFICATA',
      result
    };
    onUpdatePlay(updatedPlay);
  };

  // Handler to verify a play against a Win for Italia Team / Win for Life (6/40) extraction
  const handleVerifyWinForItaliaPlay = (play: SavedPlay, targetWfiDraw: WinForItaliaDraw) => {
    const result: PlayResult = evaluateWinForItaliaPlay(play.columns, targetWfiDraw, play.cost);
    const updatedPlay: SavedPlay = {
      ...play,
      status: 'VERIFICATA',
      result
    };
    onUpdatePlay(updatedPlay);
  };

  // Handler to manually update cost & winning of an existing play
  const handleSaveInlineCostAndWinning = (play: SavedPlay) => {
    const newCost = parseFloat(editCostInput.replace(',', '.'));
    const newWin = parseFloat(editWinInput.replace(',', '.'));
    if (Number.isNaN(newCost) || newCost < 0 || Number.isNaN(newWin) || newWin < 0) {
      return;
    }
    const updated = applyManualCostAndWinning(play, newCost, newWin, true);
    onUpdatePlay(updated);
    setInlineSaveFeedback(true);
    setTimeout(() => setInlineSaveFeedback(false), 2500);
  };

  const previewCostNum = Math.max(0, parseFloat(manualCost.replace(',', '.')) || 0);
  const previewWinNum = Math.max(0, parseFloat(manualWinning.replace(',', '.')) || 0);
  const previewNetNum = previewWinNum - previewCostNum;

  return (
    <div className="space-y-6">
      {/* Economic Ledger Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span>Controllo Budget & Bilancio Economico</span>
            </h2>
            <p className="text-xs text-slate-400">
              Tracciamento giocate di sistema e manuali, costi sostenuti, vincite conseguite e ritorno sull&apos;investimento (ROI).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs px-3 py-1.5 rounded-full bg-slate-950 text-slate-300 border border-slate-800 font-mono">
              {ledger.totalPlays} giocate registrate ({ledger.verifiedCount} verificate)
            </span>
            <button
              type="button"
              onClick={() => {
                setManualError(null);
                setIsManualFormOpen((prev) => !prev);
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                isManualFormOpen
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:from-amber-400 hover:to-amber-500'
              }`}
            >
              {isManualFormOpen ? (
                <>
                  <X className="w-4 h-4" />
                  <span>Chiudi Inserimento Manuale</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Registrazione Manuale Giocata</span>
                </>
              )}
            </button>
          </div>
        </div>

        {manualSuccessBanner && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-semibold">{manualSuccessBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setManualSuccessBanner(null)}
              className="text-emerald-400 hover:text-emerald-200 p-1"
              aria-label="Chiudi notifica"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/90">
            <span className="text-[11px] text-slate-400 block font-semibold uppercase">Spesa Cumulata</span>
            <span className="text-xl font-extrabold text-white font-mono block mt-1">
              {ledger.totalSpent.toFixed(2)} €
            </span>
            <span className="text-[10px] text-slate-500">Costo totale schedine</span>
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
            <span className="text-[10px] text-purple-400/80">Accantonamento extra</span>
          </div>
        </div>
      </div>

      {/* Manual Play Registration Form Panel */}
      {isManualFormOpen && (
        <form
          onSubmit={handleSaveManualPlay}
          className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-5 shadow-2xl space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-amber-400" />
                <span>Registrazione Manuale delle Giocate</span>
              </h3>
              <p className="text-xs text-slate-400">
                Inserisci manualmente una o più sestine giocate per SuperEnalotto (6/90) o Win for Italia Team / Win for Life (6/40).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowQuickPaste((prev) => !prev)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>{showQuickPaste ? 'Nascondi Incolla Testo' : 'Incolla Multi-Sestina'}</span>
              </button>
              <button
                type="button"
                onClick={handleAddRandomRow}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Dices className="w-3.5 h-3.5 text-emerald-400" />
                <span>+ Sestina Casuale (1–{maxNumberForManualGame})</span>
              </button>
            </div>
          </div>

          {/* Game Type Switcher: SuperEnalotto (6/90) vs Win for Italia Team / Win for Life (6/40) */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Seleziona Gioco della Schedina:
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSwitchManualGameType('superenalotto')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                  manualGameType === 'superenalotto'
                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                <span>SuperEnalotto (6/90 • 1,00 €/col.)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchManualGameType('winforitalia')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                  manualGameType === 'winforitalia'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Win for Italia Team / Win for Life (6/40 • 2,00 €/col.)</span>
              </button>
            </div>
          </div>

          {/* Optional Quick Multi-Sestina Text Paste */}
          {showQuickPaste && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="manual-quick-paste"
                  className="text-xs font-bold text-slate-300 uppercase tracking-wider"
                >
                  Incolla una o più sestine (una per riga, 6 numeri da 1 a {maxNumberForManualGame}
                  {manualGameType === 'superenalotto' ? ', opz. *SuperStar' : ''})
                </label>
              </div>
              <textarea
                id="manual-quick-paste"
                rows={3}
                value={quickPasteText}
                onChange={(e) => setQuickPasteText(e.target.value)}
                placeholder={
                  manualGameType === 'winforitalia'
                    ? 'Esempio Win for Italia 6/40:\n04 11 18 25 34 39'
                    : 'Esempio SuperEnalotto 6/90:\n05 14 28 42 67 89 *45\n12, 23, 34, 56, 78, 90'
                }
                className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleImportQuickPaste}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors"
                >
                  Importa Sestine nelle Righe
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Sestine Rows Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                1. Sestine Giocate ({manualRows.length}{' '}
                {manualRows.length === 1 ? 'colonna' : 'colonne'} &bull; Range 1–
                {maxNumberForManualGame})
              </span>
              <button
                type="button"
                onClick={handleAddRow}
                className="px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Aggiungi Sestina</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {manualRows.map((row, rIdx) => (
                <div
                  key={row.rowId}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 text-amber-400 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      #{rIdx + 1}
                    </span>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {row.numbers.map((numStr, nIdx) => (
                        <input
                          key={nIdx}
                          type="number"
                          min={1}
                          max={maxNumberForManualGame}
                          required
                          value={numStr}
                          onChange={(e) =>
                            handleNumberInputChange(row.rowId, nIdx, e.target.value)
                          }
                          placeholder={`N${nIdx + 1}`}
                          aria-label={`Sestina ${rIdx + 1} Numero ${nIdx + 1}`}
                          className="w-12 h-10 rounded-lg bg-slate-900 border border-slate-700 text-center font-mono font-bold text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      ))}
                    </div>

                    {/* Optional SuperStar input (SuperEnalotto only) */}
                    {manualGameType === 'superenalotto' && (
                      <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
                        <span className="text-[11px] font-bold text-purple-300 font-mono">★</span>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={row.superstar}
                          onChange={(e) => handleSuperstarInputChange(row.rowId, e.target.value)}
                          placeholder="SS"
                          aria-label={`Sestina ${rIdx + 1} SuperStar opzionale`}
                          title="Numero SuperStar opzionale (1-90)"
                          className="w-12 h-10 rounded-lg bg-slate-900 border border-purple-500/40 text-center font-mono font-bold text-sm text-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const rand = createRandomManualRow(rIdx + 1, maxNumberForManualGame);
                        setManualRows((prev) =>
                          prev.map((item) =>
                            item.rowId === row.rowId
                              ? { ...item, numbers: rand.numbers }
                              : item
                          )
                        );
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-mono cursor-pointer"
                      title={`Riempi questa sestina con 6 numeri casuali (1-${maxNumberForManualGame})`}
                    >
                      Casuale
                    </button>
                    {manualRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(row.rowId)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition-colors cursor-pointer"
                        aria-label={`Rimuovi Sestina ${rIdx + 1}`}
                        title="Rimuovi riga"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 2: Cost, Winning, Contest, and Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-800">
            {/* Costo Associato (€) */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="manual-cost-input"
                  className="text-xs font-bold text-slate-300 flex items-center gap-1"
                >
                  <Euro className="w-3.5 h-3.5 text-amber-400" />
                  <span>Costo Associato (€)</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCostManuallyEdited(false);
                    setManualCost((manualRows.length * unitCostPerColumn).toFixed(2));
                  }}
                  className="text-[10px] text-amber-400 hover:underline font-mono cursor-pointer"
                >
                  Auto ({unitCostPerColumn}€×{manualRows.length})
                </button>
              </div>
              <input
                id="manual-cost-input"
                type="number"
                step="0.01"
                min="0"
                required
                value={manualCost}
                onChange={(e) => {
                  setCostManuallyEdited(true);
                  setManualCost(e.target.value);
                }}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-mono font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-[10px] text-slate-500 block">
                Importo speso per la schedina
              </span>
            </div>

            {/* Vincita Conseguita (€) */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <label
                htmlFor="manual-winning-input"
                className="text-xs font-bold text-emerald-400 flex items-center gap-1"
              >
                <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                <span>Vincita Conseguita (€)</span>
              </label>
              <input
                id="manual-winning-input"
                type="number"
                step="0.01"
                min="0"
                required
                value={manualWinning}
                onChange={(e) => {
                  setManualWinning(e.target.value);
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val) && val > 0) {
                    setManualStatus('VERIFICATA');
                  }
                }}
                className="w-full rounded-lg bg-slate-900 border border-emerald-500/40 px-3 py-2 text-sm font-mono font-bold text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-[10px] text-slate-500 block">
                Inserisci 0,00 € se non vincente o in attesa
              </span>
            </div>

            {/* Concorso di Riferimento */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="manual-contest-input"
                  className="text-xs font-bold text-slate-300"
                >
                  Concorso Riferimento
                </label>
                {manualGameType === 'winforitalia' ? (
                  wfiDraws.length > 0 && (
                    <select
                      aria-label="Seleziona concorso Win for Italia da archivio"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) setManualContestId(e.target.value);
                      }}
                      className="bg-slate-900 text-[10px] text-emerald-300 border border-emerald-500/30 rounded px-1.5 py-0.5 font-mono"
                    >
                      <option value="">Da archivio 6/40...</option>
                      {wfiDraws.slice(0, 20).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id} ({d.date})
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  draws.length > 0 && (
                    <select
                      aria-label="Seleziona concorso da archivio"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) setManualContestId(e.target.value);
                      }}
                      className="bg-slate-900 text-[10px] text-slate-400 border border-slate-800 rounded px-1.5 py-0.5 font-mono"
                    >
                      <option value="">Da archivio 6/90...</option>
                      {draws.slice(0, 15).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id} ({d.date})
                        </option>
                      ))}
                    </select>
                  )
                )}
              </div>
              <input
                id="manual-contest-input"
                type="text"
                required
                value={manualContestId}
                onChange={(e) => setManualContestId(e.target.value)}
                placeholder={
                  manualGameType === 'winforitalia' ? 'es. WFI-2026-061' : 'es. 2026-175'
                }
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-mono font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-[10px] text-slate-500 block">
                ID concorso o data giocata
              </span>
            </div>

            {/* Stato Giocata & Nota */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <label
                htmlFor="manual-status-select"
                className="text-xs font-bold text-slate-300 block"
              >
                Stato Contabile
              </label>
              <select
                id="manual-status-select"
                value={previewWinNum > 0 ? 'VERIFICATA' : manualStatus}
                onChange={(e) =>
                  setManualStatus(e.target.value as 'VERIFICATA' | 'IN_ATTESA')
                }
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="VERIFICATA">Confermata (Contabilizza Costo e Vincita)</option>
                <option value="IN_ATTESA">In Attesa di Estrazione</option>
              </select>
              <input
                type="text"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="Nota opzionale (es. Schedina bar)"
                aria-label="Nota opzionale giocata"
                className="w-full rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500 mt-1"
              />
            </div>
          </div>

          {manualError && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{manualError}</span>
            </div>
          )}

          {/* Footer Summary & Submit */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <span className="text-slate-400">
                Gioco:{' '}
                <strong
                  className={
                    manualGameType === 'winforitalia' ? 'text-emerald-300' : 'text-amber-300'
                  }
                >
                  {manualGameType === 'winforitalia'
                    ? 'Win for Italia / Win for Life (6/40)'
                    : 'SuperEnalotto (6/90)'}
                </strong>
              </span>
              <span className="text-slate-400">
                Sestine: <strong className="text-white">{manualRows.length}</strong>
              </span>
              <span className="text-slate-400">
                Costo: <strong className="text-white">{previewCostNum.toFixed(2)} €</strong>
              </span>
              <span className="text-slate-400">
                Vincita: <strong className="text-emerald-400">{previewWinNum.toFixed(2)} €</strong>
              </span>
              <span className="text-slate-400">
                Impatto Netto:{' '}
                <strong
                  className={
                    previewNetNum >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {previewNetNum > 0 ? '+' : ''}
                  {previewNetNum.toFixed(2)} €
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsManualFormOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer transition-colors"
              >
                Annulla
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-extrabold text-xs shadow-lg flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Save className="w-4 h-4" />
                <span>Salva Giocata nel Bilancio</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Plays Master-Detail View */}
      {plays.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Plays List (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              Storico Schedine Registrate
            </h3>

            <div className="space-y-2">
              {plays.map((play) => {
                const isSelected = activePlay?.id === play.id;
                const isVerified = play.status === 'VERIFICATA';
                const hasWin = play.result && play.result.totalWinning > 0;
                const isWfiPlay = isWinForItaliaPlay(play);

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
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-bold text-sm text-white">
                          Concorso {play.targetContestId}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                            isWfiPlay
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {isWfiPlay ? 'Win for Italia 6/40' : 'SuperEnalotto 6/90'}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          isVerified
                            ? hasWin
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {isVerified
                          ? hasWin
                            ? `Vinti ${play.result?.totalWinning.toFixed(2)}€`
                            : '0,00€ (Verificata)'
                          : 'In Attesa'}
                      </span>
                    </div>

                    {play.manualNote && (
                      <p className="text-[11px] text-slate-400 italic mt-1 truncate">
                        {play.manualNote}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-slate-400 mt-2 font-mono">
                      <span>
                        {play.columns.length}{' '}
                        {play.columns.length === 1 ? 'sestina' : 'colonne'} (Costo:{' '}
                        {play.cost.toFixed(2)}€)
                      </span>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-extrabold text-white">
                        Giocata Concorso {activePlay.targetContestId}
                      </h3>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border ${
                          isWinForItaliaPlay(activePlay)
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {isWinForItaliaPlay(activePlay)
                          ? 'Win for Italia Team / Win for Life (6/40)'
                          : 'SuperEnalotto (6/90)'}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-950 text-slate-300 border border-slate-800 font-mono">
                        {activePlay.mode === 'manual'
                          ? `Registrazione (${activePlay.cost.toFixed(2)}€)`
                          : activePlay.mode === 'pure_coverage'
                          ? `Copertura Pura (${activePlay.cost.toFixed(2)}€)`
                          : `SuperStar (${activePlay.cost.toFixed(2)}€)`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Numeri coinvolti: {activePlay.poolNumbers.join(' - ')} | Creata il{' '}
                      {activePlay.createdAt.split('T')[0]}
                      {activePlay.manualNote ? ` | Nota: ${activePlay.manualNote}` : ''}
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

                {/* Inline Cost & Manual Winning Editor for Active Play */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
                    <Edit3 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Modifica Rapida Costo & Vincita Reale:</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor="inline-edit-cost"
                        className="text-[11px] text-slate-400 font-mono"
                      >
                        Costo (€):
                      </label>
                      <input
                        id="inline-edit-cost"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editCostInput}
                        onChange={(e) => setEditCostInput(e.target.value)}
                        className="w-20 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor="inline-edit-win"
                        className="text-[11px] text-emerald-400 font-mono"
                      >
                        Vincita (€):
                      </label>
                      <input
                        id="inline-edit-win"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editWinInput}
                        onChange={(e) => setEditWinInput(e.target.value)}
                        className="w-24 rounded-lg bg-slate-900 border border-emerald-500/40 px-2 py-1 text-xs font-mono font-bold text-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveInlineCostAndWinning(activePlay)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-bold font-mono cursor-pointer transition-colors"
                    >
                      {inlineSaveFeedback ? 'Salvato!' : 'Aggiorna Importi'}
                    </button>
                  </div>
                </div>

                {/* Verification Trigger Bar (Supports both SuperEnalotto 6/90 and Win for Italia Team / Win for Life 6/40) */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-300">
                      Archivio Estrazioni di Verifica:
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="verify-switch-superenalotto"
                        onClick={() => {
                          setVerifyGameType('superenalotto');
                          setSelectedTargetDrawId(draws[0]?.id || '');
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                          verifyGameType === 'superenalotto'
                            ? 'bg-amber-500 text-slate-950 border-amber-300 shadow'
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        <Trophy className="w-3.5 h-3.5" />
                        <span>SuperEnalotto (6/90)</span>
                      </button>
                      <button
                        type="button"
                        data-testid="verify-switch-winforitalia"
                        onClick={() => {
                          setVerifyGameType('winforitalia');
                          const matchingWfi = wfiDraws.find(
                            (d) => d.id === activePlay.targetContestId
                          );
                          setSelectedTargetDrawId(matchingWfi?.id || wfiDraws[0]?.id || '');
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                          verifyGameType === 'winforitalia'
                            ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow'
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        <span>Win for Italia Team / Win for Life (6/40)</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs flex-1">
                      <span className="text-slate-400 shrink-0">Verifica contro estrazione:</span>
                      <select
                        id="select-target-draw"
                        data-testid="select-target-draw"
                        value={selectedTargetDrawId}
                        onChange={(e) => setSelectedTargetDrawId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        {verifyGameType === 'winforitalia'
                          ? wfiDraws.slice(0, 30).map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.id} ({d.date} ore {d.time || '20:00'}) - [{d.numbers.join(', ')}]
                              </option>
                            ))
                          : draws.slice(0, 30).map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.id} ({d.date}) - {d.numbers.join(', ')} (J:{d.jolly}
                                {d.superstar ? ` ★:${d.superstar}` : ''})
                              </option>
                            ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      data-testid="verify-play-submit-btn"
                      onClick={() => {
                        if (verifyGameType === 'winforitalia') {
                          const wfiToMatch =
                            wfiDraws.find((d) => d.id === selectedTargetDrawId) || wfiDraws[0];
                          if (wfiToMatch) {
                            handleVerifyWinForItaliaPlay(activePlay, wfiToMatch);
                          }
                        } else {
                          const drawToMatch =
                            draws.find((d) => d.id === selectedTargetDrawId) || draws[0];
                          if (drawToMatch) {
                            handleVerifyPlay(activePlay, drawToMatch);
                          }
                        }
                      }}
                      className={`px-4 py-2 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shrink-0 ${
                        verifyGameType === 'winforitalia'
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 hover:from-emerald-400 hover:to-teal-500'
                          : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:from-amber-400 hover:to-amber-500'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Confronta ed Evidenzia Vincite (
                        {verifyGameType === 'winforitalia' ? '6/40' : '6/90'})
                      </span>
                    </button>
                  </div>
                </div>

                {/* Columns Match Breakdown */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Dettaglio Sestine Giocate ({activePlay.columns.length}) & Esito
                    </h4>
                    {activePlay.result && (
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        Totale Vinto: {activePlay.result.totalWinning.toFixed(2)} € (Netto:{' '}
                        {activePlay.result.netReturn >= 0 ? '+' : ''}
                        {activePlay.result.netReturn.toFixed(2)} €)
                      </span>
                    )}
                  </div>

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
                              {activePlay.result?.isManualWinning
                                ? isWinningCol
                                  ? `Vincita Registrata: ${matchInfo.estimatedPrize.toFixed(2)} €`
                                  : 'Registrata'
                                : `${matchInfo.matchCount} Punti${
                                    matchInfo.hasSuperstar ? ' + Stella' : ''
                                  }${isWinningCol ? ` (${matchInfo.estimatedPrize} €)` : ''}`}
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
        <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-amber-400 flex items-center justify-center mx-auto">
            <Trophy className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">Nessuna Giocata Registrata</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Puoi inserire subito una giocata manuale specificando le sestine, il costo associato e la vincita, oppure usare la scheda &quot;Generatore Ottimizzato&quot;.
          </p>
          <div>
            <button
              type="button"
              onClick={() => setIsManualFormOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-xs shadow-md hover:from-amber-400 hover:to-amber-500 transition-all inline-flex items-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Registra Giocata Manuale</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
