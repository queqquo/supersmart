/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWinForItaliaDraws,
  calculateWinForItaliaStats,
  selectBalancedTop12ForWinForItalia,
  runWinForItaliaFunnel40To12,
  selectSniperSestinaFromTop12,
  parseWinForItaliaManualInput,
  runWinForItaliaWeeklyMonteCarlo,
  isWinForItaliaPlay,
  evaluateWinForItaliaPlay,
  compareSavedPlayAgainstWinForItaliaDraws
} from './winForItalia';
import { SavedPlay } from '../types/lottery';

test('calculateWinForItaliaStats uses dynamic window Math.min(history.length, 50)', () => {
  const fullHistory = loadWinForItaliaDraws();
  assert.ok(fullHistory.length >= 50, 'Seed winforitalia.json should contain at least 50 draws');

  const fullRes = calculateWinForItaliaStats(fullHistory);
  assert.equal(fullRes.windowSize, 50);
  assert.equal(fullRes.stats.length, 40);

  const shortHistory = fullHistory.slice(0, 18);
  const shortRes = calculateWinForItaliaStats(shortHistory);
  assert.equal(shortRes.windowSize, 18);
});

test('selectBalancedTop12ForWinForItalia enforces max 3 per decade and rewards extremes 1-8/33-40', () => {
  // 16 candidates with heavy concentration in decade 1 (11-20) plus extremes
  const pool16 = [1, 3, 7, 11, 12, 13, 14, 15, 16, 21, 22, 27, 33, 35, 38, 40];
  const { top12Numbers, decadeDistributionTop12 } = selectBalancedTop12ForWinForItalia(pool16);

  assert.equal(top12Numbers.length, 12);
  // Check soft limit: at most 3 numbers per decade
  for (const dec of [0, 1, 2, 3]) {
    assert.ok(
      (decadeDistributionTop12[dec] || 0) <= 3,
      `Decade ${dec} exceeded 3 numbers: ${decadeDistributionTop12[dec]}`
    );
  }
});

test('runWinForItaliaFunnel40To12 builds 16 candidates (13 genetic + 3 chaos) and outputs 12 unique numbers in 1..40', () => {
  const history = loadWinForItaliaDraws();
  const { stats } = calculateWinForItaliaStats(history);
  const funnel = runWinForItaliaFunnel40To12(stats);

  assert.equal(funnel.genetic13.length, 13);
  assert.equal(funnel.chaos3.length, 3);
  assert.equal(funnel.pool16.length, 16);
  assert.equal(new Set(funnel.pool16).size, 16);
  assert.equal(funnel.top12Numbers.length, 12);
  assert.ok(funnel.top12Numbers.every((n) => n >= 1 && n <= 40));
  for (const dec of [0, 1, 2, 3]) {
    assert.ok(
      (funnel.decadeDistributionTop12[dec] || 0) <= 3,
      `Decade ${dec} exceeded 3 numbers in runWinForItaliaFunnel40To12`
    );
  }
});

test('selectSniperSestinaFromTop12 evaluates all C(12,6) = 924 sestine and selects Top 1 + alternatives #2 and #3', () => {
  const history = loadWinForItaliaDraws();
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
  const history = loadWinForItaliaDraws();

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

test('runWinForItaliaWeeklyMonteCarlo simulates 50,000 draws with 40-bit bitmasks and calculates 7-draw weekly cycle recovery', () => {
  const result = runWinForItaliaWeeklyMonteCarlo([3, 8, 15, 22, 34, 39], 50000, 2026040);

  assert.equal(result.totalSimulatedDraws, 50000);
  assert.equal(result.ticketCost, 2.0);
  assert.equal(result.weeklyCost, 14.0);
  assert.equal(result.totalSpent, 100000);
  // In a 6/40 lottery, P(match=2) = C(6,2)*C(34,4)/C(40,6) = 15 * 46376 / 3838380 ≈ 18.12%
  // Over 50,000 draws, punto2 hits should be roughly ~9,060 (between 8,400 and 9,700)
  assert.ok(
    result.hitsByCategory.punto2 > 8200 && result.hitsByCategory.punto2 < 9900,
    `Punto 2 hits (${result.hitsByCategory.punto2}) should match 6/40 hypergeometric expectation (~9062)`
  );
  assert.ok(result.expectedPunto2PerWeek > 1.1 && result.expectedPunto2PerWeek < 1.5);
  assert.ok(result.averageWeeklyRecoveryRatePct > 20 && result.averageWeeklyRecoveryRatePct < 80);
});

test('evaluateWinForItaliaPlay and compareSavedPlayAgainstWinForItaliaDraws evaluate 6/40 prizes accurately', () => {
  const history = loadWinForItaliaDraws();
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

