import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runNext100DrawsSimulation,
  calculateWeeklySestineExpectedPnL,
  evaluateSingleSestinaPnL
} from './monteCarloSimulation';
import { INITIAL_HISTORICAL_DRAWS } from '../data/seedDraws';
import { GeneratedColumn, Draw } from '../types/lottery';

test('runNext100DrawsSimulation simulates 100 official SuperEnalotto draws and creates a high-probability sestina', () => {
  const sampleColumns: GeneratedColumn[] = [
    { id: 1, numbers: [8, 19, 28, 38, 56, 77], sum: 226, evens: 4, odds: 2, lows: 4, highs: 2 },
    { id: 2, numbers: [12, 23, 34, 45, 67, 81], sum: 262, evens: 2, odds: 4, lows: 4, highs: 2 }
  ];

  const simResult = runNext100DrawsSimulation(
    INITIAL_HISTORICAL_DRAWS,
    sampleColumns,
    'bayesian_hybrid_urn',
    424242
  );

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

test('calculateWeeklySestineExpectedPnL computes exact mean of gains and losses across each single sestina', () => {
  const columns: GeneratedColumn[] = [
    // Column 1 will match 3 numbers on Draw 1 (prize = 25€) and 0 on Draw 2 (prize = 0€)
    // Total cost = 2€, Total gain = 25€, Total unrecovered loss = 1€ (from Draw 2), Net = +23€
    { id: 1, numbers: [10, 20, 30, 40, 50, 60], sum: 210, evens: 6, odds: 0, lows: 4, highs: 2 },
    // Column 2 will match 2 numbers on Draw 1 (prize = 5€) and 0 on Draw 2 (prize = 0€)
    // Total cost = 2€, Total gain = 5€, Total unrecovered loss = 1€ (from Draw 2), Net = +3€
    { id: 2, numbers: [10, 20, 41, 51, 61, 71], sum: 254, evens: 2, odds: 4, lows: 3, highs: 3 },
    // Column 3 will match 0 on both draws
    // Total cost = 2€, Total gain = 0€, Total unrecovered loss = 2€, Net = -2€
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

  const summary = calculateWeeklySestineExpectedPnL(columns, draws);
  assert.equal(summary.sestineCount, 3);
  assert.equal(summary.drawsCount, 2);

  // Check individual sestine
  assert.equal(summary.perSestinaResults[0].totalGrossGain, 25);
  assert.equal(summary.perSestinaResults[0].totalNetProfitLoss, 23);

  assert.equal(summary.perSestinaResults[1].totalGrossGain, 5);
  assert.equal(summary.perSestinaResults[1].totalNetProfitLoss, 3);

  assert.equal(summary.perSestinaResults[2].totalGrossGain, 0);
  assert.equal(summary.perSestinaResults[2].totalNetProfitLoss, -2);

  // Check arithmetic mean across the 3 sestine:
  // Mean Gain = (25 + 5 + 0) / 3 = 10.00 €
  assert.equal(summary.meanTotalGainPerSestina, 10);
  // Mean Unrecovered Loss = (1 + 1 + 2) / 3 = 1.33 €
  assert.equal(summary.meanTotalLossPerSestina, 1.33);
  // Mean Net Profit/Loss per Sestina = (23 + 3 - 2) / 3 = 8.00 €
  assert.equal(summary.meanNetProfitLossPerSestina, 8);
  // Mean Single Draw Net per Sestina = 8.00 / 2 = 4.00 €
  assert.equal(summary.meanSingleDrawNetPerSestina, 4);
});
