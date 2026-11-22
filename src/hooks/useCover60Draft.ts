import { useEffect, useRef, useState } from 'react';
import { parseCoverDraft, type Cover60Draft, type CoverKind } from '../utils/cover60';
import { saveCloudCover60, saveCloudCover90, subscribeCloudCover60, subscribeCloudCover90 } from '../utils/firebase';

const cloud = {
  60: { subscribe: subscribeCloudCover60, save: saveCloudCover60 },
  90: { subscribe: subscribeCloudCover90, save: saveCloudCover90 },
} as const;

function readCache(key: string, kind: CoverKind) {
  try {
    return parseCoverDraft(JSON.parse(localStorage.getItem(key) ?? 'null'), kind);
  } catch {
    return null;
  }
}

export function useCover60Draft(email: string) {
  return useCoverDraft(email, 60);
}

export function useCoverDraft(email: string, kind: CoverKind) {
  const cacheKey = `supersmart_cover${kind}_v1:${email.trim().toLowerCase()}`;
  const [draft, setDraft] = useState<Cover60Draft | null>(() => readCache(cacheKey, kind));
  const [sync, setSync] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const writePending = useRef(false);

  useEffect(() => {
    // Open one listener per generator visit, only after the user opens the panel.
    return cloud[kind].subscribe(email, (remote, confirmed) => {
      if (confirmed) {
        setDraft(remote);
        try {
          if (remote) localStorage.setItem(cacheKey, JSON.stringify(remote));
          else localStorage.removeItem(cacheKey);
        } catch {
          // An unavailable browser cache does not prevent cloud sync.
        }
        setSync('ready');
      } else {
        setSync('offline');
      }
    }, () => setSync('error'));
  }, [email, kind, cacheKey]);

  async function save(next: Cover60Draft) {
    if (sync !== 'ready' || writePending.current) return;
    writePending.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await cloud[kind].save(email, next);
      // The confirmed listener snapshot supplies the shared draft.
    } catch {
      setFailed(true);
    } finally {
      writePending.current = false;
      setSaving(false);
    }
  }

  return { draft, sync, saving, failed, save, canGenerate: sync === 'ready' && !saving };
}
