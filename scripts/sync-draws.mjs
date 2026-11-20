#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Nightly Auto-Sync Script for SuperEnalotto (6/90) and Win for Italia Team (6/40)
 * Invoked by GitHub Actions (.github/workflows/sync-draws.yml) and available for manual CLI execution.
 *
 * - Reuses the exact fetch/parsing logic used by the manual SuperEnalotto sync button
 * - Extends sync to Win for Italia Team (6/40, no Jolly/SuperStar)
 * - Performs idempotent updates to src/data/superenalotto.json and src/data/winforitalia.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SUPERENALOTTO_JSON_PATH = path.join(ROOT_DIR, 'src', 'data', 'superenalotto.json');
const WINFORITALIA_JSON_PATH = path.join(ROOT_DIR, 'src', 'data', 'winforitalia.json');

const SUPERENALOTTO_FEED_URL =
  'https://raw.githubusercontent.com/delpinsky/Superenalotto/main/storico-estrazioni-superenalotto.json';
const SUPERENALOTTO_SISAL_URL =
  'https://www.giochinumerici.info/sisal-gn-proxy-servlet-web/proxy/gntn-info-web/rest/gioco/superenalotto/estrazioni/ultimoconcorso';

const WINFORITALIA_SISAL_URLS = [
  'https://www.giochinumerici.info/sisal-gn-proxy-servlet-web/proxy/gntn-info-web/rest/gioco/sivincetutto/estrazioni/ultimoconcorso',
  'https://www.giochinumerici.info/sisal-gn-proxy-servlet-web/proxy/gntn-info-web/rest/gioco/winforlife/estrazioni/ultimoconcorso'
];

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Sync SuperEnalotto (6/90 + Jolly + SuperStar) idempotently
 */
async function syncSuperEnalotto() {
  const existingData = await readJsonSafe(SUPERENALOTTO_JSON_PATH, {
    exportedAt: new Date(0).toISOString(),
    count: 0,
    draws: []
  });
  const existingDraws = Array.isArray(existingData.draws) ? existingData.draws : [];
  const existingById = new Map(existingDraws.map((d) => [d.id, d]));
  const existingDates = new Set(existingDraws.map((d) => d.date));

  let fetchedDraws = [];

  try {
    const res = await fetch(SUPERENALOTTO_FEED_URL, {
      headers: { 'User-Agent': 'SuperEnalotto-Combinatorial-Optimizer-AutoSync/1.0' }
    });
    if (res.ok) {
      const data = await res.json();
      const rawDraws = Array.isArray(data?.draws)
        ? data.draws.filter((d) => d.date && d.date >= '2026-01-01')
        : [];
      rawDraws.sort((a, b) => a.date.localeCompare(b.date));
      const byYear = {};
      fetchedDraws = rawDraws.map((d) => {
        const year = parseInt(d.date.slice(0, 4), 10);
        byYear[year] = (byYear[year] || 0) + 1;
        const contestNumber =
          typeof d.concorso === 'number' && d.concorso > 0 ? d.concorso : byYear[year];
        const sortedNums = [...d.nums].map(Number).sort((a, b) => a - b);
        return {
          id: `${year}-${String(contestNumber).padStart(3, '0')}`,
          contestNumber,
          year,
          date: d.date,
          numbers: sortedNums,
          jolly: Number(d.jolly) || 1,
          superstar: Number(d.ss) || Number(d.jolly) || 1
        };
      });
    }
  } catch (err) {
    console.warn('[Auto-Sync SuperEnalotto] Warning fetching primary feed:', err.message);
  }

  // Fallback / supplement from Sisal GNTN live endpoint
  try {
    const sisalRes = await fetch(SUPERENALOTTO_SISAL_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SuperEnalotto-AutoSync/1.0)',
        Accept: 'application/json'
      }
    });
    if (sisalRes.ok) {
      const sisalData = await sisalRes.json();
      const conc = sisalData?.concorso || sisalData?.estrazione;
      const estratti = conc?.combinazioneVincente?.estratti || sisalData?.combinazioneVincente?.estratti;
      if (Array.isArray(estratti) && estratti.length >= 6) {
        const rawDate = conc?.dataEstrazione || sisalData?.dataEstrazione || Date.now();
        const isoDate = new Date(rawDate).toISOString().slice(0, 10);
        const year = parseInt(isoDate.slice(0, 4), 10);
        const contestNumber = Number(conc?.numero || conc?.codice || 1);
        const nums = estratti
          .slice(0, 6)
          .map(Number)
          .filter((n) => n >= 1 && n <= 90)
          .sort((a, b) => a - b);
        if (nums.length === 6) {
          fetchedDraws.push({
            id: `${year}-${String(contestNumber).padStart(3, '0')}`,
            contestNumber,
            year,
            date: isoDate,
            numbers: nums,
            jolly: Number(conc?.combinazioneVincente?.jolly || 1),
            superstar: Number(conc?.combinazioneVincente?.superstar || 1)
          });
        }
      }
    }
  } catch {
    // Optional live endpoint
  }

  let addedCount = 0;
  for (const draw of fetchedDraws) {
    if (
      draw &&
      typeof draw.date === 'string' &&
      Array.isArray(draw.numbers) &&
      draw.numbers.length === 6 &&
      !existingById.has(draw.id) &&
      !existingDates.has(draw.date)
    ) {
      existingById.set(draw.id, draw);
      existingDates.add(draw.date);
      addedCount++;
    }
  }

  if (addedCount === 0) {
    console.log('[Auto-Sync SuperEnalotto] Nessuna nuova estrazione trovata (archivio già aggiornato).');
    return false;
  }

  const mergedDraws = Array.from(existingById.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  const nextPayload = {
    exportedAt: new Date().toISOString(),
    count: mergedDraws.length,
    draws: mergedDraws
  };
  await fs.writeFile(SUPERENALOTTO_JSON_PATH, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
  console.log(`[Auto-Sync SuperEnalotto] Aggiunte ${addedCount} nuove estrazioni (totale: ${mergedDraws.length}).`);
  return true;
}

/**
 * Sync Win for Italia Team (6/40, no Jolly/SuperStar) idempotently
 */
async function syncWinForItaliaTeam() {
  const existingData = await readJsonSafe(WINFORITALIA_JSON_PATH, {
    game: 'Win for Italia Team (6/40)',
    exportedAt: new Date(0).toISOString(),
    count: 0,
    draws: []
  });
  const existingDraws = Array.isArray(existingData.draws) ? existingData.draws : [];
  const existingById = new Map(existingDraws.map((d) => [d.id, d]));
  const existingDates = new Set(existingDraws.map((d) => d.date));

  const fetchedDraws = [];

  for (const url of WINFORITALIA_SISAL_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WinForItalia-AutoSync/1.0)',
          Accept: 'application/json'
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const conc = data?.concorso || data?.estrazione || data;
      const estratti =
        conc?.combinazioneVincente?.estratti ||
        data?.combinazioneVincente?.estratti ||
        conc?.numeriEstratti;
      if (Array.isArray(estratti) && estratti.length >= 6) {
        const validNums = Array.from(
          new Set(
            estratti
              .map(Number)
              .filter((n) => Number.isInteger(n) && n >= 1 && n <= 40)
          )
        )
          .slice(0, 6)
          .sort((a, b) => a - b);

        if (validNums.length === 6) {
          const rawDate = conc?.dataEstrazione || data?.dataEstrazione || Date.now();
          const isoDate = new Date(rawDate).toISOString().slice(0, 10);
          const year = parseInt(isoDate.slice(0, 4), 10);
          const maxContestInYear = existingDraws
            .filter((d) => d.year === year)
            .reduce((max, d) => Math.max(max, Number(d.contestNumber) || 0), 0);
          const contestNumber =
            Number(conc?.numero || conc?.codice) || maxContestInYear + 1;
          fetchedDraws.push({
            id: `WFI-${year}-${String(contestNumber).padStart(3, '0')}`,
            contestNumber,
            year,
            date: isoDate,
            numbers: validNums
          });
        }
      }
    } catch {
      // Continue trying fallback endpoint
    }
  }

  let addedCount = 0;
  for (const draw of fetchedDraws) {
    if (
      draw &&
      typeof draw.date === 'string' &&
      Array.isArray(draw.numbers) &&
      draw.numbers.length === 6 &&
      draw.numbers.every((n) => n >= 1 && n <= 40) &&
      !existingById.has(draw.id) &&
      !existingDates.has(draw.date)
    ) {
      existingById.set(draw.id, draw);
      existingDates.add(draw.date);
      addedCount++;
    }
  }

  if (addedCount === 0) {
    console.log('[Auto-Sync Win for Italia Team] Nessuna nuova estrazione trovata (archivio già aggiornato).');
    return false;
  }

  const mergedDraws = Array.from(existingById.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  const nextPayload = {
    game: 'Win for Italia Team (6/40)',
    exportedAt: new Date().toISOString(),
    count: mergedDraws.length,
    draws: mergedDraws
  };
  await fs.writeFile(WINFORITALIA_JSON_PATH, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
  console.log(`[Auto-Sync Win for Italia Team] Aggiunte ${addedCount} nuove estrazioni (totale: ${mergedDraws.length}).`);
  return true;
}

async function main() {
  console.log('=== Avvio Auto-Sync Estrazioni (SuperEnalotto + Win for Italia Team 6/40) ===');
  const seUpdated = await syncSuperEnalotto();
  const wfiUpdated = await syncWinForItaliaTeam();
  console.log(
    `=== Fine Auto-Sync (Modificati: SuperEnalotto=${seUpdated}, WinForItaliaTeam=${wfiUpdated}) ===`
  );
}

main().catch((err) => {
  console.error('Errore fatale in sync-draws.mjs:', err);
  process.exitCode = 1;
});
