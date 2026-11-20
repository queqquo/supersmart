import type { GeneratedColumn } from '../types/lottery';
import { buildGeneratedColumn, fisherYatesCryptoShuffle } from './combinatorics';

export const COVER60_COST = 10;
export const COVER60_TOTAL_DRAWS = 622_614_630;

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

export function generateCover60(): GeneratedColumn[] {
  const numbers = fisherYatesCryptoShuffle(Array.from({ length: 90 }, (_, i) => i + 1)).slice(0, 60);
  return Array.from({ length: 10 }, (_, i) => {
    const column = buildGeneratedColumn(i + 1, numbers.slice(i * 6, (i + 1) * 6));
    if (!column) throw new Error('Colonna Copertura 60 non valida.');
    return column;
  });
}
