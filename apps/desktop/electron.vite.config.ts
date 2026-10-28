import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Workspace packages ship TypeScript sources and must be bundled, not externalized.
const bundled = ['@ols/ipc-contracts', '@ols/shared-types', '@ols/geometry-adapters', '@ols/cad-kernel', 'zod'];

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Production builds load from file://, where response-header CSP does not apply, so the
 * policy is embedded as a meta tag. Dev relies on the header set by the main process.
 */
function cspMeta(): Plugin {
  return {
    name: 'ols-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: PROD_CSP }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          // Entry of the CAD kernel utility process (opencascade.js is loaded from disk at runtime).
          'cad-kernel': resolve(__dirname, 'electron/cad/kernel-entry.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react(), tailwindcss(), cspMeta()],
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/index.html') } },
      chunkSizeWarningLimit: 4000,
    },
  },
});
