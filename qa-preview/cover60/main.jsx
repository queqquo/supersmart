import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SystemGenerator } from '../../src/components/SystemGenerator';
import { DEFAULT_FILTERS, DEFAULT_WEIGHTS } from '../../src/utils/storage';
import '../preview.css';

const archiveSize = new URLSearchParams(window.location.search).get('archivio');
const demoAccount = new URLSearchParams(window.location.search).get('account') === 'altro' ? 'altro@example.org' : 'demo@example.org';
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
  const [inGenerator, setInGenerator] = useState(true);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
      <p className="rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-300">
        <strong className="text-white">Anteprima Supersmart</strong> · Le estrazioni sono dimostrative. {__HOSTED_QA_PREVIEW__
          ? 'Il salvataggio è simulato durante la visita: si azzera ricaricando l’anteprima.'
          : 'Il salvataggio del sistema è simulato in questo browser, senza Firebase.'}
      </p>
      <div role="group" aria-label="Sezioni dimostrative" className="flex gap-2">
        <button type="button" aria-pressed={inGenerator} className="rounded-lg border border-slate-700 px-3 py-2" onClick={() => setInGenerator(true)}>Generatore</button>
        <button type="button" aria-pressed={!inGenerator} className="rounded-lg border border-slate-700 px-3 py-2" onClick={() => setInGenerator(false)}>Verifica & Bilancio</button>
      </div>
      {inGenerator && <SystemGenerator userEmail={demoAccount} draws={draws} savedPlays={plays} weights={weights} filters={filters}
        onUpdateWeights={setWeights} onUpdateFilters={setFilters} onOpenSmartPaste={() => {}}
        onSavePlay={play => setPlays(items => [...items, play])} />}
      <section hidden={inGenerator} className="rounded-xl border border-slate-700 p-4">
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
