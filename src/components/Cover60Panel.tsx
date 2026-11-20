import { useMemo, useState } from 'react';
import { BookmarkPlus, Copy, ShieldCheck, Shuffle } from 'lucide-react';
import type { Draw, GeneratedColumn, SavedPlay } from '../types/lottery';
import { COVER60_ARCHIVE_YEARS, COVER60_COST, COVER60_HISTORY_LIMIT, COVER60_MIN_DRAWS, COVER60_ODDS, COVER60_TOTAL_DRAWS, createCover60WeightedShuffle, generateCover60, getCover60ArchiveStats, getCover60History } from '../utils/cover60';

const pct = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 5 });
const whole = new Intl.NumberFormat('it-IT');
const formatDate = (date: string) => date.split('-').reverse().join('/');
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-300';

export function Cover60Panel({ draws, savedPlays, onSavePlay }: {
  draws: readonly Draw[];
  savedPlays: readonly SavedPlay[];
  onSavePlay: (play: SavedPlay) => void;
}) {
  const [columns, setColumns] = useState<GeneratedColumn[]>([]);
  const [status, setStatus] = useState('');
  const [historyMessage, setHistoryMessage] = useState('');
  const [generationError, setGenerationError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [selectionNote, setSelectionNote] = useState<string>();
  const latestDraw = draws[0];
  const { start, end, drawCount, stats } = useMemo(() => getCover60ArchiveStats(draws), [draws]);
  const weighted = drawCount >= COVER60_MIN_DRAWS;
  const archivePeriod = start && end ? `dal ${formatDate(start)} al ${formatDate(end)}` : '';
  const archiveSummary = `${whole.format(drawCount)} estrazioni ${archivePeriod}`;
  const text = columns.map(({ numbers }) => numbers.map(n => String(n).padStart(2, '0')).join(' - ')).join('\n');

  function generate() {
    const { forbidden, checkedPlays } = getCover60History(savedPlays);
    const next = generateCover60(forbidden, weighted ? createCover60WeightedShuffle(stats) : undefined);
    setColumns(next ?? []);
    setSelectionNote(!next ? undefined : weighted
      ? `Selezione pesata sugli ultimi ${COVER60_ARCHIVE_YEARS} anni: ${archiveSummary}.`
      : `Selezione casuale uniforme: meno di ${COVER60_MIN_DRAWS} estrazioni nel periodo.`);
    setSaved(false);
    setManualCopy(false);
    setGenerationError(!next);
    setStatus(next ? '10 sestine generate: 60 numeri distinti.' : '');
    setHistoryMessage(!next
      ? 'Non è stato possibile generare dieci sestine senza duplicati. Riprova.'
      : checkedPlays === 1
        ? 'Nessuna sestina identica nella giocata SuperEnalotto controllata.'
        : checkedPlays > 1
          ? `Nessuna sestina identica nelle ${checkedPlays} giocate SuperEnalotto controllate.`
          : 'Nessuna giocata SuperEnalotto disponibile per il confronto. Il controllo sullo storico non è stato eseguito.');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('10 sestine copiate.');
    } catch {
      setManualCopy(true);
      setStatus('Copia automatica non disponibile. Puoi copiare le sestine dal campo di testo.');
    }
  }

  function register() {
    if (saved || columns.length !== 10 || !latestDraw) return;
    const targetContestId = `${latestDraw.year}-${String(latestDraw.contestNumber + 1).padStart(3, '0')}`;
    onSavePlay({
      id: `play-cover60-${Date.now()}`,
      createdAt: new Date().toISOString(),
      targetContestId,
      mode: 'pure_coverage',
      cost: COVER60_COST,
      savedAmount: 0,
      poolNumbers: columns.flatMap(column => column.numbers).sort((a, b) => a - b),
      columns,
      status: 'IN_ATTESA',
      manualNote: ['Copertura 60 (10 sestine base, senza sovrapposizioni)', selectionNote].filter(Boolean).join(' · ')
    });
    setSaved(true);
    setStatus('Sestine aggiunte a Verifica & Bilancio. Nessun acquisto effettuato.');
  }

  return (
    <section aria-labelledby="cover60-heading" className="space-y-5 rounded-2xl border border-emerald-800/70 bg-slate-900 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">SuperEnalotto base · 6/90</p>
          <h2 id="cover60-heading" className="text-xl font-bold text-white">Copertura 60</h2>
          <p className="max-w-xl text-sm text-slate-300">10 sestine da 1 €, con 60 numeri distinti e nessuna sovrapposizione. Generazione nel browser, senza simulazioni o chiamate al server.</p>
        </div>
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/60 px-4 py-2">
          <span className="block text-xs text-emerald-200">Costo per concorso</span>
          <strong className="font-mono text-lg text-white">10,00 €</strong>
        </div>
      </div>
      <div className="space-y-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200">
        <p className="font-semibold">Selezione dei 60 numeri</p>
        <p className="text-xs leading-relaxed">Ritardo e frequenza hanno lo stesso peso. Si usano gli ultimi {COVER60_ARCHIVE_YEARS} anni a partire dall’ultima estrazione in archivio, senza escludere alcun numero a priori.</p>
        <p data-testid="cover60-selection" aria-live="polite" className="text-xs leading-relaxed">
          {selectionNote || (weighted
            ? `Archivio disponibile: ${archiveSummary}.`
            : `Con meno di ${COVER60_MIN_DRAWS} estrazioni nel periodo, la selezione è casuale uniforme.`)}
        </p>
        <p className="text-xs text-slate-400">Le statistiche storiche non aumentano le probabilità di vincita.</p>
      </div>
      <button type="button" data-testid="cover60-generate" onClick={generate}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:w-auto">
        <Shuffle aria-hidden="true" className="h-4 w-4" />{columns.length ? 'Rigenera 10 sestine' : 'Genera 10 sestine'}
      </button>
      <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${generationError ? 'border-rose-800 bg-rose-950/50 text-rose-100' : 'border-slate-700 bg-slate-950 text-slate-200'}`}>
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <div>
          <p className="font-semibold">Controllo anti-duplicato attivo</p>
          <p data-testid="cover60-history-check" aria-live="polite" className="mt-0.5 text-xs leading-relaxed">
            {historyMessage || `Confronta ogni sestina con le ultime ${COVER60_HISTORY_LIMIT} giocate SuperEnalotto già caricate in Verifica & Bilancio.`}
          </p>
        </div>
      </div>
      {columns.length > 0 && (
        <>
          <ol aria-label="Sestine Copertura 60" className="grid gap-2 sm:grid-cols-2">
            {columns.map(column => (
              <li key={column.id} data-testid="cover60-column" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-slate-700 bg-slate-950 p-2.5">
                <span className="text-xs font-semibold text-slate-300">Sestina {column.id}</span>
                <div className="flex gap-1">
                  {column.numbers.map(n => (
                    <span key={n} data-testid="cover60-number" className="grid h-7 w-7 place-items-center rounded-md bg-emerald-950 font-mono text-sm font-semibold text-emerald-100">
                      {String(n).padStart(2, '0')}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="cover60-copy" onClick={copy} className={secondary}><Copy aria-hidden="true" className="h-4 w-4" /> Copia 10 sestine</button>
            <button type="button" data-testid="cover60-register" onClick={register} disabled={!latestDraw || saved} className={secondary}>
              <BookmarkPlus aria-hidden="true" className="h-4 w-4" /> {saved ? 'Registrate nel bilancio' : 'Registra in Verifica & Bilancio'}
            </button>
          </div>
          {!latestDraw && <p className="text-xs text-slate-400">Per registrare le sestine serve un concorso di riferimento nell’archivio.</p>}
          {manualCopy && (
            <label className="block text-sm text-slate-300">
              Sestine da copiare manualmente
              <textarea readOnly value={text} onFocus={e => e.currentTarget.select()} rows={10}
                className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 p-3 font-mono text-slate-100" />
            </label>
          )}
        </>
      )}
      <p role="status" className="text-sm text-emerald-200 empty:hidden">{status}</p>
      <div className="space-y-2 border-t border-slate-700 pt-4">
        <h3 className="text-sm font-bold text-white">Probabilità esatte per concorso</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COVER60_ODDS.filter(({ threshold }) => threshold !== 5).map(({ threshold, draws }) => (
            <div key={threshold} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
              <dt className="text-xs text-slate-300">{threshold === 6 ? '6 punti' : `Almeno ${threshold} punti`}</dt>
              <dd className="mt-1 font-mono text-xs font-bold text-emerald-200 sm:text-sm">
                {threshold === 6 ? `1 su ${whole.format(COVER60_TOTAL_DRAWS / draws)}` : `${pct.format(100 * draws / COVER60_TOTAL_DRAWS)}%`}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-400">La soglia è raggiunta da almeno una colonna in un’estrazione uniforme. Fare punti non equivale a recuperare i 10 €.</p>
      </div>
    </section>
  );
}
