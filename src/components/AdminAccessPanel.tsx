/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  UserPlus,
  UserCheck,
  UserX,
  Clock,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Users,
  Lock,
  Sparkles
} from 'lucide-react';
import {
  UserAccessRecord,
  UserRole,
  isPrimaryAdmin,
  normalizeEmail
} from '../utils/auth';

interface AdminAccessPanelProps {
  adminEmail: string;
  acl: UserAccessRecord[];
  onAuthorizeUser: (
    targetEmail: string,
    options?: { name?: string; role?: UserRole; note?: string }
  ) => void;
  onRevokeUser: (targetEmail: string) => void;
  onRemoveUser: (targetEmail: string) => void;
  onSimulatePendingRequest: (email: string, name: string, note: string) => void;
}

export const AdminAccessPanel: React.FC<AdminAccessPanelProps> = ({
  acl,
  onAuthorizeUser,
  onRevokeUser,
  onRemoveUser,
  onSimulatePendingRequest
}) => {
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('USER');
  const [newNote, setNewNote] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(
    null
  );

  const pendingUsers = acl.filter((u) => u.status === 'PENDING');
  const authorizedUsers = acl.filter((u) => u.status === 'AUTHORIZED');
  const rejectedUsers = acl.filter((u) => u.status === 'REJECTED');

  const showNotice = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleAddAuthorizedUser = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onAuthorizeUser(newEmail, {
        name: newName,
        role: newRole,
        note: newNote || 'Abilitato direttamente dall\'amministratore'
      });
      showNotice('success', `Utente ${normalizeEmail(newEmail)} autorizzato con successo!`);
      setNewEmail('');
      setNewName('');
      setNewRole('USER');
      setNewNote('');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Errore durante l\'autorizzazione');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-amber-950/30 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Pannello Amministratore OAuth
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Ruolo: Amministratore Principale
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-white">
              Gestione Accessi & Autorizzazioni Utenti (Gmail)
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Controlla chi può accedere all'applicazione. Per impostazione predefinita solo l'
              <strong className="text-slate-200">Amministratore</strong> ha accesso; gli altri utenti
              possono entrare solo dopo la tua esplicita approvazione.
            </p>
          </div>

          {/* Summary KPI badges */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Autorizzati</span>
              <span className="text-lg font-extrabold text-emerald-400 font-mono">
                {authorizedUsers.length}
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">In Attesa</span>
              <span className="text-lg font-extrabold text-amber-400 font-mono">
                {pendingUsers.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Add / Pre-Authorize User Form (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <UserPlus className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Autorizza Nuovo Utente Gmail
              </h3>
            </div>

            <form onSubmit={handleAddAuthorizedUser} className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="auth-email-input" className="block text-xs font-semibold text-slate-300">
                  Email Google / Gmail da autorizzare *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-email-input"
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="es. utente@gmail.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="auth-name-input" className="block text-xs font-semibold text-slate-300">
                  Nome o Etichetta Utente
                </label>
                <input
                  id="auth-name-input"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="es. Mario Rossi"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="auth-role-select" className="block text-xs font-semibold text-slate-300">
                    Ruolo Assegnato
                  </label>
                  <select
                    id="auth-role-select"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-emerald-300 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  >
                    <option value="USER">Utente Standard (USER)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="auth-note-input" className="block text-xs font-semibold text-slate-300">
                    Nota (opzionale)
                  </label>
                  <input
                    id="auth-note-input"
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="es. Amico / Collega"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-amber-500 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserCheck className="w-4 h-4" />
                <span>Autorizza Accesso Email</span>
              </button>
            </form>
          </div>

          {/* Quick Simulation Box to test Pending Requests */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Test Flusso Richiesta d'Accesso
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Vuoi verificare come appare una richiesta in entrata di un nuovo utente Gmail prima di approvarla?
            </p>
            <button
              type="button"
              onClick={() => {
                const demoEmail = `utente.ospite${Math.floor(Math.random() * 90 + 10)}@gmail.com`;
                onSimulatePendingRequest(
                  demoEmail,
                  'Utente Ospite',
                  'Richiesta accesso per consultare le sestine settimanali'
                );
                showNotice(
                  'success',
                  `Simulata richiesta in attesa da ${demoEmail}. Ora puoi approvarla o rifiutarla qui a fianco!`
                );
              }}
              className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
            >
              Simula Richiesta in Entrata (Utente Esterno)
            </button>
          </div>
        </div>

        {/* Right Column: Pending Requests & Authorized Users List (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Pending Approval Queue */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Richieste in Attesa di Approvazione ({pendingUsers.length})
                </h3>
              </div>
              {pendingUsers.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Azione Richiesta
                </span>
              )}
            </div>

            {pendingUsers.length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-500">
                Nessuna richiesta di accesso in attesa in questo momento.
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendingUsers.map((u) => (
                  <div
                    key={u.email}
                    className="p-3.5 rounded-xl bg-amber-950/15 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{u.name}</span>
                        <span className="text-xs font-mono text-amber-300">{u.email}</span>
                      </div>
                      {u.note && (
                        <p className="text-xs text-slate-400 italic">"{u.note}"</p>
                      )}
                      <span className="text-[10px] text-slate-500 font-mono block">
                        Richiesto il: {u.requestedAt.split('T')[0]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onAuthorizeUser(u.email);
                          showNotice('success', `Accesso autorizzato per ${u.email}`);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Autorizza</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onRevokeUser(u.email);
                          showNotice('success', `Richiesta rifiutata per ${u.email}`);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold text-xs transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>Rifiuta</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Authorized Users List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Utenti Autorizzati ({authorizedUsers.length})
                </h3>
              </div>
            </div>

            <div className="space-y-2.5">
              {authorizedUsers.map((u) => {
                const isRoot = isPrimaryAdmin(u.email);
                return (
                  <div
                    key={u.email}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full font-extrabold text-xs flex items-center justify-center shrink-0 ${
                          isRoot
                            ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {isRoot ? 'AD' : u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{u.name}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                              u.role === 'ADMIN'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {isRoot ? 'Amministratore Principale' : u.role}
                          </span>
                        </div>
                        {!isRoot && (
                          <div className="text-xs font-mono text-slate-400">{u.email}</div>
                        )}
                        {u.note && (
                          <div className="text-[11px] text-slate-500">{u.note}</div>
                        )}
                      </div>
                    </div>

                    {isRoot ? (
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400/90 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 self-end sm:self-center">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Protetto</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            onRevokeUser(u.email);
                            showNotice('success', `Accesso revocato per ${u.email}`);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
                        >
                          Revoca Accesso
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onRemoveUser(u.email);
                            showNotice('success', `Utente ${u.email} rimosso`);
                          }}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Rimuovi definitivamente"
                          aria-label={`Rimuovi ${u.email}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Revoked / Rejected Users if any */}
          {rejectedUsers.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
              <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                Accessi Revocati o Rifiutati ({rejectedUsers.length})
              </h3>
              <div className="space-y-2">
                {rejectedUsers.map((u) => (
                  <div
                    key={u.email}
                    className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <span className="text-xs font-bold text-slate-300">{u.name}</span>
                      <span className="text-xs font-mono text-slate-500 ml-2">{u.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onAuthorizeUser(u.email);
                          showNotice('success', `Accesso riabilitato per ${u.email}`);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold cursor-pointer"
                      >
                        Riabilita
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveUser(u.email)}
                        className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                        aria-label={`Elimina ${u.email}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
