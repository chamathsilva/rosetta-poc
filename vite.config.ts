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
});
