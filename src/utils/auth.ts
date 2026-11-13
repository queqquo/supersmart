/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const PRIMARY_ADMIN_EMAIL = 'giuseppe.vitiello@gmail.com';

export type UserRole = 'ADMIN' | 'USER';
export type AccessStatus = 'AUTHORIZED' | 'PENDING' | 'REJECTED';

export interface UserAccessRecord {
  email: string;
  name: string;
  picture?: string;
  role: UserRole;
  status: AccessStatus;
  requestedAt: string;
  updatedAt: string;
  authorizedBy?: string;
  note?: string;
  lastLoginAt?: string;
}

export interface AuthSession {
  email: string;
  name: string;
  picture?: string;
  loginAt: string;
  provider: 'google_oauth';
}

const AUTH_STORAGE_KEYS = {
  ACL: 'superenalotto_zero_cost_acl_v3',
  DELETED_ACL_EMAILS: 'superenalotto_deleted_acl_emails_v1',
  SESSION: 'superenalotto_zero_cost_session_v3'
};

function loadDeletedAclEmails(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.DELETED_ACL_EMAILS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Ignore
  }
  return new Set();
}

function markAclEmailDeleted(email: string): void {
  const norm = normalizeEmail(email);
  if (!norm || isPrimaryAdmin(norm)) return;
  try {
    const set = loadDeletedAclEmails();
    set.add(norm);
    localStorage.setItem(AUTH_STORAGE_KEYS.DELETED_ACL_EMAILS, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore
  }
}

function unmarkAclEmailDeleted(email: string): void {
  const norm = normalizeEmail(email);
  if (!norm) return;
  try {
    const set = loadDeletedAclEmails();
    if (set.has(norm)) {
      set.delete(norm);
      localStorage.setItem(AUTH_STORAGE_KEYS.DELETED_ACL_EMAILS, JSON.stringify(Array.from(set)));
    }
  } catch {
    // Ignore
  }
}

/**
 * Normalize an email address
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate that an email is a valid Google / Gmail email address
 */
export function isValidGmailAddress(email: string): boolean {
  const norm = normalizeEmail(email);
  if (norm === PRIMARY_ADMIN_EMAIL) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(norm);
}

/**
 * Check if email belongs to the primary administrator (Giuseppe Vitiello)
 */
export function isPrimaryAdmin(email: string): boolean {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL;
}

/**
 * Create the default initial ACL containing only the primary administrator
 */
export function createInitialACL(): UserAccessRecord[] {
  const now = new Date().toISOString();
  return [
    {
      email: PRIMARY_ADMIN_EMAIL,
      name: 'Giuseppe Vitiello',
      role: 'ADMIN',
      status: 'AUTHORIZED',
      requestedAt: now,
      updatedAt: now,
      authorizedBy: 'SYSTEM_BOOTSTRAP',
      note: 'Amministratore principale'
    }
  ];
}

/**
 * Ensure primary admin is always present, ADMIN, and AUTHORIZED in the ACL list,
 * and ensure all other users strictly have role 'USER'
 */
export function ensureAdminInACL(records: UserAccessRecord[]): UserAccessRecord[] {
  const normalizedList = records
    .filter((r) => normalizeEmail(r.email) !== 'admin@sistema.local')
    .map((r) =>
      isPrimaryAdmin(r.email)
        ? r
        : {
            ...r,
            role: 'USER' as UserRole
          }
    );
  const adminIdx = normalizedList.findIndex(
    (r) => normalizeEmail(r.email) === PRIMARY_ADMIN_EMAIL
  );
  const now = new Date().toISOString();

  if (adminIdx === -1) {
    normalizedList.unshift({
      email: PRIMARY_ADMIN_EMAIL,
      name: 'Giuseppe Vitiello',
      role: 'ADMIN',
      status: 'AUTHORIZED',
      requestedAt: now,
      updatedAt: now,
      authorizedBy: 'SYSTEM_BOOTSTRAP',
      note: 'Amministratore principale'
    });
  } else {
    normalizedList[adminIdx] = {
      ...normalizedList[adminIdx],
      email: PRIMARY_ADMIN_EMAIL,
      name: normalizedList[adminIdx].name || 'Giuseppe Vitiello',
      role: 'ADMIN',
      status: 'AUTHORIZED'
    };
  }

  return normalizedList;
}

/**
 * Check access status for a given email against the ACL.
 * Only PRIMARY_ADMIN_EMAIL is granted isAdmin = true.
 * Any other approved user enters strictly as a standard USER (isAdmin = false).
 */
export function evaluateUserAccess(
  email: string,
  acl: UserAccessRecord[]
): {
  isAuthorized: boolean;
  isAdmin: boolean;
  status: AccessStatus | 'UNREGISTERED';
  record: UserAccessRecord | null;
} {
  const norm = normalizeEmail(email);
  if (!norm) {
    return { isAuthorized: false, isAdmin: false, status: 'UNREGISTERED', record: null };
  }

  if (isPrimaryAdmin(norm)) {
    const adminRec =
      acl.find((r) => normalizeEmail(r.email) === PRIMARY_ADMIN_EMAIL) ||
      createInitialACL()[0];
    return {
      isAuthorized: true,
      isAdmin: true,
      status: 'AUTHORIZED',
      record: adminRec
    };
  }

  const found = acl.find((r) => normalizeEmail(r.email) === norm);
  if (!found) {
    return {
      isAuthorized: false,
      isAdmin: false,
      status: 'UNREGISTERED',
      record: null
    };
  }

  return {
    isAuthorized: found.status === 'AUTHORIZED',
    isAdmin: false,
    status: found.status,
    record: {
      ...found,
      role: 'USER'
    }
  };
}

/**
 * Submit an access request from a non-authorized user
 */
export function requestUserAccess(
  acl: UserAccessRecord[],
  user: { email: string; name?: string; picture?: string; note?: string }
): UserAccessRecord[] {
  const norm = normalizeEmail(user.email);
  if (!isValidGmailAddress(norm)) {
    throw new Error('Indirizzo email non valido.');
  }

  unmarkAclEmailDeleted(norm);
  const now = new Date().toISOString();
  const updated = ensureAdminInACL(acl);
  const existingIdx = updated.findIndex((r) => normalizeEmail(r.email) === norm);

  const displayName =
    user.name?.trim() ||
    norm
      .split('@')[0]
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

  if (existingIdx >= 0) {
    if (updated[existingIdx].status !== 'AUTHORIZED') {
      updated[existingIdx] = {
        ...updated[existingIdx],
        name: displayName,
        picture: user.picture || updated[existingIdx].picture,
        status: 'PENDING',
        updatedAt: now,
        note: user.note?.trim() || updated[existingIdx].note
      };
    }
  } else {
    updated.push({
      email: norm,
      name: displayName,
      picture: user.picture,
      role: 'USER',
      status: 'PENDING',
      requestedAt: now,
      updatedAt: now,
      note: user.note?.trim() || 'Richiesta di accesso tramite Google OAuth'
    });
  }

  return updated;
}

/**
 * Admin action: Authorize a user by email (either approving a pending request or pre-authorizing a new email)
 */
export function authorizeUserByAdmin(
  acl: UserAccessRecord[],
  adminEmail: string,
  targetEmail: string,
  options?: { name?: string; role?: UserRole; note?: string }
): UserAccessRecord[] {
  const normAdmin = normalizeEmail(adminEmail);
  const adminEval = evaluateUserAccess(normAdmin, acl);
  if (!adminEval.isAdmin) {
    throw new Error('Operazione consentita solo all\'amministratore.');
  }

  const normTarget = normalizeEmail(targetEmail);
  if (!isValidGmailAddress(normTarget)) {
    throw new Error('Inserisci un indirizzo email valido.');
  }

  unmarkAclEmailDeleted(normTarget);
  const now = new Date().toISOString();
  const updated = ensureAdminInACL(acl);
  const idx = updated.findIndex((r) => normalizeEmail(r.email) === normTarget);

  const defaultName =
    options?.name?.trim() ||
    normTarget
      .split('@')[0]
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

  if (idx >= 0) {
    updated[idx] = {
      ...updated[idx],
      name: options?.name?.trim() || updated[idx].name || defaultName,
      role: isPrimaryAdmin(normTarget) ? 'ADMIN' : 'USER',
      status: 'AUTHORIZED',
      updatedAt: now,
      authorizedBy: 'Amministratore',
      note: options?.note !== undefined ? options.note : updated[idx].note
    };
  } else {
    updated.push({
      email: normTarget,
      name: defaultName,
      role: isPrimaryAdmin(normTarget) ? 'ADMIN' : 'USER',
      status: 'AUTHORIZED',
      requestedAt: now,
      updatedAt: now,
      authorizedBy: 'Amministratore',
      note: options?.note || 'Autorizzato manualmente dall\'amministratore'
    });
  }

  return updated;
}

/**
 * Admin action: Revoke or Reject a user's access
 */
export function revokeUserByAdmin(
  acl: UserAccessRecord[],
  adminEmail: string,
  targetEmail: string
): UserAccessRecord[] {
  const normAdmin = normalizeEmail(adminEmail);
  const adminEval = evaluateUserAccess(normAdmin, acl);
  if (!adminEval.isAdmin) {
    throw new Error('Operazione consentita solo all\'amministratore.');
  }

  const normTarget = normalizeEmail(targetEmail);
  if (isPrimaryAdmin(normTarget)) {
    throw new Error('Non è possibile revocare l\'accesso all\'amministratore principale.');
  }

  const now = new Date().toISOString();
  const updated = ensureAdminInACL(acl);
  const idx = updated.findIndex((r) => normalizeEmail(r.email) === normTarget);

  if (idx >= 0) {
    updated[idx] = {
      ...updated[idx],
      status: 'REJECTED',
      updatedAt: now,
      authorizedBy: 'Amministratore'
    };
  }

  return updated;
}

/**
 * Admin action: Remove a user record completely from the ACL
 */
export function removeUserRecordByAdmin(
  acl: UserAccessRecord[],
  adminEmail: string,
  targetEmail: string
): UserAccessRecord[] {
  const normAdmin = normalizeEmail(adminEmail);
  const adminEval = evaluateUserAccess(normAdmin, acl);
  if (!adminEval.isAdmin) {
    throw new Error('Operazione consentita solo all\'amministratore.');
  }

  const normTarget = normalizeEmail(targetEmail);
  if (isPrimaryAdmin(normTarget)) {
    throw new Error('Non è possibile rimuovere l\'amministratore principale.');
  }

  markAclEmailDeleted(normTarget);
  return ensureAdminInACL(acl).filter((r) => normalizeEmail(r.email) !== normTarget);
}

// --- IndexedDB Helper for Zero-Cost ACL Persistence ---
const ACL_IDB_NAME = 'superenalotto_zero_cost_acl_idb';
const ACL_IDB_STORE = 'acl_store';

function openACLIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(ACL_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ACL_IDB_STORE)) {
          db.createObjectStore(ACL_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveACLToIDB(acl: UserAccessRecord[]): Promise<void> {
  const db = await openACLIDB();
  if (!db) return;
  try {
    const tx = db.transaction(ACL_IDB_STORE, 'readwrite');
    tx.objectStore(ACL_IDB_STORE).put(ensureAdminInACL(acl), 'acl_records');
  } catch {
    // Ignore IDB errors
  }
}

async function loadACLFromIDB(): Promise<UserAccessRecord[]> {
  const db = await openACLIDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ACL_IDB_STORE, 'readonly');
      const req = tx.objectStore(ACL_IDB_STORE).get('acl_records');
      req.onsuccess = () => {
        resolve(Array.isArray(req.result) ? ensureAdminInACL(req.result) : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Merge multiple ACL arrays by email, keeping the most recent updatedAt status
 * and protecting AUTHORIZED users from accidental downgrade to PENDING on a new browser.
 */
export function mergeACLRecords(
  ...aclLists: (UserAccessRecord[] | null | undefined)[]
): UserAccessRecord[] {
  const mergedMap = new Map<string, UserAccessRecord>();
  for (const list of aclLists) {
    if (!Array.isArray(list)) continue;
    for (const rec of list) {
      if (!rec || typeof rec.email !== 'string') continue;
      const norm = normalizeEmail(rec.email);
      if (!norm || norm === 'admin@sistema.local') continue;
      const existing = mergedMap.get(norm);
      if (!existing) {
        mergedMap.set(norm, {
          ...rec,
          email: norm,
          role: isPrimaryAdmin(norm) ? 'ADMIN' : 'USER'
        });
      } else {
        // Protect an already AUTHORIZED record from being downgraded to PENDING by a new browser login
        if (existing.status === 'AUTHORIZED' && rec.status === 'PENDING') {
          continue;
        }
        if (rec.status === 'AUTHORIZED' && existing.status === 'PENDING') {
          mergedMap.set(norm, {
            ...existing,
            ...rec,
            email: norm,
            role: isPrimaryAdmin(norm) ? 'ADMIN' : 'USER'
          });
          continue;
        }
        const existingTime = new Date(existing.updatedAt || existing.requestedAt || 0).getTime();
        const incomingTime = new Date(rec.updatedAt || rec.requestedAt || 0).getTime();
        if (incomingTime >= existingTime) {
          mergedMap.set(norm, {
            ...existing,
            ...rec,
            email: norm,
            role: isPrimaryAdmin(norm) ? 'ADMIN' : 'USER'
          });
        }
      }
    }
  }
  return ensureAdminInACL(Array.from(mergedMap.values()));
}

/**
 * Storage helpers (LocalStorage + IndexedDB Zero-Cost persistence)
 */
export function loadACL(): UserAccessRecord[] {
  try {
    localStorage.removeItem('superenalotto_zero_cost_acl_v1');
    localStorage.removeItem('superenalotto_zero_cost_acl_v2');
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.ACL);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return ensureAdminInACL(parsed);
      }
    }
  } catch (e) {
    console.warn('Error loading ACL from localStorage:', e);
  }
  const initial = createInitialACL();
  saveACL(initial);
  return initial;
}

export function saveACL(acl: UserAccessRecord[]): void {
  const safe = ensureAdminInACL(acl);
  try {
    localStorage.setItem(AUTH_STORAGE_KEYS.ACL, JSON.stringify(safe));
  } catch (e) {
    console.error('Error saving ACL to localStorage:', e);
  }
  saveACLToIDB(safe);
}

export function loadAuthSession(): AuthSession | null {
  try {
    localStorage.removeItem('superenalotto_zero_cost_session_v1');
    localStorage.removeItem('superenalotto_zero_cost_session_v2');
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.SESSION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.email === 'string' &&
        normalizeEmail(parsed.email) !== 'admin@sistema.local'
      ) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error loading auth session:', e);
  }
  return null;
}

export function saveAuthSession(session: AuthSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(AUTH_STORAGE_KEYS.SESSION);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEYS.SESSION, JSON.stringify(session));
    }
  } catch (e) {
    console.error('Error saving auth session:', e);
  }
}

/**
 * Shared Cloud Firestore + Server + IndexedDB + LocalStorage ACL Synchronization
 * (Preserves authorized users and pending requests across browsers, devices, and container restarts)
 */
export async function fetchServerACL(): Promise<UserAccessRecord[] | null> {
  const deletedEmails = loadDeletedAclEmails();
  const localAcl = loadACL().filter(
    (r) => isPrimaryAdmin(r.email) || !deletedEmails.has(normalizeEmail(r.email))
  );
  const idbAcl = (await loadACLFromIDB()).filter(
    (r) => isPrimaryAdmin(r.email) || !deletedEmails.has(normalizeEmail(r.email))
  );

  let cloudAcl: UserAccessRecord[] = [];
  let serverAcl: UserAccessRecord[] = [];

  try {
    const { fetchCloudACL } = await import('./firebase');
    const fetchedCloud = await fetchCloudACL();
    if (Array.isArray(fetchedCloud)) {
      cloudAcl = fetchedCloud.filter(
        (r) => isPrimaryAdmin(r.email) || !deletedEmails.has(normalizeEmail(r.email))
      );
    }
  } catch {
    // Ignore if in non-browser environment
  }

  try {
    const res = await fetch('/api/acl');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.acl)) {
        serverAcl = ensureAdminInACL(data.acl).filter(
          (r) => isPrimaryAdmin(r.email) || !deletedEmails.has(normalizeEmail(r.email))
        );
      }
    }
  } catch {
    // Offline fallback
  }

  const merged = mergeACLRecords(serverAcl, idbAcl, localAcl, cloudAcl);
  saveACL(merged);

  // Sync missing/updated records back to Cloud Firestore
  try {
    const { upsertManyCloudACLRecords } = await import('./firebase');
    const cloudMap = new Map(cloudAcl.map((r) => [normalizeEmail(r.email), r]));
    const toUpload = merged.filter((r) => {
      const inCloud = cloudMap.get(normalizeEmail(r.email));
      if (!inCloud) return true;
      if (inCloud.status !== r.status || inCloud.name !== r.name) return true;
      return false;
    });
    if (toUpload.length > 0) {
      await upsertManyCloudACLRecords(toUpload);
    }
  } catch {
    // Ignore
  }

  // If merged has records that the server didn't have (e.g. after container restart), push them to server
  if (merged.length > serverAcl.length) {
    try {
      await fetch('/api/acl/sync', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acl: merged })
      });
    } catch {
      // Ignore if offline
    }
  }

  return merged;
}

export async function apiRequestUserAccess(user: {
  email: string;
  name?: string;
  picture?: string;
  note?: string;
}): Promise<UserAccessRecord[] | null> {
  const norm = normalizeEmail(user.email);
  unmarkAclEmailDeleted(norm);

  // First check Cloud Firestore so an already-authorized user on a new browser is not overwritten with PENDING
  const latestAcl = (await fetchServerACL()) || loadACL();
  const updatedLocal = requestUserAccess(latestAcl, user);
  saveACL(updatedLocal);

  const targetRec = updatedLocal.find((r) => normalizeEmail(r.email) === norm);
  if (targetRec) {
    import('./firebase')
      .then(({ upsertCloudACLRecord }) => upsertCloudACLRecord(targetRec))
      .catch(() => {});
  }

  try {
    const res = await fetch('/api/acl/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.acl)) {
        const merged = mergeACLRecords(updatedLocal, data.acl);
        saveACL(merged);
        return merged;
      }
    }
  } catch {
    // Fallback to local/cloud
  }
  return updatedLocal;
}

export async function apiAuthorizeUserByAdmin(
  adminEmail: string,
  targetEmail: string,
  options?: { name?: string; role?: UserRole; note?: string }
): Promise<UserAccessRecord[] | null> {
  const normTarget = normalizeEmail(targetEmail);
  unmarkAclEmailDeleted(normTarget);

  const updatedLocal = authorizeUserByAdmin(loadACL(), adminEmail, targetEmail, options);
  saveACL(updatedLocal);

  const targetRec = updatedLocal.find((r) => normalizeEmail(r.email) === normTarget);
  if (targetRec) {
    import('./firebase')
      .then(({ upsertCloudACLRecord }) => upsertCloudACLRecord(targetRec))
      .catch(() => {});
  }

  try {
    const res = await fetch('/api/acl/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail, targetEmail, options })
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.acl)) {
        const merged = mergeACLRecords(updatedLocal, data.acl);
        saveACL(merged);
        return merged;
      }
    }
  } catch {
    // Fallback to local/cloud
  }
  return updatedLocal;
}

export async function apiRevokeUserByAdmin(
  adminEmail: string,
  targetEmail: string
): Promise<UserAccessRecord[] | null> {
  const normTarget = normalizeEmail(targetEmail);
  const updatedLocal = revokeUserByAdmin(loadACL(), adminEmail, targetEmail);
  saveACL(updatedLocal);

  const targetRec = updatedLocal.find((r) => normalizeEmail(r.email) === normTarget);
  if (targetRec) {
    import('./firebase')
      .then(({ upsertCloudACLRecord }) => upsertCloudACLRecord(targetRec))
      .catch(() => {});
  }

  try {
    const res = await fetch('/api/acl/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail, targetEmail })
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.acl)) {
        const merged = mergeACLRecords(updatedLocal, data.acl);
        saveACL(merged);
        return merged;
      }
    }
  } catch {
    // Fallback to local/cloud
  }
  return updatedLocal;
}

export async function apiRemoveUserRecordByAdmin(
  adminEmail: string,
  targetEmail: string
): Promise<UserAccessRecord[] | null> {
  const normTarget = normalizeEmail(targetEmail);
  markAclEmailDeleted(normTarget);
  const filteredLocal = loadACL().filter((r) => normalizeEmail(r.email) !== normTarget);
  saveACL(filteredLocal);

  import('./firebase')
    .then(({ removeCloudACLRecord }) => removeCloudACLRecord(normTarget))
    .catch(() => {});

  try {
    const res = await fetch('/api/acl/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail, targetEmail })
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.acl)) {
        const safe = ensureAdminInACL(data.acl).filter(
          (r) => normalizeEmail(r.email) !== normTarget
        );
        saveACL(safe);
        return safe;
      }
    }
  } catch {
    // Fallback to local
  }
  return filteredLocal;
}



