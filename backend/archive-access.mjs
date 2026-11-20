import config from '../firebase-applet-config.json' with { type: 'json' };
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const adminApp = getApps().find(app => app.name === 'archive-token-verifier') ??
  initializeApp({ projectId: config.projectId }, 'archive-token-verifier');

/**
 * Cloud Firestore validates the Firebase ID token and applies the Admin-only
 * list rule for this project/database after signature verification with
 * Firebase Admin SDK. No service-account key or caller-supplied email is used.
 */
export async function archiveWriteStatus(authorization, {
  verifyToken = token => getAuth(adminApp).verifyIdToken(token),
  fetchPolicy = fetch,
} = {}) {
  if (typeof authorization !== 'string' || authorization.length > 8192 ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) {
    return 401;
  }
  // An emulator configuration must never be able to weaken the archive API.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return 503;
  let identity;
  try {
    identity = await verifyToken(authorization.slice(7));
  } catch (error) {
    return error?.code === 'auth/internal-error' ? 503 : 401;
  }
  if (identity?.firebase?.sign_in_provider !== 'google.com' || identity.email_verified !== true) {
    return 403;
  }
  const project = encodeURIComponent(config.projectId);
  const database = encodeURIComponent(config.firestoreDatabaseId);
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/acl_verified?pageSize=1`;
  try {
    const outcome = await fetchPolicy(url, {
      headers: { Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    void outcome.body?.cancel().catch(() => {});
    if (outcome.status === 200) return 200;
    if (outcome.status === 401 || outcome.status === 403) return outcome.status;
    return 503;
  } catch {
    return 503;
  }
}
