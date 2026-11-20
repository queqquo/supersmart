import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider, browserSessionPersistence, getAuth, onIdTokenChanged,
  setPersistence, signInWithPopup, signOut, type User,
} from 'firebase/auth';
import {
  collection, doc, getDocsFromServer, limit, onSnapshot, query, runTransaction,
} from 'firebase/firestore';
import config from '../../firebase-applet-config.json';
import { getCloudDb } from './firebase';
import {
  isPrimaryAdmin, normalizeEmail, type AccessStatus, type AuthSession, type UserAccessRecord,
} from './auth';

export const SECURE_ACL = 'acl_verified';

export function getCloudAuth() {
  return getAuth(getApps().length ? getApp() : initializeApp(config));
}

export async function startGoogleLogin() {
  const auth = getCloudAuth();
  await setPersistence(auth, browserSessionPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export function logoutGoogle() {
  return signOut(getCloudAuth());
}

export function observeVerifiedIdentity(next: (user: User | null) => void, fail: () => void) {
  let generation = 0;
  const unsubscribe = onIdTokenChanged(getCloudAuth(), async (user) => {
    const current = ++generation;
    if (!user) { next(null); return; }
    try {
      const token = await user.getIdTokenResult();
      if (current !== generation) return;
      const email = normalizeEmail(user.email || '');
      if (token.signInProvider !== 'google.com' || token.claims.email_verified !== true ||
          token.claims.email !== email || !email.endsWith('@gmail.com')) {
        next(null);
        fail();
      } else {
        next(user);
      }
    } catch {
      if (current === generation) { next(null); fail(); }
    }
  }, fail);
  return () => { generation++; unsubscribe(); };
}

export function toSession(user: User): AuthSession {
  const email = normalizeEmail(user.email || '');
  return {
    email, name: user.displayName || email.split('@')[0],
    loginAt: user.metadata.lastSignInTime || new Date().toISOString(), provider: 'google_oauth',
  };
}

export function observeVerifiedAccess(
  user: User,
  update: (records: UserAccessRecord[], status: AccessStatus, admin: boolean) => void,
  fail: () => void,
) {
  const db = getCloudDb();
  if (!db) { fail(); return () => {}; }
  const { email, name } = toSession(user);
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  const abort = () => { if (!cancelled) fail(); };

  if (isPrimaryAdmin(email)) {
    const ref = collection(db, SECURE_ACL);
    // Do not confer access until the server has applied the Admin-only policy.
    getDocsFromServer(query(ref, limit(1))).then(() => {
      if (cancelled) return;
      unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        update(snap.docs.map(record => record.data() as UserAccessRecord), 'AUTHORIZED', true);
      }, abort);
    }).catch(abort);
  } else {
    const ref = doc(db, SECURE_ACL, email);
    const now = new Date().toISOString();
    runTransaction(db, async tx => {
      if (!(await tx.get(ref)).exists()) {
        tx.set(ref, { uid: user.uid, email, name: name.slice(0, 160), role: 'USER', status: 'PENDING',
          requestedAt: now, updatedAt: now });
      }
    }).then(() => {
      if (cancelled) return;
      unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        const record = snap.data();
        if (!record || record.uid !== user.uid || record.role !== 'USER') {
          update([], 'REJECTED', false);
        } else {
          update([], record.status === 'AUTHORIZED' ? 'AUTHORIZED' :
            record.status === 'PENDING' ? 'PENDING' : 'REJECTED', false);
        }
      }, abort);
    }).catch(abort);
  }
  return () => { cancelled = true; unsubscribe?.(); };
}

export async function decideVerifiedAccess(email: string, status: 'AUTHORIZED' | 'REJECTED') {
  const db = getCloudDb();
  if (!db) throw new Error('Archivio autorizzazioni non disponibile.');
  const ref = doc(db, SECURE_ACL, normalizeEmail(email));
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Richiesta non trovata.');
    tx.update(ref, { status, updatedAt: new Date().toISOString() });
  });
}

export async function fetchArchiveMutation(body: unknown): Promise<Response> {
  const user = typeof window !== 'undefined' ? getCloudAuth().currentUser : null;
  if (!user || !isPrimaryAdmin(user.email || '')) return new Response(null, { status: 403 });
  return fetch('/api/draws', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
}
