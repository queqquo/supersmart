/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Clipboard, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { parseExtractionText } from '../utils/combinatorics';
import { Draw } from '../types/lottery';

interface SmartPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveDraw: (draw: Draw) => void;
  lastDraw?: Draw;
}

export const SmartPasteModal: React.FC<SmartPasteModalProps> = ({
  isOpen,
  onClose,
  onSaveDraw,
  lastDraw
}) => {
  const [pasteText, setPasteText] = useState('');
  const [parsedData, setParsedData] = useState<Partial<Draw> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleTextChange = (text: string) => {
    setPasteText(text);
    setErrorMsg('');
    if (!text.trim()) {
      setParsedData(null);
      return;
    }
    const result = parseExtractionText(text);
    if (result && result.numbers && result.numbers.length === 6) {
      setParsedData(result);
    } else {
      setParsedData(null);
      if (text.length > 15) {
        setErrorMsg('Impossibile estrarre 6 numeri validi. Verifica il formato del testo incollato.');
      }
    }
  };

  const handleApplySample = (sample: string) => {
    handleTextChange(sample);
  };

  const handleConfirmSave = () => {
    if (!parsedData || !parsedData.numbers) return;

    const fullDraw: Draw = {
      id: parsedData.id || `2026-${String(parsedData.contestNumber || 46).padStart(3, '0')}`,
      contestNumber: parsedData.contestNumber || 46,
      year: parsedData.year || 2026,
      date: parsedData.date || new Date().toISOString().split('T')[0],
      numbers: parsedData.numbers as [number, number, number, number, number, number],
      jolly: parsedData.jolly ?? 1,
      superstar: parsedData.superstar
    };

    onSaveDraw(fullDraw);
    setPasteText('');
    setParsedData(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Clipboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Incolla Rapido Smart
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
                  Zero Cost
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Incolla il testo dell'ultima estrazione da qualsiasi sito (Sisal, televideo, news). Il parser regex estrae automaticamente data, sestina, Jolly e SuperStar.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Chiudi finestra"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Quick sample buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Esempi di prova:</span>
            <button
              type="button"
              onClick={() =>
                handleApplySample(
                  "SuperEnalotto Concorso n. 46 del 26/03/2026: 8 - 14 - 29 - 45 - 63 - 81 Jolly: 12 SuperStar: 50"
                )
              }
              className="text-xs px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              Formato Ufficiale Sisal
            </button>
            <button
              type="button"
              onClick={() =>
                handleApplySample(
                  "Estrazione 2026-047 (28/03/2026) Numeri: 3, 17, 34, 58, 70, 89 | Jolly 25 | Stella 77"
                )
              }
              className="text-xs px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              Formato Compatto
            </button>
          </div>

          {/* Textarea */}
          <div className="space-y-2">
            <label htmlFor="smart-paste-input" className="block text-sm font-medium text-slate-300">
              Testo dell'estrazione:
            </label>
            <textarea
              id="smart-paste-input"
              rows={4}
              value={pasteText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Incolla qui il testo, es: 'Estrazione n. 46 del 26/03/2026: 8, 14, 29, 45, 63, 81 Jolly: 12 SuperStar: 50'..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all font-mono"
            />
          </div>

          {/* Error notice if needed */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Parsed Result Preview */}
          {parsedData && parsedData.numbers && (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-emerald-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Estrazione Riconosciuta con Successo</span>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  ID: <span className="text-white font-bold">{parsedData.id}</span> | Data: {parsedData.date}
                </div>
              </div>

              {/* Ball display */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold mr-1">
                  Sestina:
                </span>
                {parsedData.numbers.map((num, i) => (
                  <div
                    key={i}
                    className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-extrabold text-sm flex items-center justify-center shadow-lg shadow-amber-500/20 border border-amber-300 font-mono"
                  >
                    {num}
                  </div>
                ))}

                {parsedData.jolly !== undefined && (
                  <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-700">
                    <span className="text-xs text-rose-400 font-bold">Jolly:</span>
                    <div className="w-8 h-8 rounded-full bg-rose-500 text-white font-extrabold text-xs flex items-center justify-center shadow border border-rose-400 font-mono">
                      {parsedData.jolly}
                    </div>
                  </div>
                )}

                {parsedData.superstar !== undefined && (
                  <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-700">
                    <span className="text-xs text-purple-400 font-bold">SuperStar:</span>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shadow border border-purple-400 font-mono">
                      ★ {parsedData.superstar}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/90">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={!parsedData}
            onClick={handleConfirmSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg transition-all ${
              parsedData
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:from-amber-400 hover:to-amber-500 shadow-amber-500/25 cursor-pointer active:scale-95'
                : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Salva nell'Archivio & Aggiorna Statistiche
          </button>
        </div>
      </div>
    </div>
  );
};
