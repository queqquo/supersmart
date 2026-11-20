import type { GeneratedColumn, SavedPlay } from '../types/lottery';
import { buildGeneratedColumn, fisherYatesCryptoShuffle } from './combinatorics';
import { isWinForItaliaPlay } from './winForItalia';

export const COVER60_COST = 10;
export const COVER60_TOTAL_DRAWS = 622_614_630;
export const COVER60_HISTORY_LIMIT = 10;
const COVER60_MAX_ATTEMPTS = 20;
const universe = Array.from({ length: 90 }, (_, i) => i + 1);
const emptyHistory = new Set<string>();

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

export function generateCover60(
  forbidden: ReadonlySet<string> = emptyHistory,
  shuffle = fisherYatesCryptoShuffle,
): GeneratedColumn[] | null {
  for (let attempt = 0; attempt < COVER60_MAX_ATTEMPTS; attempt++) {
    const numbers = shuffle(universe).slice(0, 60);
    const columns: GeneratedColumn[] = [];
    for (let i = 0; i < 10; i++) {
      const column = buildGeneratedColumn(i + 1, numbers.slice(i * 6, (i + 1) * 6));
      if (!column || forbidden.has(column.numbers.join(','))) break;
      columns.push(column);
    }
    if (columns.length === 10 && new Set(columns.flatMap(c => c.numbers)).size === 60) return columns;
  }
  return null;
}
