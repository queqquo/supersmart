/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Draw, SavedPlay, ScoringWeights, FilterOptions } from '../types/lottery';
import { generateFullHistoricalDataset } from '../data/seedDraws';

const STORAGE_KEYS = {
  DRAWS: 'superenalotto_custom_draws_delta_v6',
  PLAYS: 'superenalotto_saved_plays',
  WEIGHTS: 'superenalotto_scoring_weights',
  FILTERS: 'superenalotto_filter_options',
  PIGGYBANK: 'superenalotto_piggybank_balance'
};

export const DEFAULT_WEIGHTS: ScoringWeights = {
  wDelay: 0.50,
  wFrequency: 0.30,
  wAffinity: 0.20
};

export const DEFAULT_FILTERS: FilterOptions = {
  evenOdd: true,
  highLow: true,
  sumRange: true,
  minSum: 190,
  maxSum: 350,
  consecutive: true,
  decades: true,
  cadences: true
};

// --- IndexedDB Helper for High-Capacity Zero-Cost Persistence of Saved Plays ---
const IDB_NAME = 'superenalotto_zero_cost_idb';
const IDB_STORE = 'plays_store';

function openPlaysIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function savePlaysToIDB(plays: SavedPlay[]): Promise<void> {
  const db = await openPlaysIDB();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(plays, 'saved_plays_list');
  } catch {
    // Ignore IDB errors
  }
}

async function loadPlaysFromIDB(): Promise<SavedPlay[]> {
  const db = await openPlaysIDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('saved_plays_list');
      req.onsuccess = () => {
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Load all official historical draws (2,946 draws from 2009 to 2026) merged with any custom user draws
 */
export function loadDraws(): Draw[] {
  const fullSeed = generateFullHistoricalDataset();
  try {
    // Free up localStorage space by removing legacy full-archive keys
    localStorage.removeItem('superenalotto_historical_draws');
    localStorage.removeItem('superenalotto_official_draws_2009_2026_v5');

    const rawDelta = localStorage.getItem(STORAGE_KEYS.DRAWS);
    if (rawDelta) {
      const parsedDelta: Draw[] = JSON.parse(rawDelta);
      if (Array.isArray(parsedDelta) && parsedDelta.length > 0) {
        const mergedMap = new Map<string, Draw>();
        for (const d of fullSeed) mergedMap.set(d.id, d);
        for (const d of parsedDelta) mergedMap.set(d.id, d);
        return Array.from(mergedMap.values()).sort((a, b) => b.date.localeCompare(a.date));
      }
    }
  } catch (e) {
    console.warn('Error reading custom draws delta from localStorage:', e);
  }

  return fullSeed;
}

/**
 * Synchronize official SuperEnalotto archive from the live Open-Data feed (server proxy or direct GitHub Raw)
 */
export async function syncOfficialDrawsFromLiveFeed(): Promise<{
  draws: Draw[];
  addedOrUpdated: number;
  latestDate: string;
}> {
  const current = loadDraws();
  const prevCount = current.length;

  let fetchedDraws: Draw[] = [];

  try {
    const res = await fetch('/api/draws/official-sync');
    if (res.ok) {
      const payload = await res.json();
      if (Array.isArray(payload?.draws) && payload.draws.length > 0) {
        fetchedDraws = payload.draws;
      }
    }
  } catch {
    // Fallback to direct GitHub Raw Open-Data feed if running in static environment
  }

  if (fetchedDraws.length === 0) {
    const directRes = await fetch(
      'https://raw.githubusercontent.com/delpinsky/Superenalotto/main/storico-estrazioni-superenalotto.json'
    );
    if (directRes.ok) {
      const data = await directRes.json();
      const rawDraws = Array.isArray(data?.draws)
        ? data.draws.filter((d: { date?: string }) => d.date && d.date >= '2009-01-01')
        : [];
      rawDraws.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
      const byYear: Record<number, number> = {};
      fetchedDraws = rawDraws.map(
        (d: {
          date: string;
          nums: number[];
          jolly?: number | null;
          ss?: number | null;
          concorso?: number;
        }) => {
          const year = parseInt(d.date.slice(0, 4), 10);
          byYear[year] = (byYear[year] || 0) + 1;
          const contestNumber =
            typeof d.concorso === 'number' && d.concorso > 0 ? d.concorso : byYear[year];
          const sortedNums = [...d.nums].map(Number).sort((a, b) => a - b) as [
            number,
            number,
            number,
            number,
            number,
            number
          ];
          return {
            id: `${year}-${String(contestNumber).padStart(3, '0')}`,
            contestNumber,
            year,
            date: d.date,
            numbers: sortedNums,
            jolly: Number(d.jolly) || 1,
            superstar: Number(d.ss) || Number(d.jolly) || 1
          };
        }
      );
    }
  }

  if (fetchedDraws.length === 0) {
    return {
      draws: current,
      addedOrUpdated: 0,
      latestDate: current[0]?.date || ''
    };
  }

  const mergedMap = new Map<string, Draw>();
  for (const d of current) mergedMap.set(d.id, d);
  for (const d of fetchedDraws) mergedMap.set(d.id, d);

  const merged = Array.from(mergedMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  saveDraws(merged);

  return {
    draws: merged,
    addedOrUpdated: Math.max(0, merged.length - prevCount),
    latestDate: merged[0]?.date || ''
  };
}

/**
 * Save only custom/extra draws to browser storage so localStorage stays lightweight (<5 KB)
 */
export function saveDraws(draws: Draw[]): void {
  try {
    const seedIds = new Set(generateFullHistoricalDataset().map((d) => d.id));
    const delta = draws.filter((d) => !seedIds.has(d.id));
    localStorage.setItem(STORAGE_KEYS.DRAWS, JSON.stringify(delta));
  } catch (e) {
    console.error('Error saving draws delta to localStorage:', e);
  }
}

/**
 * Add a new draw to the archive (prepend or update existing)
 */
export function insertDraw(newDraw: Draw): Draw[] {
  const current = loadDraws();
  const existingIdx = current.findIndex((d) => d.id === newDraw.id);

  if (existingIdx >= 0) {
    current[existingIdx] = newDraw;
  } else {
    current.unshift(newDraw);
  }

  current.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  saveDraws(current);
  return current;
}

/**
 * Load saved weekly plays from localStorage
 */
export function loadSavedPlays(): SavedPlay[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PLAYS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error loading saved plays:', e);
  }
  return [];
}

/**
 * Save weekly plays to localStorage + IndexedDB + Server
 */
export function savePlays(plays: SavedPlay[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYS, JSON.stringify(plays));
  } catch (e) {
    console.error('Error saving plays to localStorage:', e);
  }
  savePlaysToIDB(plays);
  fetch('/api/plays', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plays })
  }).catch(() => {
    // Ignore if offline
  });
}

/**
 * Synchronize saved plays across LocalStorage, IndexedDB, and Server (/api/plays)
 * so plays are never lost on logout, reload, or across sessions
 */
export async function syncSavedPlaysWithServer(): Promise<SavedPlay[]> {
  const localPlays = loadSavedPlays();
  const idbPlays = await loadPlaysFromIDB();
  let serverPlays: SavedPlay[] = [];

  try {
    const res = await fetch('/api/plays');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.plays)) {
        serverPlays = data.plays;
      }
    }
  } catch {
    // Offline fallback
  }

  const mergedMap = new Map<string, SavedPlay>();
  for (const p of serverPlays) {
    if (p && typeof p.id === 'string') mergedMap.set(p.id, p);
  }
  for (const p of idbPlays) {
    if (p && typeof p.id === 'string') {
      const existing = mergedMap.get(p.id);
      if (!existing || (p.status === 'VERIFICATA' && existing.status !== 'VERIFICATA')) {
        mergedMap.set(p.id, p);
      }
    }
  }
  for (const p of localPlays) {
    if (p && typeof p.id === 'string') {
      const existing = mergedMap.get(p.id);
      if (!existing || (p.status === 'VERIFICATA' && existing.status !== 'VERIFICATA')) {
        mergedMap.set(p.id, p);
      }
    }
  }

  const merged = Array.from(mergedMap.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );

  try {
    localStorage.setItem(STORAGE_KEYS.PLAYS, JSON.stringify(merged));
  } catch {
    // Ignore
  }
  await savePlaysToIDB(merged);

  if (merged.length > serverPlays.length) {
    fetch('/api/plays', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plays: merged })
    }).catch(() => {
      // Ignore
    });
  }

  return merged;
}

/**
 * Add a new play (persisted to localStorage, IndexedDB, and Server)
 */
export function insertPlay(play: SavedPlay): SavedPlay[] {
  const plays = loadSavedPlays();
  const existingIdx = plays.findIndex((p) => p.id === play.id);
  if (existingIdx >= 0) {
    plays[existingIdx] = play;
  } else {
    plays.unshift(play);
  }
  savePlays(plays);
  fetch('/api/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ play })
  }).catch(() => {
    // Ignore
  });
  return plays;
}

/**
 * Update a play (e.g. after verification)
 */
export function updatePlay(updated: SavedPlay): SavedPlay[] {
  const plays = loadSavedPlays();
  const idx = plays.findIndex((p) => p.id === updated.id);
  if (idx >= 0) {
    plays[idx] = updated;
  } else {
    plays.unshift(updated);
  }
  savePlays(plays);
  fetch('/api/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ play: updated })
  }).catch(() => {
    // Ignore
  });
  return plays;
}

/**
 * Delete a play
 */
export function deletePlay(id: string): SavedPlay[] {
  const plays = loadSavedPlays();
  const filtered = plays.filter((p) => p.id !== id);
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYS, JSON.stringify(filtered));
  } catch {
    // Ignore
  }
  savePlaysToIDB(filtered);
  fetch(`/api/plays/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  }).catch(() => {
    // Ignore
  });
  return filtered;
}

/**
 * Load Scoring Weights
 */
export function loadWeights(): ScoringWeights {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WEIGHTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.wDelay === 'number' &&
        typeof parsed.wFrequency === 'number' &&
        typeof parsed.wAffinity === 'number'
      ) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading weights:', e);
  }
  return DEFAULT_WEIGHTS;
}

/**
 * Save Scoring Weights
 */
export function saveWeights(weights: ScoringWeights): void {
  try {
    localStorage.setItem(STORAGE_KEYS.WEIGHTS, JSON.stringify(weights));
  } catch (e) {
    console.error('Error saving weights:', e);
  }
}

/**
 * Load filter options
 */
export function loadFilters(): FilterOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FILTERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch (e) {
    console.warn('Error loading filters:', e);
  }
  return DEFAULT_FILTERS;
}

/**
 * Save filter options
 */
export function saveFilters(filters: FilterOptions): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FILTERS, JSON.stringify(filters));
  } catch (e) {
    console.error('Error saving filters:', e);
  }
}

/**
 * Export all draws and plays to JSON string
 */
export function exportBackupJSON(): string {
  const data = {
    app: 'SuperEnalotto Combinatorial Optimizer',
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    draws: loadDraws(),
    plays: loadSavedPlays(),
    weights: loadWeights(),
    filters: loadFilters()
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Export draws to CSV string
 */
export function exportDrawsCSV(): string {
  const draws = loadDraws();
  const header = 'id;data;n1;n2;n3;n4;n5;n6;jolly;superstar\n';
  const rows = draws.map((d) => {
    return `${d.id};${d.date};${d.numbers.join(';')};${d.jolly};${d.superstar ?? ''}`;
  });
  return header + rows.join('\n');
}

/**
 * Import JSON backup
 */
export function importBackupJSON(jsonString: string): { importedDraws: number; importedPlays: number } {
  const parsed = JSON.parse(jsonString);
  let importedDraws = 0;
  let importedPlays = 0;

  if (Array.isArray(parsed.draws)) {
    saveDraws(parsed.draws);
    importedDraws = parsed.draws.length;
  }
  if (Array.isArray(parsed.plays)) {
    savePlays(parsed.plays);
    importedPlays = parsed.plays.length;
  }
  if (parsed.weights) {
    saveWeights(parsed.weights);
  }
  if (parsed.filters) {
    saveFilters(parsed.filters);
  }

  return { importedDraws, importedPlays };
}

/**
 * Import draws from CSV format
 */
export function importDrawsCSV(csvString: string): number {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return 0;

  const current = loadDraws();
  const existingMap = new Map(current.map((d) => [d.id, d]));
  let added = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/[;,]/);
    if (parts.length >= 8) {
      const id = parts[0].trim();
      const date = parts[1].trim();
      const n1 = parseInt(parts[2], 10);
      const n2 = parseInt(parts[3], 10);
      const n3 = parseInt(parts[4], 10);
      const n4 = parseInt(parts[5], 10);
      const n5 = parseInt(parts[6], 10);
      const n6 = parseInt(parts[7], 10);
      const jolly = parts[8] ? parseInt(parts[8], 10) : 1;
      const superstar = parts[9] ? parseInt(parts[9], 10) : undefined;

      if ([n1, n2, n3, n4, n5, n6].every((n) => !isNaN(n) && n >= 1 && n <= 90)) {
        const sortedNums = [n1, n2, n3, n4, n5, n6].sort((a, b) => a - b) as [
          number,
          number,
          number,
          number,
          number,
          number
        ];
        const contestNumber = parseInt(id.split('-')[1] || '1', 10);
        const year = parseInt(id.split('-')[0] || date.slice(0, 4) || '2026', 10);

        const draw: Draw = {
          id: id || `${year}-${String(contestNumber).padStart(3, '0')}`,
          contestNumber,
          year,
          date,
          numbers: sortedNums,
          jolly,
          superstar
        };

        existingMap.set(draw.id, draw);
        added++;
      }
    }
  }

  const merged = Array.from(existingMap.values());
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  saveDraws(merged);
  return added;
}
