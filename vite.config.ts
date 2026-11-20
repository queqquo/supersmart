import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function disableHmrWebSocketPlugin(): Plugin {
  return {
    name: 'disable-hmr-websocket-client',
    enforce: 'post',
    transform(code, id) {
      if (
        id.includes('vite/dist/client/client.mjs') ||
        code.includes('createWebSocketModuleRunnerTransport')
      ) {
        return {
          code: code
            .replace(
              'console.debug("[vite] connecting...");',
              '/* HMR WebSocket disabled in AI Studio */'
            )
            .replace(
              'const createWebSocketModuleRunnerTransport = (options) => {',
              'const createWebSocketModuleRunnerTransport = (_options) => { return { async connect() {}, disconnect() {}, send() {} }; }; const _unusedCreateWsTransport = (options) => {'
            )
            .replace(
              'setupForwardConsoleHandler(transport, forwardConsole);',
              '/* ForwardConsole WebSocket disabled in AI Studio */'
            ),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), disableHmrWebSocketPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio preview environment to prevent @vite/client WebSocket errors.
      hmr: false as const,
      ws: false as const,
      watch: null,
    },
  };
});
