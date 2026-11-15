/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Sparkles,
  History,
  Trophy,
  BarChart3,
  Clipboard,
  ShieldCheck,
  LogOut,
  Users,
  Dices,
  Bot
} from 'lucide-react';
import { AuthSession, isPrimaryAdmin } from '../utils/auth';

export type NavTab = 'generator' | 'camel' | 'simulation' | 'archive' | 'ledger' | 'stats' | 'admin';

interface HeaderProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenSmartPaste: () => void;
  pendingPlaysCount: number;
  session: AuthSession;
  isAdmin: boolean;
  pendingAccessCount: number;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenSmartPaste,
  pendingPlaysCount,
  session,
  isAdmin,
  pendingAccessCount,
  onLogout
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2">
          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950 font-black text-xl shrink-0">
              ★
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base sm:text-lg text-white tracking-tight">
                  SuperEnalotto
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold uppercase tracking-wider">
                  Zero-Cost
                </span>
              </div>
              <span className="text-[11px] text-slate-400 hidden sm:block font-medium">
                Combinatorial Optimizer &bull; Sistema Ridotto 10€&ndash;100€ / Sett.
              </span>
            </div>
          </div>

          {/* Right Actions: Smart Paste + User OAuth Profile + Logout */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onOpenSmartPaste}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer active:scale-95"
              title="Incolla l'ultima estrazione estratta da web"
            >
              <Clipboard className="w-4 h-4 text-amber-400" />
              <span className="hidden md:inline">Incolla Rapido Smart</span>
            </button>

            {/* Authenticated User badge */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="hidden sm:flex flex-col items-end">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white leading-none">
                    {session.name}
                  </span>
                  {isAdmin ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-extrabold uppercase">
                      Admin
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-extrabold uppercase">
                      Utente
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {isPrimaryAdmin(session.email) ? 'Amministratore' : session.email}
                </span>
              </div>

              <button
                type="button"
                onClick={onLogout}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors cursor-pointer"
                title="Cambia account Google / Esci"
                aria-label="Cambia account Google / Esci"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-1 sm:space-x-2 border-t border-slate-800/80 pt-1 pb-2 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => onTabChange('generator')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'generator'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Generatore Ottimizzato</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('camel')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'camel'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-indigo-300 hover:text-white hover:bg-slate-900 border border-indigo-500/30'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Agenti CAMEL (Sistemi)</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('simulation')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'simulation'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Dices className="w-4 h-4" />
            <span>Simulazione 100&ndash;100k Estrazioni</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('archive')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'archive'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Archivio Estrazioni</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('ledger')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer relative ${
              activeTab === 'ledger'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Verifica & Bilancio</span>
            {pendingPlaysCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono font-bold">
                {pendingPlaysCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('stats')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'stats'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Statistiche 90 Numeri</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => onTabChange('admin')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer relative ${
                activeTab === 'admin'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-amber-300/90 hover:text-amber-200 hover:bg-slate-900 border border-amber-500/20'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Gestione Utenti (Admin)</span>
              {pendingAccessCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono font-bold animate-pulse">
                  {pendingAccessCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
