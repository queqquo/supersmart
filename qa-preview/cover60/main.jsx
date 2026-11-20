import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SystemGenerator } from '../../src/components/SystemGenerator';
import { DEFAULT_FILTERS, DEFAULT_WEIGHTS } from '../../src/utils/storage';
import '../preview.css';

const draws = [{
  id: '2026-185',
  contestNumber: 185,
  year: 2026,
  date: '2026-11-19',
  numbers: [22, 38, 54, 61, 68, 75],
  jolly: 2,
  superstar: 8,
}];

function Preview() {
  const [plays, setPlays] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
      <p className="rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-300">
        <strong className="text-white">Anteprima Supersmart</strong> · Apri «Copertura 60 · 10 €» nel generatore. Il registro è dimostrativo e non salva dati su Firebase.
      </p>
      <SystemGenerator userEmail="demo@example.org" draws={draws} weights={weights} filters={filters}
        onUpdateWeights={setWeights} onUpdateFilters={setFilters} onOpenSmartPaste={() => {}}
        onSavePlay={play => setPlays(items => [...items, play])} />
      <section className="rounded-xl border border-slate-700 p-4">
        <h2 className="font-bold">Registro dimostrativo</h2>
        {plays.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {plays.map(play => (
              <li key={play.id} data-testid="demo-registered">{play.columns.length} colonne · {new Set(play.poolNumbers).size} numeri distinti · {play.cost.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-400">Nessuna registrazione in questa sessione.</p>}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Preview />);
