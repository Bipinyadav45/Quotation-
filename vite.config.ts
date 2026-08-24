import 'dotenv/config'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * The port Express is actually on, read from the same .env Express reads.
 *
 * It used to be the literal 4000 here while .env said PORT=5050, so every
 * /api call from the browser was proxied to a port with nothing on it. The
 * application looked completely broken — the AI button did nothing at all —
 * and it had been masked for days by a stale server from an earlier run that
 * happened to still be sitting on 4000.
 *
 * Two files naming the same port independently is the bug. They read one value
 * now, and the default matches server/src/config.ts's own.
 */
const API_PORT = Number(process.env.PORT ?? 4000)

// The frontend lives in web/. In development Vite serves it on :5173 and proxies
// /api through to Express. In production `npm run build` emits web/dist, which
// Express serves itself — one process, one port. See server/src/index.ts.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
