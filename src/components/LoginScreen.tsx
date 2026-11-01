/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Clock,
  Lock,
  Send,
  LogOut,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import {
  AuthSession,
  UserAccessRecord,
  evaluateUserAccess,
  isValidGmailAddress,
  normalizeEmail,
  isPrimaryAdmin
} from '../utils/auth';

interface LoginScreenProps {
  session: AuthSession | null;
  acl: UserAccessRecord[];
  onLogin: (session: AuthSession) => void;
  onLogout: () => void;
  onRequestAccess: (user: { email: string; name: string; note: string }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  session,
  acl,
  onLogin,
  onLogout,
  onRequestAccess
}) => {
  const [showGoogleChooser, setShowGoogleChooser] = useState(false);
  const [customEmail, setCustomEmail] = useState('');
  const [customName, setCustomName] = useState('');
  const [authError, setAuthError] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [noteUpdatedSuccess, setNoteUpdatedSuccess] = useState(false);

  const accessEval = session
    ? evaluateUserAccess(session.email, acl)
    : { isAuthorized: false, isAdmin: false, status: 'UNREGISTERED' as const, record: null };

  // Complete sign-in with Google email
  const handleSelectGoogleAccount = (email: string, name: string) => {
    setAuthError('');
    const norm = normalizeEmail(email);
    if (!isValidGmailAddress(norm)) {
      setAuthError('Inserisci un indirizzo email Google / Gmail valido (es. nome@gmail.com).');
      return;
    }

    const resolvedName =
      name.trim() ||
      (isPrimaryAdmin(norm)
        ? 'Giuseppe Vitiello'
        : norm
            .split('@')[0]
            .replace(/[._]/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase()));

    const newSession: AuthSession = {
      email: norm,
      name: resolvedName,
      loginAt: new Date().toISOString(),
      provider: 'google_oauth'
    };

    // If non-admin and not yet registered in ACL, automatically send an access request for approval as USER
    if (!isPrimaryAdmin(norm)) {
      const currentEval = evaluateUserAccess(norm, acl);
      if (currentEval.status === 'UNREGISTERED') {
        onRequestAccess({
          email: norm,
          name: resolvedName,
          note: 'Richiesta di approvazione accesso come Utente tramite Google Login'
        });
      }
    }

    setShowGoogleChooser(false);
    setCustomEmail('');
    setCustomName('');
    onLogin(newSession);
  };

  const handleGoogleOAuthButtonClick = () => {
    setAuthError('');
    setShowGoogleChooser(true);
  };

  const handleSendOrUpdateAccessRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    onRequestAccess({
      email: session.email,
      name: session.name,
      note:
        requestNote.trim() ||
        'Richiesta di approvazione accesso come Utente tramite Google Login'
    });
    setNoteUpdatedSuccess(true);
    setTimeout(() => setNoteUpdatedSuccess(false), 3500);
  };

  // Non-admin accounts in ACL (never expose the primary admin email on the login screen)
  const otherAccountsInACL = acl.filter((r) => !isPrimaryAdmin(r.email));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 relative overflow-hidden">
      {/* Background decorative glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header bar */}
      <div className="max-w-5xl w-full mx-auto pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950 font-black text-xl">
            ★
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base text-white tracking-tight">
                SuperEnalotto Combinatorial Optimizer
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold uppercase">
                Zero-Cost OAuth
              </span>
            </div>
            <span className="text-xs text-slate-400 block">
              Controllo Accessi tramite Google Gmail &bull; Autorizzazione Amministratore
            </span>
          </div>
        </div>
      </div>

      {/* Center Card */}
      <div className="max-w-md w-full mx-auto my-8 z-10">
        {!session ? (
          /* STATE 1: NOT LOGGED IN — ONLY "Accedi con Google (Gmail)" */
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-6 backdrop-blur-md">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-3 shadow-inner">
                <Lock className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                Accesso Riservato
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                L'accesso al motore combinatorio avviene esclusivamente tramite autenticazione{' '}
                <strong>Google (Gmail)</strong>. L'Amministratore accede con pieni poteri di gestione;
                gli altri utenti inviano una richiesta di approvazione e, una volta autorizzati,
                accedono con profilo <strong>Utente</strong>.
              </p>
            </div>

            {/* Single Official Google Sign-In Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleGoogleOAuthButtonClick}
                className="w-full py-3.5 px-5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-3 cursor-pointer active:scale-[0.99] border border-slate-200"
              >
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>Accedi con Google (Gmail)</span>
              </button>
            </div>

            {/* Info Box */}
            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/80 space-y-1.5 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Verifica Identità &amp; Ruoli (Admin / Utente)</span>
              </div>
              <p>
                Autenticandoti con il tuo account Gmail: se sei l'Amministratore accedi direttamente al
                pannello completo; se sei un nuovo utente viene inviata automaticamente una richiesta di
                approvazione all'Amministratore per abilitare l'ingresso come Utente.
              </p>
            </div>
          </div>
        ) : (
          /* STATE 2: LOGGED IN AS NON-ADMIN USER NOT YET AUTHORIZED */
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-6 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-amber-400 text-sm">
                  {session.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{session.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold uppercase">
                      Richiedente Utente
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400">{session.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Esci</span>
              </button>
            </div>

            {accessEval.status === 'REJECTED' ? (
              <div className="space-y-4 text-center py-2">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
                  <ShieldAlert className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    Accesso Non Autorizzato / Revocato
                  </span>
                  <h2 className="text-xl font-extrabold text-white">
                    Autorizzazione Negata o Revocata
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    L'amministratore ha revocato o rifiutato l'autorizzazione di accesso come Utente per{' '}
                    <strong className="text-slate-200 font-mono">{session.email}</strong>.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onRequestAccess({
                      email: session.email,
                      name: session.name,
                      note: 'Nuova richiesta di approvazione accesso come Utente'
                    });
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer"
                >
                  Invia Nuova Richiesta di Approvazione Utente
                </button>
              </div>
            ) : (
              /* PENDING (OR UNREGISTERED FALLBACK) -> SHOW REQUEST SENT + OPTIONAL NOTE */
              <div className="space-y-4 py-1">
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                    <Clock className="w-7 h-7 animate-pulse" />
                  </div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    In Attesa di Approvazione
                  </span>
                  <h2 className="text-xl font-extrabold text-white">
                    Richiesta Inviata all'Amministratore
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Il tuo account <strong className="text-slate-200 font-mono">{session.email}</strong> non
                    corrisponde all'Amministratore: è stata inviata una richiesta per approvare il tuo
                    accesso con profilo <strong className="text-emerald-300">Utente</strong>.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-left text-xs space-y-1.5 text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>Stato richiesta:</span>
                    <strong className="text-amber-400 font-mono">IN ATTESA DI APPROVAZIONE</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Ruolo richiesto:</span>
                    <strong className="text-emerald-400 font-mono">UTENTE (Non Amministratore)</strong>
                  </div>
                  {accessEval.record?.note && (
                    <div className="pt-1 border-t border-slate-800/80">
                      Nota inviata:{' '}
                      <span className="text-slate-300 italic">"{accessEval.record.note}"</span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSendOrUpdateAccessRequest} className="space-y-2.5 pt-1">
                  <label htmlFor="request-note" className="block text-xs font-semibold text-slate-300">
                    Aggiungi o aggiorna una nota per l'Amministratore (opzionale):
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="request-note"
                      type="text"
                      value={requestNote}
                      onChange={(e) => setRequestNote(e.target.value)}
                      placeholder="Es. Richiedo abilitazione come utente..."
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Invia Nota</span>
                    </button>
                  </div>
                  {noteUpdatedSuccess && (
                    <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Richiesta aggiornata ed inviata all'amministratore.</span>
                    </div>
                  )}
                </form>

                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all cursor-pointer"
                >
                  Cambia Account Google (Gmail)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Google OAuth Account Sign-In Modal */}
      {showGoogleChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden">
            {/* Google-styled header */}
            <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span className="text-sm font-bold text-white">Accedi con Google (Gmail)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGoogleChooser(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Chiudi
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Enter Google / Gmail Account Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSelectGoogleAccount(customEmail, customName);
                }}
                className="space-y-3"
              >
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-200 block">
                    Inserisci il tuo indirizzo email Google (Gmail)
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    Il sistema verificherà automaticamente se l'account appartiene all'Amministratore o
                    a un Utente.
                  </span>
                </div>

                {authError && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{authError}</span>
                  </div>
                )}

                <div className="space-y-2.5 pt-1">
                  <div>
                    <label
                      htmlFor="google-email-input"
                      className="block text-[11px] font-semibold text-slate-300 mb-1"
                    >
                      Email Google / Gmail *
                    </label>
                    <input
                      id="google-email-input"
                      type="email"
                      required
                      autoFocus
                      value={customEmail}
                      onChange={(e) => setCustomEmail(e.target.value)}
                      placeholder="nome.cognome@gmail.com"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="google-name-input"
                      className="block text-[11px] font-semibold text-slate-300 mb-1"
                    >
                      Nome e Cognome (opzionale)
                    </label>
                    <input
                      id="google-name-input"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Es. Mario Rossi"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
                  >
                    Continua con Google
                  </button>
                </div>
              </form>

              {/* Other non-admin accounts already registered in ACL if any */}
              {otherAccountsInACL.length > 0 && (
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Account Utente Recenti
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {otherAccountsInACL.map((acc) => (
                      <button
                        key={acc.email}
                        type="button"
                        onClick={() => handleSelectGoogleAccount(acc.email, acc.name)}
                        className="w-full p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 transition-all flex items-center justify-between text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center">
                            {acc.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-200">{acc.name}</div>
                            <div className="text-[11px] font-mono text-slate-400">{acc.email}</div>
                          </div>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            acc.status === 'AUTHORIZED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : acc.status === 'PENDING'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {acc.status === 'AUTHORIZED'
                            ? 'Utente Approvato'
                            : acc.status === 'PENDING'
                            ? 'In Attesa'
                            : 'Revocato'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="max-w-5xl w-full mx-auto text-center pb-2 text-[11px] text-slate-500">
        SuperEnalotto Combinatorial Optimizer &bull; Zero-Cost Edition &bull; Protezione OAuth attiva
      </div>
    </div>
  );
};
