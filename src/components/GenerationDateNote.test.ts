import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGenerationDate } from './GenerationDateNote';

test('generation date is shown in Italian, Italian time, with weekday and year', () => {
  assert.equal(formatGenerationDate('2026-11-21T09:32:00.000Z'), 'sabato 21 novembre 2026 alle 10:32');
  assert.equal(formatGenerationDate(null), null);
  assert.equal(formatGenerationDate('garbage'), null);
});
