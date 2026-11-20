/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Draw,
  SisalDrawRecord,
  SavedPlay,
  ScoringWeights,
  FilterOptions,
  UserGeneratedSystemRecord,
  UserSimulationStateRecord
} from '../types/lottery';
import { validateRealDrawInput, drawToSisalRecord } from './combinatorics';
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
  DRAWS: 'superenalotto_real_draws_v1',
  PLAYS: 'superenalotto_saved_plays',
  DELETED_PLAY_IDS: 'superenalotto_deleted_play_ids_v1',
  WEIGHTS: 'superenalotto_scoring_weights',
  FILTERS: 'superenalotto_filter_options_v2',
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
  const baseSet = new Set<string>(['play-manual-1793562659204', 'play-wfi-1795034983423']);
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
  evenOdd: false,
  highLow: false,
  sumRange: false,
  minSum: 190,
  maxSum: 350,
  consecutive: false,
  decades: false,
  cadences: false
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
 * Valida, deduplica (per numero di concorso e data) e ordina in modo decrescente per data/concorso
 * una lista di record (sia in formato SisalDrawRecord sia in formato Draw).
 * Scarta automaticamente qualsiasi record incompleto, duplicato o fuori intervallo [1..90].
 */
export function validateAndDeduplicateDraws(rawItems: unknown[]): Draw[] {
  if (!Array.isArray(rawItems)) return [];

  const byConcorsoAndDate = new Map<string, Draw>();
  const byYearConcorso = new Map<string, string>();
  const byDateAndSestina = new Map<string, string>();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    const check = validateRealDrawInput({
      id: typeof item.id === 'string' ? item.id : undefined,
      concorso:
        typeof item.concorso === 'number'
          ? item.concorso
          : typeof item.contestNumber === 'number'
          ? item.contestNumber
          : undefined,
      contestNumber:
        typeof item.contestNumber === 'number'
          ? item.contestNumber
          : typeof item.concorso === 'number'
          ? item.concorso
          : undefined,
      year: typeof item.year === 'number' ? item.year : undefined,
      data:
        typeof item.data === 'string'
          ? item.data
          : typeof item.date === 'string'
          ? item.date
          : undefined,
      date:
        typeof item.date === 'string'
          ? item.date
          : typeof item.data === 'string'
          ? item.data
          : undefined,
      sestina: Array.isArray(item.sestina)
        ? (item.sestina as number[])
        : Array.isArray(item.numbers)
        ? (item.numbers as number[])
        : undefined,
      numbers: Array.isArray(item.numbers)
        ? (item.numbers as number[])
        : Array.isArray(item.sestina)
        ? (item.sestina as number[])
        : undefined,
      jolly: item.jolly !== undefined ? Number(item.jolly) : undefined,
      superstar: item.superstar !== undefined ? Number(item.superstar) : undefined
    });

    if (!check.valid || !check.draw) continue;
    const validDraw = check.draw;

    const primaryKey = `${validDraw.contestNumber}__${validDraw.date}`;
    const yearConcorsoKey = `${validDraw.year}-${validDraw.contestNumber}`;
    const dateSestinaKey = `${validDraw.date}__${validDraw.numbers.join(',')}`;

    // Skip duplicates by concorso+data, year+concorso, or same date+sestina
    if (
      byConcorsoAndDate.has(primaryKey) ||
      byYearConcorso.has(yearConcorsoKey) ||
      byDateAndSestina.has(dateSestinaKey)
    ) {
      continue;
    }

    byConcorsoAndDate.set(primaryKey, validDraw);
    byYearConcorso.set(yearConcorsoKey, primaryKey);
    byDateAndSestina.set(dateSestinaKey, primaryKey);
  }

  return Array.from(byConcorsoAndDate.values()).sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.contestNumber - a.contestNumber;
  });
}

/**
 * Carica esclusivamente le estrazioni reali validate salvate in localStorage.
 * Nessun dato precompilato o fittizio: se l'archivio è vuoto, restituisce [].
 */
export function loadDraws(): Draw[] {
  try {
    if (typeof localStorage === 'undefined') return [];

    // Pulizia chiavi legacy precompilate
    localStorage.removeItem('superenalotto_historical_draws');
    localStorage.removeItem('superenalotto_official_draws_2009_2026_v5');
    localStorage.removeItem('superenalotto_custom_draws_delta_v6');

    const raw = localStorage.getItem(STORAGE_KEYS.DRAWS);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return validateAndDeduplicateDraws(parsed);
  } catch (e) {
    console.warn('Error reading real draws from localStorage:', e);
    return [];
  }
}

/**
 * All'avvio dell'app, esegue il fetch di `/data/estrazioni_sisal.json` e lo unisce
 * (merge deduplicato per numero di concorso e data) con eventuali estrazioni reali salvate
 * dall'utente in `localStorage`.
 * Se entrambi sono vuoti (`draws.length === 0`), restituisce `[]`.
 */
export async function loadAndMergeEstrazioniSisal(): Promise<Draw[]> {
  const localDraws = loadDraws();
  let staticSisalRecords: unknown[] = [];

  try {
    if (typeof fetch !== 'undefined') {
      const res = await fetch('/data/estrazioni_sisal.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          staticSisalRecords = data;
        }
      }
    }
  } catch {
    // Se offline o ambiente di test senza server HTTP, usa solo localDraws
  }

  const merged = validateAndDeduplicateDraws([...localDraws, ...staticSisalRecords]);
  if (merged.length > 0) {
    saveDraws(merged);
  }
  return merged;
}

/**
 * Sincronizzazione manuale su richiesta dell'utente da `/data/estrazioni_sisal.json` e Cloud Firestore
 */
export async function syncOfficialDrawsFromLiveFeed(): Promise<{
  draws: Draw[];
  addedOrUpdated: number;
  latestDate: string;
}> {
  const current = loadDraws();
  const prevCount = current.length;
  const merged = await loadAndMergeEstrazioniSisal();

  return {
    draws: merged,
    addedOrUpdated: Math.max(0, merged.length - prevCount),
    latestDate: merged[0]?.date || ''
  };
}

/**
 * Salva l'archivio reale validato in localStorage nel formato rigoroso Sisal
 * ({ concorso, data, sestina, jolly, superstar }) ordinato per data/concorso decrescente.
 */
export function saveDraws(draws: Draw[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const validDraws = validateAndDeduplicateDraws(draws || []);
    const sisalRecords: SisalDrawRecord[] = validDraws
      .map((d) => drawToSisalRecord(d))
      .filter((r): r is SisalDrawRecord => r !== null);
    localStorage.setItem(STORAGE_KEYS.DRAWS, JSON.stringify(sisalRecords));
  } catch (e) {
    console.error('Error saving real draws to localStorage:', e);
  }
}

/**
 * Svuota completamente l'archivio delle estrazioni in localStorage
 */
export function clearAllDraws(): Draw[] {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.DRAWS);
    }
  } catch (e) {
    console.error('Error clearing draws from localStorage:', e);
  }
  return [];
}

/**
 * Inserisce una nuova estrazione reale nell'archivio dopo validazione rigorosa Sisal [1..90] e controllo anti-duplicati
 */
export function insertDraw(newDraw: Draw): Draw[] {
  const check = validateRealDrawInput(newDraw);
  if (!check.valid || !check.draw) {
    throw new Error(check.error || 'Estrazione non valida');
  }
  const validatedDraw = check.draw;
  const current = loadDraws();

  // Merge deduplicato (il nuovo record ha priorità in caso di aggiornamento dello stesso concorso/data)
  const merged = validateAndDeduplicateDraws([validatedDraw, ...current]);
  saveDraws(merged);
  upsertCloudCustomDraw(validatedDraw).catch(() => {});
  return merged;
}

export function normalizeLegacyWinForItaliaPlay(play: SavedPlay): SavedPlay {
  if (
    play &&
    play.id === 'play-wfi-1795036570889' &&
    (play.targetContestId === 'WFI-2026-304' ||
      play.columns?.[0]?.numbers?.join(',') === '3,14,15,26,30,35')
  ) {
    return {
      ...play,
      targetContestId: 'WFI-2026-053',
      manualNote: 'Win for Italia Team (6/40) — Concorso 53 del 19/11/2026 (2,00 €)',
      poolNumbers: [1, 14, 15, 24, 30, 39],
      columns: [
        {
          id: 1,
          numbers: [1, 14, 15, 24, 30, 39],
          sum: 123,
          evens: 3,
          odds: 3,
          lows: 3,
          highs: 3
        }
      ],
      status: 'VERIFICATA',
      result: {
        matchesPerColumn: [
          {
            columnId: 1,
            numbers: [1, 14, 15, 24, 30, 39],
            matchedNumbers: [],
            matchCount: 0,
            hasJolly: false,
            hasSuperstar: false,
            prizeTier: 'Nessun Punto',
            estimatedPrize: 0
          }
        ],
        totalWinning: 0,
        netReturn: -2,
        bestMatch: 0,
        hasWin: false,
        verifiedAt: '2026-11-19T20:55:00.000Z'
      }
    };
  }
  return play;
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
        return parsed
          .filter((p) => p && typeof p.id === 'string' && !deletedIds.has(p.id))
          .map(normalizeLegacyWinForItaliaPlay);
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
  const cleanPlays = plays
    .filter((p) => p && typeof p.id === 'string' && !deletedIds.has(p.id))
    .map(normalizeLegacyWinForItaliaPlay);
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
  const cleanPlays = plays
    .filter((p) => p && typeof p.id === 'string' && !deletedIds.has(p.id))
    .map(normalizeLegacyWinForItaliaPlay);
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
  const normExisting = normalizeLegacyWinForItaliaPlay(existing);
  const normIncoming = normalizeLegacyWinForItaliaPlay(incoming);
  if (normIncoming.status === 'VERIFICATA' && normExisting.status !== 'VERIFICATA') {
    return normIncoming;
  }
  if (normExisting.status === 'VERIFICATA' && normIncoming.status !== 'VERIFICATA') {
    return normExisting;
  }
  const existingVerTime = new Date(
    (normExisting as SavedPlay & { updatedAt?: string }).updatedAt ||
      normExisting.result?.verifiedAt ||
      normExisting.createdAt ||
      0
  ).getTime();
  const incomingVerTime = new Date(
    (normIncoming as SavedPlay & { updatedAt?: string }).updatedAt ||
      normIncoming.result?.verifiedAt ||
      normIncoming.createdAt ||
      0
  ).getTime();
  return incomingVerTime >= existingVerTime ? normIncoming : normExisting;
}

/**
 * Synchronize saved plays across Cloud Firestore (/plays + /deleted_plays), Server (/api/plays), IndexedDB, and LocalStorage
 * Ensures deleted plays NEVER resurrect across browsers or during in-flight async syncs.
 */
export async function syncSavedPlaysWithServer(): Promise<SavedPlay[]> {
  // Also ensure the legacy test plays are removed from Cloud Firestore
  removeCloudPlay('play-manual-1793562659204').catch(() => {});
  removeCloudPlay('play-wfi-1795034983423').catch(() => {});

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
  const idbPlays = idbPlaysRaw
    .filter((p) => p && !allDeletedIds.has(p.id))
    .map(normalizeLegacyWinForItaliaPlay);
  const cloudPlays = (cloudPlaysResult || [])
    .filter((p) => p && !allDeletedIds.has(p.id))
    .map(normalizeLegacyWinForItaliaPlay);
  const serverPlays = serverResponse.plays
    .filter((p) => p && !allDeletedIds.has(p.id))
    .map(normalizeLegacyWinForItaliaPlay);

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
  const cloudRawMap = new Map((cloudPlaysResult || []).map((p) => [p.id, p]));
  const toUploadToCloud = merged.filter((p) => {
    if (finalDeletedIds.has(p.id)) return false;
    const inCloud = cloudRawMap.get(p.id);
    if (!inCloud) return true;
    if (p.targetContestId !== inCloud.targetContestId) return true;
    if (
      (p.columns?.[0]?.numbers || []).join(',') !==
      (inCloud.columns?.[0]?.numbers || []).join(',')
    ) {
      return true;
    }
    if (p.status === 'VERIFICATA' && inCloud.status !== 'VERIFICATA') return true;
    if ((p.result?.totalWinning ?? 0) !== (inCloud.result?.totalWinning ?? 0)) return true;
    if (p.cost !== inCloud.cost) return true;
    if (p.userEmail && !inCloud.userEmail) return true;
    return false;
  });

  if (toUploadToCloud.length > 0) {
    await upsertManyCloudPlays(toUploadToCloud);
  }

  if (merged.length !== serverPlays.length || toUploadToCloud.length > 0) {
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
 * Esporta l'intero archivio reale unito e ordinato per data/concorso decrescente
 * nel formato esatto di `public/data/estrazioni_sisal.json`:
 * [
 *   {
 *     "concorso": number,
 *     "data": "YYYY-MM-DD",
 *     "sestina": [n1, n2, n3, n4, n5, n6],
 *     "jolly": number,
 *     "superstar": number
 *   }
 * ]
 */
export function exportEstrazioniSisalJSON(sourceDraws?: Draw[]): string {
  const validDraws = validateAndDeduplicateDraws(sourceDraws ?? loadDraws());
  const sisalArray: SisalDrawRecord[] = validDraws
    .map((d) => drawToSisalRecord(d))
    .filter((r): r is SisalDrawRecord => r !== null);
  return JSON.stringify(sisalArray, null, 2);
}

/**
 * Export all draws and plays to JSON string
 */
export function exportBackupJSON(): string {
  const validDraws = loadDraws();
  const sisalDraws = validDraws
    .map((d) => drawToSisalRecord(d))
    .filter((r): r is SisalDrawRecord => r !== null);
  const data = {
    app: 'SuperEnalotto Combinatorial Optimizer',
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    draws: sisalDraws,
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
  const header = 'concorso;data;n1;n2;n3;n4;n5;n6;jolly;superstar\n';
  const rows = draws.map((d) => {
    return `${d.contestNumber};${d.date};${d.numbers.join(';')};${d.jolly};${d.superstar ?? ''}`;
  });
  return header + rows.join('\n');
}

/**
 * Importa archivio JSON (formato `estrazioni_sisal.json` o backup JSON completo)
 * validando rigorosamente ogni record e scartando record incompleti, duplicati o fuori intervallo.
 */
export function importBackupJSON(jsonString: string): { importedDraws: number; importedPlays: number } {
  const parsed = JSON.parse(jsonString);
  let importedDraws = 0;
  let importedPlays = 0;

  const rawDrawsList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.draws)
    ? parsed.draws
    : null;

  if (rawDrawsList) {
    const current = loadDraws();
    const prevCount = current.length;
    const validIncoming: Draw[] = [];

    for (const item of rawDrawsList) {
      if (!item || typeof item !== 'object') continue;
      const numbers = Array.isArray(item.sestina)
        ? item.sestina
        : Array.isArray(item.numbers)
        ? item.numbers
        : [];
      const jolly = item.jolly;
      const superstar = item.superstar;
      const date = item.data ?? item.date;
      const concorso = item.concorso ?? item.contestNumber;

      const check = validateRealDrawInput({
        id: typeof item.id === 'string' ? item.id : undefined,
        concorso: concorso !== undefined ? Number(concorso) : undefined,
        contestNumber: concorso !== undefined ? Number(concorso) : undefined,
        year: typeof item.year === 'number' ? item.year : undefined,
        data: date !== undefined ? String(date) : undefined,
        date: date !== undefined ? String(date) : undefined,
        sestina: numbers.map(Number),
        numbers: numbers.map(Number),
        jolly: jolly !== undefined ? Number(jolly) : undefined,
        superstar: superstar !== undefined && superstar !== null && String(superstar).trim() !== ''
          ? Number(superstar)
          : undefined
      });

      if (check.valid && check.draw) {
        validIncoming.push(check.draw);
      }
    }

    const merged = validateAndDeduplicateDraws([...current, ...validIncoming]);
    importedDraws = Math.max(0, merged.length - prevCount);
    saveDraws(merged);
  }

  if (parsed && !Array.isArray(parsed)) {
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
  }

  return { importedDraws, importedPlays };
}

/**
 * Importa estrazioni da formato CSV con validazione rigorosa Sisal:
 * - `sestina`: 6 interi univoci [1..90] ordinati in modo crescente
 * - `jolly`: intero [1..90] non presente in `sestina`
 * - `superstar`: intero [1..90] obbligatorio
 * - Scarta automaticamente record incompleti, duplicati o fuori intervallo.
 */
export function importDrawsCSV(csvString: string): number {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length === 0) return 0;

  const current = loadDraws();
  const prevCount = current.length;
  const validIncoming: Draw[] = [];

  const startIdx =
    /^[a-zA-Z]/.test(lines[0].trim()) && !/^\d{1,4}(-\d{1,4})?[;,]/.test(lines[0].trim())
      ? 1
      : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/[;,]/);
    if (parts.length >= 10) {
      const rawIdOrConcorso = parts[0].trim();
      const date = parts[1].trim();
      const n1 = parseInt(parts[2], 10);
      const n2 = parseInt(parts[3], 10);
      const n3 = parseInt(parts[4], 10);
      const n4 = parseInt(parts[5], 10);
      const n5 = parseInt(parts[6], 10);
      const n6 = parseInt(parts[7], 10);
      const jolly = parts[8] ? parseInt(parts[8].trim(), 10) : NaN;
      const superstar = parts[9] && parts[9].trim() !== '' ? parseInt(parts[9].trim(), 10) : NaN;

      const contestNumber = rawIdOrConcorso.includes('-')
        ? parseInt(rawIdOrConcorso.split('-')[1], 10)
        : parseInt(rawIdOrConcorso, 10);
      const year = parseInt(date.slice(0, 4), 10);

      const check = validateRealDrawInput({
        id: rawIdOrConcorso.includes('-')
          ? rawIdOrConcorso
          : `${year}-${String(contestNumber).padStart(3, '0')}`,
        concorso: contestNumber,
        contestNumber,
        year,
        data: date,
        date,
        sestina: [n1, n2, n3, n4, n5, n6],
        numbers: [n1, n2, n3, n4, n5, n6],
        jolly,
        superstar
      });

      if (check.valid && check.draw) {
        validIncoming.push(check.draw);
      }
    }
  }

  const merged = validateAndDeduplicateDraws([...current, ...validIncoming]);
  saveDraws(merged);
  return Math.max(0, merged.length - prevCount);
}
