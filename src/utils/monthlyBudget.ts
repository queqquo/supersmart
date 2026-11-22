import type { SavedPlay } from '../types/lottery';

export const DEFAULT_MONTHLY_BUDGET = 40;
export const BUDGET_WARNING_RATIO = 0.8;
const BUDGET_STORAGE_KEY = 'supersmart_monthly_budget_v1';

const monthKeyFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Europe/Rome' });

/** "2026-11" for a date, using Italian time so late-evening plays fall in the right month. */
export function romeMonthKey(date: Date): string {
  const parts = monthKeyFormatter.formatToParts(date);
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}`;
}

export type BudgetLevel = 'ok' | 'near' | 'over';

export interface MonthlyBudgetSummary {
  monthKey: string;
  spent: number;
  playsCount: number;
  budget: number;
  remaining: number;
  ratio: number;
  level: BudgetLevel;
}

/** Sums the cost of every play registered in the current month (Italian time), all games included. */
export function summarizeMonthlySpending(plays: readonly SavedPlay[], budget: number, now = new Date()): MonthlyBudgetSummary {
  const monthKey = romeMonthKey(now);
  let spent = 0;
  let playsCount = 0;
  for (const play of plays) {
    const created = new Date(play.createdAt);
    if (Number.isNaN(created.getTime()) || romeMonthKey(created) !== monthKey) continue;
    if (!Number.isFinite(play.cost) || play.cost <= 0) continue;
    spent += play.cost;
    playsCount++;
  }
  spent = Math.round(spent * 100) / 100;
  const ratio = budget > 0 ? spent / budget : 0;
  const level: BudgetLevel = spent >= budget ? (spent > budget ? 'over' : 'near') : ratio >= BUDGET_WARNING_RATIO ? 'near' : 'ok';
  return { monthKey, spent, playsCount, budget, remaining: Math.round((budget - spent) * 100) / 100, ratio, level };
}

export function loadMonthlyBudget(): number {
  try {
    const value = Number(localStorage.getItem(BUDGET_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 && value <= 10000 ? value : DEFAULT_MONTHLY_BUDGET;
  } catch {
    return DEFAULT_MONTHLY_BUDGET;
  }
}

export function saveMonthlyBudget(value: number): void {
  try {
    localStorage.setItem(BUDGET_STORAGE_KEY, String(value));
  } catch {
    // The budget still applies for this visit.
  }
}
