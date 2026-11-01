/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.PORT) || 3000;
const PRIMARY_ADMIN_EMAIL = 'giuseppe.vitiello@gmail.com';

type UserRole = 'ADMIN' | 'USER';
type AccessStatus = 'AUTHORIZED' | 'PENDING' | 'REJECTED';

interface UserAccessRecord {
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ACL_FILE_PATH = path.join(DATA_DIR, 'acl.json');

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function isPrimaryAdmin(email: string): boolean {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL;
}

function isValidGmailAddress(email: string): boolean {
  const norm = normalizeEmail(email);
  if (norm === PRIMARY_ADMIN_EMAIL) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm);
}

function createInitialACL(): UserAccessRecord[] {
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

function ensureAdminInACL(records: UserAccessRecord[]): UserAccessRecord[] {
  const normalizedList: UserAccessRecord[] = records
    .filter((r) => r && typeof r.email === 'string' && normalizeEmail(r.email) !== 'admin@sistema.local')
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

function requestUserAccess(
  acl: UserAccessRecord[],
  user: { email: string; name?: string; picture?: string; note?: string }
): UserAccessRecord[] {
  const norm = normalizeEmail(user.email);
  if (!isValidGmailAddress(norm)) {
    throw new Error('Indirizzo email non valido.');
  }

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
        role: isPrimaryAdmin(norm) ? 'ADMIN' : 'USER',
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

function authorizeUserByAdmin(
  acl: UserAccessRecord[],
  adminEmail: string,
  targetEmail: string,
  options?: { name?: string; role?: UserRole; note?: string }
): UserAccessRecord[] {
  if (!isPrimaryAdmin(adminEmail)) {
    throw new Error("Operazione consentita solo all'amministratore.");
  }

  const normTarget = normalizeEmail(targetEmail);
  if (!isValidGmailAddress(normTarget)) {
    throw new Error('Inserisci un indirizzo email valido.');
  }

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
      note: options?.note || "Autorizzato manualmente dall'amministratore"
    });
  }

  return updated;
}

function revokeUserByAdmin(
  acl: UserAccessRecord[],
  adminEmail: string,
  targetEmail: string
): UserAccessRecord[] {
  if (!isPrimaryAdmin(adminEmail)) {
    throw new Error("Operazione consentita solo all'amministratore.");
  }

  const normTarget = normalizeEmail(targetEmail);
  if (isPrimaryAdmin(normTarget)) {
    throw new Error("Non è possibile revocare l'accesso all'amministratore principale.");
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

function removeUserRecordByAdmin(
  acl: UserAccessRecord[],
  adminEmail: string,
  targetEmail: string
): UserAccessRecord[] {
  if (!isPrimaryAdmin(adminEmail)) {
    throw new Error("Operazione consentita solo all'amministratore.");
  }

  const normTarget = normalizeEmail(targetEmail);
  if (isPrimaryAdmin(normTarget)) {
    throw new Error("Non è possibile rimuovere l'amministratore principale.");
  }

  return ensureAdminInACL(acl).filter((r) => normalizeEmail(r.email) !== normTarget);
}

// Persistent server ACL and Plays state (with in-memory fallback if filesystem is read-only)
const PLAYS_FILE_PATH = path.join(DATA_DIR, 'plays.json');
let memoryACL: UserAccessRecord[] = createInitialACL();
let memoryPlays: Record<string, unknown>[] = [];

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch {
    // Ignore if read-only container filesystem
  }
}

function readServerACL(): UserAccessRecord[] {
  ensureDataDir();
  try {
    if (fs.existsSync(ACL_FILE_PATH)) {
      const raw = fs.readFileSync(ACL_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryACL = ensureAdminInACL(parsed);
        return memoryACL;
      }
    }
  } catch (err) {
    console.warn('Using in-memory ACL fallback:', err);
  }
  memoryACL = ensureAdminInACL(memoryACL);
  writeServerACL(memoryACL);
  return memoryACL;
}

function writeServerACL(acl: UserAccessRecord[]): UserAccessRecord[] {
  const normalized = ensureAdminInACL(acl);
  memoryACL = normalized;
  ensureDataDir();
  try {
    fs.writeFileSync(ACL_FILE_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  } catch {
    // Keep in memoryACL if filesystem is read-only
  }
  return normalized;
}

function readServerPlays(): Record<string, unknown>[] {
  ensureDataDir();
  try {
    if (fs.existsSync(PLAYS_FILE_PATH)) {
      const raw = fs.readFileSync(PLAYS_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryPlays = parsed;
        return memoryPlays;
      }
    }
  } catch (err) {
    console.warn('Using in-memory Plays fallback:', err);
  }
  return memoryPlays;
}

function writeServerPlays(plays: Record<string, unknown>[]): Record<string, unknown>[] {
  memoryPlays = Array.isArray(plays) ? plays : [];
  ensureDataDir();
  try {
    fs.writeFileSync(PLAYS_FILE_PATH, JSON.stringify(memoryPlays, null, 2), 'utf8');
  } catch {
    // Keep in memoryPlays if filesystem is read-only
  }
  return memoryPlays;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  readServerACL();
  readServerPlays();

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // --- Shared Zero-Cost Plays History Endpoints ---
  app.get('/api/plays', (_req, res) => {
    const plays = readServerPlays();
    res.json({ plays });
  });

  app.post('/api/plays', (req, res) => {
    const play = req.body?.play;
    if (!play || typeof play.id !== 'string') {
      res.status(400).json({ error: 'Giocata non valida.' });
      return;
    }
    const current = [...readServerPlays()];
    const idx = current.findIndex((p) => p.id === play.id);
    if (idx >= 0) {
      current[idx] = play;
    } else {
      current.unshift(play);
    }
    const saved = writeServerPlays(current);
    res.json({ plays: saved });
  });

  app.put('/api/plays', (req, res) => {
    const incoming = req.body?.plays;
    if (!Array.isArray(incoming)) {
      res.status(400).json({ error: 'Lista giocate non valida.' });
      return;
    }
    const current = readServerPlays();
    const mergedMap = new Map<string, Record<string, unknown>>();
    for (const p of current) {
      if (p && typeof p.id === 'string') mergedMap.set(p.id, p);
    }
    for (const p of incoming) {
      if (p && typeof p.id === 'string') mergedMap.set(p.id, p);
    }
    const merged = Array.from(mergedMap.values()).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
    const saved = writeServerPlays(merged);
    res.json({ plays: saved });
  });

  app.delete('/api/plays/:id', (req, res) => {
    const targetId = req.params.id;
    const current = readServerPlays();
    const filtered = current.filter((p) => p.id !== targetId);
    const saved = writeServerPlays(filtered);
    res.json({ plays: saved });
  });

  app.get('/api/acl', (_req, res) => {
    const acl = readServerACL();
    res.json({ acl });
  });

  app.put('/api/acl/sync', (req, res) => {
    try {
      const incoming: UserAccessRecord[] = Array.isArray(req.body?.acl) ? req.body.acl : [];
      const current = readServerACL();
      const mergedMap = new Map<string, UserAccessRecord>();
      for (const rec of current) {
        if (rec && typeof rec.email === 'string') {
          mergedMap.set(normalizeEmail(rec.email), rec);
        }
      }
      for (const rec of incoming) {
        if (rec && typeof rec.email === 'string' && isValidGmailAddress(rec.email)) {
          const norm = normalizeEmail(rec.email);
          const existing = mergedMap.get(norm);
          if (!existing) {
            mergedMap.set(norm, {
              ...rec,
              email: norm,
              role: isPrimaryAdmin(norm) ? 'ADMIN' : 'USER'
            });
          } else {
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
      const saved = writeServerACL(Array.from(mergedMap.values()));
      res.json({ acl: saved });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore sincronizzazione ACL.'
      });
    }
  });

  app.post('/api/acl/request', (req, res) => {
    try {
      const { email, name, picture, note } = req.body || {};
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email obbligatoria.' });
        return;
      }
      const current = readServerACL();
      const updated = requestUserAccess(current, { email, name, picture, note });
      const saved = writeServerACL(updated);
      res.json({ acl: saved });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore durante la registrazione della richiesta.'
      });
    }
  });

  app.post('/api/acl/authorize', (req, res) => {
    try {
      const { adminEmail, targetEmail, options } = req.body || {};
      const current = readServerACL();
      const updated = authorizeUserByAdmin(current, adminEmail, targetEmail, options);
      const saved = writeServerACL(updated);
      res.json({ acl: saved });
    } catch (err) {
      res.status(403).json({
        error: err instanceof Error ? err.message : "Errore durante l'autorizzazione."
      });
    }
  });

  app.post('/api/acl/revoke', (req, res) => {
    try {
      const { adminEmail, targetEmail } = req.body || {};
      const current = readServerACL();
      const updated = revokeUserByAdmin(current, adminEmail, targetEmail);
      const saved = writeServerACL(updated);
      res.json({ acl: saved });
    } catch (err) {
      res.status(403).json({
        error: err instanceof Error ? err.message : 'Errore durante la revoca.'
      });
    }
  });

  app.post('/api/acl/remove', (req, res) => {
    try {
      const { adminEmail, targetEmail } = req.body || {};
      const current = readServerACL();
      const updated = removeUserRecordByAdmin(current, adminEmail, targetEmail);
      const saved = writeServerACL(updated);
      res.json({ acl: saved });
    } catch (err) {
      res.status(403).json({
        error: err instanceof Error ? err.message : 'Errore durante la rimozione.'
      });
    }
  });

  app.get('/api/draws/official-sync', async (_req, res) => {
    try {
      const feedUrl =
        'https://raw.githubusercontent.com/delpinsky/Superenalotto/main/storico-estrazioni-superenalotto.json';
      const response = await fetch(feedUrl, {
        headers: { 'User-Agent': 'SuperEnalotto-Optimizer/1.0' }
      });
      if (!response.ok) {
        res.status(502).json({ error: `Feed status ${response.status}` });
        return;
      }
      const data = await response.json();
      const rawDraws = Array.isArray(data?.draws)
        ? data.draws.filter((d: { date?: string }) => d.date && d.date >= '2009-01-01')
        : [];

      rawDraws.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
      const byYear: Record<number, number> = {};
      const draws = rawDraws.map(
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
          const sortedNums = [...d.nums].map(Number).sort((a, b) => a - b);
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

      draws.sort((a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date));
      res.json({
        exportedAt: data.exported || new Date().toISOString(),
        count: draws.length,
        draws
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Impossibile sincronizzare il feed ufficiale.'
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SuperEnalotto Optimizer Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
