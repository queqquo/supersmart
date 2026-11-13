/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Draw,
  SavedPlay,
  ScoringWeights,
  FilterOptions,
  UserGeneratedSystemRecord,
  UserSimulationStateRecord
} from '../types/lottery';
import { generateFullHistoricalDataset } from '../data/seedDraws';
import {
  fetchCloudPlays,
  upsertCloudPlay,
  upsertManyCloudPlays,
  removeCloudPlay,
  fetchCloudDeletedPlayIds,
  fetchCloudCustomDraws,
  upsertCloudCustomDraw,
  fetchCloudUserSystem,
  upsertCloudUserSystem,
  fetchCloudUserSimulation,
  upsertCloudUserSimulation
} from './firebase';

const STORAGE_KEYS = {
  DRAWS: 'superenalotto_custom_draws_delta_v6',
  PLAYS: 'superenalotto_saved_plays',
  DELETED_PLAY_IDS: 'superenalotto_deleted_play_ids_v1',
  WEIGHTS: 'superenalotto_scoring_weights',
  FILTERS: 'superenalotto_filter_options',
  PIGGYBANK: 'superenalotto_piggybank_balance',
  USER_SYSTEM_PREFIX: 'superenalotto_user_system_v1_',
  USER_SIMULATION_PREFIX: 'superenalotto_user_simulation_v1_'
};

function normalizeUserEmailKey(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function getUserSystemStorageKey(userEmail: string): string {
  return `${STORAGE_KEYS.USER_SYSTEM_PREFIX}${normalizeUserEmailKey(userEmail)}`;
}

/**
 * Load the persisted optimized system (sestine & parameters) for a specific user from localStorage
 */
export function loadUserGeneratedSystem(userEmail: string): UserGeneratedSystemRecord | null {
  const emailKey = normalizeUserEmailKey(userEmail);
  if (!emailKey) return null;
  try {
    const raw = localStorage.getItem(getUserSystemStorageKey(emailKey));
    if (raw) {
      const parsed = JSON.parse(raw) as UserGeneratedSystemRecord;
      if (
        parsed &&
        normalizeUserEmailKey(parsed.userEmail) === emailKey &&
        parsed.systemResult &&
        Array.isArray(parsed.systemResult.columns) &&
        parsed.systemResult.columns.length > 0
      ) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error loading user generated system from localStorage:', e);
  }
  return null;
}

/**
 * Cache a user's generated system locally without triggering remote writes
 */
export function cacheUserGeneratedSystemLocally(record: UserGeneratedSystemRecord): void {
  const emailKey = normalizeUserEmailKey(record?.userEmail);
  if (!emailKey || !record?.systemResult) return;
  try {
    localStorage.setItem(
      getUserSystemStorageKey(emailKey),
      JSON.stringify({ ...record, userEmail: emailKey })
    );
  } catch (e) {
    console.error('Error caching user generated system locally:', e);
  }
}

/**
 * Save a user's generated system when they click "Calcola Sistema Ottimizzato"
 * Persists to localStorage (per-user), Server (/api/user-systems/:email), and Cloud Firestore (/user_systems/{emailKey})
 */
export function saveUserGeneratedSystem(record: UserGeneratedSystemRecord): void {
  const emailKey = normalizeUserEmailKey(record?.userEmail);
  if (!emailKey || !record?.systemResult) return;
  const normalizedRecord: UserGeneratedSystemRecord = {
    ...record,
    userEmail: emailKey,
    updatedAt: record.updatedAt || new Date().toISOString()
  };
  cacheUserGeneratedSystemLocally(normalizedRecord);
  upsertCloudUserSystem(normalizedRecord).catch(() => {});
  fetch(`/api/user-systems/${encodeURIComponent(emailKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record: normalizedRecord })
  }).catch(() => {
    // Ignore if offline
  });
}

/**
 * Synchronize a specific user's generated system across Cloud Firestore, Server, and LocalStorage
 */
export async function syncUserGeneratedSystem(
  userEmail: string
): Promise<UserGeneratedSystemRecord | null> {
  const emailKey = normalizeUserEmailKey(userEmail);
  if (!emailKey) return null;

  const localRecord = loadUserGeneratedSystem(emailKey);

  const [cloudRecord, serverRecord] = await Promise.all([
    fetchCloudUserSystem(emailKey),
    fetch(`/api/user-systems/${encodeURIComponent(emailKey)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return (data?.record as UserGeneratedSystemRecord) || null;
      })
      .catch(() => null)
  ]);

  const candidates = [localRecord, serverRecord, cloudRecord].filter(
    (r): r is UserGeneratedSystemRecord =>
      Boolean(
        r &&
          normalizeUserEmailKey(r.userEmail) === emailKey &&
          r.systemResult &&
          Array.isArray(r.systemResult.columns) &&
          r.systemResult.columns.length > 0
      )
  );

  if (candidates.length === 0) {
    return null;
  }

  // Pick the most recently saved record for this specific user
  candidates.sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
  const best = candidates[0];

  cacheUserGeneratedSystemLocally(best);

  if (!cloudRecord || new Date(best.updatedAt || 0).getTime() > new Date(cloudRecord.updatedAt || 0).getTime()) {
    await upsertCloudUserSystem(best);
  }

  if (!serverRecord || new Date(best.updatedAt || 0).getTime() > new Date(serverRecord.updatedAt || 0).getTime()) {
    fetch(`/api/user-systems/${encodeURIComponent(emailKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: best })
    }).catch(() => {});
  }

  return best;
}

export function getUserSimulationStorageKey(userEmail: string): string {
  return `${STORAGE_KEYS.USER_SIMULATION_PREFIX}${normalizeUserEmailKey(userEmail)}`;
}

export function loadUserSimulationState(userEmail: string): UserSimulationStateRecord | null {
  const emailKey = normalizeUserEmailKey(userEmail);
  if (!emailKey) return null;
  try {
    const raw = localStorage.getItem(getUserSimulationStorageKey(emailKey));
    if (raw) {
      const parsed = JSON.parse(raw) as UserSimulationStateRecord;
      if (
        parsed &&
        normalizeUserEmailKey(parsed.userEmail) === emailKey &&
        typeof parsed.simSeed === 'number' &&
        typeof parsed.numDrawsToSimulate === 'number'
      ) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error loading user simulation state from localStorage:', e);
  }
  return null;
}

export function cacheUserSimulationStateLocally(record: UserSimulationStateRecord): void {
  const emailKey = normalizeUserEmailKey(record?.userEmail);
  if (!emailKey || typeof record?.simSeed !== 'number') return;
  try {
    localStorage.setItem(
      getUserSimulationStorageKey(emailKey),
      JSON.stringify({ ...record, userEmail: emailKey })
    );
  } catch (e) {
    console.error('Error caching user simulation state locally:', e);
  }
}

export function saveUserSimulationState(record: UserSimulationStateRecord): void {
  const emailKey = normalizeUserEmailKey(record?.userEmail);
  if (!emailKey || typeof record?.simSeed !== 'number') return;
  const normalizedRecord: UserSimulationStateRecord = {
    ...record,
    userEmail: emailKey,
    updatedAt: record.updatedAt || new Date().toISOString()
  };
  cacheUserSimulationStateLocally(normalizedRecord);
  upsertCloudUserSimulation(normalizedRecord).catch(() => {});
  fetch(`/api/user-simulations/${encodeURIComponent(emailKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record: normalizedRecord })
  }).catch(() => {});
}

export async function syncUserSimulationState(
  userEmail: string
): Promise<UserSimulationStateRecord | null> {
  const emailKey = normalizeUserEmailKey(userEmail);
  if (!emailKey) return null;

  const localRecord = loadUserSimulationState(emailKey);

  const [cloudRecord, serverRecord] = await Promise.all([
    fetchCloudUserSimulation(emailKey),
    fetch(`/api/user-simulations/${encodeURIComponent(emailKey)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return (data?.record as UserSimulationStateRecord) || null;
      })
      .catch(() => null)
  ]);

  const candidates = [localRecord, serverRecord, cloudRecord].filter(
    (r): r is UserSimulationStateRecord =>
      Boolean(
        r &&
          normalizeUserEmailKey(r.userEmail) === emailKey &&
          typeof r.simSeed === 'number' &&
          typeof r.numDrawsToSimulate === 'number'
      )
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
  const best = candidates[0];

  cacheUserSimulationStateLocally(best);

  if (!cloudRecord || new Date(best.updatedAt || 0).getTime() > new Date(cloudRecord.updatedAt || 0).getTime()) {
    await upsertCloudUserSimulation(best);
  }

  if (!serverRecord || new Date(best.updatedAt || 0).getTime() > new Date(serverRecord.updatedAt || 0).getTime()) {
    fetch(`/api/user-simulations/${encodeURIComponent(emailKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: best })
    }).catch(() => {});
  }

  return best;
}

export function loadDeletedPlayIds(): Set<string> {
  const baseSet = new Set<string>(['play-manual-1793562659204']);
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DELETED_PLAY_IDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') baseSet.add(id);
        }
      }
    }
  } catch {
    // Ignore
  }
  return baseSet;
}

export function saveDeletedPlayIds(ids: Iterable<string>): Set<string> {
  const merged = loadDeletedPlayIds();
  for (const id of ids) {
    if (typeof id === 'string' && id) merged.add(id);
  }
  try {
    localStorage.setItem(STORAGE_KEYS.DELETED_PLAY_IDS, JSON.stringify(Array.from(merged)));
  } catch {
    // Ignore
  }
  return merged;
}

function markPlayIdDeleted(id: string): void {
  saveDeletedPlayIds([id]);
}

function unmarkPlayIdDeleted(id: string): void {
  try {
    const set = loadDeletedPlayIds();
    if (set.has(id)) {
      set.delete(id);
      localStorage.setItem(STORAGE_KEYS.DELETED_PLAY_IDS, JSON.stringify(Array.from(set)));
    }
  } catch {
    // Ignore
  }
}

/**
 * Filter plays so each user only sees their own plays in Verifica & Bilancio.
 * Legacy plays without `userEmail` belong to the primary administrator (giuseppe.vitiello@gmail.com).
 */
export function filterPlaysForUser(plays: SavedPlay[], userEmail: string): SavedPlay[] {
  const emailKey = normalizeUserEmailKey(userEmail);
  const deletedIds = loadDeletedPlayIds();
  if (!emailKey) return [];
  return plays.filter((p) => {
    if (!p || deletedIds.has(p.id)) return false;
    const owner = normalizeUserEmailKey(p.userEmail || 'giuseppe.vitiello@gmail.com');
    return owner === emailKey;
  });
}

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
 * Synchronize official SuperEnalotto archive from the live Open-Data feed + Cloud Firestore custom draws
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
    try {
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
    } catch {
      // Ignore if offline
    }
  }

  const cloudCustomDraws = (await fetchCloudCustomDraws()) || [];

  if (fetchedDraws.length === 0 && cloudCustomDraws.length === 0) {
    return {
      draws: current,
      addedOrUpdated: 0,
      latestDate: current[0]?.date || ''
    };
  }

  const mergedMap = new Map<string, Draw>();
  for (const d of current) mergedMap.set(d.id, d);
  for (const d of fetchedDraws) mergedMap.set(d.id, d);
  for (const d of cloudCustomDraws) mergedMap.set(d.id, d);

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
 * Add a new draw to the archive (prepend or update existing) and persist to Cloud Firestore
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
  upsertCloudCustomDraw(newDraw).catch(() => {});
  return current;
}

/**
 * Load saved weekly plays from localStorage (automatically excluding deleted play IDs)
 */
export function loadSavedPlays(): SavedPlay[] {
  const deletedIds = loadDeletedPlayIds();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PLAYS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((p) => p && typeof p.id === 'string' && !deletedIds.has(p.id));
      }
    }
  } catch (e) {
    console.warn('Error loading saved plays:', e);
  }
  return [];
}

/**
 * Cache plays locally in localStorage and IndexedDB without triggering remote writes
 */
export function cachePlaysLocally(plays: SavedPlay[]): void {
  const deletedIds = loadDeletedPlayIds();
  const cleanPlays = plays.filter((p) => p && typeof p.id === 'string' && !deletedIds.has(p.id));
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYS, JSON.stringify(cleanPlays));
  } catch (e) {
    console.error('Error caching plays to localStorage:', e);
  }
  savePlaysToIDB(cleanPlays);
}

/**
 * Save weekly plays to localStorage + IndexedDB + Server + Cloud Firestore
 */
export function savePlays(plays: SavedPlay[]): void {
  const deletedIds = loadDeletedPlayIds();
  const cleanPlays = plays.filter((p) => p && typeof p.id === 'string' && !deletedIds.has(p.id));
  cachePlaysLocally(cleanPlays);
  fetch('/api/plays', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plays: cleanPlays })
  }).catch(() => {
    // Ignore if offline
  });
  if (cleanPlays.length > 0) {
    upsertManyCloudPlays(cleanPlays).catch(() => {});
  }
}

function pickPreferredPlay(existing: SavedPlay, incoming: SavedPlay): SavedPlay {
  if (incoming.status === 'VERIFICATA' && existing.status !== 'VERIFICATA') {
    return incoming;
  }
  if (existing.status === 'VERIFICATA' && incoming.status !== 'VERIFICATA') {
    return existing;
  }
  const existingVerTime = new Date(existing.result?.verifiedAt || existing.createdAt || 0).getTime();
  const incomingVerTime = new Date(incoming.result?.verifiedAt || incoming.createdAt || 0).getTime();
  return incomingVerTime >= existingVerTime ? incoming : existing;
}

/**
 * Synchronize saved plays across Cloud Firestore (/plays + /deleted_plays), Server (/api/plays), IndexedDB, and LocalStorage
 * Ensures deleted plays NEVER resurrect across browsers or during in-flight async syncs.
 */
export async function syncSavedPlaysWithServer(): Promise<SavedPlay[]> {
  // Also ensure the legacy test play is removed from Cloud Firestore
  removeCloudPlay('play-manual-1793562659204').catch(() => {});

  const [idbPlaysRaw, cloudPlaysResult, cloudDeletedIds, serverResponse] = await Promise.all([
    loadPlaysFromIDB(),
    fetchCloudPlays(),
    fetchCloudDeletedPlayIds(),
    fetch('/api/plays')
      .then(async (res) => {
        if (!res.ok) return { plays: [] as SavedPlay[], deletedIds: [] as string[] };
        const data = await res.json();
        return {
          plays: Array.isArray(data?.plays) ? (data.plays as SavedPlay[]) : [],
          deletedIds: Array.isArray(data?.deletedIds) ? (data.deletedIds as string[]) : []
        };
      })
      .catch(() => ({ plays: [] as SavedPlay[], deletedIds: [] as string[] }))
  ]);

  // Re-read localDeletedPlayIds AFTER all awaits so any deletion clicked while sync was in-flight is honored!
  const allDeletedIds = saveDeletedPlayIds([
    ...loadDeletedPlayIds(),
    ...cloudDeletedIds,
    ...serverResponse.deletedIds
  ]);

  const localPlays = loadSavedPlays().filter((p) => p && !allDeletedIds.has(p.id));
  const idbPlays = idbPlaysRaw.filter((p) => p && !allDeletedIds.has(p.id));
  const cloudPlays = (cloudPlaysResult || []).filter((p) => p && !allDeletedIds.has(p.id));
  const serverPlays = serverResponse.plays.filter((p) => p && !allDeletedIds.has(p.id));

  // If any play present in Cloud Firestore is actually in allDeletedIds, remove it from Cloud Firestore
  if (cloudPlaysResult) {
    for (const cp of cloudPlaysResult) {
      if (cp && allDeletedIds.has(cp.id)) {
        removeCloudPlay(cp.id).catch(() => {});
      }
    }
  }

  const mergedMap = new Map<string, SavedPlay>();

  for (const list of [serverPlays, idbPlays, localPlays, cloudPlays]) {
    for (const p of list) {
      if (!p || typeof p.id !== 'string' || allDeletedIds.has(p.id)) continue;
      const existing = mergedMap.get(p.id);
      if (!existing) {
        mergedMap.set(p.id, p);
      } else {
        mergedMap.set(p.id, pickPreferredPlay(existing, p));
      }
    }
  }

  // Final check against latest loadDeletedPlayIds() in case user clicked Delete right now
  const finalDeletedIds = loadDeletedPlayIds();
  const merged = Array.from(mergedMap.values())
    .filter((p) => !finalDeletedIds.has(p.id))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  cachePlaysLocally(merged);

  // Push any non-deleted local/server plays that are missing or outdated in Cloud Firestore
  const cloudMap = new Map(cloudPlays.map((p) => [p.id, p]));
  const toUploadToCloud = merged.filter((p) => {
    if (finalDeletedIds.has(p.id)) return false;
    const inCloud = cloudMap.get(p.id);
    if (!inCloud) return true;
    if (p.status === 'VERIFICATA' && inCloud.status !== 'VERIFICATA') return true;
    if ((p.result?.totalWinning ?? 0) !== (inCloud.result?.totalWinning ?? 0)) return true;
    if (p.cost !== inCloud.cost) return true;
    if (p.userEmail && !inCloud.userEmail) return true;
    return false;
  });

  if (toUploadToCloud.length > 0) {
    await upsertManyCloudPlays(toUploadToCloud);
  }

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
 * Add a new play (persisted to Cloud Firestore, Server, IndexedDB, and localStorage)
 */
export function insertPlay(play: SavedPlay): SavedPlay[] {
  unmarkPlayIdDeleted(play.id);
  const plays = loadSavedPlays();
  const existingIdx = plays.findIndex((p) => p.id === play.id);
  if (existingIdx >= 0) {
    plays[existingIdx] = play;
  } else {
    plays.unshift(play);
  }
  cachePlaysLocally(plays);
  upsertCloudPlay(play).catch(() => {});
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
 * Update a play (e.g. after verification or inline edit)
 */
export function updatePlay(updated: SavedPlay): SavedPlay[] {
  unmarkPlayIdDeleted(updated.id);
  const plays = loadSavedPlays();
  const idx = plays.findIndex((p) => p.id === updated.id);
  if (idx >= 0) {
    plays[idx] = updated;
  } else {
    plays.unshift(updated);
  }
  cachePlaysLocally(plays);
  upsertCloudPlay(updated).catch(() => {});
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
 * Delete a play across localStorage, IndexedDB, Server, and Cloud Firestore
 */
export function deletePlay(id: string): SavedPlay[] {
  markPlayIdDeleted(id);
  const plays = loadSavedPlays();
  const filtered = plays.filter((p) => p.id !== id);
  cachePlaysLocally(filtered);
  removeCloudPlay(id).catch(() => {});
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
