import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SystemGenerator } from '../../src/components/SystemGenerator';
import { DEFAULT_FILTERS, DEFAULT_WEIGHTS } from '../../src/utils/storage';
import '../preview.css';

const archiveSize = new URLSearchParams(window.location.search).get('archivio');
const draws = Array.from({ length: archiveSize === 'breve' ? 3 : archiveSize === 'minimo' ? 2 : 40 }, (_, i) => ({
  id: `2026-${185 - i}`,
  contestNumber: 185 - i,
  year: 2026,
  date: new Date(Date.UTC(2026, 10, 19 - i * (archiveSize === 'minimo' ? 731 : 19))).toISOString().slice(0, 10),
  numbers: Array.from({ length: 6 }, (_, j) => 1 + (i * 13 + j * 17) % 90).sort((a, b) => a - b),
  jolly: 2,
  superstar: 8,
}));

function Preview() {
  const [plays, setPlays] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
      <p className="rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-300">
        <strong className="text-white">Anteprima Supersmart</strong> · Apri «Copertura 60 · 10 €» nel generatore. Le estrazioni sono dimostrative e il registro non salva dati su Firebase.
      </p>
      <SystemGenerator userEmail="demo@example.org" draws={draws} savedPlays={plays} weights={weights} filters={filters}
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
