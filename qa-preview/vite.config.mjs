import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const firebase = readFileSync(new URL('../src/utils/firebase.ts', import.meta.url), 'utf8');
const firebaseFunctions = [...firebase.matchAll(/^export (async )?function (\w+)/gm)];

// The isolated preview renders the actual lab but cannot use production auth, storage or archive services.
const offlinePreview = (hosted) => ({
  name: 'isolated-wfi-preview',
  enforce: 'pre',
  resolveId(source) {
    if (source === 'virtual:preview-storage') return '\0preview:storage';
    if (/(?:^|\/)(firebase|secureAuth|externalDrawsRepo)$/.test(source)) return `\0preview:${source.split('/').pop()}`;
  },
  load(id) {
    if (id === '\0preview:storage') return `
      const state = new Map();
      export const previewStorage = {
        getItem: key => state.get(key) ?? null,
        setItem: (key, value) => { state.set(key, String(value)); },
        removeItem: key => { state.delete(key); }
      };
      export const previewDatabase = undefined;
      export const previewFetch = async () => new Response(null, { status: 404 });`;
    if (id === '\0preview:firebase') return firebaseFunctions.map(([, asyncPrefix, name]) => {
      if (name === 'subscribeCloudCover60') return `
        const cover60PreviewMemory = new Map();
        const cover60PreviewEvents = new EventTarget();
        const cover60PreviewKey = email => 'supersmart_preview_cloud_cover60:' + email;
        const getCover60Preview = email => {
          ${hosted ? 'return cover60PreviewMemory.get(email) || null;' : `
          try { return JSON.parse(localStorage.getItem(cover60PreviewKey(email)) || 'null'); }
          catch { return cover60PreviewMemory.get(email) || null; }`}
        };
        export function subscribeCloudCover60(email, onUpdate) {
          const notify = () => onUpdate(getCover60Preview(email), true);
          const onStorage = event => { if (event.key === cover60PreviewKey(email)) notify(); };
          cover60PreviewEvents.addEventListener(email, notify);
          window.addEventListener('storage', onStorage);
          notify();
          return () => {
            cover60PreviewEvents.removeEventListener(email, notify);
            window.removeEventListener('storage', onStorage);
          };
        }`;
      if (name === 'saveCloudCover60') return `
        export async function saveCloudCover60(email, draft) {
          ${hosted ? 'cover60PreviewMemory.set(email, draft);' : `
          try { localStorage.setItem(cover60PreviewKey(email), JSON.stringify(draft)); }
          catch { cover60PreviewMemory.set(email, draft); }`}
          cover60PreviewEvents.dispatchEvent(new Event(email));
        }`;
      const body = name.startsWith('subscribe') ? '() => {}' : 'null';
      return `export const ${name} = ${asyncPrefix || ''}() => ${body};`;
    }).join('\n');
    if (id === '\0preview:secureAuth') return `
      export const getCloudAuth = () => ({currentUser:null});
      export const fetchArchiveMutation = async () => new Response(null, {status:403});`;
    if (id === '\0preview:externalDrawsRepo') return `
      export const EXTERNAL_SUPERENALOTTO_RAW_URL = 'data:application/json,[]';
      export const EXTERNAL_WINFORITALIA_RAW_URL = 'data:application/json,[]';`;
  },
  transform(code, id) {
    if (hosted && id.endsWith('/src/hooks/useCover60Draft.ts')) {
      return { code: `import { previewStorage } from 'virtual:preview-storage';\n` + code.replace(/\blocalStorage\b/g, 'previewStorage'), map: null };
    }
    if (!/[\\/]src[\\/](?:components[\\/]WinForItaliaLab\.tsx|utils[\\/](?:storage|winForItalia|auth)\.ts)$/.test(id)) return;
    const source = code.replace(/\blocalStorage\b/g, 'previewStorage').replace(/\bindexedDB\b/g, 'previewDatabase');
    return {
      code: `import { previewStorage, previewDatabase, previewFetch } from 'virtual:preview-storage';\n` +
        (/[\\/]storage\.ts$/.test(id) ? source.replace(/\bfetch\(/g, 'previewFetch(') : source),
      map: null
    };
  },
  configureServer(server) {
    server.middlewares.use('/api', (_req, res) => { res.statusCode = 204; res.end(); });
  }
});

export default defineConfig(({ mode, command }) => ({
  root: fileURLToPath(new URL(mode === 'cover60' ? './cover60/' : './', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [offlinePreview(command === 'build'), react(), tailwindcss()],
  define: { __HOSTED_QA_PREVIEW__: JSON.stringify(command === 'build') },
  server: { fs: { allow: [project] } },
  build: {
    outDir: fileURLToPath(new URL(mode === 'cover60' ? '../../cover60-preview-dist/' : '../../wfi-preview-dist/', import.meta.url)),
    emptyOutDir: true
  }
}));
