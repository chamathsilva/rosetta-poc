import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client is built to dist/client and served as static assets by the Express
// process - see docs/ARCHITECTURE.md. Vite is a build-time tool only; it does
// not run in production.
export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  // Dev-only proxy so `npm run dev:client` can reach the Express + ws process
  // without a full `npm run build:client` on every edit. Build-time only -
  // ships nothing to the droplet (docs/ARCHITECTURE.md "Client build").
  //
  // The browser's Origin in dev is Vite's own dev-server origin, and this
  // proxy forwards that header verbatim to the target - so ALLOWED_ORIGIN in
  // .env for local work MUST be Vite's dev origin, not localhost:3000. See
  // agents/TEMP/walking-skeleton/architecture-notes.md, "Local development".
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
      },
      '/ws': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
