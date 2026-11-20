/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Header, NavTab } from './components/Header';
import { SystemGenerator } from './components/SystemGenerator';
import { CamelWorkforceLab } from './components/CamelWorkforceLab';
import { WinForItaliaLab } from './components/WinForItaliaLab';
import { SimulationEngine } from './components/SimulationEngine';
import { HistoricalArchive } from './components/HistoricalArchive';
import { PlaysVerification } from './components/PlaysVerification';
import { StatisticsExplorer } from './components/StatisticsExplorer';
import { SmartPasteModal } from './components/SmartPasteModal';
import { LoginScreen } from './components/LoginScreen';
import { AdminAccessPanel } from './components/AdminAccessPanel';
import {
  Draw,
  SavedPlay,
  ScoringWeights,
  FilterOptions,
  GeneratedColumn,
  SimulationGeneratorPreset,
  CoverageTarget
} from './types/lottery';
import {
  calculateNumberStatistics,
  scoreAllNumbers,
  selectFunnelPool30To12,
  generateOptimizedSystem
} from './utils/combinatorics';
import {
  loadDraws,
  loadAndMergeEstrazioniSisal,
  validateAndDeduplicateDraws,
  insertDraw,
  saveDraws,
  loadSavedPlays,
  cacheOwnedPlays,
  syncSavedPlaysWithServer,
  insertPlay,
  updatePlay,
  deletePlay,
  loadDeletedPlayIds,
  saveDeletedPlayIds,
  normalizeLegacyWinForItaliaPlay,
  filterPlaysForUser,
  loadWeights,
  saveWeights,
  loadFilters,
  saveFilters
} from './utils/storage';
import type { AccessStatus, AuthSession, UserAccessRecord } from './utils/auth';
import type { User } from 'firebase/auth';
import {
  decideVerifiedAccess, logoutGoogle, observeVerifiedAccess, observeVerifiedIdentity, toSession,
} from './utils/secureAuth';
import {
  testFirestoreConnection,
  subscribeCloudPlays,
  subscribeCloudDeletedPlayIds,
  subscribeCloudCustomDraws,
  subscribeCloudWinForItaliaDraws
} from './utils/firebase';
import {
  WinForItaliaDraw,
  loadWinForItaliaDraws,
  saveWinForItaliaDraws,
  loadAndMergeWinForItaliaDraws,
  normalizeWinForItaliaDrawList
} from './utils/winForItalia';

export default function App() {
  const [identity, setIdentity] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<{
    user: User; status: AccessStatus; admin: boolean; acl: UserAccessRecord[];
  } | null>(null);
  const [error, setError] = useState('');
  const verified = access?.user === identity ? access : null;
  const session = identity ? toSession(identity) : null;

  useEffect(() => observeVerifiedIdentity(user => {
    setError('');
    setIdentity(user);
    setReady(true);
  }, () => {
    setError('Accedi con un account Gmail verificato da Google.');
    setReady(true);
  }), []);

  useEffect(() => {
    if (!identity) { setAccess(null); return; }
    return observeVerifiedAccess(identity, (acl, status, admin) => {
      setError('');
      setAccess({ user: identity, acl, status, admin });
    }, () => {
      setAccess(null);
      setError('Impossibile verificare le autorizzazioni. Esci e riprova.');
    });
  }, [identity]);

  const logout = () => {
    setAccess(null);
    void logoutGoogle().catch(() => setError('Uscita non completata. Riprova.'));
  };
  if (!session || verified?.status !== 'AUTHORIZED' || error) {
    return <LoginScreen session={session} status={verified?.status ?? 'PENDING'}
      loading={!ready || Boolean(identity && !verified && !error)} error={error} onLogout={logout} />;
  }
  return <AuthorizedApp key={identity?.uid} session={session} acl={verified.acl}
    isAdmin={verified.admin} onLogout={logout} />;
}

function AuthorizedApp({ session, acl, isAdmin, onLogout }: {
  session: AuthSession; acl: UserAccessRecord[]; isAdmin: boolean; onLogout: () => void;
}) {
  const [activeTab, setActiveTab] = useState<NavTab>('generator');
  const [draws, setDraws] = useState<Draw[]>(() => loadDraws());
  const [winForItaliaDraws, setWinForItaliaDraws] = useState<WinForItaliaDraw[]>(() =>
    loadWinForItaliaDraws()
  );
  const [weights, setWeights] = useState<ScoringWeights>(() => loadWeights());
  const [filters, setFilters] = useState<FilterOptions>(() => loadFilters());
  const [savedPlays, setSavedPlays] = useState<SavedPlay[]>(() =>
    filterPlaysForUser(loadSavedPlays(), session.email));
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);

  // Compute initial weekly columns so Simulation tab always has the current weekly system even if opened directly
  const [coverageTarget, setCoverageTarget] = useState<CoverageTarget>('terni');

  const defaultWeeklyColumns = useMemo<GeneratedColumn[]>(() => {
    const stats = calculateNumberStatistics(draws, 36);
    const scored = scoreAllNumbers(stats, weights, 36);
    const pool = selectFunnelPool30To12(
      scored,
      12,
      undefined,
      draws.length > 0 ? 'real_archive_weighted' : 'pure_uniform'
    ).top12Numbers;
    return generateOptimizedSystem(pool, filters, 10, undefined, coverageTarget).columns;
  }, [draws, weights, filters, coverageTarget]);

  const [weeklyColumns, setWeeklyColumns] = useState<GeneratedColumn[]>([]);
  const [appliedSimPreset, setAppliedSimPreset] = useState<SimulationGeneratorPreset | null>(null);

  // All'avvio dell'app: carica gli archivi dal repo GitHub esterno + Cloud Firestore (persistenza cross-browser/dispositivo)
  useEffect(() => {
    testFirestoreConnection().catch(() => {});
    loadAndMergeEstrazioniSisal()
      .then((mergedDraws) => {
        if (mergedDraws.length > 0) {
          setDraws(mergedDraws);
        }
      })
      .catch(() => {});
    loadAndMergeWinForItaliaDraws()
      .then((mergedWfi) => {
        if (mergedWfi.length > 0) {
          setWinForItaliaDraws(mergedWfi);
        }
      })
      .catch(() => {
        // Ignore if offline
      });
  }, []);

  const initialPlaysSyncDoneRef = React.useRef(false);

  // Real-time data listeners are mounted only inside the authorized app.
  useEffect(() => {
    const email = session.email;
    const unsubDeletedPlays = subscribeCloudDeletedPlayIds((cloudDeletedIds) => {
      if (cloudDeletedIds.length > 0) {
        const allDeleted = saveDeletedPlayIds(cloudDeletedIds);
        setSavedPlays((prevPlays) => {
          const filtered = prevPlays.filter((p) => !allDeleted.has(p.id));
          cacheOwnedPlays(filtered, email);
          return filtered;
        });
      }
    }, session.email);

    const unsubPlays = subscribeCloudPlays((cloudPlays) => {
      const deletedSet = loadDeletedPlayIds();
      const cleanCloudPlays = cloudPlays
        .filter((p) => p && !deletedSet.has(p.id))
        .map(normalizeLegacyWinForItaliaPlay);
      setSavedPlays((prevPlays) => {
        if (
          !initialPlaysSyncDoneRef.current &&
          cleanCloudPlays.length === 0 &&
          prevPlays.length > 0
        ) {
          return prevPlays
            .filter((p) => !deletedSet.has(p.id))
            .map(normalizeLegacyWinForItaliaPlay);
        }
        cacheOwnedPlays(cleanCloudPlays, email);
        return cleanCloudPlays;
      });
    }, session.email);

    const unsubCustomDraws = subscribeCloudCustomDraws((cloudDraws) => {
      if (cloudDraws.length > 0) {
        setDraws((prevDraws) => {
          const merged = validateAndDeduplicateDraws([...cloudDraws, ...prevDraws]);
          saveDraws(merged);
          return merged;
        });
      }
    });

    const unsubWfiDraws = subscribeCloudWinForItaliaDraws((cloudWfi) => {
      if (cloudWfi.length > 0) {
        setWinForItaliaDraws((prevWfi) => {
          const merged = normalizeWinForItaliaDrawList([...prevWfi, ...cloudWfi]);
          saveWinForItaliaDraws(merged);
          return merged;
        });
      }
    });

    return () => {
      unsubDeletedPlays();
      unsubPlays();
      unsubCustomDraws();
      unsubWfiDraws();
    };
  }, []);

  // Automatically sync savedPlays across Cloud Firestore, Server (/api/plays), IndexedDB, and LocalStorage on startup, login, and tab switch
  useEffect(() => {
    let active = true;
    syncSavedPlaysWithServer(session.email).then((mergedPlays) => {
      if (active) {
        initialPlaysSyncDoneRef.current = true;
        setSavedPlays(mergedPlays);
      }
    });
    return () => {
      active = false;
    };
  }, [session?.email, activeTab]);

  // Update weights
  const handleUpdateWeights = (newWeights: ScoringWeights) => {
    setWeights(newWeights);
    saveWeights(newWeights);
  };

  // Update filters
  const handleUpdateFilters = (newFilters: FilterOptions) => {
    setFilters(newFilters);
    saveFilters(newFilters);
  };

  // Apply high-probability sestina, pool, and parameters from SimulationEngine to SystemGenerator
  const handleApplySimulationPreset = (preset: SimulationGeneratorPreset) => {
    setWeights(preset.recommendedWeights);
    saveWeights(preset.recommendedWeights);
    setFilters(preset.recommendedFilters);
    saveFilters(preset.recommendedFilters);
    if (preset.coverageTarget) {
      setCoverageTarget(preset.coverageTarget);
    }
    setAppliedSimPreset(preset);
    setActiveTab('generator');
  };

  // Add / Insert new Draw (via Smart Paste or Import)
  const handleSaveDraw = (newDraw: Draw) => {
    const updated = insertDraw(newDraw);
    setDraws(updated);

    const matchingPending = savedPlays.filter(
      (p) =>
        p.status === 'IN_ATTESA' &&
        (p.targetContestId === newDraw.id || p.targetContestId === String(newDraw.contestNumber))
    );

    if (matchingPending.length > 0) {
      setActiveTab('ledger');
    }
  };

  // Update all draws
  const handleUpdateDraws = (newDraws: Draw[]) => {
    setDraws(newDraws);
    saveDraws(newDraws);
  };

  // Update all Win for Italia Team (6/40) draws
  const handleUpdateWinForItaliaDraws = (newWfiDraws: WinForItaliaDraw[]) => {
    setWinForItaliaDraws(newWfiDraws);
    saveWinForItaliaDraws(newWfiDraws);
  };

  // Add Play to ledger (tagged with the current user's email)
  const handleSavePlay = (newPlay: SavedPlay) => {
    const playWithOwner: SavedPlay = {
      ...newPlay,
      userEmail: newPlay.userEmail || session?.email.trim().toLowerCase()
    };
    const updated = insertPlay(playWithOwner);
    setSavedPlays(updated);
  };

  // Update Play (e.g. after verification)
  const handleUpdatePlay = (updatedPlay: SavedPlay) => {
    const playWithOwner: SavedPlay = {
      ...updatedPlay,
      userEmail: updatedPlay.userEmail || session?.email.trim().toLowerCase()
    };
    const updated = updatePlay(playWithOwner);
    setSavedPlays(updated);
  };

  // Delete Play
  const handleDeletePlay = (id: string) => {
    const updated = deletePlay(id, session.email);
    setSavedPlays(updated);
  };

  const userSavedPlays = filterPlaysForUser(savedPlays, session.email);
  const pendingPlaysCount = userSavedPlays.filter((p) => p.status === 'IN_ATTESA').length;
  const pendingAccessCount = acl.filter((u) => u.status === 'PENDING').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Navigation Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSmartPaste={() => setIsSmartPasteOpen(true)}
        pendingPlaysCount={pendingPlaysCount}
        session={session}
        isAdmin={isAdmin}
        pendingAccessCount={pendingAccessCount}
        onLogout={onLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'generator' && (
          <SystemGenerator
            key={session.email.toLowerCase()}
            userEmail={session.email}
            draws={draws}
            savedPlays={userSavedPlays}
            weights={weights}
            onUpdateWeights={handleUpdateWeights}
            filters={filters}
            onUpdateFilters={handleUpdateFilters}
            onSavePlay={handleSavePlay}
            onOpenSmartPaste={() => setIsSmartPasteOpen(true)}
            onColumnsGenerated={setWeeklyColumns}
            onOpenSimulationTab={() => setActiveTab('simulation')}
            appliedSimPreset={appliedSimPreset}
            onClearSimPreset={() => setAppliedSimPreset(null)}
            coverageTarget={coverageTarget}
            onUpdateCoverageTarget={setCoverageTarget}
          />
        )}

        {activeTab === 'camel' && (
          <CamelWorkforceLab
            key={session.email.toLowerCase()}
            userEmail={session.email}
            draws={draws}
            filters={filters}
            coverageTarget={coverageTarget}
            onUpdateCoverageTarget={setCoverageTarget}
            onApplyToGenerator={handleApplySimulationPreset}
            onSavePlay={handleSavePlay}
          />
        )}

        {activeTab === 'winforitalia' && (
          <WinForItaliaLab
            key={session.email.toLowerCase()}
            userEmail={session.email}
            onSavePlay={handleSavePlay}
            draws={winForItaliaDraws}
            onUpdateDraws={handleUpdateWinForItaliaDraws}
          />
        )}

        {activeTab === 'simulation' && (
          <SimulationEngine
            key={session.email.toLowerCase()}
            userEmail={session.email}
            draws={draws}
            weeklyColumns={weeklyColumns.length > 0 ? weeklyColumns : defaultWeeklyColumns}
            onSavePlay={handleSavePlay}
            onApplyToGenerator={handleApplySimulationPreset}
            coverageTarget={coverageTarget}
            onUpdateCoverageTarget={setCoverageTarget}
          />
        )}

        {activeTab === 'archive' && (
          <HistoricalArchive
            draws={draws}
            onUpdateDraws={handleUpdateDraws}
            winForItaliaDraws={winForItaliaDraws}
            onUpdateWinForItaliaDraws={handleUpdateWinForItaliaDraws}
            onOpenSmartPaste={() => setIsSmartPasteOpen(true)}
            savedPlays={userSavedPlays}
            weeklyColumns={weeklyColumns.length > 0 ? weeklyColumns : defaultWeeklyColumns}
            onSavePlay={handleSavePlay}
            onOpenLedgerTab={() => setActiveTab('ledger')}
          />
        )}

        {activeTab === 'ledger' && (
          <PlaysVerification
            plays={userSavedPlays}
            draws={draws}
            winForItaliaDraws={winForItaliaDraws}
            onSavePlay={handleSavePlay}
            onUpdatePlay={handleUpdatePlay}
            onDeletePlay={handleDeletePlay}
          />
        )}

        {activeTab === 'stats' && (
          <StatisticsExplorer
            draws={draws}
            weights={weights}
          />
        )}

        {activeTab === 'admin' && isAdmin && (
          <AdminAccessPanel
            acl={acl}
            onDecision={decideVerifiedAccess}
          />
        )}
      </main>

      {/* Smart Paste Modal */}
      <SmartPasteModal
        isOpen={isSmartPasteOpen}
        onClose={() => setIsSmartPasteOpen(false)}
        onSaveDraw={handleSaveDraw}
        lastDraw={draws[0]}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center md:text-left">
            <p className="text-slate-400 font-medium">
              SuperEnalotto Combinatorial Optimizer &mdash; Zero-Cost Architecture (100% Client-Side)
            </p>
            <p className="text-[11px] text-slate-500">
              Nota statistica: Il gioco è vietato ai minori e può causare dipendenza patologica. Ogni estrazione è un evento stocastico indipendente con probabilità sestina P = 1 / 622.614.630.
            </p>
          </div>
          <div className="flex items-center gap-4 text-slate-400 text-[11px]">
            <span>OAuth Gmail Attivo</span>
            <span>&bull;</span>
            <span>Covering Design C(v, 6)</span>
            <span>&bull;</span>
            <span className="text-amber-400 font-bold">Budget: 10€ / 15€ / 20€ / max 100€</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
