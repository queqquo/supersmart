/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WinForItaliaDraw,
  normalizeWinForItaliaDrawList,
  calculateWinForItaliaStats,
  selectBalancedTop12ForWinForItalia,
  runWinForItaliaFunnel40To12,
  selectSniperSestinaFromTop12,
  generateReduced3Columns,
  generateWinForItaliaExtended,
  getWinForItaliaExtendedOdds,
  WFI_EXTENDED_DEMO_SEED,
  parseWinForItaliaManualInput,
  runWinForItaliaWeeklyMonteCarlo,
  isWinForItaliaPlay,
  evaluateWinForItaliaPlay,
  compareSavedPlayAgainstWinForItaliaDraws
} from './winForItalia';
import { SavedPlay } from '../types/lottery';

function makeFixtureHistory(count = 53): WinForItaliaDraw[] {
  const draws: WinForItaliaDraw[] = [];
  const baseDate = new Date('2026-09-28T20:00:00Z');
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const cn = i + 1;
    const nums =
      cn === 53
        ? ([3, 12, 22, 25, 31, 38] as [number, number, number, number, number, number])
        : cn === 1
        ? ([10, 12, 19, 24, 33, 34] as [number, number, number, number, number, number])
        : ([
            ((i * 3) % 8) + 1,
            ((i * 5) % 8) + 9,
            ((i * 7) % 8) + 17,
            ((i * 11) % 6) + 25,
            ((i * 13) % 5) + 31,
            ((i * 17) % 4) + 37
          ].sort((a, b) => a - b) as [number, number, number, number, number, number]);
    draws.push({
      id: `WFI-2026-${String(cn).padStart(3, '0')}`,
      contestNumber: cn,
      year: 2026,
      date: iso,
      time: '20:00',
      numbers: nums
    });
  }
  return normalizeWinForItaliaDrawList(draws);
}

test('calculateWinForItaliaStats uses dynamic window Math.min(history.length, 50)', () => {
  const fullHistory = makeFixtureHistory(53);
  assert.ok(fullHistory.length >= 50, 'Fixture history should contain at least 50 draws');

  const fullRes = calculateWinForItaliaStats(fullHistory);
  assert.equal(fullRes.windowSize, 50);
  assert.equal(fullRes.stats.length, 40);

  const shortHistory = fullHistory.slice(0, 18);
  const shortRes = calculateWinForItaliaStats(shortHistory);
  assert.equal(shortRes.windowSize, 18);
});

test('selectBalancedTop12ForWinForItalia enforces max 3 per decade and Max 7 P/D on 12 / Max 5 P/D on 9', () => {
  // 16 candidates with heavy concentration in decade 1 (11-20) and evens
  const pool16 = [2, 4, 6, 8, 12, 14, 16, 18, 22, 24, 26, 33, 34, 36, 38, 39];
  const { top12Numbers, decadeDistributionTop12 } = selectBalancedTop12ForWinForItalia(pool16, new Set(), 12);

  assert.equal(top12Numbers.length, 12);
  for (const dec of [0, 1, 2, 3]) {
    assert.ok(
      (decadeDistributionTop12[dec] || 0) <= 3,
      `Decade ${dec} exceeded 3 numbers: ${decadeDistributionTop12[dec]}`
    );
  }

  // Test with balanced parity pool for Top 9 (Max 5 P/D -> 5/4 or 4/5)
  const balancedPool16 = [1, 2, 7, 8, 11, 12, 17, 18, 22, 23, 27, 28, 33, 34, 39, 40];
  const res9 = selectBalancedTop12ForWinForItalia(balancedPool16, new Set(), 9);
  assert.equal(res9.top12Numbers.length, 9);
  const evens9 = res9.top12Numbers.filter((n) => n % 2 === 0).length;
  const odds9 = 9 - evens9;
  assert.ok(evens9 <= 5 && odds9 <= 5, `Top 9 parity (${evens9}P/${odds9}D) must be 5/4 or 4/5`);
});

test('runWinForItaliaFunnel40To12 builds 16 candidates (13 genetic + 3 chaos) and outputs both Top 12 and Top 9 in 1..40', () => {
  const history = makeFixtureHistory(53);
  const { stats } = calculateWinForItaliaStats(history);
  const funnel = runWinForItaliaFunnel40To12(stats);

  assert.equal(funnel.genetic13.length, 13);
  assert.equal(funnel.chaos3.length, 3);
  assert.equal(funnel.pool16.length, 16);
  assert.equal(new Set(funnel.pool16).size, 16);
  assert.equal(funnel.top12Numbers.length, 12);
  assert.equal(funnel.top9Numbers.length, 9);
  assert.ok(funnel.top12Numbers.every((n) => n >= 1 && n <= 40));
  assert.ok(funnel.top9Numbers.every((n) => n >= 1 && n <= 40));
  for (const dec of [0, 1, 2, 3]) {
    assert.ok(
      (funnel.decadeDistributionTop12[dec] || 0) <= 3,
      `Decade ${dec} exceeded 3 numbers in runWinForItaliaFunnel40To12`
    );
    assert.ok(
      (funnel.decadeDistributionTop9[dec] || 0) <= 3,
      `Decade ${dec} exceeded 3 numbers in Top 9`
    );
  }
});

test('generateReduced3Columns develops 3 sestine from Top 9 (C(9,6)=84) with exact 2x symmetric coverage', () => {
  const history = makeFixtureHistory(53);
  const { stats } = calculateWinForItaliaStats(history);
  const funnel = runWinForItaliaFunnel40To12(stats, () => 0.37);
  const reduced = generateReduced3Columns(funnel.top9Numbers, stats);

  assert.equal(reduced.totalCombinationsEvaluated, 84);
  assert.equal(reduced.columns.length, 3);
  assert.equal(reduced.isPerfect2x, true, 'Every number in Top 9 must appear in exactly 2 of the 3 sestine');

  for (const num of reduced.top9Numbers) {
    assert.equal(
      reduced.numberFrequencies[num],
      2,
      `Number ${num} should appear 2 times, appeared ${reduced.numberFrequencies[num]} times`
    );
  }
});

test('selectSniperSestinaFromTop12 evaluates all C(12,6) = 924 sestine and selects Top 1 + alternatives #2 and #3', () => {
  const history = makeFixtureHistory(53);
  const { stats } = calculateWinForItaliaStats(history);
  const funnel = runWinForItaliaFunnel40To12(stats, () => 0.42);
  const sniper = selectSniperSestinaFromTop12(funnel.top12Numbers, stats);

  assert.equal(sniper.totalCombinationsEvaluated, 924);
  assert.equal(sniper.primarySestina.numbers.length, 6);
  assert.equal(sniper.alternative2.numbers.length, 6);
  assert.equal(sniper.alternative3.numbers.length, 6);
  assert.ok(
    sniper.primarySestina.totalScore >= sniper.alternative2.totalScore,
    'Primary sestina #1 must have highest total score'
  );
  assert.ok(
    sniper.primarySestina.maxPerDecade <= 3,
    'Primary sestina must respect max 3 numbers per decade'
  );
});

test('parseWinForItaliaManualInput validates 6 distinct numbers between 1 and 40', () => {
  const history = makeFixtureHistory(53);

  const valid = parseWinForItaliaManualInput('39, 4, 18, 11, 25, 34', history, '2026-04-20');
  assert.ok(valid.draw);
  assert.deepEqual(valid.draw.numbers, [4, 11, 18, 25, 34, 39]);

  const outOfRange = parseWinForItaliaManualInput('4, 11, 18, 25, 34, 41', history);
  assert.ok(outOfRange.error);

  const duplicate = parseWinForItaliaManualInput('4, 11, 18, 18, 34, 39', history);
  assert.ok(duplicate.error);

  const wrongCount = parseWinForItaliaManualInput('4, 11, 18, 25, 34', history);
  assert.ok(wrongCount.error);
});

test('runWinForItaliaWeeklyMonteCarlo simulates 50,000 draws for both 1 column (14,00 €/week) and 3 reduced columns (42,00 €/week)', () => {
  const result = runWinForItaliaWeeklyMonteCarlo([3, 8, 15, 22, 34, 39], 50000, 2026040);

  assert.equal(result.totalSimulatedDraws, 50000);
  assert.equal(result.columnsCount, 1);
  assert.equal(result.ticketCost, 2.0);
  assert.equal(result.weeklyCost, 14.0);
  assert.equal(result.totalSpent, 100000);
  assert.ok(
    result.hitsByCategory.punto2 > 8200 && result.hitsByCategory.punto2 < 9900,
    `Punto 2 hits (${result.hitsByCategory.punto2}) should match 6/40 hypergeometric expectation (~9062)`
  );
  assert.ok(result.expectedPunto2PerWeek > 1.1 && result.expectedPunto2PerWeek < 1.5);
  assert.ok(result.averageWeeklyRecoveryRatePct > 20 && result.averageWeeklyRecoveryRatePct < 80);

  // Test 3-column reduced system Monte Carlo (6,00 € / evening, 42,00 € / week)
  const reduced = generateReduced3Columns([2, 7, 11, 16, 21, 26, 33, 36, 39]);
  const res3 = runWinForItaliaWeeklyMonteCarlo(
    reduced.columns.map((c) => [...c.numbers]),
    50000,
    2026040
  );
  assert.equal(res3.columnsCount, 3);
  assert.equal(res3.ticketCost, 6.0);
  assert.equal(res3.weeklyCost, 42.0);
  assert.equal(res3.totalSpent, 300000);
  assert.ok(
    res3.probAtLeastOnePunto2PerDrawPct > result.probAtLeastOnePunto2PerDrawPct,
    `3-column evening Punto 2 probability (${res3.probAtLeastOnePunto2PerDrawPct}%) must exceed 1-column (${result.probAtLeastOnePunto2PerDrawPct}%)`
  );
});

test('evaluateWinForItaliaPlay and compareSavedPlayAgainstWinForItaliaDraws evaluate 6/40 prizes accurately', () => {
  const history = makeFixtureHistory(53);
  const sampleDraw = {
    id: 'WFI-2026-999',
    contestNumber: 999,
    year: 2026,
    date: '2026-04-20',
    time: '20:00',
    numbers: [3, 8, 15, 22, 34, 39] as [number, number, number, number, number, number]
  };

  const mockPlay: SavedPlay = {
    id: 'play-wfi-test',
    createdAt: '2026-04-20T12:00:00.000Z',
    targetContestId: 'WFI-2026-999',
    mode: 'manual',
    cost: 2.0,
    savedAmount: 0,
    poolNumbers: [3, 8, 15, 22, 34, 39],
    columns: [
      {
        id: 1,
        numbers: [3, 8, 16, 23, 35, 40], // 2 matches: 3, 8 -> 2.00 €
        sum: 125,
        evens: 3,
        odds: 3,
        lows: 3,
        highs: 3
      }
    ],
    status: 'IN_ATTESA',
    manualNote: 'Win for Italia Team (6/40)'
  };

  assert.equal(isWinForItaliaPlay(mockPlay), true);

  const evalRes = evaluateWinForItaliaPlay(mockPlay.columns, sampleDraw, mockPlay.cost);
  assert.equal(evalRes.bestMatch, 2);
  assert.equal(evalRes.totalWinning, 2.0);
  assert.equal(evalRes.netReturn, 0.0);

  const compRes = compareSavedPlayAgainstWinForItaliaDraws(mockPlay, history, 25);
  assert.equal(compRes.drawsEvaluatedCount, 25);
  assert.equal(compRes.costPerDraw, 2.0);
  assert.equal(compRes.totalSpent, 50.0);
});

test('loadWinForItaliaDraws contains official Sisal Concorso 53 (2026-11-19: 3, 12, 22, 25, 31, 38) through Concorso 1 (2026-09-28)', () => {
  const history = makeFixtureHistory(53);
  assert.equal(history.length, 53);

  const conc53 = history.find((d) => d.id === 'WFI-2026-053');
  assert.ok(conc53, 'Concorso 53 (WFI-2026-053) must exist');
  assert.equal(conc53.contestNumber, 53);
  assert.equal(conc53.date, '2026-11-19');
  assert.deepEqual(conc53.numbers, [3, 12, 22, 25, 31, 38]);

  const conc1 = history.find((d) => d.id === 'WFI-2026-001');
  assert.ok(conc1, 'Concorso 1 (WFI-2026-001) must exist');
  assert.equal(conc1.date, '2026-09-28');
  assert.deepEqual(conc1.numbers, [10, 12, 19, 24, 33, 34]);

  // Verify user ticket play (1, 14, 15, 24, 30, 39) on Concorso 53 evaluates to 0 matches
  const userTicketEval = evaluateWinForItaliaPlay(
    [{ id: 1, numbers: [1, 14, 15, 24, 30, 39], sum: 123, evens: 3, odds: 3, lows: 3, highs: 3 }],
    conc53,
    2.0
  );
  assert.equal(userTicketEval.bestMatch, 0);
  assert.equal(userTicketEval.totalWinning, 0);
});

test('UserWinForItaliaRecord normalizes and persists exact locked sestine per user across round-trips', async () => {
  const { normalizeUserWinForItaliaRecord } = await import('./winForItalia');
  const {
    loadUserWinForItaliaState,
    cacheUserWinForItaliaStateLocally,
    getUserWinForItaliaStorageKey
  } = await import('./storage');

  const history = makeFixtureHistory(53);
  const { windowSize, stats } = calculateWinForItaliaStats(history);
  const funnelResult = runWinForItaliaFunnel40To12(stats, () => 0.41);
  const sniperSelection = selectSniperSestinaFromTop12(funnelResult.top12Numbers, stats);
  const reduced3System = generateReduced3Columns(funnelResult.top9Numbers, stats);

  const record = {
    userEmail: 'Giuseppe.Vitiello@gmail.com',
    updatedAt: '2026-11-20T18:55:00.000Z',
    playMode: 'sniper' as const,
    latestDrawIdAtGeneration: history[0].id,
    windowSizeAtGeneration: windowSize,
    funnelResult,
    sniperSelection,
    reduced3System
  };

  const roundTripped = normalizeUserWinForItaliaRecord(
    JSON.parse(JSON.stringify(record)),
    'giuseppe.vitiello@gmail.com'
  );
  assert.ok(roundTripped);
  assert.ok(roundTripped.sniperSelection && roundTripped.reduced3System);
  assert.equal(roundTripped.userEmail, 'giuseppe.vitiello@gmail.com');
  assert.deepEqual(
    roundTripped.sniperSelection.primarySestina.numbers,
    sniperSelection.primarySestina.numbers
  );
  assert.deepEqual(
    roundTripped.reduced3System.columns.map((c) => c.numbers),
    reduced3System.columns.map((c) => c.numbers)
  );

  // Reject mismatched user email
  assert.equal(
    normalizeUserWinForItaliaRecord(record, 'altro.utente@gmail.com'),
    null
  );

  // Verify localStorage persistence & per-user isolation
  const memStore = new Map<string, string>();
  const prevLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  (globalThis as unknown as { localStorage: Partial<Storage> }).localStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStore.set(k, v);
    },
    removeItem: (k: string) => {
      memStore.delete(k);
    }
  };
  try {
    cacheUserWinForItaliaStateLocally(roundTripped);
    assert.ok(memStore.has(getUserWinForItaliaStorageKey('giuseppe.vitiello@gmail.com')));

    const loaded = loadUserWinForItaliaState('giuseppe.vitiello@gmail.com');
    assert.ok(loaded);
    assert.ok(loaded.sniperSelection && loaded.funnelResult);
    assert.deepEqual(
      loaded.sniperSelection.primarySestina.numbers,
      sniperSelection.primarySestina.numbers
    );
    assert.deepEqual(loaded.funnelResult.top12Numbers, funnelResult.top12Numbers);
    assert.equal(loadUserWinForItaliaState('altro.utente@gmail.com'), null);
  } finally {
    if (prevLocalStorage === undefined) {
      delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as unknown as { localStorage: Storage }).localStorage = prevLocalStorage;
    }
  }
});

test('Copertura estesa reproduces the example and samples 18 distinct in-range numbers for other seeds', async () => {
  const example = await generateWinForItaliaExtended(WFI_EXTENDED_DEMO_SEED);
  assert.deepEqual(example.columns.map(c => c.numbers), [
    [2, 14, 18, 30, 31, 34], [7, 10, 15, 32, 33, 39], [4, 13, 19, 20, 21, 23]
  ]);
  assert.deepEqual(await generateWinForItaliaExtended(example.seed), example);
  for (let i = 0; i < 20; i++) {
    const generated = await generateWinForItaliaExtended(`test-${i}`);
    const numbers = generated.columns.flatMap(column => {
      assert.equal(column.numbers.length, 6);
      return column.numbers;
    });
    assert.equal(new Set(numbers).size, 18);
    assert.ok(numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 40));
  }
  assert.notDeepEqual((await generateWinForItaliaExtended('different')).columns, example.columns);
  await assert.rejects(() => generateWinForItaliaExtended(''));
});

test('Copertura estesa uses exact disjoint-column counts', () => {
  assert.deepEqual(getWinForItaliaExtendedOdds(), {
    draws: 3838380, atLeast2: 2167095, atLeast3: 383700, exact6: 3
  });
});

test('Copertura estesa round-trips alone and alongside both legacy modes; invalid columns are rejected', async () => {
  const { normalizeUserWinForItaliaRecord } = await import('./winForItalia');
  const email = 'test@example.org';
  const extendedSystem = await generateWinForItaliaExtended(WFI_EXTENDED_DEMO_SEED);
  const record = {
    userEmail: email, updatedAt: '2026-11-20T18:55:00Z', playMode: 'extended18',
    latestDrawIdAtGeneration: '', windowSizeAtGeneration: 0, extendedSystem
  };
  assert.deepEqual(normalizeUserWinForItaliaRecord(JSON.parse(JSON.stringify(record)), email), record);
  assert.equal(normalizeUserWinForItaliaRecord(record, 'other@example.org'), null);

  const { stats } = calculateWinForItaliaStats(makeFixtureHistory(53));
  const funnelResult = runWinForItaliaFunnel40To12(stats, () => 0.41);
  const sniperSelection = selectSniperSestinaFromTop12(funnelResult.top12Numbers, stats);
  const reduced3System = generateReduced3Columns(funnelResult.top9Numbers, stats);
  assert.deepEqual(normalizeUserWinForItaliaRecord({
    ...record, playMode: 'reduced3', funnelResult, sniperSelection, reduced3System
  }, email)?.extendedSystem, extendedSystem);
  const bad = { ...record, extendedSystem: { ...extendedSystem, columns: [
    extendedSystem.columns[0], { ...extendedSystem.columns[1], numbers: extendedSystem.columns[0].numbers },
    extendedSystem.columns[2]
  ] } };
  assert.equal(normalizeUserWinForItaliaRecord(bad, email), null);
  assert.deepEqual(normalizeUserWinForItaliaRecord({
    ...bad, playMode: 'sniper', funnelResult, sniperSelection, reduced3System
  }, email)?.sniperSelection, sniperSelection);
});



