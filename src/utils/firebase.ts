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
  getDocs,
  getDocFromServer,
  setDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Draw, SavedPlay } from '../types/lottery';
import { UserAccessRecord, normalizeEmail, isPrimaryAdmin } from './auth';

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
    await deleteDoc(doc(db, 'plays', playId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `plays/${playId}`);
    return false;
  }
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
// 3. CUSTOM DRAWS DELTA CLOUD PERSISTENCE (/custom_draws/{drawId})
// ============================================================================

export async function fetchCloudCustomDraws(): Promise<Draw[] | null> {
  const db = getCloudDb();
  if (!db) return null;
  try {
    const snap = await getDocs(collection(db, 'custom_draws'));
    const draws: Draw[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Draw;
      if (data && typeof data.id === 'string' && Array.isArray(data.numbers)) {
        draws.push(data);
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
    const clean = stripUndefined(draw);
    await setDoc(doc(db, 'custom_draws', draw.id), clean);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `custom_draws/${draw.id}`);
    return false;
  }
}
