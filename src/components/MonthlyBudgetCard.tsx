import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';
import type { SavedPlay } from '../types/lottery';
import { loadMonthlyBudget, saveMonthlyBudget, summarizeMonthlySpending } from '../utils/monthlyBudget';

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const monthName = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });

export function MonthlyBudgetCard({ plays }: { plays: readonly SavedPlay[] }) {
  const [budget, setBudget] = useState(loadMonthlyBudget);
  const [draft, setDraft] = useState(String(budget));
  const summary = useMemo(() => summarizeMonthlySpending(plays, budget), [plays, budget]);
  const pct = Math.min(100, Math.round(summary.ratio * 100));

  function commit() {
    const value = Number(draft.replace(',', '.'));
    if (Number.isFinite(value) && value > 0 && value <= 10000) {
      const rounded = Math.round(value * 100) / 100;
      setBudget(rounded);
      saveMonthlyBudget(rounded);
      setDraft(String(rounded));
    } else {
      setDraft(String(budget));
    }
  }

  const tone = summary.level === 'over'
    ? { box: 'border-rose-700 bg-rose-950/40', bar: 'bg-rose-500', text: 'text-rose-100' }
    : summary.level === 'near'
      ? { box: 'border-amber-600 bg-amber-950/40', bar: 'bg-amber-400', text: 'text-amber-100' }
      : { box: 'border-emerald-800 bg-emerald-950/30', bar: 'bg-emerald-400', text: 'text-emerald-100' };

  return (
    <section aria-labelledby="monthly-budget-heading" data-testid="monthly-budget" className={`space-y-3 rounded-xl border p-4 ${tone.box}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="monthly-budget-heading" className="flex items-center gap-2 text-sm font-bold text-white">
            <Wallet aria-hidden="true" className="h-4 w-4" /> Budget di {monthName.format(new Date())}
          </h3>
          <p className="text-xs text-slate-300">Somma delle giocate registrate questo mese, di tutti i giochi.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-200">
          Budget mensile (€)
          <input
            type="number" inputMode="decimal" min={1} max={10000} step={1}
            value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            data-testid="monthly-budget-input"
            className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-right font-mono text-white"
          />
        </label>
      </div>
      <p className="font-mono text-lg font-bold text-white" data-testid="monthly-budget-spent">
        {euro.format(summary.spent)} <span className="text-sm font-normal text-slate-300">su {euro.format(summary.budget)} · {summary.playsCount} {summary.playsCount === 1 ? 'giocata' : 'giocate'}</span>
      </p>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Budget mensile usato" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <p role="status" data-testid="monthly-budget-status" className={`flex items-start gap-2 text-xs ${tone.text}`}>
        {summary.level === 'ok'
          ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          : <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {summary.level === 'over'
            ? `Hai superato il budget di ${euro.format(-summary.remaining)}. Valuta di fermarti fino al mese prossimo.`
            : summary.remaining <= 0
              ? 'Hai raggiunto il budget del mese. Le prossime giocate lo supererebbero.'
              : summary.level === 'near'
                ? `Sei vicino al limite: restano ${euro.format(summary.remaining)}.`
                : `Restano ${euro.format(summary.remaining)} questo mese.`}
        </span>
      </p>
    </section>
  );
}
