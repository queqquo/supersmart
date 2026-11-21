import { useEffect, useRef, useState } from 'react';
import { parseCover60Draft, type Cover60Draft } from '../utils/cover60';
import { saveCloudCover60, subscribeCloudCover60 } from '../utils/firebase';

const keyFor = (email: string) => `supersmart_cover60_v1:${email.trim().toLowerCase()}`;

function readCache(email: string) {
  try {
    return parseCover60Draft(JSON.parse(localStorage.getItem(keyFor(email)) ?? 'null'));
  } catch {
    return null;
  }
}

export function useCover60Draft(email: string) {
  const [draft, setDraft] = useState<Cover60Draft | null>(() => readCache(email));
  const [sync, setSync] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const writePending = useRef(false);

  useEffect(() => {
    // Open one listener per generator visit, only after the user opens Cover 60.
    return subscribeCloudCover60(email, (remote, confirmed) => {
      if (confirmed) {
        setDraft(remote);
        try {
          if (remote) localStorage.setItem(keyFor(email), JSON.stringify(remote));
          else localStorage.removeItem(keyFor(email));
        } catch {
          // An unavailable browser cache does not prevent cloud sync.
        }
        setSync('ready');
      } else {
        setSync('offline');
      }
    }, () => setSync('error'));
  }, [email]);

  async function save(next: Cover60Draft) {
    if (sync !== 'ready' || writePending.current) return;
    writePending.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await saveCloudCover60(email, next);
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
