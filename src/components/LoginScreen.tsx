import React, { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { AccessStatus, AuthSession } from '../utils/auth';
import { startGoogleLogin } from '../utils/secureAuth';

export function LoginScreen({ session, status, loading, error, onLogout }: {
  session: AuthSession | null;
  status: AccessStatus;
  loading: boolean;
  error: string;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const login = async () => {
    setLoginError('');
    setBusy(true);
    try {
      await startGoogleLogin();
    } catch {
      setLoginError('Accesso Google non completato. Consenti il popup e riprova.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-7">
        <LockKeyhole aria-hidden="true" className="text-amber-400" />
        <p className="text-sm font-semibold text-amber-300">SuperEnalotto Combinatorial Optimizer</p>
        <h1 className="text-2xl font-bold">Accesso riservato</h1>
        <p className="text-sm text-slate-300">
          L’identità viene verificata tramite Google. Se accedi con un nuovo account Gmail,
          un amministratore deve approvare la tua richiesta prima che tu possa usare l’app.
        </p>
        {loading && <p role="status">Verifica dell’accesso in corso…</p>}
        {!loading && session && !error && (
          <p role="status" className="text-sm">
            {status === 'PENDING' ? 'Richiesta ricevuta. Il tuo account è in attesa di approvazione.'
              : 'Questo account non è autorizzato. Contatta l’amministratore.'}
          </p>
        )}
        {(error || loginError) && <p role="alert" className="text-sm text-rose-300">{error || loginError}</p>}
        {!session && !loading && (
          <button type="button" onClick={() => void login()} disabled={busy}
            className="rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-amber-400">
            {busy ? 'Connessione a Google…' : 'Accedi con Google'}
          </button>
        )}
        {session && <button type="button" onClick={onLogout} className="font-semibold underline">Esci</button>}
      </div>
    </main>
  );
}
