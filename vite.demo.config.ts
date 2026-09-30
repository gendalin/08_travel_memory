/**
 * Static review build.
 *
 * One self-contained HTML file: no server, no API key, deterministic stub
 * model. Used for the shareable prototype, never for the real app.
 */

import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { __STUB_ONLY__: 'true' },
  resolve: {
    alias: [
      {
        // Only this build carries the retrieved set and its four megabytes of
        // inlined photography. Swapping the module rather than branching on a flag
        // is what keeps it out of the app's own bundle.
        find: './demo/prototypeCatalogue.ts',
        replacement: resolve(import.meta.dirname, 'src/demo/prototypeCatalogue.inlined.ts'),
      },
    ],
  },
  build: {
    outDir: 'dist-demo',
    // Everything in one chunk so the inliner has a single script to embed.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app[extname]',
      },
    },
  },
})
