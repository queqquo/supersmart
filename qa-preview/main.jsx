import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WinForItaliaLab } from '../src/components/WinForItaliaLab';
import './preview.css';

const fixtureDraws = [{
  id: 'WFI-2026-001', contestNumber: 1, year: 2026, date: '2026-11-19',
  time: '20:00', numbers: [2, 11, 14, 25, 31, 38]
}];

function Preview() {
  const [draws, setDraws] = useState(fixtureDraws);
  const [plays, setPlays] = useState([]);
  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
      <p className="text-sm text-slate-300 border border-slate-700 rounded-xl px-4 py-3">
        <strong className="text-white">Anteprima Supersmart</strong> · Dati dimostrativi, azzerati al ricaricamento. Nessuna connessione a Firebase e nessuna giocata reale.
      </p>
      <WinForItaliaLab userEmail="demo@example.org" draws={draws} onUpdateDraws={setDraws}
        onSavePlay={play => setPlays(items => [...items, play])} />
      <section className="rounded-xl border border-slate-700 p-4">
        <h2 className="font-bold">Registro dimostrativo</h2>
        {plays.length ? (
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {plays.map((play, i) => (
              <li key={`${play.id}-${i}`} data-testid="preview-registered-play">
                {play.columns.length} colonne · {play.poolNumbers.length} numeri nella rosa · {play.cost.toLocaleString('it-IT', {style:'currency', currency:'EUR'})}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-400">Nessuna registrazione in questa sessione.</p>}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Preview />);
