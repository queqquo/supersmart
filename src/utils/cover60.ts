import type { Draw, GeneratedColumn, SavedPlay } from '../types/lottery';
import { buildGeneratedColumn, fisherYatesCryptoShuffle, getCryptoRandomFloat } from './combinatorics';
import { isWinForItaliaPlay } from './winForItalia';

export const COVER60_COST = 10;
export const COVER60_TOTAL_DRAWS = 622_614_630;
export const COVER60_HISTORY_LIMIT = 10;
export const COVER60_ARCHIVE_YEARS = 2;
export const COVER60_MIN_DRAWS = 2;
const COVER60_MAX_ATTEMPTS = 20;
const universe = Array.from({ length: 90 }, (_, i) => i + 1);
const emptyHistory = new Set<string>();
type Cover60NumberStat = { currentDelay: number; frequency: number };

export type Cover60Draft = {
  id: string;
  selectionNote: string;
  historyMessage: string;
  systemResult: { columns: { numbers: number[] }[] };
  /** When these sestine were generated (from the account record's updatedAt, written only on generation). */
  generatedAt?: string;
};

/** Copertura 60: 10 disjoint sestine (60 numbers). Copertura 90: 15 disjoint sestine covering all 90 numbers. */
export type CoverKind = 60 | 90;
export const COVER90_COST = 15;
export const coverColumnCount = (kind: CoverKind) => kind / 6;

export function parseCoverDraft(raw: unknown, kind: CoverKind): Cover60Draft | null {
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as Partial<Cover60Draft>;
  const columns = draft.systemResult?.columns;
  if (typeof draft.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(draft.id) ||
      typeof draft.selectionNote !== 'string' || draft.selectionNote.length > 240 ||
      typeof draft.historyMessage !== 'string' || draft.historyMessage.length > 240 ||
      !Array.isArray(columns) || columns.length !== coverColumnCount(kind) ||
      columns.some(column => !column || !columnKey(column.numbers)) ||
      new Set(columns.flatMap(c => c.numbers)).size !== kind) return null;
  const stamped = raw as { generatedAt?: unknown; updatedAt?: unknown };
  const generatedAt = [stamped.generatedAt, stamped.updatedAt]
    .find((v): v is string => typeof v === 'string' && v.length <= 64 && !Number.isNaN(Date.parse(v)));
  return { id: draft.id, selectionNote: draft.selectionNote, historyMessage: draft.historyMessage,
    systemResult: { columns: columns.map(c => ({ numbers: [...c.numbers].sort((a, b) => a - b) })) },
    ...(generatedAt ? { generatedAt } : {}) };
}

export const parseCover60Draft = (raw: unknown) => parseCoverDraft(raw, 60);
export const parseCover90Draft = (raw: unknown) => parseCoverDraft(raw, 90);

// Counts for "at least one column reaches the threshold", not exact prize tiers.
// Enumerating the number of hits in each of ten groups of six, plus 30 unused numbers,
// gives the same result for every disjoint system.
export const COVER60_ODDS = [
  { threshold: 2, draws: 276_865_275 },
  { threshold: 3, draws: 19_566_750 },
  { threshold: 4, draws: 527_950 },
  { threshold: 5, draws: 5_050 },
  { threshold: 6, draws: 10 },
] as const;

// Same enumeration with fifteen groups of six and no unused numbers.
export const COVER90_ODDS = [
  { threshold: 2, draws: 389_101_350 },
  { threshold: 3, draws: 29_335_125 },
  { threshold: 4, draws: 791_925 },
  { threshold: 5, draws: 7_575 },
  { threshold: 6, draws: 15 },
] as const;

function columnKey(numbers: readonly number[]): string | null {
  if (!Array.isArray(numbers) || numbers.length !== 6 || new Set(numbers).size !== 6 ||
      !numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 90)) return null;
  return [...numbers].sort((a, b) => a - b).join(',');
}

export function getCover60History(plays: readonly SavedPlay[]) {
  // Input is the account-scoped, non-deleted ledger already loaded by the app.
  const recent = plays.filter(play => play && !isWinForItaliaPlay(play))
    .map(play => ({ play, timestamp: Date.parse(play.createdAt) || 0 }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, COVER60_HISTORY_LIMIT);
  const forbidden = new Set<string>();
  let checkedPlays = 0;
  for (const { play } of recent) {
    let checked = false;
    for (const column of Array.isArray(play.columns) ? play.columns : []) {
      const key = column && columnKey(column.numbers);
      if (!key) continue;
      forbidden.add(key);
      checked = true;
    }
    if (checked) checkedPlays++;
  }
  return { forbidden, checkedPlays };
}

export function getCover60ArchiveStats(draws: readonly Draw[]) {
  // Anchor the window to the latest available contest so the displayed period
  // and results remain reproducible for the same archive, even when offline.
  const end = draws.reduce<string | null>((latest, draw) =>
    latest === null || draw.date > latest ? draw.date : latest, null);
  let start: string | null = null;
  if (end) {
    const [year, month, day] = end.split('-').map(Number);
    const firstYear = year - COVER60_ARCHIVE_YEARS;
    const lastDayOfMonth = new Date(Date.UTC(firstYear, month, 0)).getUTCDate();
    start = new Date(Date.UTC(firstYear, month - 1, Math.min(day, lastDayOfMonth))).toISOString().slice(0, 10);
  }
  const recent = start === null ? [] : draws.filter(draw => draw.date >= start)
    .sort((a, b) => b.date.localeCompare(a.date) || b.contestNumber - a.contestNumber);
  const stats: Record<number, Cover60NumberStat> = Object.fromEntries(universe.map(n =>
    [n, { currentDelay: recent.length, frequency: 0 }]
  ));
  for (const [index, draw] of recent.entries()) {
    for (const n of draw.numbers) {
      if (stats[n].frequency === 0) stats[n].currentDelay = index;
      stats[n].frequency++;
    }
  }
  return { start, end, drawCount: recent.length, stats };
}

export function createCover60WeightedShuffle(
  stats: Readonly<Record<number, Cover60NumberStat>>,
  rng = getCryptoRandomFloat,
): (items: readonly number[]) => number[] {
  const maxDelay = Math.max(1, ...universe.map(n => stats[n].currentDelay));
  const maxFrequency = Math.max(1, ...universe.map(n => stats[n].frequency));
  const weights = universe.map(n => 1 + 0.5 * (
    stats[n].currentDelay / maxDelay + stats[n].frequency / maxFrequency
  ));

  // Exponential race: weighted sampling without replacement. Sorted arrival times
  // supply all 60 picks; a separate shuffle mixes them before forming columns.
  return items => {
    const pool = items.map(n => ({ n, arrival: -Math.log1p(-rng()) / weights[n - 1] }))
      .sort((a, b) => a.arrival - b.arrival)
      .slice(0, 60)
      .map(({ n }) => n);
    return fisherYatesCryptoShuffle(pool);
  };
}

export function generateCover(
  kind: CoverKind,
  forbidden: ReadonlySet<string> = emptyHistory,
  shuffle = fisherYatesCryptoShuffle,
): GeneratedColumn[] | null {
  const count = coverColumnCount(kind);
  for (let attempt = 0; attempt < COVER60_MAX_ATTEMPTS; attempt++) {
    const numbers = shuffle(universe).slice(0, kind);
    const columns: GeneratedColumn[] = [];
    for (let i = 0; i < count; i++) {
      const column = buildGeneratedColumn(i + 1, numbers.slice(i * 6, (i + 1) * 6));
      if (!column || forbidden.has(column.numbers.join(','))) break;
      columns.push(column);
    }
    if (columns.length === count && new Set(columns.flatMap(c => c.numbers)).size === kind) return columns;
  }
  return null;
}

export const generateCover60 = (forbidden: ReadonlySet<string> = emptyHistory, shuffle = fisherYatesCryptoShuffle) =>
  generateCover(60, forbidden, shuffle);
export const generateCover90 = (forbidden: ReadonlySet<string> = emptyHistory, shuffle = fisherYatesCryptoShuffle) =>
  generateCover(90, forbidden, shuffle);
