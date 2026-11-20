/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vercel Serverless API for External GitHub Draw Archive Persistence & Live Official Sync.
 * Supports:
 *   - game=superenalotto (SuperEnalotto 6/90 + Jolly + SuperStar)
 *   - game=winforitalia  (Win for Italia Team / Win for Life 6/40 • Ore 20:00)
 *
 * Reads from external public GitHub repo (queqquo/supersmart-storico-estrazioni) so
 * the app repository stays lightweight for Google AI Studio.
 * When GITHUB_TOKEN (or DRAWS_GITHUB_TOKEN) is set in Vercel env vars, POST updates
 * commit directly back to the external GitHub repository.
 */

const REPO_OWNER = process.env.EXTERNAL_DRAWS_REPO_OWNER || 'queqquo';
const REPO_NAME = process.env.EXTERNAL_DRAWS_REPO_NAME || 'supersmart-storico-estrazioni';
const REPO_BRANCH = process.env.EXTERNAL_DRAWS_REPO_BRANCH || 'main';
const GITHUB_TOKEN = process.env.DRAWS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';

const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

const GAME_FILES = {
  superenalotto: {
    path: 'data/superenalotto.json',
    label: 'SuperEnalotto (6/90)'
  },
  winforitalia: {
    path: 'data/winforitalia.json',
    label: 'Win for Italia Team / Win for Life (6/40)'
  }
};

const SUPERENALOTTO_FEED_URL =
  'https://raw.githubusercontent.com/delpinsky/Superenalotto/main/storico-estrazioni-superenalotto.json';

const IT_MONTHS = {
  gen: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  mag: '05',
  giu: '06',
  lug: '07',
  ago: '08',
  set: '09',
  ott: '10',
  nov: '11',
  dic: '12'
};

function normalizeSuperEnalottoDraw(d) {
  if (!d || typeof d !== 'object') return null;
  const dateStr = String(d.date || d.data || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr < '2009-01-01') return null;

  const rawNums = Array.isArray(d.numbers)
    ? d.numbers
    : Array.isArray(d.nums)
    ? d.nums
    : Array.isArray(d.sestina)
    ? d.sestina
    : null;
  if (!rawNums || rawNums.length !== 6) return null;

  const nums = rawNums.map(Number).sort((a, b) => a - b);
  if (new Set(nums).size !== 6 || nums.some((n) => !Number.isInteger(n) || n < 1 || n > 90)) {
    return null;
  }

  const jolly = Number(d.jolly);
  if (!Number.isInteger(jolly) || jolly < 1 || jolly > 90 || nums.includes(jolly)) return null;

  const rawSs = d.superstar !== undefined ? d.superstar : d.ss;
  let superstar;
  if (rawSs !== undefined && rawSs !== null && String(rawSs).trim() !== '') {
    const ssNum = Number(rawSs);
    if (Number.isInteger(ssNum) && ssNum >= 1 && ssNum <= 90) {
      superstar = ssNum;
    }
  }

  const year = parseInt(dateStr.slice(0, 4), 10);
  let contestNumber = Number(d.contestNumber || d.concorso || 0);
  if (!Number.isInteger(contestNumber) || contestNumber <= 0) {
    if (typeof d.id === 'string' && d.id.includes('-')) {
      contestNumber = parseInt(d.id.split('-')[1], 10);
    }
  }
  if (!Number.isInteger(contestNumber) || contestNumber <= 0) return null;

  const out = {
    id: `${year}-${String(contestNumber).padStart(3, '0')}`,
    contestNumber,
    year,
    date: dateStr,
    numbers: nums,
    jolly
  };
  if (superstar !== undefined) out.superstar = superstar;
  return out;
}

function normalizeWinForItaliaDraw(d) {
  if (!d || typeof d !== 'object') return null;
  const dateStr = String(d.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

  const rawNums = Array.isArray(d.numbers) ? d.numbers : null;
  if (!rawNums || rawNums.length !== 6) return null;

  const nums = rawNums.map(Number).sort((a, b) => a - b);
  if (new Set(nums).size !== 6 || nums.some((n) => !Number.isInteger(n) || n < 1 || n > 40)) {
    return null;
  }

  const year = parseInt(dateStr.slice(0, 4), 10);
  let contestNumber = Number(d.contestNumber || d.concorso || 0);
  if (!Number.isInteger(contestNumber) || contestNumber <= 0) {
    if (typeof d.id === 'string') {
      const m = d.id.match(/(\d+)$/);
      if (m) contestNumber = parseInt(m[1], 10);
    }
  }
  if (!Number.isInteger(contestNumber) || contestNumber <= 0) return null;

  return {
    id: `WFI-${year}-${String(contestNumber).padStart(3, '0')}`,
    contestNumber,
    year,
    date: dateStr,
    time: String(d.time || '20:00'),
    numbers: nums
  };
}

function mergeSuperEnalotto(baseList, incomingList) {
  const byDate = new Map();
  for (const item of baseList || []) {
    const norm = normalizeSuperEnalottoDraw(item);
    if (norm) byDate.set(norm.date, norm);
  }
  const prevKeys = new Set(
    Array.from(byDate.values()).map((d) => `${d.date}|${d.id}|${d.numbers.join(',')}|${d.jolly}|${d.superstar ?? ''}`)
  );

  for (const item of incomingList || []) {
    const norm = normalizeSuperEnalottoDraw(item);
    if (!norm) continue;
    const prev = byDate.get(norm.date);
    if (!prev) {
      byDate.set(norm.date, norm);
    } else if (norm.superstar !== undefined && prev.superstar === undefined) {
      byDate.set(norm.date, norm);
    } else if (prev.numbers.join(',') !== norm.numbers.join(',') || prev.jolly !== norm.jolly) {
      byDate.set(norm.date, norm);
    }
  }

  const merged = Array.from(byDate.values()).sort((a, b) => {
    const cmp = b.date.localeCompare(a.date);
    return cmp !== 0 ? cmp : b.contestNumber - a.contestNumber;
  });

  let addedOrUpdated = 0;
  for (const d of merged) {
    const sig = `${d.date}|${d.id}|${d.numbers.join(',')}|${d.jolly}|${d.superstar ?? ''}`;
    if (!prevKeys.has(sig)) addedOrUpdated++;
  }
  return { draws: merged, addedOrUpdated };
}

function mergeWinForItalia(baseList, incomingList) {
  const byDate = new Map();
  for (const item of baseList || []) {
    const norm = normalizeWinForItaliaDraw(item);
    if (norm) byDate.set(norm.date, norm);
  }
  const prevKeys = new Set(
    Array.from(byDate.values()).map((d) => `${d.date}|${d.id}|${d.numbers.join(',')}`)
  );

  for (const item of incomingList || []) {
    const norm = normalizeWinForItaliaDraw(item);
    if (norm) byDate.set(norm.date, norm);
  }

  const merged = Array.from(byDate.values()).sort((a, b) => {
    const cmp = b.date.localeCompare(a.date);
    return cmp !== 0 ? cmp : b.contestNumber - a.contestNumber;
  });

  let addedOrUpdated = 0;
  for (const d of merged) {
    const sig = `${d.date}|${d.id}|${d.numbers.join(',')}`;
    if (!prevKeys.has(sig)) addedOrUpdated++;
  }
  return { draws: merged, addedOrUpdated };
}

async function readExternalGithubFile(filePath) {
  // Prefer GitHub Contents API when token is set (bypasses raw CDN cache and returns SHA for writes)
  if (GITHUB_TOKEN) {
    try {
      const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${REPO_BRANCH}`;
      const res = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'SuperSmart-Vercel-Draws-API/1.0'
        }
      });
      if (res.ok) {
        const meta = await res.json();
        let rawText = '';
        if (meta.content && meta.encoding === 'base64') {
          rawText = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf8');
        } else if (meta.download_url) {
          const dl = await fetch(meta.download_url, {
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
          });
          if (dl.ok) rawText = await dl.text();
        }
        if (rawText) {
          const parsed = JSON.parse(rawText);
          return {
            draws: Array.isArray(parsed) ? parsed : Array.isArray(parsed?.draws) ? parsed.draws : [],
            sha: meta.sha || null,
            source: 'github-api'
          };
        }
      }
    } catch {
      // Fallback to raw URL below
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${filePath}?t=${Date.now()}`;
  const rawRes = await fetch(rawUrl, {
    headers: { 'User-Agent': 'SuperSmart-Vercel-Draws-API/1.0', 'Cache-Control': 'no-cache' }
  });
  if (!rawRes.ok) {
    return { draws: [], sha: null, source: 'github-raw-empty' };
  }
  const parsed = await rawRes.json();
  return {
    draws: Array.isArray(parsed) ? parsed : Array.isArray(parsed?.draws) ? parsed.draws : [],
    sha: null,
    source: 'github-raw'
  };
}

async function writeExternalGithubFile(filePath, payload, existingSha, commitMessage) {
  if (!GITHUB_TOKEN) {
    return { persisted: false, reason: 'GITHUB_TOKEN non configurato su Vercel' };
  }

  let sha = existingSha;
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  if (!sha) {
    try {
      const checkRes = await fetch(`${apiUrl}?ref=${REPO_BRANCH}`, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'SuperSmart-Vercel-Draws-API/1.0'
        }
      });
      if (checkRes.ok) {
        const meta = await checkRes.json();
        sha = meta.sha || undefined;
      }
    } catch {
      // File may not exist yet
    }
  }

  const jsonContent =
    filePath.includes('superenalotto')
      ? `${JSON.stringify(payload)}\n`
      : `${JSON.stringify(payload, null, 2)}\n`;

  const body = {
    message: commitMessage,
    content: Buffer.from(jsonContent, 'utf8').toString('base64'),
    branch: REPO_BRANCH
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'SuperSmart-Vercel-Draws-API/1.0'
    },
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    return { persisted: false, reason: `GitHub HTTP ${putRes.status}: ${errText.slice(0, 180)}` };
  }

  const result = await putRes.json();
  return {
    persisted: true,
    commitSha: result?.commit?.sha || null
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveSuperEnalottoDraws() {
  const results = [];
  try {
    const res = await fetchWithTimeout(`${SUPERENALOTTO_FEED_URL}?t=${Date.now()}`, {
      headers: { 'User-Agent': 'SuperSmart-Vercel-Draws-API/1.0' }
    }, 7000);
    if (res.ok) {
      const data = await res.json();
      const rawDraws = Array.isArray(data?.draws)
        ? data.draws.filter((x) => x && x.date && x.date >= '2009-01-01')
        : [];
      rawDraws.sort((a, b) => a.date.localeCompare(b.date));
      const byYear = {};
      for (const x of rawDraws) {
        const y = parseInt(x.date.slice(0, 4), 10);
        byYear[y] = (byYear[y] || 0) + 1;
        const cn = typeof x.concorso === 'number' && x.concorso > 0 ? x.concorso : byYear[y];
        const norm = normalizeSuperEnalottoDraw({
          date: x.date,
          contestNumber: cn,
          numbers: x.nums,
          jolly: x.jolly,
          superstar: x.ss
        });
        if (norm) results.push(norm);
      }
    }
  } catch {
    // Ignore transient feed errors
  }

  // Live HTML fallback from estrazionilotterie.it for the very latest evening draws (short timeout)
  try {
    const res = await fetchWithTimeout('https://www.estrazionilotterie.it/superenalotto/estrazioni', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, 4500);
    if (res.ok) {
      const html = await res.text();
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m;
      while ((m = rowRegex.exec(html)) !== null) {
        const row = m[1];
        const concMatch = row.match(/Concorso<\/span>\s*(\d+)\s*\/\s*(\d{2,4})/i);
        const dateMatch = row.match(
          /<div[^>]*class="day[^"]*"[^>]*>[\s\S]*?<span>\s*(\d{1,2})\s*<\/span>\s*<span>\s*([a-z]{3})[\s\S]*?(\d{4})/i
        );
        if (!concMatch || !dateMatch) continue;
        const contestNumber = parseInt(concMatch[1], 10);
        const day = String(parseInt(dateMatch[1], 10)).padStart(2, '0');
        const mon = IT_MONTHS[dateMatch[2].toLowerCase()];
        const year = dateMatch[3];
        if (!mon) continue;
        const balls = [];
        const ballRe = /<li[^>]*class="[^"]*ball[^"]*"[^>]*>\s*(\d+)\s*<\/li>/gi;
        let bm;
        while ((bm = ballRe.exec(row)) !== null) {
          balls.push(parseInt(bm[1], 10));
        }
        if (balls.length >= 7) {
          const norm = normalizeSuperEnalottoDraw({
            contestNumber,
            date: `${year}-${mon}-${day}`,
            numbers: balls.slice(0, 6),
            jolly: balls[6],
            superstar: balls[7]
          });
          if (norm) results.push(norm);
        }
      }
    }
  } catch {
    // Optional live fallback
  }

  return results;
}

function parseEstrazioneDelLottoWfiHtml(html) {
  const results = [];
  const regex =
    /Estrazione\s+n\.\s*(\d+)[\s\S]*?(\d{2})\/(\d{2})\/(\d{4})[\s\S]*?<ul[^>]*class="ballRow"[^>]*>([\s\S]*?)<\/ul>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const contestNumber = parseInt(match[1], 10);
    const dateStr = `${match[4]}-${match[3]}-${match[2]}`;
    const ulHtml = match[5];
    const balls = [];
    const ballRe = /<li[^>]*class="[^"]*ball[^"]*"[^>]*>\s*(?:<strong>)?(\d+)(?:<\/strong>)?\s*<\/li>/gi;
    let bm;
    while ((bm = ballRe.exec(ulHtml)) !== null) {
      balls.push(parseInt(bm[1], 10));
    }
    if (balls.length === 6) {
      const norm = normalizeWinForItaliaDraw({
        contestNumber,
        date: dateStr,
        time: '20:00',
        numbers: balls
      });
      if (norm) results.push(norm);
    }
  }
  return results;
}

function parseEstrazioniLotterieWfiHtml(html) {
  const results = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const concMatch = row.match(/Concorso<\/span>\s*(\d+)\s*\/\s*(\d{2,4})/i);
    const dateMatch = row.match(
      /<div[^>]*class="day[^"]*"[^>]*>[\s\S]*?<span>\s*(\d{1,2})\s*<\/span>\s*<span>\s*([a-z]{3})[\s\S]*?(\d{4})/i
    );
    if (!concMatch || !dateMatch) continue;
    const contestNumber = parseInt(concMatch[1], 10);
    const day = String(parseInt(dateMatch[1], 10)).padStart(2, '0');
    const mon = IT_MONTHS[dateMatch[2].toLowerCase()];
    const year = dateMatch[3];
    if (!mon) continue;
    const balls = [];
    const ballRe = /<li[^>]*class="[^"]*ball[^"]*"[^>]*>\s*(\d+)\s*<\/li>/gi;
    let bm;
    while ((bm = ballRe.exec(row)) !== null) {
      balls.push(parseInt(bm[1], 10));
    }
    if (balls.length === 6) {
      const norm = normalizeWinForItaliaDraw({
        contestNumber,
        date: `${year}-${mon}-${day}`,
        time: '20:00',
        numbers: balls
      });
      if (norm) results.push(norm);
    }
  }
  return results;
}

async function fetchLiveWinForItaliaDraws() {
  const year = new Date().getUTCFullYear();
  const sources = [
    {
      url: `https://www.estrazionedellotto.it/win-for-italia-team/risultati/archivio-win-for-italia-team-${year}`,
      parse: parseEstrazioneDelLottoWfiHtml
    },
    {
      url: 'https://www.estrazionilotterie.it/win-for-italia-team/estrazioni',
      parse: parseEstrazioniLotterieWfiHtml
    }
  ];

  const settled = await Promise.allSettled(
    sources.map(async (src) => {
      const res = await fetchWithTimeout(
        src.url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'it-IT,it;q=0.9'
          }
        },
        5000
      );
      if (!res.ok) return [];
      const html = await res.text();
      return src.parse(html);
    })
  );

  const collected = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
      collected.push(...outcome.value);
    }
  }
  return collected;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch {
      return res.status(400).json({ ok: false, error: 'JSON body non valido' });
    }
  }

  const game = String(url.searchParams.get('game') || body.game || 'superenalotto').toLowerCase();
  const cfg = GAME_FILES[game];
  if (!cfg) {
    return res.status(400).json({ ok: false, error: 'Parametro game non valido (usa superenalotto o winforitalia)' });
  }

  try {
    const external = await readExternalGithubFile(cfg.path);
    const baseDraws =
      game === 'superenalotto'
        ? mergeSuperEnalotto([], external.draws).draws
        : mergeWinForItalia([], external.draws).draws;

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        game,
        draws: baseDraws,
        count: baseDraws.length,
        latestDate: baseDraws[0]?.date || '',
        oldestDate: baseDraws[baseDraws.length - 1]?.date || '',
        source: external.source,
        repoUrl: REPO_URL,
        githubWriteConfigured: Boolean(GITHUB_TOKEN)
      });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const action = String(body.action || url.searchParams.get('action') || 'sync').toLowerCase();
      let incoming = [];
      let mergedResult;

      if (action === 'reset_restore') {
        // Cancella lo stato precedente e ricostruisce l'intero storico reale dalle fonti ufficiali Sisal/Open-Data
        const liveDraws =
          game === 'superenalotto'
            ? await fetchLiveSuperEnalottoDraws()
            : await fetchLiveWinForItaliaDraws();
        // Usa i dati live ufficiali come base primaria; se il feed live fosse temporaneamente vuoto, usa l'archivio esterno GitHub
        const sourceList = liveDraws.length > 0 ? liveDraws : baseDraws;
        const rebuilt =
          game === 'superenalotto'
            ? mergeSuperEnalotto([], sourceList)
            : mergeWinForItalia([], sourceList);
        mergedResult = {
          draws: rebuilt.draws,
          addedOrUpdated: rebuilt.draws.length
        };
      } else {
        if (action === 'sync') {
          incoming =
            game === 'superenalotto'
              ? await fetchLiveSuperEnalottoDraws()
              : await fetchLiveWinForItaliaDraws();
        } else if (action === 'upsert' && body.draw) {
          incoming = [body.draw];
        } else if (action === 'import' && Array.isArray(body.draws)) {
          incoming = body.draws;
        }

        mergedResult =
          game === 'superenalotto'
            ? mergeSuperEnalotto(baseDraws, incoming)
            : mergeWinForItalia(baseDraws, incoming);
      }

      let githubWrite = { persisted: false, reason: 'Nessuna modifica da committare' };

      if ((action === 'reset_restore' || mergedResult.addedOrUpdated > 0) && mergedResult.draws.length > 0 && GITHUB_TOKEN) {
        const nextPayload = {
          game: cfg.label,
          source: 'external-github-archive',
          exportedAt: new Date().toISOString(),
          count: mergedResult.draws.length,
          latestDate: mergedResult.draws[0]?.date || '',
          oldestDate: mergedResult.draws[mergedResult.draws.length - 1]?.date || '',
          draws: mergedResult.draws
        };
        const commitMsg =
          action === 'reset_restore'
            ? `chore(data): ripristino completo storico ufficiale ${cfg.label} (${nextPayload.count} estrazioni fino al ${nextPayload.latestDate})`
            : `chore(data): aggiorna ${cfg.label} (+${mergedResult.addedOrUpdated} estrazioni, ultimo ${nextPayload.latestDate})`;
        githubWrite = await writeExternalGithubFile(cfg.path, nextPayload, external.sha, commitMsg);
      } else if (!GITHUB_TOKEN) {
        githubWrite = { persisted: false, reason: 'GITHUB_TOKEN non configurato su Vercel' };
      }

      return res.status(200).json({
        ok: true,
        game,
        action,
        draws: mergedResult.draws,
        count: mergedResult.draws.length,
        addedOrUpdated: mergedResult.addedOrUpdated,
        latestDate: mergedResult.draws[0]?.date || '',
        oldestDate: mergedResult.draws[mergedResult.draws.length - 1]?.date || '',
        persistedToGitHub: Boolean(githubWrite.persisted),
        githubWriteNote: githubWrite.reason || null,
        commitSha: githubWrite.commitSha || null,
        githubWriteConfigured: Boolean(GITHUB_TOKEN),
        repoUrl: REPO_URL
      });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Errore sincronizzazione archivio esterno',
      repoUrl: REPO_URL
    });
  }
}
