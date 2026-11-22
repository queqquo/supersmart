import { useMemo, useState } from 'react';
import { BookmarkPlus, Copy, ExternalLink, ShieldCheck, Shuffle } from 'lucide-react';
import type { Draw, SavedPlay } from '../types/lottery';
import { useCoverDraft } from '../hooks/useCover60Draft';
import { GenerationDateNote } from './GenerationDateNote';
import { buildGeneratedColumn } from '../utils/combinatorics';
import { COVER60_ARCHIVE_YEARS, COVER60_COST, COVER60_HISTORY_LIMIT, COVER60_MIN_DRAWS, COVER60_ODDS, COVER60_TOTAL_DRAWS, COVER90_COST, COVER90_ODDS, coverColumnCount, createCover60WeightedShuffle, generateCover, getCover60ArchiveStats, getCover60History, type CoverKind } from '../utils/cover60';

const pct = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 5 });
const whole = new Intl.NumberFormat('it-IT');
const SISAL_SUPERENALOTTO_URL = 'https://www.sisal.it/superenalotto';
const formatDate = (date: string) => date.split('-').reverse().join('/');
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-300';

export function Cover60Panel({ kind = 60, userEmail, draws, savedPlays, onSavePlay }: {
  /** 60: ten disjoint sestine chosen with archive weights; 90: fifteen sestine covering every number. */
  kind?: CoverKind;
  userEmail: string;
  draws: readonly Draw[];
  savedPlays: readonly SavedPlay[];
  onSavePlay: (play: SavedPlay) => void;
}) {
  const { draft, sync, saving, failed, save, canGenerate } = useCoverDraft(userEmail, kind);
  const count = coverColumnCount(kind);
  const cost = kind === 90 ? COVER90_COST : COVER60_COST;
  const odds = kind === 90 ? COVER90_ODDS : COVER60_ODDS;
  const tid = `cover${kind}`;
  const name = `Copertura ${kind}`;
  const regenerateLabel = `Rigenera ${count} sestine`;
  const columns = useMemo(() => draft?.systemResult.columns.flatMap(({ numbers }, index) =>
    buildGeneratedColumn(index + 1, numbers) ?? []) ?? [], [draft]);
  const [status, setStatus] = useState('');
  const [generationError, setGenerationError] = useState(false);
  const [registeredId, setRegisteredId] = useState<string>();
  const [manualCopy, setManualCopy] = useState(false);
  const selectionNote = draft?.selectionNote;
  const playId = draft && `play-${tid}-${draft.id}`;
  const saved = !!playId && (registeredId === playId || savedPlays.some(p => p.id === playId));
  const latestDraw = draws[0];
  const { start, end, drawCount, stats } = useMemo(() => getCover60ArchiveStats(draws), [draws]);
  // With all 90 numbers in play there is nothing to select: the archive is not used.
  const weighted = kind === 60 && drawCount >= COVER60_MIN_DRAWS;
  const archivePeriod = start && end ? `dal ${formatDate(start)} al ${formatDate(end)}` : '';
  const archiveSummary = `${whole.format(drawCount)} estrazioni ${archivePeriod}`;
  const text = columns.map(({ numbers }) => numbers.map(n => String(n).padStart(2, '0')).join(' - ')).join('\n');

  function generate() {
    if (!canGenerate) return;
    const { forbidden, checkedPlays } = getCover60History(savedPlays);
    const next = generateCover(kind, forbidden, weighted ? createCover60WeightedShuffle(stats) : undefined);
    setManualCopy(false);
    setGenerationError(!next);
    setStatus('');
    if (!next) return;
    void save({
      id: globalThis.crypto.randomUUID(),
      selectionNote: kind === 90 ? 'Tutti i 90 numeri, ripartiti a caso in 15 sestine.' : weighted ? `Selezione pesata sugli ultimi ${COVER60_ARCHIVE_YEARS} anni: ${archiveSummary}.`
        : `Selezione casuale uniforme: meno di ${COVER60_MIN_DRAWS} estrazioni nel periodo.`,
      historyMessage: checkedPlays === 1
        ? 'Nessuna sestina identica nella giocata SuperEnalotto controllata.'
        : checkedPlays > 1
          ? `Nessuna sestina identica nelle ${checkedPlays} giocate SuperEnalotto controllate.`
          : 'Nessuna giocata SuperEnalotto disponibile per il confronto. Il controllo sullo storico non è stato eseguito.',
      systemResult: { columns: next.map(({ numbers }) => ({ numbers })) }
    });
  }

  async function copy(forSisal = false) {
    try {
      await navigator.clipboard.writeText(text);
      setManualCopy(false);
      setStatus(forSisal
        ? `${count} sestine copiate. Su Sisal, inseriscile e controllale prima di confermare.`
        : `${count} sestine copiate.`);
    } catch {
      setManualCopy(true);
      setStatus('Copia automatica non disponibile. Puoi copiare le sestine dal campo di testo.');
    }
  }

  function register() {
    if (saved || saving || !playId || columns.length !== count || !latestDraw) return;
    const targetContestId = `${latestDraw.year}-${String(latestDraw.contestNumber + 1).padStart(3, '0')}`;
    onSavePlay({
      id: playId,
      createdAt: new Date().toISOString(),
      targetContestId,
      mode: 'pure_coverage',
      cost,
      savedAmount: 0,
      poolNumbers: columns.flatMap(column => column.numbers).sort((a, b) => a - b),
      columns,
      status: 'IN_ATTESA',
      manualNote: [kind === 90 ? 'Copertura 90 (15 sestine base, tutti i 90 numeri)' : 'Copertura 60 (10 sestine base, senza sovrapposizioni)', selectionNote].filter(Boolean).join(' · ')
    });
    setRegisteredId(playId);
    setStatus('Sestine aggiunte a Verifica & Bilancio. Nessun acquisto effettuato.');
  }

  return (
    <section aria-labelledby={`${tid}-heading`} className="space-y-5 rounded-2xl border border-emerald-800/70 bg-slate-900 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">SuperEnalotto base · 6/90</p>
          <h2 id={`${tid}-heading`} className="text-xl font-bold text-white">{name}</h2>
          <p className="max-w-xl text-sm text-slate-300">{kind === 90 ? '15 sestine da 1 €: ogni numero da 1 a 90 compare in una sola sestina.' : '10 sestine da 1 €, con 60 numeri distinti e nessuna sovrapposizione.'} Il browser calcola i numeri; il sistema viene salvato nel tuo account, non nel bilancio.</p>
        </div>
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/60 px-4 py-2">
          <span className="block text-xs text-emerald-200">Costo per concorso</span>
          <strong className="font-mono text-lg text-white">{euro.format(cost)}</strong>
        </div>
      </div>
      <div className="space-y-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200">
        <p className="font-semibold">{kind === 90 ? 'Numeri giocati' : 'Selezione dei 60 numeri'}</p>
        <p className="text-xs leading-relaxed">{kind === 90
          ? 'Si giocano tutti i 90 numeri: cambia solo come vengono divisi nelle 15 sestine, in modo casuale. L’archivio non serve.'
          : `Ritardo e frequenza hanno lo stesso peso. Si usano gli ultimi ${COVER60_ARCHIVE_YEARS} anni a partire dall’ultima estrazione in archivio, senza escludere alcun numero a priori.`}</p>
        <p data-testid={`${tid}-selection`} aria-live="polite" className="text-xs leading-relaxed">
          {selectionNote || (kind === 90 ? 'Nessuna sestina ancora generata.' : weighted
            ? `Archivio disponibile: ${archiveSummary}.`
            : `Con meno di ${COVER60_MIN_DRAWS} estrazioni nel periodo, la selezione è casuale uniforme.`)}
        </p>
        <p className="text-xs text-slate-400">Le statistiche storiche non aumentano le probabilità di vincita.</p>
      </div>
      <button type="button" data-testid={`${tid}-generate`} onClick={generate} disabled={!canGenerate}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:opacity-50 sm:w-auto">
        <Shuffle aria-hidden="true" className="h-4 w-4" />{columns.length ? regenerateLabel : `Genera ${count} sestine`}
      </button>
      <p role="status" data-testid={`${tid}-sync`} className="text-xs text-slate-300">
        {saving ? 'Salvataggio nel tuo account in corso…'
          : failed ? 'Salvataggio non riuscito. Il sistema precedente non è stato sostituito.'
          : sync === 'loading' ? 'Caricamento del sistema dal tuo account…'
          : sync !== 'ready' ? 'Sincronizzazione non disponibile. Riconnettiti o ricarica per generare nuove sestine.'
          : draft ? 'Sestine sincronizzate nel tuo account. I numeri cambiano solo con «Rigenera».'
          : 'Nessuna sestina salvata nel tuo account.'}
      </p>
      <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${generationError ? 'border-rose-800 bg-rose-950/50 text-rose-100' : 'border-slate-700 bg-slate-950 text-slate-200'}`}>
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <div>
          <p className="font-semibold">Controllo anti-duplicato attivo</p>
          <p data-testid={`${tid}-history-check`} aria-live="polite" className="mt-0.5 text-xs leading-relaxed">
            {generationError ? `Non è stato possibile generare ${count} sestine senza duplicati. Riprova.`
              : draft?.historyMessage || `Confronta ogni sestina con le ultime ${COVER60_HISTORY_LIMIT} giocate SuperEnalotto già caricate in Verifica & Bilancio.`}
          </p>
        </div>
      </div>
      {columns.length > 0 && (
        <>
          <GenerationDateNote generatedAt={draft?.generatedAt} regenerateLabel={regenerateLabel} testId={`${tid}-generated-at`} />
          <ol aria-label={`Sestine ${name}`} className="grid gap-2 sm:grid-cols-2">
            {columns.map(column => (
              <li key={column.id} data-testid={`${tid}-column`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-slate-700 bg-slate-950 p-2.5">
                <span className="text-xs font-semibold text-slate-300">Sestina {column.id}</span>
                <div className="flex gap-1">
                  {column.numbers.map(n => (
                    <span key={n} data-testid={`${tid}-number`} className="grid h-7 w-7 place-items-center rounded-md bg-emerald-950 font-mono text-sm font-semibold text-emerald-100">
                      {String(n).padStart(2, '0')}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <a href={SISAL_SUPERENALOTTO_URL} target="_blank" rel="noopener noreferrer"
              data-testid={`${tid}-copy-sisal`} onClick={() => void copy(true)}
              aria-describedby={`${tid}-sisal-note`} className={`${secondary} min-h-11 border-emerald-600/70`}>
              <ExternalLink aria-hidden="true" className="h-4 w-4" /> Copia e apri Sisal
            </a>
            <button type="button" data-testid={`${tid}-copy`} onClick={() => void copy()} className={secondary}><Copy aria-hidden="true" className="h-4 w-4" /> Copia {count} sestine</button>
            <button type="button" data-testid={`${tid}-register`} onClick={register} disabled={!latestDraw || saved || saving} className={secondary}>
              <BookmarkPlus aria-hidden="true" className="h-4 w-4" /> {saved ? 'Registrate nel bilancio' : 'Registra in Verifica & Bilancio'}
            </button>
          </div>
          <p id={`${tid}-sisal-note`} className="text-xs text-slate-400">Apre Sisal in un’altra scheda. Le sestine restano negli appunti: inserimento, verifica e pagamento sono manuali.</p>
          {!latestDraw && <p className="text-xs text-slate-400">Per registrare le sestine serve un concorso di riferimento nell’archivio.</p>}
          {manualCopy && (
            <label className="block text-sm text-slate-300">
              Sestine da copiare manualmente
              <textarea readOnly value={text} onFocus={e => e.currentTarget.select()} rows={count}
                className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 p-3 font-mono text-slate-100" />
            </label>
          )}
        </>
      )}
      <p role="status" className="text-sm text-emerald-200 empty:hidden">{status}</p>
      <div className="space-y-2 border-t border-slate-700 pt-4">
        <h3 className="text-sm font-bold text-white">Probabilità esatte per concorso</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {odds.filter(({ threshold }) => threshold !== 5).map(({ threshold, draws }) => (
            <div key={threshold} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
              <dt className="text-xs text-slate-300">{threshold === 6 ? '6 punti' : `Almeno ${threshold} punti`}</dt>
              <dd className="mt-1 font-mono text-xs font-bold text-emerald-200 sm:text-sm">
                {threshold === 6 ? `1 su ${whole.format(COVER60_TOTAL_DRAWS / draws)}` : `${pct.format(100 * draws / COVER60_TOTAL_DRAWS)}%`}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-400">La soglia è raggiunta da almeno una colonna in un’estrazione uniforme. Fare punti non equivale a recuperare i {euro.format(cost)}.</p>
      </div>
    </section>
  );
}
