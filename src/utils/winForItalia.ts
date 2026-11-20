/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EXTERNAL_WINFORITALIA_RAW_URL } from '../config/externalDrawsRepo';
import {
  fetchCloudWinForItaliaDraws,
  upsertCloudWinForItaliaDraw,
  upsertManyCloudWinForItaliaDraws,
  clearCloudCustomDraws
} from './firebase';
import {
  SavedPlay,
  GeneratedColumn,
  PlayResult,
  ColumnMatchResult
} from '../types/lottery';
import {
  SavedPlayArchiveComparisonSummary,
  ArchiveDrawPlayComparisonRow,
  clampArchiveComparisonDrawsCount
} from './combinatorics';

export interface WinForItaliaDraw {
  id: string;
  contestNumber: number;
  year: number;
  date: string;
  time?: string;
  numbers: [number, number, number, number, number, number];
}

export interface WinForItaliaNumberStat {
  number: number;
  decade: number; // 0: 1-10, 1: 11-20, 2: 21-30, 3: 31-40
  frequencyWindow: number;
  currentDelay: number;
  maxDelay: number;
  affinityScore: number;
  geneticScore: number;
}

export interface WinForItaliaFunnelCandidate {
  num: number;
  decade: number;
  cadence: number;
  isExtreme: boolean;
  isCentral: boolean;
  isChaos: boolean;
  sameDecadeCount: number;
  sameCadenceCount: number;
  adjacentCount: number;
  clusterBonus: number;
  extremeBonus: number;
  isolationPenalty: number;
  totalFunnelScore: number;
  selectedInTop12: boolean;
  selectedInTop9?: boolean;
}

export interface WinForItaliaFunnelResult {
  genetic13: number[];
  chaos3: number[];
  pool16: number[];
  scoredPool16: WinForItaliaFunnelCandidate[];
  top12Numbers: number[];
  decadeDistributionTop12: Record<number, number>;
  top9Numbers: number[];
  decadeDistributionTop9: Record<number, number>;
}

export interface WinForItaliaRankedSestina {
  rank: number;
  numbers: [number, number, number, number, number, number];
  totalScore: number;
  sum: number;
  evenCount: number;
  oddCount: number;
  lowCount?: number; // 1..20
  highCount?: number; // 21..40
  extremesCount: number; // 1-8 and 33-40
  adjacentPairsCount: number;
  sameDecadePairsCount: number;
  maxPerDecade: number;
  decadeCounts: [number, number, number, number];
  geneticBaseScore: number;
  structuralScore: number;
}

export interface WinForItaliaSniperSelection {
  primarySestina: WinForItaliaRankedSestina;
  alternative2: WinForItaliaRankedSestina;
  alternative3: WinForItaliaRankedSestina;
  totalCombinationsEvaluated: number; // C(12,6) = 924
}

export interface WinForItaliaReduced3System {
  top9Numbers: number[];
  columns: [WinForItaliaRankedSestina, WinForItaliaRankedSestina, WinForItaliaRankedSestina];
  numberFrequencies: Record<number, number>;
  isPerfect2x: boolean;
  uniquePairsCovered: number;
  totalPairsInTop9: number; // C(9,2) = 36
  uniqueTripletsCovered: number;
  totalTripletsInTop9: number; // C(9,3) = 84
  totalCombinationsEvaluated: number; // C(9,6) = 84
}

export interface WinForItaliaWeeklyMonteCarloResult {
  totalSimulatedDraws: number;
  totalSimulatedWeeks: number;
  columnsCount: number; // 1 (2,00 €) or 3 (6,00 €)
  ticketCost: number; // 2.00 € or 6.00 €
  weeklyCost: number; // 14.00 € or 42.00 € (7 draws)
  totalSpent: number;
  totalEarned: number;
  averagePayoutPerDraw: number;
  averageWeeklyPayout: number;
  averageWeeklyRecoveryRatePct: number;
  expectedPunto2PerWeek: number;
  probAtLeastOneWinPerDrawPct: number;
  probAtLeastOnePunto2PerDrawPct: number;
  probAtLeastOnePunto3PerDrawPct: number;
  probAtLeastOneWinPerWeekPct: number;
  probAtLeastOnePunto2PerWeekPct: number;
  probAtLeastOnePunto3PerWeekPct: number;
  executionTimeMs: number;
  hitsByCategory: {
    punto2: number;
    punto3: number;
    punto4: number;
    punto5: number;
    punto6: number;
  };
  payoutByCategory: {
    punto2: number;
    punto3: number;
    punto4: number;
    punto5: number;
    punto6: number;
  };
}

export const WIN_FOR_ITALIA_PRIZES = {
  PUNTO_2: 2.0,
  PUNTO_3: 8.0,
  PUNTO_4: 50.0,
  PUNTO_5: 440.0,
  PUNTO_6: 10000.0
} as const;

export const WIN_FOR_ITALIA_STORAGE_KEY = 'winforitalia_external_archive_v3';
const LEGACY_WIN_FOR_ITALIA_STORAGE_KEY_V2 = 'winforitalia_custom_draws_delta_v2';
const LEGACY_WIN_FOR_ITALIA_STORAGE_KEY = 'winforitalia_custom_draws_delta_v1';

export const WIN_FOR_ITALIA_UI_LABELS = {
  title: 'Imbuto Cecchino 40→16→12→1 (13 Gen + 3 Caos)',
  shortBadge: 'Imbuto 40→12 (13 Gen + 3 Caos · Max 7 P/D)',
  subtitle: 'Competizione Pura Bilanciata (16 → 12 → 1 Sestina): Cluster + Estremi 1–8/33–40 • Max 3/Decina • Max 7 P/D',
  weightsDetail:
    'Rosa 16 (13 Genetici + 3 Caos su 1..40) valutata con Cluster (cap +45: Decina +12, Cadenza +8, Contigui ±2 +15), Estremi 1–8/33–40 (+40), Penalità Isolati (-30 / -5 estremi), limite Max 3 per decina e vincolo equilibrio Max 7 P/D nei Top 12. Sestina #1 estratta dalle C(12,6) = 924 combinazioni integrali.'
} as const;

export const WIN_FOR_ITALIA_REDUCED3_UI_LABELS = {
  title: 'Sistema Ridotto 40→16→9→3 (13 Gen + 3 Caos)',
  shortBadge: 'Imbuto 40→9 (13 Gen + 3 Caos · Max 5 P/D)',
  subtitle: 'Competizione Pura Bilanciata (16 → 9 → 3 Sestine): Cluster + Estremi 1–8/33–40 • Max 3/Decina • Max 5 P/D',
  weightsDetail:
    'Rosa 16 (13 Genetici + 3 Caos su 1..40) valutata con Cluster (cap +45), Estremi 1–8/33–40 (+40), Penalità Isolati (-30 / -5 estremi), limite Max 3 per decina e vincolo equilibrio Max 5 P/D (5/4 o 4/5) nei Top 9. Sviluppo ridotto a 3 Sestine su C(9,6) = 84 combinazioni con Copertura 2x Simmetrica (ogni numero dei 9 compare esattamente 2 volte).'
} as const;

/**
 * Helper to get decade index (0..3) for a number in 1..40:
 * 0 -> 1..10, 1 -> 11..20, 2 -> 21..30, 3 -> 31..40
 */
export function getWinForItaliaDecade(num: number): number {
  return Math.min(3, Math.max(0, Math.floor((num - 1) / 10)));
}

/**
 * Normalize and validate a 6-number array in 1..40
 */
export function isValidWinForItaliaSestina(nums: number[]): nums is [number, number, number, number, number, number] {
  if (!Array.isArray(nums) || nums.length !== 6) return false;
  const unique = new Set(nums);
  if (unique.size !== 6) return false;
  return nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 40);
}

export function normalizeWinForItaliaDrawList(rawList: unknown[]): WinForItaliaDraw[] {
  const mergedByDate = new Map<string, WinForItaliaDraw>();
  for (const item of rawList || []) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Partial<WinForItaliaDraw> & { concorso?: number };
    const dateStr = String(d.date || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (!Array.isArray(d.numbers) || !isValidWinForItaliaSestina(d.numbers.map(Number))) continue;
    const sorted = [...d.numbers].map(Number).sort((a, b) => a - b) as [
      number,
      number,
      number,
      number,
      number,
      number
    ];
    const year = parseInt(dateStr.slice(0, 4), 10);
    const contestNumber = Number(d.contestNumber || d.concorso || 0) || 1;
    const id =
      typeof d.id === 'string' && d.id.trim()
        ? d.id.trim()
        : `WFI-${year}-${String(contestNumber).padStart(3, '0')}`;
    mergedByDate.set(dateStr, {
      id,
      contestNumber,
      year,
      date: dateStr,
      time: d.time || '20:00',
      numbers: sorted
    });
  }

  return Array.from(mergedByDate.values()).sort((a, b) => {
    const cmp = b.date.localeCompare(a.date);
    if (cmp !== 0) return cmp;
    return b.contestNumber - a.contestNumber;
  });
}

/**
 * Load cached Win for Italia Team / Win for Life (6/40) draws from localStorage.
 * Full official history is loaded asynchronously from the external GitHub repository + Cloud Firestore
 * so no heavy JSON file lives inside the app repo (zero AI Studio token overhead).
 */
export function loadWinForItaliaDraws(): WinForItaliaDraw[] {
  const collected: unknown[] = [];

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_WIN_FOR_ITALIA_STORAGE_KEY);
      for (const key of [LEGACY_WIN_FOR_ITALIA_STORAGE_KEY_V2, WIN_FOR_ITALIA_STORAGE_KEY]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          collected.push(...parsed);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  return normalizeWinForItaliaDrawList(collected);
}

/**
 * Save merged Win for Italia Team / Win for Life (6/40) archive cache to localStorage
 */
export function saveWinForItaliaDraws(draws: WinForItaliaDraw[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const clean = normalizeWinForItaliaDrawList(draws);
    localStorage.setItem(WIN_FOR_ITALIA_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Parse rapid manual entry of 6 comma-separated (or space-separated) numbers between 1 and 40
 */
export function parseWinForItaliaManualInput(
  rawInput: string,
  existingHistory: WinForItaliaDraw[],
  customDate?: string
): { draw?: WinForItaliaDraw; error?: string } {
  const cleaned = String(rawInput || '').trim();
  if (!cleaned) {
    return { error: 'Inserisci 6 numeri tra 1 e 40 separati da virgola (es. 4, 11, 18, 25, 34, 39).' };
  }

  const tokens = cleaned
    .split(/[\s,;.-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length !== 6) {
    return {
      error: `Trovati ${tokens.length} valori: inserisci esattamente 6 numeri distinti compresi tra 1 e 40.`
    };
  }

  const nums = tokens.map((t) => Number(t));
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 40)) {
    return {
      error: 'Tutti i 6 numeri devono essere interi compresi tra 1 e 40 (estremi inclusi).'
    };
  }

  const unique = new Set(nums);
  if (unique.size !== 6) {
    return {
      error: 'I 6 numeri devono essere tutti diversi tra loro (nessun duplicato).'
    };
  }

  const sorted = [...nums].sort((a, b) => a - b) as [number, number, number, number, number, number];
  const dateStr =
    customDate && /^\d{4}-\d{2}-\d{2}$/.test(customDate)
      ? customDate
      : new Date().toISOString().slice(0, 10);
  const year = parseInt(dateStr.slice(0, 4), 10);
  const existingForDate = existingHistory.find((d) => d.date === dateStr);
  const maxContestInYear = existingHistory
    .filter((d) => d.year === year)
    .reduce((max, d) => Math.max(max, d.contestNumber), 0);
  const targetContest = existingForDate ? existingForDate.contestNumber : maxContestInYear + 1;

  const draw: WinForItaliaDraw = {
    id: existingForDate ? existingForDate.id : `WFI-${year}-${String(targetContest).padStart(3, '0')}`,
    contestNumber: targetContest,
    year,
    date: dateStr,
    time: '20:00',
    numbers: sorted
  };

  return { draw };
}

/**
 * Insert a new manual or synced Win for Italia Team draw into history and persist
 * across localStorage, Cloud Firestore (cross-browser/cross-device), and External GitHub API.
 */
export function insertWinForItaliaDraw(newDraw: WinForItaliaDraw): WinForItaliaDraw[] {
  const current = loadWinForItaliaDraws();
  const merged = normalizeWinForItaliaDrawList([...current, newDraw]);
  saveWinForItaliaDraws(merged);
  upsertCloudWinForItaliaDraw(newDraw).catch(() => {});
  if (typeof fetch !== 'undefined') {
    fetch('/api/draws', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'winforitalia', action: 'upsert', draw: newDraw })
    }).catch(() => {
      // Ignore if offline or in unit test environment
    });
  }
  return merged;
}

async function fetchExternalWinForItaliaBase(): Promise<unknown[]> {
  if (typeof fetch === 'undefined') return [];

  try {
    const apiRes = await fetch('/api/draws?game=winforitalia', { cache: 'no-store' });
    const ct = apiRes.headers.get('content-type') || '';
    if (apiRes.ok && ct.includes('application/json')) {
      const payload = await apiRes.json();
      if (Array.isArray(payload?.draws) && payload.draws.length > 0) {
        return payload.draws;
      }
    }
  } catch {
    // Fallback to direct external GitHub Raw URL below
  }

  try {
    const rawRes = await fetch(`${EXTERNAL_WINFORITALIA_RAW_URL}?t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (rawRes.ok) {
      const parsed = await rawRes.json();
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.draws)) return parsed.draws;
    }
  } catch {
    // Offline fallback
  }

  return [];
}

/**
 * Startup loader: merges external GitHub archive + Cloud Firestore + localStorage cache
 */
export async function loadAndMergeWinForItaliaDraws(): Promise<WinForItaliaDraw[]> {
  const localDraws = loadWinForItaliaDraws();
  const [externalRecords, cloudDraws] = await Promise.all([
    fetchExternalWinForItaliaBase(),
    fetchCloudWinForItaliaDraws().catch(() => null)
  ]);

  const merged = normalizeWinForItaliaDrawList([
    ...localDraws,
    ...externalRecords,
    ...(cloudDraws || [])
  ]);
  if (merged.length > 0) {
    saveWinForItaliaDraws(merged);
  }
  return merged;
}

/**
 * Sync Win for Italia Team / Win for Life (6/40) archive from live sources via /api/draws,
 * commit back to external GitHub repo if configured, and persist new draws to Cloud Firestore.
 */
export async function syncWinForItaliaDrawsFromServer(): Promise<{
  draws: WinForItaliaDraw[];
  addedOrUpdated: number;
  latestDate: string;
  persistedToGitHub: boolean;
  persistedToCloud: boolean;
}> {
  const current = loadWinForItaliaDraws();
  const prevKeys = new Set(current.map((d) => `${d.date}|${d.id}|${d.numbers.join(',')}`));

  let serverDraws: unknown[] = [];
  let persistedToGitHub = false;

  if (typeof fetch !== 'undefined') {
    try {
      const res = await fetch('/api/draws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'winforitalia', action: 'sync' })
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const payload = await res.json();
        if (Array.isArray(payload?.draws) && payload.draws.length > 0) {
          serverDraws = payload.draws;
          persistedToGitHub = Boolean(payload?.persistedToGitHub);
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (serverDraws.length === 0) {
    serverDraws = await fetchExternalWinForItaliaBase();
  }

  const cloudDraws = (await fetchCloudWinForItaliaDraws().catch(() => null)) || [];
  const merged = normalizeWinForItaliaDrawList([...current, ...serverDraws, ...cloudDraws]);

  let addedOrUpdated = 0;
  const newlyFound: WinForItaliaDraw[] = [];
  for (const d of merged) {
    const sig = `${d.date}|${d.id}|${d.numbers.join(',')}`;
    if (!prevKeys.has(sig)) {
      addedOrUpdated++;
      newlyFound.push(d);
    }
  }

  if (merged.length > 0) {
    saveWinForItaliaDraws(merged);
  }

  let persistedToCloud = false;
  if (newlyFound.length > 0) {
    persistedToCloud = await upsertManyCloudWinForItaliaDraws(newlyFound).catch(() => false);
  }

  return {
    draws: merged,
    addedOrUpdated,
    latestDate: merged[0]?.date || '',
    persistedToGitHub,
    persistedToCloud
  };
}

/**
 * Cancella l'archivio locale + delta Cloud Firestore di Win for Italia / Win for Life (6/40)
 * e ripristina l'intero storico ufficiale reale da Sisal/archivi ufficiali + Repo GitHub esterno.
 */
export async function resetAndRestoreWinForItaliaArchive(): Promise<{
  draws: WinForItaliaDraw[];
  count: number;
  latestDate: string;
  oldestDate: string;
  persistedToGitHub: boolean;
}> {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(WIN_FOR_ITALIA_STORAGE_KEY);
      localStorage.removeItem(LEGACY_WIN_FOR_ITALIA_STORAGE_KEY_V2);
      localStorage.removeItem(LEGACY_WIN_FOR_ITALIA_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  await clearCloudCustomDraws('winforitalia').catch(() => false);

  let restoredRaw: unknown[] = [];
  let persistedToGitHub = false;

  if (typeof fetch !== 'undefined') {
    try {
      const res = await fetch('/api/draws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'winforitalia', action: 'reset_restore' })
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const payload = await res.json();
        if (Array.isArray(payload?.draws) && payload.draws.length > 0) {
          restoredRaw = payload.draws;
          persistedToGitHub = Boolean(payload?.persistedToGitHub);
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (restoredRaw.length === 0) {
    restoredRaw = await fetchExternalWinForItaliaBase();
  }

  const cleanRestored = normalizeWinForItaliaDrawList(restoredRaw);
  if (cleanRestored.length > 0) {
    saveWinForItaliaDraws(cleanRestored);
  }

  return {
    draws: cleanRestored,
    count: cleanRestored.length,
    latestDate: cleanRestored[0]?.date || '',
    oldestDate: cleanRestored[cleanRestored.length - 1]?.date || '',
    persistedToGitHub
  };
}

/**
 * Import Win for Italia / Win for Life (6/40) draws from JSON or CSV and persist
 * across localStorage, Cloud Firestore, and External GitHub repo.
 */
export async function importWinForItaliaDraws(
  content: string,
  isCsv: boolean
): Promise<{ draws: WinForItaliaDraw[]; importedCount: number; persistedToGitHub: boolean }> {
  const current = loadWinForItaliaDraws();
  const prevKeys = new Set(current.map((d) => `${d.date}|${d.numbers.join(',')}`));
  const incoming: unknown[] = [];

  if (isCsv) {
    const lines = content.trim().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^[a-zA-Z]/.test(line) && !line.toUpperCase().startsWith('WFI-')) continue;
      const parts = line.split(/[;,]/).map((p) => p.trim());
      // Format: Concorso,Anno,Data,Ora,N1,N2,N3,N4,N5,N6
      if (parts.length >= 10) {
        const id = parts[0];
        const dateRaw = parts[2];
        const isoDate = /^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)
          ? `${dateRaw.slice(6, 10)}-${dateRaw.slice(3, 5)}-${dateRaw.slice(0, 2)}`
          : dateRaw;
        const nums = parts.slice(4, 10).map((n) => parseInt(n, 10));
        const m = id.match(/(\d+)$/);
        incoming.push({
          id,
          contestNumber: m ? parseInt(m[1], 10) : i + 1,
          year: parseInt(isoDate.slice(0, 4), 10) || 2026,
          date: isoDate,
          time: parts[3] || '20:00',
          numbers: nums
        });
      }
    }
  } else {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.draws) ? parsed.draws : [];
    incoming.push(...list);
  }

  const validIncoming = normalizeWinForItaliaDrawList(incoming);
  const merged = normalizeWinForItaliaDrawList([...current, ...validIncoming]);
  saveWinForItaliaDraws(merged);

  const importedDraws = merged.filter((d) => !prevKeys.has(`${d.date}|${d.numbers.join(',')}`));

  let persistedToGitHub = false;
  if (validIncoming.length > 0) {
    await upsertManyCloudWinForItaliaDraws(validIncoming).catch(() => {});
    if (typeof fetch !== 'undefined') {
      persistedToGitHub = await fetch('/api/draws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'winforitalia', action: 'import', draws: validIncoming })
      })
        .then(async (res) => {
          if (!res.ok) return false;
          const data = await res.json().catch(() => null);
          return Boolean(data?.persistedToGitHub);
        })
        .catch(() => false);
    }
  }

  return {
    draws: merged,
    importedCount: importedDraws.length,
    persistedToGitHub
  };
}

/**
 * Calculate dynamic historical statistics on numbers 1..40 using windowSize = Math.min(history.length, 50)
 */
export function calculateWinForItaliaStats(history: WinForItaliaDraw[]): {
  windowSize: number;
  stats: WinForItaliaNumberStat[];
} {
  const windowSize = Math.min(history.length, 50);
  const recentWindow = history.slice(0, windowSize);
  const lastDrawNumbers = new Set(recentWindow[0]?.numbers || []);

  const freqMap = new Array<number>(41).fill(0);
  const currentDelayMap = new Array<number>(41).fill(windowSize);
  const maxDelayMap = new Array<number>(41).fill(0);
  const lastSeenIndex = new Array<number>(41).fill(-1);
  const coOccurrenceScore = new Array<number>(41).fill(0);

  // Compute delays and frequency over the dynamic window (up to 50 draws)
  for (let idx = 0; idx < recentWindow.length; idx++) {
    const draw = recentWindow[idx];
    const hasOverlapWithLatest =
      idx > 0 && draw.numbers.some((n) => lastDrawNumbers.has(n));

    for (const num of draw.numbers) {
      if (num < 1 || num > 40) continue;
      freqMap[num]++;

      if (lastSeenIndex[num] === -1) {
        currentDelayMap[num] = idx;
        maxDelayMap[num] = idx;
      } else {
        const gap = idx - lastSeenIndex[num] - 1;
        if (gap > maxDelayMap[num]) {
          maxDelayMap[num] = gap;
        }
      }
      lastSeenIndex[num] = idx;

      if (hasOverlapWithLatest) {
        coOccurrenceScore[num] += 1;
      }
    }
  }

  for (let num = 1; num <= 40; num++) {
    if (lastSeenIndex[num] === -1) {
      currentDelayMap[num] = windowSize;
      maxDelayMap[num] = windowSize;
    } else {
      const tailGap = windowSize - 1 - lastSeenIndex[num];
      if (tailGap > maxDelayMap[num]) {
        maxDelayMap[num] = tailGap;
      }
    }
  }

  const maxFreq = Math.max(1, ...freqMap.slice(1));
  const maxDel = Math.max(1, ...currentDelayMap.slice(1));
  const maxAff = Math.max(1, ...coOccurrenceScore.slice(1));

  const stats: WinForItaliaNumberStat[] = [];
  for (let num = 1; num <= 40; num++) {
    const normFreq = (freqMap[num] / maxFreq) * 100;
    const normDelay = (currentDelayMap[num] / maxDel) * 100;
    const normAff = (coOccurrenceScore[num] / maxAff) * 100;

    // Genetic composite score (45% cyclic frequency + 35% delay tension + 20% spia affinity)
    const geneticScore = Number((normFreq * 0.45 + normDelay * 0.35 + normAff * 0.20).toFixed(2));

    stats.push({
      number: num,
      decade: getWinForItaliaDecade(num),
      frequencyWindow: freqMap[num],
      currentDelay: currentDelayMap[num],
      maxDelay: maxDelayMap[num],
      affinityScore: Number(normAff.toFixed(1)),
      geneticScore
    });
  }

  return {
    windowSize,
    stats: stats.sort((a, b) => b.geneticScore - a.geneticScore || a.number - b.number)
  };
}

/**
 * Balanced Funnel Scoring 16 -> N (N = 12 for Cecchino, N = 9 for Sistema Ridotto) for Win for Italia Team (6/40):
 * - Cluster (cap max +45 pt): Ambi decina (1-10, 11-20, 21-30, 31-40) +12, cadenza +8, contigui ±2 +15
 * - Estremi (1-8 e 33-40): +40 pt
 * - Penalità isolati: -30 pt (-5 pt se estremo)
 * - Limite morbido decina: massimo 3 numeri per singola decina
 * - Vincolo Equilibrio Pari/Dispari: max 7 Pari o 7 Dispari su 12 numeri; max 5 Pari o 5 Dispari su 9 numeri (5/4 o 4/5)
 */
export function selectBalancedTop12ForWinForItalia(
  pool16: number[],
  chaosSet: Set<number> = new Set(),
  targetCount: number = 12
): {
  top12Numbers: number[];
  scoredPool16: WinForItaliaFunnelCandidate[];
  decadeDistributionTop12: Record<number, number>;
} {
  const uniquePool = Array.from(new Set(pool16)).filter((n) => n >= 1 && n <= 40);
  const clampedTarget = Math.min(uniquePool.length || targetCount, Math.max(6, Math.round(targetCount || 12)));

  const rawCandidates = uniquePool.map((num) => {
    const decade = getWinForItaliaDecade(num);
    const cadence = num % 10;
    const isExtreme = num <= 8 || num >= 33;
    const isCentral = num >= 15 && num <= 26;

    const sameDecadeCount = uniquePool.filter(
      (n) => n !== num && getWinForItaliaDecade(n) === decade
    ).length;
    const sameCadenceCount = uniquePool.filter(
      (n) => n !== num && n % 10 === cadence
    ).length;
    const adjacentCount = uniquePool.filter(
      (n) => n !== num && Math.abs(n - num) <= 2
    ).length;

    // 1. BONUS CLUSTERING CON TETTO MASSIMO (max +45 pt totali)
    const rawClusterScore =
      Math.min(sameDecadeCount, 2) * 12 +
      Math.min(sameCadenceCount, 2) * 8 +
      Math.min(adjacentCount, 2) * 15;
    const clusterBonus = Math.min(rawClusterScore, 45);

    // 2. BONUS POLARIZZAZIONE EQUILIBRATO (+40 pt agli estremi 1-8 e 33-40)
    const extremeBonus = isExtreme ? 40 : 0;

    // 3. PENALITÀ DISPERSIONE MIRATA (-30 pt isolati, -5 pt se estremo)
    let isolationPenalty = 0;
    if (sameDecadeCount === 0 && adjacentCount === 0) {
      isolationPenalty = isExtreme ? -5 : -30;
    } else if (isCentral && adjacentCount === 0) {
      isolationPenalty = -15;
    }

    const totalFunnelScore = clusterBonus + extremeBonus + isolationPenalty;

    return {
      num,
      decade,
      cadence,
      isExtreme,
      isCentral,
      isChaos: chaosSet.has(num),
      sameDecadeCount,
      sameCadenceCount,
      adjacentCount,
      clusterBonus,
      extremeBonus,
      isolationPenalty,
      totalFunnelScore,
      selectedInTop12: false,
      selectedInTop9: false
    };
  });

  // Sort descending by score
  rawCandidates.sort((a, b) => b.totalFunnelScore - a.totalFunnelScore || a.num - b.num);

  // 4. SELEZIONE FINALE CON LIMITE DECINA (max 3) E PARITÀ (max 7 su 12 / max 5 su 9)
  const selected: number[] = [];
  const decadeCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const maxPerParity = clampedTarget === 9 ? 5 : Math.ceil(clampedTarget / 2) + 1;
  let evenCount = 0;
  let oddCount = 0;

  for (const item of rawCandidates) {
    if (selected.length >= clampedTarget) break;
    const currentDecadeCount = decadeCounts[item.decade] || 0;
    const isEven = item.num % 2 === 0;

    if (currentDecadeCount < 3) {
      if (isEven && evenCount < maxPerParity) {
        selected.push(item.num);
        decadeCounts[item.decade] = currentDecadeCount + 1;
        evenCount++;
        item.selectedInTop12 = true;
      } else if (!isEven && oddCount < maxPerParity) {
        selected.push(item.num);
        decadeCounts[item.decade] = currentDecadeCount + 1;
        oddCount++;
        item.selectedInTop12 = true;
      }
    }
  }

  // Fallback di sicurezza: prima prova a rispettare SEMPRE il limite di decina (max 3 per decina), poi completa
  if (selected.length < clampedTarget) {
    for (const item of rawCandidates) {
      if (selected.length >= clampedTarget) break;
      if (!selected.includes(item.num)) {
        const currentDecadeCount = decadeCounts[item.decade] || 0;
        if (currentDecadeCount < 3) {
          selected.push(item.num);
          decadeCounts[item.decade] = currentDecadeCount + 1;
          if (item.num % 2 === 0) evenCount++;
          else oddCount++;
          item.selectedInTop12 = true;
        }
      }
    }
  }

  if (selected.length < clampedTarget) {
    for (const item of rawCandidates) {
      if (selected.length >= clampedTarget) break;
      if (!selected.includes(item.num)) {
        selected.push(item.num);
        decadeCounts[item.decade] = (decadeCounts[item.decade] || 0) + 1;
        item.selectedInTop12 = true;
      }
    }
  }

  return {
    top12Numbers: [...selected].sort((a, b) => a - b),
    scoredPool16: rawCandidates,
    decadeDistributionTop12: decadeCounts
  };
}

/**
 * Full 40 -> 16 (13 Genetic + 3 Chaos) -> 12 & 9 Funnel for Win for Italia Team
 */
export function runWinForItaliaFunnel40To12(
  rankedStats: WinForItaliaNumberStat[],
  rng: () => number = Math.random
): WinForItaliaFunnelResult {
  const sortedStats = [...rankedStats].sort(
    (a, b) => b.geneticScore - a.geneticScore || a.number - b.number
  );

  // Ensure each of the 4 decades (1-10, 11-20, 21-30, 31-40) contributes its top 3 genetic candidates (4x3=12)
  // with at least 1 even and 1 odd per decade so that both Max 3/Decade and Max P/D (Max 7 on 12, Max 5 on 9) are always satisfied.
  const genetic13: number[] = [];
  const pickedGenetic = new Set<number>();

  for (let dec = 0; dec < 4; dec++) {
    const decCandidates = sortedStats.filter((s) => s.decade === dec);
    const topEven = decCandidates.find((s) => s.number % 2 === 0);
    const topOdd = decCandidates.find((s) => s.number % 2 !== 0);
    if (topEven && !pickedGenetic.has(topEven.number)) {
      genetic13.push(topEven.number);
      pickedGenetic.add(topEven.number);
    }
    if (topOdd && !pickedGenetic.has(topOdd.number)) {
      genetic13.push(topOdd.number);
      pickedGenetic.add(topOdd.number);
    }
    for (const cand of decCandidates) {
      const decCount = genetic13.filter((n) => getWinForItaliaDecade(n) === dec).length;
      if (decCount >= 3) break;
      if (!pickedGenetic.has(cand.number)) {
        genetic13.push(cand.number);
        pickedGenetic.add(cand.number);
      }
    }
  }

  for (const s of sortedStats) {
    if (genetic13.length >= 13) break;
    if (!pickedGenetic.has(s.number)) {
      genetic13.push(s.number);
      pickedGenetic.add(s.number);
    }
  }

  const chaos3: number[] = [];
  const existingSet = new Set<number>(genetic13);

  let guard = 0;
  while (chaos3.length < 3 && guard < 500) {
    guard++;
    const randNum = Math.floor(rng() * 40) + 1;
    if (!existingSet.has(randNum)) {
      existingSet.add(randNum);
      chaos3.push(randNum);
    }
  }

  // Deterministic fill if rng produced collisions
  for (let n = 1; n <= 40 && chaos3.length < 3; n++) {
    if (!existingSet.has(n)) {
      existingSet.add(n);
      chaos3.push(n);
    }
  }

  const pool16 = [...genetic13, ...chaos3];
  const chaosSet = new Set(chaos3);

  const { top12Numbers, scoredPool16, decadeDistributionTop12 } =
    selectBalancedTop12ForWinForItalia(pool16, chaosSet, 12);

  const { top12Numbers: top9Numbers, decadeDistributionTop12: decadeDistributionTop9 } =
    selectBalancedTop12ForWinForItalia(pool16, chaosSet, 9);

  const top9Set = new Set(top9Numbers);
  for (const cand of scoredPool16) {
    cand.selectedInTop9 = top9Set.has(cand.num);
  }

  return {
    genetic13,
    chaos3,
    pool16,
    scoredPool16,
    top12Numbers,
    decadeDistributionTop12,
    top9Numbers,
    decadeDistributionTop9
  };
}

/**
 * Score a single 6/40 sestina according to structural filters (Pari/Dispari 3/3 o 4/2, Somma 95-150,
 * Estremi 1-8/33-40, Coppie contigue o decina, Max 3 per decina) and genetic score.
 */
export function scoreWinForItaliaSestina(
  rawCombo: number[],
  statScoreMap?: Map<number, number>
): Omit<WinForItaliaRankedSestina, 'rank'> {
  const combo = [...rawCombo].slice(0, 6).sort((a, b) => a - b) as [
    number,
    number,
    number,
    number,
    number,
    number
  ];

  let sum = 0;
  let evenCount = 0;
  let lowCount = 0;
  let extremesCount = 0;
  let adjacentPairsCount = 0;
  let sameDecadePairsCount = 0;
  let geneticSum = 0;
  const decadeCounts: [number, number, number, number] = [0, 0, 0, 0];

  for (let k = 0; k < 6; k++) {
    const val = combo[k];
    sum += val;
    if (val % 2 === 0) evenCount++;
    if (val <= 20) lowCount++;
    if (val <= 8 || val >= 33) extremesCount++;
    const dec = getWinForItaliaDecade(val);
    decadeCounts[dec]++;
    geneticSum += statScoreMap?.get(val) ?? 50;

    if (k > 0 && combo[k] - combo[k - 1] <= 2) {
      adjacentPairsCount++;
    }
  }

  for (let d = 0; d < 4; d++) {
    if (decadeCounts[d] >= 2) {
      sameDecadePairsCount += (decadeCounts[d] * (decadeCounts[d] - 1)) / 2;
    }
  }

  const oddCount = 6 - evenCount;
  const highCount = 6 - lowCount;
  const maxPerDecade = Math.max(...decadeCounts);

  let structuralScore = 0;

  // 1. Bilanciamento Pari/Dispari (3/3 o 4/2 - 2/4)
  if (evenCount === 3 && oddCount === 3) {
    structuralScore += 35;
  } else if (evenCount === 4 || evenCount === 2) {
    structuralScore += 22;
  } else {
    structuralScore -= 45;
  }

  // 2. Somma fisiologica per 6/40 (95 - 150, centro ideale ~123)
  if (sum >= 95 && sum <= 150) {
    const distFromIdeal = Math.abs(sum - 123);
    structuralScore += 35 + Math.max(0, 15 - distFromIdeal * 0.5);
  } else {
    structuralScore -= 50;
  }

  // 3. Presenza di almeno 1-2 estremi (1-8 / 33-40)
  if (extremesCount >= 1 && extremesCount <= 2) {
    structuralScore += 32;
  } else if (extremesCount === 3) {
    structuralScore += 20;
  } else {
    structuralScore -= 35;
  }

  // 4. Presenza di almeno 1 coppia contigua (±1/±2) o d'ambo di decina
  if (adjacentPairsCount >= 1 && adjacentPairsCount <= 2) {
    structuralScore += 28;
  } else if (sameDecadePairsCount >= 1) {
    structuralScore += 18;
  } else {
    structuralScore -= 25;
  }

  // 5. Massimo 3 numeri nella stessa decina
  if (maxPerDecade <= 2) {
    structuralScore += 25;
  } else if (maxPerDecade === 3) {
    structuralScore += 15;
  } else {
    structuralScore -= 80;
  }

  const geneticBaseScore = Number((geneticSum / 6).toFixed(2));
  const totalScore = Number((structuralScore + geneticBaseScore * 0.35).toFixed(2));

  return {
    numbers: combo,
    totalScore,
    sum,
    evenCount,
    oddCount,
    lowCount,
    highCount,
    extremesCount,
    adjacentPairsCount,
    sameDecadePairsCount,
    maxPerDecade,
    decadeCounts,
    geneticBaseScore,
    structuralScore: Number(structuralScore.toFixed(2))
  };
}

/**
 * Generate all C(12, 6) = 924 integral sestine in memory and score them in "Cecchino" mode
 * to extract Sestina #1 (2,00 €) and alternatives #2 and #3.
 */
export function selectSniperSestinaFromTop12(
  top12Numbers: number[],
  stats: WinForItaliaNumberStat[]
): WinForItaliaSniperSelection {
  const pool = [...top12Numbers].slice(0, 12).sort((a, b) => a - b);
  const statScoreMap = new Map<number, number>();
  for (const s of stats) {
    statScoreMap.set(s.number, s.geneticScore);
  }

  const evaluated: Omit<WinForItaliaRankedSestina, 'rank'>[] = [];

  const n = pool.length;
  for (let i0 = 0; i0 < n - 5; i0++) {
    for (let i1 = i0 + 1; i1 < n - 4; i1++) {
      for (let i2 = i1 + 1; i2 < n - 3; i2++) {
        for (let i3 = i2 + 1; i3 < n - 2; i3++) {
          for (let i4 = i3 + 1; i4 < n - 1; i4++) {
            for (let i5 = i4 + 1; i5 < n; i5++) {
              const combo = [
                pool[i0],
                pool[i1],
                pool[i2],
                pool[i3],
                pool[i4],
                pool[i5]
              ];
              evaluated.push(scoreWinForItaliaSestina(combo, statScoreMap));
            }
          }
        }
      }
    }
  }

  evaluated.sort((a, b) => b.totalScore - a.totalScore || a.sum - b.sum);

  const primarySestina: WinForItaliaRankedSestina = {
    ...evaluated[0],
    rank: 1
  };

  // Pick #2 and #3 with slight diversity (avoiding 5/6 identical numbers to #1 when possible)
  const diverseCandidates = evaluated.slice(1).filter((cand) => {
    const overlapWith1 = cand.numbers.filter((n) => primarySestina.numbers.includes(n)).length;
    return overlapWith1 <= 4;
  });

  const alt2Source = diverseCandidates[0] || evaluated[1] || evaluated[0];
  const alt3Source =
    diverseCandidates.find((cand) => {
      const overlapWith2 = cand.numbers.filter((n) => alt2Source.numbers.includes(n)).length;
      return overlapWith2 <= 4;
    }) ||
    diverseCandidates[1] ||
    evaluated[2] ||
    evaluated[0];

  return {
    primarySestina,
    alternative2: { ...alt2Source, rank: 2 },
    alternative3: { ...alt3Source, rank: 3 },
    totalCombinationsEvaluated: evaluated.length
  };
}

/**
 * Sistema Ridotto 6,00 € (3 Sestine) su Pool Base di 9 Numeri:
 * - Genera tutte le C(9, 6) = 84 sestine integrali
 * - Valuta ogni sestina con scoreWinForItaliaSestina
 * - Trova la terna [s1, s2, s3] con il punteggio strutturale complessivo più alto in cui
 *   OGNI numero del pool Top 9 compare esattamente 2 volte (9 x 2 = 18 posizioni -> Copertura 2x Simmetrica).
 */
export function generateReduced3Columns(
  top9: number[],
  stats: WinForItaliaNumberStat[] = []
): WinForItaliaReduced3System {
  const pool9 = Array.from(new Set(top9))
    .filter((n) => n >= 1 && n <= 40)
    .slice(0, 9)
    .sort((a, b) => a - b);

  // If fewer than 9 numbers were passed, pad deterministically from 1..40
  for (let n = 1; n <= 40 && pool9.length < 9; n++) {
    if (!pool9.includes(n)) pool9.push(n);
  }
  pool9.sort((a, b) => a - b);

  const statScoreMap = new Map<number, number>();
  for (const s of stats) {
    statScoreMap.set(s.number, s.geneticScore);
  }

  // 1. Genera tutte le C(9, 6) = 84 sestine possibili
  const allSestine: Omit<WinForItaliaRankedSestina, 'rank'>[] = [];
  const n = pool9.length;
  for (let i0 = 0; i0 < n - 5; i0++) {
    for (let i1 = i0 + 1; i1 < n - 4; i1++) {
      for (let i2 = i1 + 1; i2 < n - 3; i2++) {
        for (let i3 = i2 + 1; i3 < n - 2; i3++) {
          for (let i4 = i3 + 1; i4 < n - 1; i4++) {
            for (let i5 = i4 + 1; i5 < n; i5++) {
              allSestine.push(
                scoreWinForItaliaSestina(
                  [pool9[i0], pool9[i1], pool9[i2], pool9[i3], pool9[i4], pool9[i5]],
                  statScoreMap
                )
              );
            }
          }
        }
      }
    }
  }

  // 2. Ordina per punteggio strutturale decrescente
  const scored = [...allSestine].sort((a, b) => b.totalScore - a.totalScore || a.sum - b.sum);

  // 3. Cerca la migliore terna [s1, s2, s3] con copertura perfettamente simmetrica (ogni numero esattamente 2 volte)
  const findBest2xTriplet = (
    candidates: Omit<WinForItaliaRankedSestina, 'rank'>[]
  ): [
    Omit<WinForItaliaRankedSestina, 'rank'>,
    Omit<WinForItaliaRankedSestina, 'rank'>,
    Omit<WinForItaliaRankedSestina, 'rank'>
  ] | null => {
    let bestTriplet: [
      Omit<WinForItaliaRankedSestina, 'rank'>,
      Omit<WinForItaliaRankedSestina, 'rank'>,
      Omit<WinForItaliaRankedSestina, 'rank'>
    ] | null = null;
    let bestTotalScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        for (let k = j + 1; k < candidates.length; k++) {
          const s1 = candidates[i];
          const s2 = candidates[j];
          const s3 = candidates[k];

          const counts: Record<number, number> = {};
          for (const num of s1.numbers) counts[num] = (counts[num] || 0) + 1;
          for (const num of s2.numbers) counts[num] = (counts[num] || 0) + 1;
          for (const num of s3.numbers) counts[num] = (counts[num] || 0) + 1;

          const isPerfectlyBalanced = pool9.every((num) => counts[num] === 2);
          if (isPerfectlyBalanced) {
            const totalScore = s1.totalScore + s2.totalScore + s3.totalScore;
            if (totalScore > bestTotalScore) {
              bestTotalScore = totalScore;
              bestTriplet = [s1, s2, s3];
            }
          }
        }
      }
    }
    return bestTriplet;
  };

  // Prima cerca nelle prime 35 candidate come da specifica, poi su tutte le 84 per garanzia matematica 100%
  const topCandidates = scored.slice(0, Math.min(35, scored.length));
  const chosenTriplet =
    findBest2xTriplet(topCandidates) ||
    findBest2xTriplet(scored) || [scored[0], scored[1], scored[2]];

  const columns: [WinForItaliaRankedSestina, WinForItaliaRankedSestina, WinForItaliaRankedSestina] = [
    { ...chosenTriplet[0], rank: 1 },
    { ...chosenTriplet[1], rank: 2 },
    { ...chosenTriplet[2], rank: 3 }
  ];

  const numberFrequencies: Record<number, number> = {};
  for (const num of pool9) numberFrequencies[num] = 0;
  for (const col of columns) {
    for (const num of col.numbers) {
      numberFrequencies[num] = (numberFrequencies[num] || 0) + 1;
    }
  }

  const isPerfect2x = pool9.every((num) => numberFrequencies[num] === 2);

  // Calcola copertura coppie C(9,2)=36 e terne C(9,3)=84
  const pairsSet = new Set<string>();
  const tripletsSet = new Set<string>();
  for (const col of columns) {
    const nums = col.numbers;
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        pairsSet.add(`${nums[a]}-${nums[b]}`);
        for (let c = b + 1; c < 6; c++) {
          tripletsSet.add(`${nums[a]}-${nums[b]}-${nums[c]}`);
        }
      }
    }
  }

  return {
    top9Numbers: pool9,
    columns,
    numberFrequencies,
    isPerfect2x,
    uniquePairsCovered: pairsSet.size,
    totalPairsInTop9: 36,
    uniqueTripletsCovered: tripletsSet.size,
    totalTripletsInTop9: 84,
    totalCombinationsEvaluated: allSestine.length
  };
}

function popcnt32(v: number): number {
  let x = v - ((v >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Simulatore Monte Carlo "Settimana Tipo" (7 Estrazioni) per Win for Italia Team (6/40):
 * - Supporta sia Modalità Cecchino (1 sestina = 2,00 € / serata, 14,00 € / settimana)
 *   sia Modalità Sistema Ridotto (3 sestine = 6,00 € / serata, 42,00 € / settimana).
 * - Usa bitmask compatte a 40 bit (2 x 20-bit integers) per simulare 50.000 estrazioni,
 *   testando tutte le colonne contemporaneamente su ogni estrazione e sommando eventuali vincite multiple.
 */
export function runWinForItaliaWeeklyMonteCarlo(
  sestinaOrColumns: number[] | number[][],
  totalSimulatedDraws: number = 50000,
  seed: number = 2026040
): WinForItaliaWeeklyMonteCarloResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const columnsList: number[][] =
    Array.isArray(sestinaOrColumns) && Array.isArray(sestinaOrColumns[0])
      ? (sestinaOrColumns as number[][])
      : [sestinaOrColumns as number[]];

  const validColumns = columnsList.filter((col) => Array.isArray(col) && col.length > 0);
  const columnsCount = Math.max(1, validColumns.length);

  // Build 40-bit bitmask split into two 20-bit words: low20 (1..20) and high20 (21..40) for each column
  const columnMasks = validColumns.map((col) => {
    let low20 = 0;
    let high20 = 0;
    for (const n of col) {
      if (n >= 1 && n <= 20) {
        low20 |= 1 << (n - 1);
      } else if (n >= 21 && n <= 40) {
        high20 |= 1 << (n - 21);
      }
    }
    return { low20, high20 };
  });

  let rngState = (seed >>> 0) || 123456789;
  const nextRand = (): number => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
  };

  const hitsByCategory = {
    punto2: 0,
    punto3: 0,
    punto4: 0,
    punto5: 0,
    punto6: 0
  };

  let drawsWithAtLeastOneWin = 0;
  let drawsWithAtLeastOnePunto2 = 0;
  let drawsWithAtLeastOnePunto3 = 0;

  let weeksWithAtLeastOneWin = 0;
  let weeksWithAtLeastOnePunto2 = 0;
  let weeksWithAtLeastOnePunto3 = 0;

  let currentWeekWins = 0;
  let currentWeekPunto2 = 0;
  let currentWeekPunto3 = 0;
  let completedWeeks = 0;

  for (let d = 0; d < totalSimulatedDraws; d++) {
    let drawLow20 = 0;
    let drawHigh20 = 0;
    let picked = 0;

    while (picked < 6) {
      const r = Math.floor(nextRand() * 40) + 1;
      if (r <= 20) {
        const bit = 1 << (r - 1);
        if ((drawLow20 & bit) === 0) {
          drawLow20 |= bit;
          picked++;
        }
      } else {
        const bit = 1 << (r - 21);
        if ((drawHigh20 & bit) === 0) {
          drawHigh20 |= bit;
          picked++;
        }
      }
    }

    let drawHasWin = false;
    let drawHasPunto2 = false;
    let drawHasPunto3 = false;

    for (let c = 0; c < columnMasks.length; c++) {
      const mask = columnMasks[c];
      const matchCount =
        popcnt32(mask.low20 & drawLow20) + popcnt32(mask.high20 & drawHigh20);

      if (matchCount >= 2) {
        drawHasWin = true;
        currentWeekWins++;
        if (matchCount === 2) {
          hitsByCategory.punto2++;
          drawHasPunto2 = true;
          currentWeekPunto2++;
        } else if (matchCount === 3) {
          hitsByCategory.punto3++;
          drawHasPunto3 = true;
          currentWeekPunto3++;
        } else if (matchCount === 4) {
          hitsByCategory.punto4++;
        } else if (matchCount === 5) {
          hitsByCategory.punto5++;
        } else if (matchCount === 6) {
          hitsByCategory.punto6++;
        }
      }
    }

    if (drawHasWin) drawsWithAtLeastOneWin++;
    if (drawHasPunto2) drawsWithAtLeastOnePunto2++;
    if (drawHasPunto3) drawsWithAtLeastOnePunto3++;

    if ((d + 1) % 7 === 0) {
      completedWeeks++;
      if (currentWeekWins > 0) weeksWithAtLeastOneWin++;
      if (currentWeekPunto2 > 0) weeksWithAtLeastOnePunto2++;
      if (currentWeekPunto3 > 0) weeksWithAtLeastOnePunto3++;
      currentWeekWins = 0;
      currentWeekPunto2 = 0;
      currentWeekPunto3 = 0;
    }
  }

  const payoutByCategory = {
    punto2: hitsByCategory.punto2 * WIN_FOR_ITALIA_PRIZES.PUNTO_2,
    punto3: hitsByCategory.punto3 * WIN_FOR_ITALIA_PRIZES.PUNTO_3,
    punto4: hitsByCategory.punto4 * WIN_FOR_ITALIA_PRIZES.PUNTO_4,
    punto5: hitsByCategory.punto5 * WIN_FOR_ITALIA_PRIZES.PUNTO_5,
    punto6: hitsByCategory.punto6 * WIN_FOR_ITALIA_PRIZES.PUNTO_6
  };

  const ticketCost = Number((columnsCount * 2.0).toFixed(2));
  const weeklyCost = Number((ticketCost * 7).toFixed(2));
  const totalSpent = totalSimulatedDraws * ticketCost;
  const totalEarned =
    payoutByCategory.punto2 +
    payoutByCategory.punto3 +
    payoutByCategory.punto4 +
    payoutByCategory.punto5 +
    payoutByCategory.punto6;

  const averagePayoutPerDraw = totalEarned / Math.max(1, totalSimulatedDraws);
  const averageWeeklyPayout = averagePayoutPerDraw * 7;
  const averageWeeklyRecoveryRatePct = (averageWeeklyPayout / weeklyCost) * 100;
  const expectedPunto2PerWeek = (hitsByCategory.punto2 / Math.max(1, totalSimulatedDraws)) * 7;

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    totalSimulatedDraws,
    totalSimulatedWeeks: Math.max(1, completedWeeks),
    columnsCount,
    ticketCost,
    weeklyCost,
    totalSpent,
    totalEarned,
    averagePayoutPerDraw: Number(averagePayoutPerDraw.toFixed(2)),
    averageWeeklyPayout: Number(averageWeeklyPayout.toFixed(2)),
    averageWeeklyRecoveryRatePct: Number(averageWeeklyRecoveryRatePct.toFixed(1)),
    expectedPunto2PerWeek: Number(expectedPunto2PerWeek.toFixed(2)),
    probAtLeastOneWinPerDrawPct: Number(
      ((drawsWithAtLeastOneWin / Math.max(1, totalSimulatedDraws)) * 100).toFixed(1)
    ),
    probAtLeastOnePunto2PerDrawPct: Number(
      ((drawsWithAtLeastOnePunto2 / Math.max(1, totalSimulatedDraws)) * 100).toFixed(1)
    ),
    probAtLeastOnePunto3PerDrawPct: Number(
      ((drawsWithAtLeastOnePunto3 / Math.max(1, totalSimulatedDraws)) * 100).toFixed(2)
    ),
    probAtLeastOneWinPerWeekPct: Number(
      ((weeksWithAtLeastOneWin / Math.max(1, completedWeeks)) * 100).toFixed(1)
    ),
    probAtLeastOnePunto2PerWeekPct: Number(
      ((weeksWithAtLeastOnePunto2 / Math.max(1, completedWeeks)) * 100).toFixed(1)
    ),
    probAtLeastOnePunto3PerWeekPct: Number(
      ((weeksWithAtLeastOnePunto3 / Math.max(1, completedWeeks)) * 100).toFixed(1)
    ),
    executionTimeMs: Math.max(1, Math.round(endTime - startTime)),
    hitsByCategory,
    payoutByCategory
  };
}

/**
 * Rileva se una giocata salvata appartiene a Win for Italia Team / Win for Life (6/40)
 */
export function isWinForItaliaPlay(play: SavedPlay | null | undefined): boolean {
  if (!play) return false;
  const cid = String(play.targetContestId || '').toUpperCase().trim();
  const note = String(play.manualNote || '').toLowerCase();
  const pid = String(play.id || '').toLowerCase();
  return (
    cid.startsWith('WFI') ||
    cid.startsWith('WFL') ||
    pid.startsWith('play-wfi-') ||
    note.includes('win for') ||
    note.includes('6/40')
  );
}

/**
 * Valuta una giocata (1 o più sestine) contro un'estrazione Win for Italia Team / Win for Life (6/40)
 * usando la tabella premi ufficiale:
 * - Punto 2 = 2,00 €
 * - Punto 3 = 8,00 €
 * - Punto 4 = 50,00 €
 * - Punto 5 = 440,00 €
 * - Punto 6 = 10.000,00 €
 */
export function evaluateWinForItaliaPlay(
  columns: GeneratedColumn[],
  targetDraw: WinForItaliaDraw,
  cost: number
): PlayResult {
  const winningSet = new Set(targetDraw.numbers);
  const matchesPerColumn: ColumnMatchResult[] = [];
  let totalWinning = 0;
  let bestMatch = 0;

  for (const col of columns) {
    const matchedNumbers = col.numbers.filter((n) => winningSet.has(n));
    const matchCount = matchedNumbers.length;
    if (matchCount > bestMatch) {
      bestMatch = matchCount;
    }

    let prizeTier = 'Nessun Punto';
    let estimatedPrize = 0;

    if (matchCount === 6) {
      prizeTier = 'Punti 6 (Win for Italia 6/40)';
      estimatedPrize = WIN_FOR_ITALIA_PRIZES.PUNTO_6;
    } else if (matchCount === 5) {
      prizeTier = 'Punti 5 (Win for Italia 6/40)';
      estimatedPrize = WIN_FOR_ITALIA_PRIZES.PUNTO_5;
    } else if (matchCount === 4) {
      prizeTier = 'Punti 4 (Win for Italia 6/40)';
      estimatedPrize = WIN_FOR_ITALIA_PRIZES.PUNTO_4;
    } else if (matchCount === 3) {
      prizeTier = 'Punti 3 (Win for Italia 6/40)';
      estimatedPrize = WIN_FOR_ITALIA_PRIZES.PUNTO_3;
    } else if (matchCount === 2) {
      prizeTier = 'Punti 2 (Rimborso 2,00 €)';
      estimatedPrize = WIN_FOR_ITALIA_PRIZES.PUNTO_2;
    } else if (matchCount === 1) {
      prizeTier = '1 Punto';
      estimatedPrize = 0;
    }

    totalWinning += estimatedPrize;

    matchesPerColumn.push({
      columnId: col.id,
      numbers: col.numbers,
      matchedNumbers,
      matchCount,
      hasJolly: false,
      hasSuperstar: false,
      prizeTier,
      estimatedPrize
    });
  }

  const roundedWin = Number(totalWinning.toFixed(2));
  const netReturn = Number((roundedWin - cost).toFixed(2));

  return {
    matchesPerColumn,
    totalWinning: roundedWin,
    netReturn,
    bestMatch,
    hasWin: roundedWin > 0,
    verifiedAt: new Date().toISOString()
  };
}

/**
 * Confronta una giocata con le ultime N estrazioni (10..200) dell'archivio Win for Italia Team / Win for Life (6/40).
 */
export function compareSavedPlayAgainstWinForItaliaDraws(
  play: SavedPlay,
  allWfiDraws: WinForItaliaDraw[],
  requestedDrawsCount: number
): SavedPlayArchiveComparisonSummary {
  const clampedCount = clampArchiveComparisonDrawsCount(requestedDrawsCount);
  const sortedDraws = [...allWfiDraws].sort((a, b) => {
    const cmp = b.date.localeCompare(a.date);
    if (cmp !== 0) return cmp;
    return b.contestNumber - a.contestNumber;
  });
  const recentDraws = sortedDraws.slice(0, clampedCount);

  const playNumsSet = new Set<number>();
  const numberHitCounts: Record<number, number> = {};

  for (const col of play.columns) {
    for (const n of col.numbers) {
      playNumsSet.add(n);
      numberHitCounts[n] = 0;
    }
  }
  for (const n of play.poolNumbers || []) {
    playNumsSet.add(n);
    if (numberHitCounts[n] === undefined) numberHitCounts[n] = 0;
  }

  const costPerDraw =
    typeof play.cost === 'number' && play.cost > 0
      ? Number(play.cost.toFixed(2))
      : Number((play.columns.length * 2.0).toFixed(2));

  let totalSpent = 0;
  let grossWinnings = 0;
  let winningDrawsCount = 0;
  let totalMatchedNumbersCount = 0;

  const tierBreakdown = {
    points2: 0,
    points3: 0,
    points4: 0,
    points5: 0,
    points5plus1: 0,
    points6: 0,
    superstarHits: 0
  };

  const rows: ArchiveDrawPlayComparisonRow[] = [];

  for (const wfiDraw of recentDraws) {
    const evalRes = evaluateWinForItaliaPlay(play.columns, wfiDraw, costPerDraw);
    const matchedNumbersInPlay = wfiDraw.numbers.filter((n) => playNumsSet.has(n));
    for (const m of matchedNumbersInPlay) {
      numberHitCounts[m] = (numberHitCounts[m] || 0) + 1;
    }
    totalMatchedNumbersCount += matchedNumbersInPlay.length;

    let winningColumnsCount = 0;
    let bestColumnId: number | null = null;
    let bestPrizeTier = 'Nessun Punto';
    let highestColPrize = -1;

    for (const colMatch of evalRes.matchesPerColumn) {
      if (colMatch.estimatedPrize > 0) {
        winningColumnsCount++;
      }
      if (colMatch.estimatedPrize > highestColPrize && colMatch.estimatedPrize > 0) {
        highestColPrize = colMatch.estimatedPrize;
        bestColumnId = colMatch.columnId;
        bestPrizeTier = colMatch.prizeTier;
      } else if (bestColumnId === null && colMatch.matchCount > 0) {
        bestColumnId = colMatch.columnId;
      }

      if (colMatch.matchCount === 6) tierBreakdown.points6++;
      else if (colMatch.matchCount === 5) tierBreakdown.points5++;
      else if (colMatch.matchCount === 4) tierBreakdown.points4++;
      else if (colMatch.matchCount === 3) tierBreakdown.points3++;
      else if (colMatch.matchCount === 2) tierBreakdown.points2++;
    }

    const grossWinForDraw = Number(evalRes.totalWinning.toFixed(2));
    const netReturnForDraw = Number((grossWinForDraw - costPerDraw).toFixed(2));

    totalSpent = Number((totalSpent + costPerDraw).toFixed(2));
    grossWinnings = Number((grossWinnings + grossWinForDraw).toFixed(2));
    if (grossWinForDraw > 0) {
      winningDrawsCount++;
    }

    rows.push({
      draw: {
        id: wfiDraw.id,
        contestNumber: wfiDraw.contestNumber,
        year: wfiDraw.year,
        date: wfiDraw.date,
        numbers: wfiDraw.numbers,
        jolly: 0
      },
      matchedNumbersInPlay,
      jollyMatchedInPlay: false,
      superstarMatchedInPlay: false,
      playResult: evalRes,
      winningColumnsCount,
      bestColumnId,
      bestPrizeTier,
      costForDraw: costPerDraw,
      grossWinForDraw,
      netReturnForDraw
    });
  }

  const netProfitLoss = Number((grossWinnings - totalSpent).toFixed(2));
  const roiPercentage =
    totalSpent > 0 ? Number(((netProfitLoss / totalSpent) * 100).toFixed(2)) : 0;

  return {
    playId: play.id,
    drawsRequested: clampedCount,
    drawsEvaluatedCount: recentDraws.length,
    costPerDraw,
    totalSpent,
    grossWinnings,
    netProfitLoss,
    roiPercentage,
    winningDrawsCount,
    totalMatchedNumbersCount,
    tierBreakdown,
    numberHitCounts,
    playNumbersSet: Array.from(playNumsSet).sort((a, b) => a - b),
    playSuperstarsSet: [],
    rows
  };
}

