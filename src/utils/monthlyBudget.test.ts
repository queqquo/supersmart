import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SavedPlay } from '../types/lottery';
import { romeMonthKey, summarizeMonthlySpending } from './monthlyBudget';

const play = (createdAt: string, cost: number) => ({ id: createdAt + cost, createdAt, cost } as SavedPlay);
const now = new Date('2026-11-22T10:00:00Z');

test('month key uses Italian time', () => {
  assert.equal(romeMonthKey(new Date('2026-10-31T23:30:00Z')), '2026-11');
  assert.equal(romeMonthKey(new Date('2026-11-30T22:59:00Z')), '2026-11');
});

test('only plays of the current month count, with warning and over levels', () => {
  const plays = [play('2026-11-03T18:00:00Z', 10), play('2026-11-21T18:00:00Z', 10), play('2026-10-28T18:00:00Z', 10), play('bad', 10)];
  const s = summarizeMonthlySpending(plays, 40, now);
  assert.deepEqual([s.spent, s.playsCount, s.remaining, s.level], [20, 2, 20, 'ok']);
  assert.equal(summarizeMonthlySpending([...plays, play('2026-11-14T18:00:00Z', 12)], 40, now).level, 'near');
  assert.equal(summarizeMonthlySpending([...plays, play('2026-11-14T18:00:00Z', 20)], 40, now).level, 'near');
  const over = summarizeMonthlySpending([...plays, play('2026-11-14T18:00:00Z', 25)], 40, now);
  assert.deepEqual([over.level, over.remaining], ['over', -5]);
});
