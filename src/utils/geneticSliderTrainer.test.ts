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
import { Draw } from '../types/lottery';

const SAMPLE_REAL_DRAWS: Draw[] = Array.from({ length: 40 }, (_, i) => ({
  id: `2026-${String(40 - i).padStart(3, '0')}`,
  contestNumber: 40 - i,
  year: 2026,
  date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
  numbers: [
    ((i * 3) % 15) + 1,
    ((i * 5) % 15) + 16,
    ((i * 7) % 15) + 31,
    ((i * 11) % 15) + 46,
    ((i * 13) % 15) + 61,
    ((i * 17) % 15) + 76
  ],
  jolly: ((i * 19) % 15) + 1,
  superstar: ((i * 23) % 90) + 1
}));

test('crossoverTripletMean calculates exact arithmetic mean (w1,1+w1,2)/2 for all 3 slider parameters', () => {
  const parent1 = { w1: 0.8, w2: 0.4, w3: 0.2 };
  const parent2 = { w1: 0.4, w2: 0.6, w3: 0.5 };

  const child = crossoverTripletMean(parent1, parent2);

  assert.equal(child.w1, 0.6); // (0.8 + 0.4) / 2
  assert.equal(child.w2, 0.5); // (0.4 + 0.6) / 2
  assert.equal(child.w3, 0.35); // (0.2 + 0.5) / 2
});

test('runEvolutionarySliderTraining trains n1 triplets on n2 real draws over n3 generations, excludes losing triplets, and restores n1 via pairwise mean crossover', () => {
  const n1 = 16;
  const n2 = 40;
  const n3 = 6;

  const result = runEvolutionarySliderTraining(
    SAMPLE_REAL_DRAWS,
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
    assert.equal(gen.evaluatedTriplets.length, n1);
    assert.equal(gen.drawsTrainedN2, n2);
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

    assert.equal(
      gen.winningSurvivors.length + gen.generatedOffspring.length,
      n1
    );

    for (const childRec of gen.generatedOffspring) {
      const expectedMean = crossoverTripletMean(childRec.parent1, childRec.parent2);
      assert.equal(childRec.child.w1, expectedMean.w1);
      assert.equal(childRec.child.w2, expectedMean.w2);
      assert.equal(childRec.child.w3, expectedMean.w3);
    }
  }

  assert.ok(result.topWinningTriplets.length > 0);
});
