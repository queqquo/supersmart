/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Header, NavTab } from './components/Header';
import { SystemGenerator } from './components/SystemGenerator';
import { CamelWorkforceLab } from './components/CamelWorkforceLab';
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
  insertDraw,
  saveDraws,
  syncOfficialDrawsFromLiveFeed,
  loadSavedPlays,
  cachePlaysLocally,
  syncSavedPlaysWithServer,
  insertPlay,
  updatePlay,
  deletePlay,
  loadDeletedPlayIds,
  saveDeletedPlayIds,
  filterPlaysForUser,
  loadWeights,
  saveWeights,
  loadFilters,
  saveFilters
} from './utils/storage';
import {
  AuthSession,
  UserAccessRecord,
  UserRole,
  loadACL,
  saveACL,
  mergeACLRecords,
  loadAuthSession,
  saveAuthSession,
  evaluateUserAccess,
  requestUserAccess,
  authorizeUserByAdmin,
  revokeUserByAdmin,
  removeUserRecordByAdmin,
  fetchServerACL,
  apiRequestUserAccess,
  apiAuthorizeUserByAdmin,
  apiRevokeUserByAdmin,
  apiRemoveUserRecordByAdmin,
  isPrimaryAdmin
} from './utils/auth';
import {
  testFirestoreConnection,
  subscribeCloudPlays,
  subscribeCloudDeletedPlayIds,
  subscribeCloudACL
} from './utils/firebase';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('generator');
  const [draws, setDraws] = useState<Draw[]>(() => loadDraws());
  const [weights, setWeights] = useState<ScoringWeights>(() => loadWeights());
  const [filters, setFilters] = useState<FilterOptions>(() => loadFilters());
  const [savedPlays, setSavedPlays] = useState<SavedPlay[]>(() => loadSavedPlays());
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);

  // Compute initial weekly columns so Simulation tab always has the current weekly system even if opened directly
  const [coverageTarget, setCoverageTarget] = useState<CoverageTarget>('terni');

  const defaultWeeklyColumns = useMemo<GeneratedColumn[]>(() => {
    const stats = calculateNumberStatistics(draws, 36);
    const scored = scoreAllNumbers(stats, weights, 36);
    const pool = selectFunnelPool30To12(scored, 12).top12Numbers;
    return generateOptimizedSystem(pool, filters, 10, undefined, coverageTarget).columns;
  }, [draws, weights, filters, coverageTarget]);

  const [weeklyColumns, setWeeklyColumns] = useState<GeneratedColumn[]>([]);
  const [appliedSimPreset, setAppliedSimPreset] = useState<SimulationGeneratorPreset | null>(null);

  // OAuth & Access Control State
  const [acl, setAcl] = useState<UserAccessRecord[]>(() => loadACL());
  const [session, setSession] = useState<AuthSession | null>(() => loadAuthSession());

  // Automatically sync official draws and test Firestore connection on startup
  useEffect(() => {
    testFirestoreConnection().catch(() => {});
    syncOfficialDrawsFromLiveFeed()
      .then((res) => {
        if (res.draws.length > 0) {
          setDraws(res.draws);
        }
      })
      .catch(() => {
        // Ignore if offline
      });
  }, []);

  const initialPlaysSyncDoneRef = React.useRef(false);
  const initialAclSyncDoneRef = React.useRef(false);

  // Real-time Cloud Firestore listeners for Deleted Play Tombstones (/deleted_plays), Saved Plays (/plays), and User ACL (/acl)
  useEffect(() => {
    const unsubDeletedPlays = subscribeCloudDeletedPlayIds((cloudDeletedIds) => {
      if (cloudDeletedIds.length > 0) {
        const allDeleted = saveDeletedPlayIds(cloudDeletedIds);
        setSavedPlays((prevPlays) => {
          const filtered = prevPlays.filter((p) => !allDeleted.has(p.id));
          cachePlaysLocally(filtered);
          return filtered;
        });
      }
    });

    const unsubPlays = subscribeCloudPlays((cloudPlays) => {
      const deletedSet = loadDeletedPlayIds();
      const cleanCloudPlays = cloudPlays.filter((p) => p && !deletedSet.has(p.id));
      setSavedPlays((prevPlays) => {
        if (
          !initialPlaysSyncDoneRef.current &&
          cleanCloudPlays.length === 0 &&
          prevPlays.length > 0
        ) {
          return prevPlays.filter((p) => !deletedSet.has(p.id));
        }
        cachePlaysLocally(cleanCloudPlays);
        return cleanCloudPlays;
      });
    });

    const unsubAcl = subscribeCloudACL((cloudAcl) => {
      if (cloudAcl.length > 0) {
        setAcl((prevAcl) => {
          const nextAcl = initialAclSyncDoneRef.current
            ? mergeACLRecords(cloudAcl)
            : mergeACLRecords(prevAcl, cloudAcl);
          saveACL(nextAcl);
          return nextAcl;
        });
      }
    });

    return () => {
      unsubDeletedPlays();
      unsubPlays();
      unsubAcl();
    };
  }, []);

  // Automatically sync savedPlays across Cloud Firestore, Server (/api/plays), IndexedDB, and LocalStorage on startup, login, and tab switch
  useEffect(() => {
    let active = true;
    syncSavedPlaysWithServer().then((mergedPlays) => {
      initialPlaysSyncDoneRef.current = true;
      if (active) {
        setSavedPlays(mergedPlays);
      }
    });
    return () => {
      active = false;
    };
  }, [session?.email, activeTab]);

  // Sync ACL with Cloud Firestore + Server on startup and periodically
  useEffect(() => {
    let active = true;
    const syncAcl = async () => {
      const serverAcl = await fetchServerACL();
      initialAclSyncDoneRef.current = true;
      if (active && serverAcl) {
        setAcl(serverAcl);
      }
    };
    syncAcl();
    const interval = setInterval(syncAcl, 6000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeTab, session?.email]);

  // Handle Google OAuth 2.0 Implicit Flow callback token if present in URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      if (accessToken) {
        // Clear hash from URL
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
          .then((res) => res.json())
          .then(async (profile) => {
            if (profile && profile.email) {
              const emailNorm = profile.email.toLowerCase();
              const resolvedName = profile.name || emailNorm.split('@')[0];
              const newSession: AuthSession = {
                email: emailNorm,
                name: resolvedName,
                picture: profile.picture,
                loginAt: new Date().toISOString(),
                provider: 'google_oauth'
              };
              const serverAcl = (await fetchServerACL()) || loadACL();
              setAcl(serverAcl);
              const evalRes = evaluateUserAccess(emailNorm, serverAcl);
              if (!evalRes.isAdmin && evalRes.status === 'UNREGISTERED') {
                const reqPayload = {
                  email: emailNorm,
                  name: resolvedName,
                  picture: profile.picture,
                  note: 'Richiesta di approvazione accesso come Utente tramite Google Login'
                };
                const updatedAcl =
                  (await apiRequestUserAccess(reqPayload)) ||
                  requestUserAccess(serverAcl, reqPayload);
                setAcl(updatedAcl);
                saveACL(updatedAcl);
              }
              setSession(newSession);
              saveAuthSession(newSession);
            }
          })
          .catch((err) => console.error('Failed to fetch Google userinfo:', err));
      }
    }
  }, []);

  // Sync ACL and Plays across tabs via storage event
  useEffect(() => {
    const handleStorage = () => {
      setAcl(loadACL());
      setSession(loadAuthSession());
      setSavedPlays(loadSavedPlays());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Auth handlers
  const handleLogin = (newSession: AuthSession) => {
    setSession(newSession);
    saveAuthSession(newSession);

    // Fetch latest ACL from Cloud Firestore before checking if the user is UNREGISTERED
    fetchServerACL().then(async (latestAcl) => {
      const currentAcl = latestAcl || loadACL();
      setAcl(currentAcl);
      if (!isPrimaryAdmin(newSession.email)) {
        const evalRes = evaluateUserAccess(newSession.email, currentAcl);
        if (evalRes.status === 'UNREGISTERED') {
          const reqPayload = {
            email: newSession.email,
            name: newSession.name,
            note: 'Richiesta di approvazione accesso come Utente tramite Google Login'
          };
          const updatedAcl =
            (await apiRequestUserAccess(reqPayload)) ||
            requestUserAccess(currentAcl, reqPayload);
          setAcl(updatedAcl);
          saveACL(updatedAcl);
        }
      }
    });

    syncSavedPlaysWithServer().then((mergedPlays) => {
      setSavedPlays(mergedPlays);
    });
  };

  const handleLogout = () => {
    setSession(null);
    saveAuthSession(null);
    setActiveTab('generator');
  };

  const handleRequestAccess = (user: { email: string; name: string; note: string }) => {
    const updated = requestUserAccess(acl, user);
    setAcl(updated);
    saveACL(updated);
    apiRequestUserAccess(user).then((serverAcl) => {
      if (serverAcl) setAcl(serverAcl);
    });
  };

  const handleAuthorizeUser = (
    targetEmail: string,
    options?: { name?: string; role?: UserRole; note?: string }
  ) => {
    if (!session) return;
    const updated = authorizeUserByAdmin(acl, session.email, targetEmail, options);
    setAcl(updated);
    saveACL(updated);
    apiAuthorizeUserByAdmin(session.email, targetEmail, options).then((serverAcl) => {
      if (serverAcl) setAcl(serverAcl);
    });
  };

  const handleRevokeUser = (targetEmail: string) => {
    if (!session) return;
    const updated = revokeUserByAdmin(acl, session.email, targetEmail);
    setAcl(updated);
    saveACL(updated);
    apiRevokeUserByAdmin(session.email, targetEmail).then((serverAcl) => {
      if (serverAcl) setAcl(serverAcl);
    });
  };

  const handleRemoveUser = (targetEmail: string) => {
    if (!session) return;
    const updated = removeUserRecordByAdmin(acl, session.email, targetEmail);
    setAcl(updated);
    saveACL(updated);
    apiRemoveUserRecordByAdmin(session.email, targetEmail).then((serverAcl) => {
      if (serverAcl) setAcl(serverAcl);
    });
  };

  // Evaluate current user's authorization
  const accessEval = session
    ? evaluateUserAccess(session.email, acl)
    : { isAuthorized: false, isAdmin: false, status: 'UNREGISTERED' as const, record: null };

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
    const updated = deletePlay(id);
    setSavedPlays(updated);
  };

  // Gate: If not logged in or not authorized by Admin, render Login / Access Gate Screen
  if (!session || !accessEval.isAuthorized) {
    return (
      <LoginScreen
        session={session}
        acl={acl}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRequestAccess={handleRequestAccess}
      />
    );
  }

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
        isAdmin={accessEval.isAdmin}
        pendingAccessCount={pendingAccessCount}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'generator' && (
          <SystemGenerator
            key={session.email.toLowerCase()}
            userEmail={session.email}
            draws={draws}
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
            draws={draws}
            filters={filters}
            coverageTarget={coverageTarget}
            onUpdateCoverageTarget={setCoverageTarget}
            onApplyToGenerator={handleApplySimulationPreset}
            onSavePlay={handleSavePlay}
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

        {activeTab === 'admin' && accessEval.isAdmin && (
          <AdminAccessPanel
            adminEmail={session.email}
            acl={acl}
            onAuthorizeUser={handleAuthorizeUser}
            onRevokeUser={handleRevokeUser}
            onRemoveUser={handleRemoveUser}
            onSimulatePendingRequest={(email, name, note) =>
              handleRequestAccess({ email, name, note })
            }
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
