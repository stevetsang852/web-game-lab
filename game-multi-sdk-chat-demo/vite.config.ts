import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The primary host (https://yin-game-lab.grok.me), local `vite`, and Docker
 * all serve the app at `/`. The optional GitHub Pages backup is a project
 * site, so that workflow sets `VITE_BASE_PATH=/web-game-lab/`.
 */
function pagesBase(): string {
  const raw = process.env.VITE_BASE_PATH?.trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig({
  plugins: [react()],
  base: pagesBase(),
});
