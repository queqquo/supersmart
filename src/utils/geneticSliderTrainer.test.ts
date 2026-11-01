/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crossoverTripletMean,
  runEvolutionarySliderTraining
} from './geneticSliderTrainer';
import { INITIAL_HISTORICAL_DRAWS, generateFullHistoricalDataset } from '../data/seedDraws';

test('crossoverTripletMean calculates exact arithmetic mean (w1,1+w1,2)/2 for all 3 slider parameters', () => {
  const parent1 = { w1: 0.8, w2: 0.4, w3: 0.2 };
  const parent2 = { w1: 0.4, w2: 0.6, w3: 0.5 };

  const child = crossoverTripletMean(parent1, parent2);

  assert.equal(child.w1, 0.6); // (0.8 + 0.4) / 2
  assert.equal(child.w2, 0.5); // (0.4 + 0.6) / 2
  assert.equal(child.w3, 0.35); // (0.2 + 0.5) / 2
});

test('runEvolutionarySliderTraining trains n1 triplets on n2 draws over n3 generations, excludes losing triplets, and restores n1 via pairwise mean crossover', () => {
  const n1 = 16;
  const n2 = 40;
  const n3 = 6;

  const result = runEvolutionarySliderTraining(
    INITIAL_HISTORICAL_DRAWS,
    n1,
    n2,
    n3,
    202605
  );

  assert.equal(result.n1TripletsCount, n1);
  assert.equal(result.n2TrainingDraws, n2);
  assert.equal(result.n3GenerationsCount, n3);
  assert.equal(result.generations.length, n3);

  for (const gen of result.generations) {
    // Population size is restored to n1 in every generation
    assert.equal(gen.evaluatedTriplets.length, n1);
    assert.equal(gen.drawsTrainedN2, n2);

    // Every surviving triplet must be strictly in positive profit (netProfitLoss > 0)
    assert.ok(gen.winningSurvivors.length >= 2, 'At least 2 winning triplets must survive');
    assert.ok(gen.excludedLosingCount > 0, 'Losing triplets must be excluded in every generation');
    assert.ok(gen.generatedOffspring.length > 0, 'New triplets must be generated from winning pairs');

    for (const survivor of gen.winningSurvivors) {
      assert.ok(
        survivor.netProfitLoss > 0,
        `Survivor ${survivor.id} must have netProfitLoss > 0, got ${survivor.netProfitLoss}`
      );
      assert.equal(survivor.isWinning, true);
    }

    // Offspring count + survivors count must equal n1
    assert.equal(
      gen.winningSurvivors.length + gen.generatedOffspring.length,
      n1
    );

    // Verify each generated child triplet equals the exact mean of its two winning parent triplets
    for (const childRec of gen.generatedOffspring) {
      const expectedMean = crossoverTripletMean(childRec.parent1, childRec.parent2);
      assert.equal(childRec.child.w1, expectedMean.w1);
      assert.equal(childRec.child.w2, expectedMean.w2);
      assert.equal(childRec.child.w3, expectedMean.w3);
    }
  }

  // Top winning triplets must be sorted descending by highest profit / gross win value
  assert.ok(result.topWinningTriplets.length > 0);
  for (let i = 0; i < result.topWinningTriplets.length; i++) {
    assert.ok(result.topWinningTriplets[i].netProfitLoss > 0);
    if (i > 0) {
      const prevGross =
        result.topWinningTriplets[i - 1].rawHistoricalGrossWin ??
        result.topWinningTriplets[i - 1].totalGrossGain;
      const currGross =
        result.topWinningTriplets[i].rawHistoricalGrossWin ??
        result.topWinningTriplets[i].totalGrossGain;
      assert.ok(prevGross >= currGross);
    }
  }
});

test('runEvolutionarySliderTraining defaults n2TrainingDraws to all 2,946 official draws from 2009 to today', () => {
  const fullArchive = generateFullHistoricalDataset();
  assert.equal(fullArchive.length, 2946);
  const fullRes = runEvolutionarySliderTraining(
    fullArchive,
    12,
    fullArchive.length,
    4,
    202605
  );
  assert.equal(fullRes.n2TrainingDraws, 2946);
  assert.equal(fullRes.generations[0].drawsTrainedN2, 2946);
  assert.ok((fullRes.bestOverallTriplet.rawHistoricalGrossWin ?? 0) > 17676);
});

