/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  setDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  Draw,
  SavedPlay,
  UserGeneratedSystemRecord,
  UserSimulationStateRecord
} from '../types/lottery';
import { UserAccessRecord, normalizeEmail, isPrimaryAdmin } from './auth';
import {
  UserCamelWorkforceRecord,
  compactCamelWorkforceResult,
  hydrateCamelWorkforceResult
} from './camelWorkforce';
import type { UserWinForItaliaRecord } from './winForItalia';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  databaseId: string;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    databaseId: firebaseConfig.firestoreDatabaseId
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

let firestoreInstance: Firestore | null = null;

export function getCloudDb(): Firestore | null {
  if (!isBrowserEnvironment()) {
    return null;
  }
  if (firestoreInstance) {
    return firestoreInstance;
  }
  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    try {
      firestoreInstance = initializeFirestore(
        app,
        { ignoreUndefinedProperties: true },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
    return firestoreInstance;
  } catch (err) {
    console.error('Failed to initialize Firebase Firestore:', err);
    return null;
  }
}

/**
 * Strip undefined properties recursively so Firestore setDoc never rejects optional fields
 */
function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Validate connection to Cloud Firestore on startup
 */
export async function testFirestoreConnection(): Promise<boolean> {
  const db = getCloudDb();
  if (!db) return false;
  try {
    await getDocFromServer(doc(db, '_connection_test', 'ping'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. The client is offline.');
    }
    return false;
  }
}

// ============================================================================
// 1. SAVED PLAYS CLOUD PERSISTENCE (/plays/{playId})
// ============================================================================

export async function fetchCloudPlays(): Promise<SavedPlay[] | null> {
  const db = getCloudDb();
  if (!db) return null;
  try {
    const snap = await getDocs(collection(db, 'plays'));
    const plays: SavedPlay[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as SavedPlay;
      if (data && typeof data.id === 'string' && Array.isArray(data.columns)) {
        plays.push(data);
      }
    });
    plays.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return plays;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'plays');
    return null;
  }
}

export async function upsertCloudPlay(play: SavedPlay): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !play?.id) return false;
  try {
    const clean = stripUndefined({
      ...play,
      poolNumbers: Array.isArray(play.poolNumbers) ? play.poolNumbers : [],
      savedAmount: typeof play.savedAmount === 'number' ? play.savedAmount : 0,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, 'plays', play.id), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `plays/${play.id}`);
    return false;
  }
}

export async function upsertManyCloudPlays(plays: SavedPlay[]): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !Array.isArray(plays) || plays.length === 0) return false;
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    for (const play of plays) {
      if (!play || typeof play.id !== 'string') continue;
      const clean = stripUndefined({
        ...play,
        poolNumbers: Array.isArray(play.poolNumbers) ? play.poolNumbers : [],
        savedAmount: typeof play.savedAmount === 'number' ? play.savedAmount : 0,
        updatedAt: now
      });
      batch.set(doc(db, 'plays', play.id), clean);
    }
    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'plays/batch');
    return false;
  }
}

export async function removeCloudPlay(playId: string): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !playId) return false;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'plays', playId));
    batch.set(doc(db, 'deleted_plays', playId), {
      id: playId,
      deletedAt: new Date().toISOString()
    });
    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `plays/${playId}`);
    return false;
  }
}

export async function fetchCloudDeletedPlayIds(): Promise<string[]> {
  const db = getCloudDb();
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, 'deleted_plays'));
    const ids: string[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as { id?: string };
      if (data && typeof data.id === 'string') {
        ids.push(data.id);
      } else if (docSnap.id) {
        ids.push(docSnap.id);
      }
    });
    return ids;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'deleted_plays');
    return [];
  }
}

export function subscribeCloudDeletedPlayIds(
  onUpdate: (deletedIds: string[]) => void
): () => void {
  const db = getCloudDb();
  if (!db) return () => {};
  return onSnapshot(
    collection(db, 'deleted_plays'),
    (snap) => {
      const ids: string[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as { id?: string };
        if (data && typeof data.id === 'string') {
          ids.push(data.id);
        } else if (docSnap.id) {
          ids.push(docSnap.id);
        }
      });
      onUpdate(ids);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'deleted_plays');
    }
  );
}

export function subscribeCloudPlays(onUpdate: (plays: SavedPlay[]) => void): () => void {
  const db = getCloudDb();
  if (!db) return () => {};
  return onSnapshot(
    collection(db, 'plays'),
    (snap) => {
      const plays: SavedPlay[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as SavedPlay;
        if (data && typeof data.id === 'string' && Array.isArray(data.columns)) {
          plays.push(data);
        }
      });
      plays.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      onUpdate(plays);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'plays');
    }
  );
}

// ============================================================================
// 2. USER ACCESS CONTROL (ACL) CLOUD PERSISTENCE (/acl/{emailKey})
// ============================================================================

export async function fetchCloudACL(): Promise<UserAccessRecord[] | null> {
  const db = getCloudDb();
  if (!db) return null;
  try {
    const snap = await getDocs(collection(db, 'acl'));
    const records: UserAccessRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as UserAccessRecord;
      if (data && typeof data.email === 'string') {
        records.push(data);
      }
    });
    return records;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'acl');
    return null;
  }
}

export async function upsertCloudACLRecord(record: UserAccessRecord): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !record?.email) return false;
  const emailKey = normalizeEmail(record.email);
  if (!emailKey || emailKey === 'admin@sistema.local') return false;
  try {
    const clean = stripUndefined({
      ...record,
      email: emailKey,
      name: record.name || emailKey.split('@')[0],
      role: isPrimaryAdmin(emailKey) ? 'ADMIN' : 'USER',
      status: isPrimaryAdmin(emailKey) ? 'AUTHORIZED' : record.status,
      requestedAt: record.requestedAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString()
    });
    await setDoc(doc(db, 'acl', emailKey), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `acl/${emailKey}`);
    return false;
  }
}

export async function upsertManyCloudACLRecords(records: UserAccessRecord[]): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !Array.isArray(records) || records.length === 0) return false;
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    for (const rec of records) {
      if (!rec || typeof rec.email !== 'string') continue;
      const emailKey = normalizeEmail(rec.email);
      if (!emailKey || emailKey === 'admin@sistema.local') continue;
      const clean = stripUndefined({
        ...rec,
        email: emailKey,
        name: rec.name || emailKey.split('@')[0],
        role: isPrimaryAdmin(emailKey) ? 'ADMIN' : 'USER',
        status: isPrimaryAdmin(emailKey) ? 'AUTHORIZED' : rec.status,
        requestedAt: rec.requestedAt || now,
        updatedAt: rec.updatedAt || now
      });
      batch.set(doc(db, 'acl', emailKey), clean);
    }
    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'acl/batch');
    return false;
  }
}

export async function removeCloudACLRecord(email: string): Promise<boolean> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(email);
  if (!db || !emailKey || isPrimaryAdmin(emailKey)) return false;
  try {
    await deleteDoc(doc(db, 'acl', emailKey));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `acl/${emailKey}`);
    return false;
  }
}

export function subscribeCloudACL(onUpdate: (records: UserAccessRecord[]) => void): () => void {
  const db = getCloudDb();
  if (!db) return () => {};
  return onSnapshot(
    collection(db, 'acl'),
    (snap) => {
      const records: UserAccessRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as UserAccessRecord;
        if (data && typeof data.email === 'string') {
          records.push(data);
        }
      });
      onUpdate(records);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'acl');
    }
  );
}

// ============================================================================
// 3. CUSTOM DRAWS CLOUD PERSISTENCE (/custom_draws/{drawId})
//    Supports both SuperEnalotto (6/90) and Win for Italia / Win for Life (6/40)
// ============================================================================

export interface CloudWinForItaliaDrawRecord {
  id: string;
  contestNumber: number;
  year: number;
  date: string;
  time?: string;
  numbers: [number, number, number, number, number, number];
}

function isWinForItaliaCloudDoc(data: Record<string, unknown>): boolean {
  return (
    data?.game === 'winforitalia' ||
    (typeof data?.id === 'string' && data.id.toUpperCase().startsWith('WFI-'))
  );
}

export async function fetchCloudCustomDraws(): Promise<Draw[] | null> {
  const db = getCloudDb();
  if (!db) return null;
  try {
    const snap = await getDocs(collection(db, 'custom_draws'));
    const draws: Draw[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      if (isWinForItaliaCloudDoc(data)) return;
      if (data && typeof data.id === 'string' && Array.isArray(data.numbers) && data.numbers.length === 6) {
        draws.push(data as unknown as Draw);
      }
    });
    return draws;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'custom_draws');
    return null;
  }
}

export async function upsertCloudCustomDraw(draw: Draw): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !draw?.id) return false;
  try {
    const clean = stripUndefined({ ...draw, game: 'superenalotto' });
    await setDoc(doc(db, 'custom_draws', draw.id), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `custom_draws/${draw.id}`);
    return false;
  }
}

export async function upsertManyCloudCustomDraws(draws: Draw[]): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !Array.isArray(draws) || draws.length === 0) return false;
  try {
    const CHUNK = 400;
    for (let i = 0; i < draws.length; i += CHUNK) {
      const batch = writeBatch(db);
      const slice = draws.slice(i, i + CHUNK);
      for (const draw of slice) {
        if (!draw?.id) continue;
        const clean = stripUndefined({ ...draw, game: 'superenalotto' });
        batch.set(doc(db, 'custom_draws', draw.id), clean);
      }
      await batch.commit();
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'custom_draws/batch');
    return false;
  }
}

export function subscribeCloudCustomDraws(onUpdate: (draws: Draw[]) => void): () => void {
  const db = getCloudDb();
  if (!db) return () => {};
  return onSnapshot(
    collection(db, 'custom_draws'),
    (snap) => {
      const draws: Draw[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (isWinForItaliaCloudDoc(data)) return;
        if (data && typeof data.id === 'string' && Array.isArray(data.numbers) && data.numbers.length === 6) {
          draws.push(data as unknown as Draw);
        }
      });
      onUpdate(draws);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'custom_draws');
    }
  );
}

export async function fetchCloudWinForItaliaDraws(): Promise<CloudWinForItaliaDrawRecord[] | null> {
  const db = getCloudDb();
  if (!db) return null;
  try {
    const snap = await getDocs(collection(db, 'custom_draws'));
    const draws: CloudWinForItaliaDrawRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      if (!isWinForItaliaCloudDoc(data)) return;
      if (typeof data.id === 'string' && typeof data.date === 'string' && Array.isArray(data.numbers) && data.numbers.length === 6) {
        draws.push({
          id: data.id,
          contestNumber: Number(data.contestNumber) || 1,
          year: Number(data.year) || parseInt(data.date.slice(0, 4), 10) || 2026,
          date: data.date,
          time: typeof data.time === 'string' ? data.time : '20:00',
          numbers: [...(data.numbers as number[])].map(Number).sort((a, b) => a - b) as [
            number,
            number,
            number,
            number,
            number,
            number
          ]
        });
      }
    });
    return draws;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'custom_draws/winforitalia');
    return null;
  }
}

export async function upsertCloudWinForItaliaDraw(draw: CloudWinForItaliaDrawRecord): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !draw?.id) return false;
  try {
    // Include jolly: 1 placeholder solely to satisfy deployed Firestore custom_draws rule (stripped on read)
    const clean = stripUndefined({
      id: draw.id,
      contestNumber: draw.contestNumber,
      year: draw.year,
      date: draw.date,
      time: draw.time || '20:00',
      numbers: [...draw.numbers].sort((a, b) => a - b),
      jolly: 1,
      game: 'winforitalia'
    });
    await setDoc(doc(db, 'custom_draws', draw.id), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `custom_draws/${draw.id}`);
    return false;
  }
}

export async function upsertManyCloudWinForItaliaDraws(
  draws: CloudWinForItaliaDrawRecord[]
): Promise<boolean> {
  const db = getCloudDb();
  if (!db || !Array.isArray(draws) || draws.length === 0) return false;
  try {
    const CHUNK = 400;
    for (let i = 0; i < draws.length; i += CHUNK) {
      const batch = writeBatch(db);
      const slice = draws.slice(i, i + CHUNK);
      for (const draw of slice) {
        if (!draw?.id) continue;
        const clean = stripUndefined({
          id: draw.id,
          contestNumber: draw.contestNumber,
          year: draw.year,
          date: draw.date,
          time: draw.time || '20:00',
          numbers: [...draw.numbers].sort((a, b) => a - b),
          jolly: 1,
          game: 'winforitalia'
        });
        batch.set(doc(db, 'custom_draws', draw.id), clean);
      }
      await batch.commit();
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'custom_draws/winforitalia-batch');
    return false;
  }
}

export async function clearCloudCustomDraws(
  game: 'superenalotto' | 'winforitalia'
): Promise<boolean> {
  const db = getCloudDb();
  if (!db) return false;
  try {
    const snap = await getDocs(collection(db, 'custom_draws'));
    const toDeleteIds: string[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const isWfi = isWinForItaliaCloudDoc(data);
      if ((game === 'winforitalia' && isWfi) || (game === 'superenalotto' && !isWfi)) {
        toDeleteIds.push(docSnap.id);
      }
    });
    const CHUNK = 400;
    for (let i = 0; i < toDeleteIds.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const id of toDeleteIds.slice(i, i + CHUNK)) {
        batch.delete(doc(db, 'custom_draws', id));
      }
      await batch.commit();
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `custom_draws/${game}`);
    return false;
  }
}

export function subscribeCloudWinForItaliaDraws(
  onUpdate: (draws: CloudWinForItaliaDrawRecord[]) => void
): () => void {
  const db = getCloudDb();
  if (!db) return () => {};
  return onSnapshot(
    collection(db, 'custom_draws'),
    (snap) => {
      const draws: CloudWinForItaliaDrawRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (!isWinForItaliaCloudDoc(data)) return;
        if (typeof data.id === 'string' && typeof data.date === 'string' && Array.isArray(data.numbers) && data.numbers.length === 6) {
          draws.push({
            id: data.id,
            contestNumber: Number(data.contestNumber) || 1,
            year: Number(data.year) || parseInt(data.date.slice(0, 4), 10) || 2026,
            date: data.date,
            time: typeof data.time === 'string' ? data.time : '20:00',
            numbers: [...(data.numbers as number[])].map(Number).sort((a, b) => a - b) as [
              number,
              number,
              number,
              number,
              number,
              number
            ]
          });
        }
      });
      onUpdate(draws);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'custom_draws/winforitalia');
    }
  );
}

// ============================================================================
// 4. PER-USER GENERATED SYSTEM CLOUD PERSISTENCE (/user_systems/{emailKey})
// ============================================================================

export async function fetchCloudUserSystem(
  userEmail: string
): Promise<UserGeneratedSystemRecord | null> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  if (!db || !emailKey) return null;
  try {
    const snap = await getDoc(doc(db, 'user_systems', emailKey));
    if (!snap.exists()) return null;
    const data = snap.data() as UserGeneratedSystemRecord;
    if (
      data &&
      typeof data.userEmail === 'string' &&
      data.systemResult &&
      Array.isArray(data.systemResult.columns) &&
      data.systemResult.columns.length > 0
    ) {
      return data;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `user_systems/${emailKey}`);
    return null;
  }
}

export async function upsertCloudUserSystem(
  record: UserGeneratedSystemRecord
): Promise<boolean> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(record?.userEmail || '');
  if (!db || !emailKey || !record?.systemResult) return false;
  try {
    const clean = stripUndefined({
      ...record,
      userEmail: emailKey,
      updatedAt: record.updatedAt || new Date().toISOString()
    });
    await setDoc(doc(db, 'user_systems', emailKey), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_systems/${emailKey}`);
    return false;
  }
}

export function subscribeCloudUserSystem(
  userEmail: string,
  onUpdate: (record: UserGeneratedSystemRecord | null) => void
): () => void {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  if (!db || !emailKey) return () => {};
  return onSnapshot(
    doc(db, 'user_systems', emailKey),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const data = snap.data() as UserGeneratedSystemRecord;
      if (
        data &&
        typeof data.userEmail === 'string' &&
        data.systemResult &&
        Array.isArray(data.systemResult.columns) &&
        data.systemResult.columns.length > 0
      ) {
        onUpdate(data);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `user_systems/${emailKey}`);
    }
  );
}

// ============================================================================
// 5. PER-USER SIMULATION STATE CLOUD PERSISTENCE (/user_simulations/{emailKey})
// ============================================================================

export async function fetchCloudUserSimulation(
  userEmail: string
): Promise<UserSimulationStateRecord | null> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  if (!db || !emailKey) return null;
  try {
    const snap = await getDoc(doc(db, 'user_simulations', emailKey));
    if (!snap.exists()) return null;
    const data = snap.data() as UserSimulationStateRecord;
    if (
      data &&
      typeof data.userEmail === 'string' &&
      typeof data.simSeed === 'number' &&
      typeof data.numDrawsToSimulate === 'number'
    ) {
      return data;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `user_simulations/${emailKey}`);
    return null;
  }
}

export async function upsertCloudUserSimulation(
  record: UserSimulationStateRecord
): Promise<boolean> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(record?.userEmail || '');
  if (!db || !emailKey || typeof record?.simSeed !== 'number') return false;
  try {
    const clean = stripUndefined({
      ...record,
      userEmail: emailKey,
      updatedAt: record.updatedAt || new Date().toISOString()
    });
    await setDoc(doc(db, 'user_simulations', emailKey), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_simulations/${emailKey}`);
    return false;
  }
}

export function subscribeCloudUserSimulation(
  userEmail: string,
  onUpdate: (record: UserSimulationStateRecord | null) => void
): () => void {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  if (!db || !emailKey) return () => {};
  return onSnapshot(
    doc(db, 'user_simulations', emailKey),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const data = snap.data() as UserSimulationStateRecord;
      if (
        data &&
        typeof data.userEmail === 'string' &&
        typeof data.simSeed === 'number' &&
        typeof data.numDrawsToSimulate === 'number'
      ) {
        onUpdate(data);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `user_simulations/${emailKey}`);
    }
  );
}

// ============================================================================
// 6. PER-USER CAMEL WORKFORCE CLOUD PERSISTENCE (/user_systems/camel::{emailKey})
//    Reuses the deployed user_systems collection with a disjoint `camel::` doc key
//    and top-level winner `systemResult` so deployed Firestore rules accept writes
//    immediately across browsers, sessions, and devices.
// ============================================================================

const CAMEL_CLOUD_DOC_PREFIX = 'camel::';

function getCamelCloudDocId(userEmail: string): string {
  const emailKey = normalizeEmail(userEmail);
  if (!emailKey) return '';
  const docId = `${CAMEL_CLOUD_DOC_PREFIX}${emailKey}`;
  return docId.length <= 254 ? docId : '';
}

function parseCloudCamelDoc(
  data: Record<string, unknown> | undefined,
  expectedEmail: string
): UserCamelWorkforceRecord | null {
  if (!data || typeof data !== 'object') return null;
  const rawOwner =
    typeof data.ownerEmail === 'string'
      ? data.ownerEmail
      : typeof data.userEmail === 'string'
      ? data.userEmail.replace(/^camel::/, '')
      : '';
  const ownerEmail = normalizeEmail(rawOwner);
  if (!ownerEmail || ownerEmail !== expectedEmail) return null;

  const hydrated = hydrateCamelWorkforceResult(data.camelWorkforce);
  if (!hydrated) return null;

  const updatedAt =
    typeof data.updatedAt === 'string' && data.updatedAt
      ? data.updatedAt
      : hydrated.executedAt || new Date().toISOString();

  return {
    userEmail: expectedEmail,
    updatedAt,
    poolSizeV: typeof data.poolSizeV === 'number' ? data.poolSizeV : hydrated.poolSizeV,
    historicalDrawsWindow:
      typeof data.historicalDrawsWindow === 'number'
        ? data.historicalDrawsWindow
        : hydrated.historicalDrawsWindow,
    budgetEuro: typeof data.budgetEuro === 'number' ? data.budgetEuro : hydrated.budgetEuro,
    playMode:
      data.playMode === 'superstar' ||
      data.playMode === 'pure_coverage' ||
      data.playMode === 'manual'
        ? data.playMode
        : hydrated.playMode,
    coverageTarget:
      data.coverageTarget === 'ambi' || data.coverageTarget === 'terni'
        ? data.coverageTarget
        : hydrated.coverageTarget,
    selectedCandidateId:
      typeof data.selectedCandidateId === 'string' && data.selectedCandidateId
        ? data.selectedCandidateId
        : hydrated.winnerCandidate.id,
    workforceResult: hydrated
  };
}

export async function fetchCloudUserCamelWorkforce(
  userEmail: string
): Promise<UserCamelWorkforceRecord | null> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  const docId = getCamelCloudDocId(emailKey);
  if (!db || !emailKey || !docId) return null;
  try {
    const snap = await getDoc(doc(db, 'user_systems', docId));
    if (!snap.exists()) return null;
    return parseCloudCamelDoc(snap.data() as Record<string, unknown>, emailKey);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `user_systems/${docId}`);
    return null;
  }
}

export async function upsertCloudUserCamelWorkforce(
  record: UserCamelWorkforceRecord
): Promise<boolean> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(record?.userEmail || '');
  const docId = getCamelCloudDocId(emailKey);
  const winnerSys = record?.workforceResult?.winnerCandidate?.systemResult;
  const winnerCols = winnerSys?.columns;
  if (
    !db ||
    !emailKey ||
    !docId ||
    !record?.workforceResult ||
    !Array.isArray(winnerCols) ||
    winnerCols.length === 0
  ) {
    return false;
  }
  try {
    const compactResult = compactCamelWorkforceResult(record.workforceResult);
    const updatedAt = (record.updatedAt || new Date().toISOString()).slice(0, 64);
    const clean = stripUndefined({
      userEmail: docId,
      ownerEmail: emailKey,
      recordType: 'camel_workforce_v1',
      updatedAt,
      poolSizeV: record.poolSizeV,
      historicalDrawsWindow: record.historicalDrawsWindow,
      budgetEuro: record.budgetEuro,
      playMode: record.playMode,
      coverageTarget: record.coverageTarget,
      selectedCandidateId: record.selectedCandidateId || compactResult.winnerCandidateId,
      systemResult: {
        poolNumbers: winnerSys.poolNumbers,
        columns: winnerCols.slice(0, 200)
      },
      camelWorkforce: compactResult
    });
    await setDoc(doc(db, 'user_systems', docId), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_systems/${docId}`);
    return false;
  }
}

export function subscribeCloudUserCamelWorkforce(
  userEmail: string,
  onUpdate: (record: UserCamelWorkforceRecord | null) => void
): () => void {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  const docId = getCamelCloudDocId(emailKey);
  if (!db || !emailKey || !docId) return () => {};
  return onSnapshot(
    doc(db, 'user_systems', docId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const parsed = parseCloudCamelDoc(snap.data() as Record<string, unknown>, emailKey);
      if (parsed) {
        onUpdate(parsed);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `user_systems/${docId}`);
    }
  );
}

// ============================================================================
// 7. PER-USER WIN FOR ITALIA / WIN FOR LIFE CLOUD PERSISTENCE (/user_systems/wfi::{emailKey})
//    Reuses the deployed user_systems collection with a disjoint `wfi::` doc key
//    and top-level `systemResult` so deployed Firestore rules accept writes
//    immediately across browsers, sessions, and devices.
// ============================================================================

const WFI_CLOUD_DOC_PREFIX = 'wfi::';

function getWinForItaliaCloudDocId(userEmail: string): string {
  const emailKey = normalizeEmail(userEmail);
  if (!emailKey) return '';
  const docId = `${WFI_CLOUD_DOC_PREFIX}${emailKey}`;
  return docId.length <= 254 ? docId : '';
}

function parseCloudWinForItaliaDoc(
  data: Record<string, unknown> | undefined,
  expectedEmail: string
): UserWinForItaliaRecord | null {
  if (!data || typeof data !== 'object') return null;
  const rawOwner =
    typeof data.ownerEmail === 'string'
      ? data.ownerEmail
      : typeof data.userEmail === 'string'
      ? data.userEmail.replace(/^wfi::/, '')
      : '';
  const ownerEmail = normalizeEmail(rawOwner);
  if (!ownerEmail || ownerEmail !== expectedEmail) return null;

  const payload = data.winForItalia as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') return null;

  const funnel = payload.funnelResult as UserWinForItaliaRecord['funnelResult'] | undefined;
  const sniper = payload.sniperSelection as UserWinForItaliaRecord['sniperSelection'] | undefined;
  const reduced3 = payload.reduced3System as UserWinForItaliaRecord['reduced3System'] | undefined;

  if (
    !funnel ||
    !Array.isArray(funnel.top12Numbers) ||
    funnel.top12Numbers.length !== 12 ||
    !Array.isArray(funnel.top9Numbers) ||
    funnel.top9Numbers.length !== 9 ||
    !Array.isArray(funnel.scoredPool16) ||
    funnel.scoredPool16.length !== 16 ||
    !sniper?.primarySestina ||
    !Array.isArray(sniper.primarySestina.numbers) ||
    sniper.primarySestina.numbers.length !== 6 ||
    !sniper?.alternative2 ||
    !sniper?.alternative3 ||
    !reduced3 ||
    !Array.isArray(reduced3.columns) ||
    reduced3.columns.length !== 3
  ) {
    return null;
  }

  const updatedAt =
    typeof data.updatedAt === 'string' && data.updatedAt
      ? data.updatedAt
      : new Date().toISOString();

  return {
    userEmail: expectedEmail,
    updatedAt,
    playMode: payload.playMode === 'reduced3' ? 'reduced3' : 'sniper',
    latestDrawIdAtGeneration:
      typeof payload.latestDrawIdAtGeneration === 'string'
        ? payload.latestDrawIdAtGeneration
        : '',
    windowSizeAtGeneration:
      typeof payload.windowSizeAtGeneration === 'number' ? payload.windowSizeAtGeneration : 0,
    funnelResult: funnel,
    sniperSelection: sniper,
    reduced3System: reduced3
  };
}

export async function fetchCloudUserWinForItalia(
  userEmail: string
): Promise<UserWinForItaliaRecord | null> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  const docId = getWinForItaliaCloudDocId(emailKey);
  if (!db || !emailKey || !docId) return null;
  try {
    const snap = await getDoc(doc(db, 'user_systems', docId));
    if (!snap.exists()) return null;
    return parseCloudWinForItaliaDoc(snap.data() as Record<string, unknown>, emailKey);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `user_systems/${docId}`);
    return null;
  }
}

export async function upsertCloudUserWinForItalia(
  record: UserWinForItaliaRecord
): Promise<boolean> {
  const db = getCloudDb();
  const emailKey = normalizeEmail(record?.userEmail || '');
  const docId = getWinForItaliaCloudDocId(emailKey);
  const primaryNums = record?.sniperSelection?.primarySestina?.numbers;
  if (
    !db ||
    !emailKey ||
    !docId ||
    !record?.funnelResult ||
    !record?.sniperSelection ||
    !record?.reduced3System ||
    !Array.isArray(primaryNums) ||
    primaryNums.length !== 6
  ) {
    return false;
  }
  try {
    const updatedAt = (record.updatedAt || new Date().toISOString()).slice(0, 64);
    const activeColumns =
      record.playMode === 'reduced3'
        ? record.reduced3System.columns.map((c, idx) => ({
            id: idx + 1,
            numbers: [...c.numbers],
            sum: c.sum,
            evens: c.evenCount,
            odds: c.oddCount
          }))
        : [
            {
              id: 1,
              numbers: [...primaryNums],
              sum: record.sniperSelection.primarySestina.sum,
              evens: record.sniperSelection.primarySestina.evenCount,
              odds: record.sniperSelection.primarySestina.oddCount
            }
          ];

    const clean = stripUndefined({
      userEmail: docId,
      ownerEmail: emailKey,
      recordType: 'winforitalia_v1',
      updatedAt,
      systemResult: {
        poolNumbers:
          record.playMode === 'reduced3'
            ? [...record.funnelResult.top9Numbers]
            : [...record.funnelResult.top12Numbers],
        columns: activeColumns
      },
      winForItalia: {
        playMode: record.playMode,
        latestDrawIdAtGeneration: record.latestDrawIdAtGeneration,
        windowSizeAtGeneration: record.windowSizeAtGeneration,
        funnelResult: record.funnelResult,
        sniperSelection: record.sniperSelection,
        reduced3System: record.reduced3System
      }
    });
    await setDoc(doc(db, 'user_systems', docId), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_systems/${docId}`);
    return false;
  }
}

export function subscribeCloudUserWinForItalia(
  userEmail: string,
  onUpdate: (record: UserWinForItaliaRecord | null) => void
): () => void {
  const db = getCloudDb();
  const emailKey = normalizeEmail(userEmail);
  const docId = getWinForItaliaCloudDocId(emailKey);
  if (!db || !emailKey || !docId) return () => {};
  return onSnapshot(
    doc(db, 'user_systems', docId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const parsed = parseCloudWinForItaliaDoc(snap.data() as Record<string, unknown>, emailKey);
      if (parsed) {
        onUpdate(parsed);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `user_systems/${docId}`);
    }
  );
}


