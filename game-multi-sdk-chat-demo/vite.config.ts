import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { delegateTurn } from './server/static-server.mjs';
import { isTurnPathname } from './server/turn-credentials.mjs';

/**
 * The primary host (https://yin-game-lab.grok.me), local `vite`, and Docker
 * all serve the app at `/`. The optional GitHub Pages backup is a project
 * site, so that workflow sets `VITE_BASE_PATH=/web-game-lab/`.
 *
 * `GET /turn` is attached in dev and preview only. Provider secrets are read
 * on the server. They are not given an empty `envPrefix`, so Vite does not
 * inline them into the browser bundle.
 */
function pagesBase(): string {
  const raw = process.env.VITE_BASE_PATH?.trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function turnCredentialsPlugin(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    const fileEnv = loadEnv(server.config.mode, server.config.envDir, '');
    server.middlewares.use((req, res, next) => {
      const pathname = (req.url ?? '/').split('?')[0] ?? '/';
      if (!isTurnPathname(pathname)) {
        next();
        return;
      }
      const env = { ...fileEnv, ...process.env };
      void delegateTurn(req, res, env).then((handled) => {
        if (!handled && !res.headersSent) next();
      }).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify({ error: 'TURN credential endpoint failed' }));
        }
      });
    });
  };
  return {
    name: 'turn-credentials',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [react(), turnCredentialsPlugin()],
  base: pagesBase(),
});
