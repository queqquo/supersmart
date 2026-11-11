import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runNext100DrawsSimulation,
  calculateWeeklySestineExpectedPnL,
  computeAntiCrowdMultiplier,
  computeAntiCrowdMultiplierFromNumbers,
  generateSmartPoolRecommendation,
  runHistoricalRealBacktest,
  MAX_SIMULATION_DRAWS
} from './monteCarloSimulation';
import { INITIAL_HISTORICAL_DRAWS } from '../data/seedDraws';
import { GeneratedColumn, Draw } from '../types/lottery';

test('runNext100DrawsSimulation simulates 100 official SuperEnalotto draws and creates a high-probability sestina', () => {
  const sampleColumns: GeneratedColumn[] = [
    { id: 1, numbers: [8, 19, 28, 38, 56, 77], sum: 226, evens: 4, odds: 2, lows: 4, highs: 2 },
    { id: 2, numbers: [12, 23, 34, 45, 67, 81], sum: 262, evens: 2, odds: 4, lows: 4, highs: 2 }
  ];

  // Default methodology is now hypergeometric_pure_urn (no data leakage)
  const simResult = runNext100DrawsSimulation(
    INITIAL_HISTORICAL_DRAWS,
    sampleColumns,
    undefined,
    424242
  );

  assert.equal(simResult.methodology, 'hypergeometric_pure_urn');
  assert.equal(simResult.simulatedDraws.length, 100);

  // Verify official 2-urn constraints on every single simulated draw
  for (const d of simResult.simulatedDraws) {
    assert.equal(d.numbers.length, 6);
    const uniqueMain = new Set(d.numbers);
    assert.equal(uniqueMain.size, 6, 'Main 6 numbers must be unique (drawn without replacement)');
    assert.equal(
      uniqueMain.has(d.jolly),
      false,
      'Jolly is 7th ball from primary urn without replacement, cannot equal main 6'
    );
    assert.ok(d.jolly >= 1 && d.jolly <= 90);
    assert.ok(d.superstar !== undefined && d.superstar >= 1 && d.superstar <= 90);
  }

  // Verify high-probability sestina properties
  const hp = simResult.highProbabilitySestina;
  assert.equal(hp.numbers.length, 6);
  assert.equal(new Set(hp.numbers).size, 6);
  assert.ok(hp.sum >= 190 && hp.sum <= 350, `Sum ${hp.sum} should be in [190, 350]`);
  assert.ok(hp.evens >= 2 && hp.evens <= 4);
  assert.ok(hp.lows >= 2 && hp.lows <= 4);
});

test('computeAntiCrowdMultiplier returns low multiplier (~0.75) for popular/crowded draws and high (~1.50-1.65) for dispersed >31 draws', () => {
  // Crowded birthday & consecutive draw in decade 0: [1, 2, 3, 4, 11, 12]
  const crowdedCompact = new Uint8Array([1, 2, 3, 4, 11, 12, 50, 60]);
  const crowdedMult = computeAntiCrowdMultiplier(crowdedCompact, 0);
  assert.ok(crowdedMult >= 0.75 && crowdedMult <= 0.85, `Expected low multiplier, got ${crowdedMult}`);

  // Anti-Massa draw: all > 31, 6 distinct decades, 6 distinct cadences, no consecutives: [32, 43, 54, 65, 76, 87]
  const dispersedCompact = new Uint8Array([32, 43, 54, 65, 76, 87, 10, 20]);
  const dispersedMult = computeAntiCrowdMultiplier(dispersedCompact, 0);
  assert.ok(
    dispersedMult >= 1.45 && dispersedMult <= 1.65,
    `Expected high Anti-Massa multiplier, got ${dispersedMult}`
  );
  assert.ok(dispersedMult > crowdedMult);
});

test('calculateWeeklySestineExpectedPnL computes exact mean of gains and losses with Anti-Crowd multiplier', () => {
  const columns: GeneratedColumn[] = [
    { id: 1, numbers: [10, 20, 30, 40, 50, 60], sum: 210, evens: 6, odds: 0, lows: 4, highs: 2 },
    { id: 2, numbers: [10, 20, 41, 51, 61, 71], sum: 254, evens: 2, odds: 4, lows: 3, highs: 3 },
    { id: 3, numbers: [1, 2, 3, 4, 5, 6], sum: 21, evens: 3, odds: 3, lows: 6, highs: 0 }
  ];

  const draws: Draw[] = [
    {
      id: 'SIM-1',
      contestNumber: 1,
      year: 2026,
      date: '2026-04-01',
      numbers: [10, 20, 30, 75, 80, 89],
      jolly: 90,
      superstar: 15
    },
    {
      id: 'SIM-2',
      contestNumber: 2,
      year: 2026,
      date: '2026-04-03',
      numbers: [7, 14, 28, 55, 66, 88],
      jolly: 45,
      superstar: 22
    }
  ];

  const multDraw1 = computeAntiCrowdMultiplierFromNumbers(draws[0].numbers);
  const expectedPoint3Prize = Number((25.0 * multDraw1).toFixed(2));
  const expectedPoint2Prize = Number((5.0 * multDraw1).toFixed(2));

  const summary = calculateWeeklySestineExpectedPnL(columns, draws, true);
  assert.equal(summary.sestineCount, 3);
  assert.equal(summary.drawsCount, 2);

  // Check individual sestine with dynamic Anti-Crowd multiplier
  assert.equal(summary.perSestinaResults[0].totalGrossGain, expectedPoint3Prize);
  assert.equal(summary.perSestinaResults[1].totalGrossGain, expectedPoint2Prize);
  assert.equal(summary.perSestinaResults[2].totalGrossGain, 0);
  assert.equal(summary.perSestinaResults[2].totalNetProfitLoss, -2);
});

test('generateSmartPoolRecommendation executes Walk-Forward Optimization and returns balanced 10-15 pool', () => {
  for (const size of [10, 12, 15]) {
    const rec = generateSmartPoolRecommendation(INITIAL_HISTORICAL_DRAWS, size);
    assert.equal(rec.poolSize, size);
    assert.equal(rec.recommendedPool.length, size);
    assert.equal(new Set(rec.recommendedPool).size, size);
    const decadesCovered = Object.values(rec.decadeDistribution).filter((cnt) => cnt > 0).length;
    const cadencesCovered = Object.values(rec.cadenceDistribution).filter((cnt) => cnt > 0).length;
    assert.ok(decadesCovered >= 4, `Expected >=4 decades covered, got ${decadesCovered}`);
    assert.ok(cadencesCovered >= 4, `Expected >=4 cadences covered, got ${cadencesCovered}`);
  }
});

test('runHistoricalRealBacktest evaluates generated sestine across real historical archive with Anti-Crowd multiplier', () => {
  const columns: GeneratedColumn[] = [
    { id: 1, numbers: [8, 19, 28, 38, 56, 77], sum: 226, evens: 4, odds: 2, lows: 4, highs: 2 },
    { id: 2, numbers: [12, 23, 34, 45, 67, 81], sum: 262, evens: 2, odds: 4, lows: 4, highs: 2 }
  ];

  const backtest = runHistoricalRealBacktest(columns, INITIAL_HISTORICAL_DRAWS);
  assert.equal(backtest.totalContestsEvaluated, INITIAL_HISTORICAL_DRAWS.length);
  assert.equal(backtest.totalHistoricalCost, INITIAL_HISTORICAL_DRAWS.length * 2);
  assert.ok(backtest.averageAntiCrowdMultiplier >= 0.75 && backtest.averageAntiCrowdMultiplier <= 1.65);
  assert.ok(Array.isArray(backtest.winningContests));
});

test('runNext100DrawsSimulation supports up to 250,000 draws with progress callback and clamping', () => {
  const sampleColumns: GeneratedColumn[] = [
    { id: 1, numbers: [8, 19, 28, 38, 56, 77], sum: 226, evens: 4, odds: 2, lows: 4, highs: 2 }
  ];

  assert.equal(MAX_SIMULATION_DRAWS, 250000);

  let progressCalls = 0;
  const highSim = runNext100DrawsSimulation(
    INITIAL_HISTORICAL_DRAWS,
    sampleColumns,
    'hypergeometric_pure_urn',
    99999,
    45000,
    'terni',
    (completed, total) => {
      progressCalls++;
      assert.equal(total, 45000);
      assert.ok(completed >= 20000 && completed <= 45000);
    }
  );
  assert.equal(highSim.totalSimulatedDrawsCount, 45000);
  assert.ok(progressCalls >= 2, 'Expected progress callback every 20,000 draws');
});
