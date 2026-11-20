import { useState } from 'react';
import type { UserAccessRecord } from '../utils/auth';

export function AdminAccessPanel({ acl, onDecision }: {
  acl: UserAccessRecord[];
  onDecision: (email: string, status: 'AUTHORIZED' | 'REJECTED') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const decide = async (email: string, status: 'AUTHORIZED' | 'REJECTED') => {
    setBusy(true);
    setMessage('');
    try {
      await onDecision(email, status);
      setMessage(status === 'AUTHORIZED' ? 'Accesso approvato.' : 'Accesso negato o revocato.');
    } catch {
      setMessage('Modifica non salvata. Riprova.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-xl font-bold text-white">Gestione accessi Google</h2>
      <p className="text-sm text-slate-300">
        Per comparire qui, un utente deve prima accedere con il proprio account Gmail.
        Approva solo gli account attesi. La revoca blocca anche una sessione già aperta.
      </p>
      <p role="status" className="text-sm">{message}</p>
      {([
        ['PENDING', 'Richieste in attesa'],
        ['AUTHORIZED', 'Utenti autorizzati'],
        ['REJECTED', 'Utenti respinti o revocati'],
      ] as const).map(([status, label]) => (
        <section key={status} className="space-y-2">
          <h3 className="font-semibold text-amber-300">{label}</h3>
          {acl.filter(user => user.status === status).map(user => (
            <div key={user.email} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 p-3">
              <div className="min-w-0 flex-1 break-all">
                <p className="font-semibold">{user.name}</p>
                <p className="text-sm text-slate-400">{user.email}</p>
              </div>
              {status !== 'AUTHORIZED' && <button disabled={busy} className="underline"
                onClick={() => void decide(user.email, 'AUTHORIZED')}>Approva</button>}
              {status !== 'REJECTED' && <button disabled={busy} className="underline"
                onClick={() => void decide(user.email, 'REJECTED')}>{status === 'AUTHORIZED' ? 'Revoca' : 'Respingi'}</button>}
            </div>
          ))}
          {!acl.some(user => user.status === status) && <p className="text-sm text-slate-400">Nessun account.</p>}
        </section>
      ))}
    </section>
  );
}
