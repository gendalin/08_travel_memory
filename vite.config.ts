import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { handleApiRequest } from './server/routes.ts'

/** Serves /api/* from the dev server's Node process, keeping the key off the client. */
function apiPlugin(): Plugin {
  return {
    name: 'next-trip-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleApiRequest(req, res)
        if (!handled) next()
      })
    },
  }
}

export default defineConfig({
  // Absent outside the static review build; see vite.demo.config.ts.
  define: { __STUB_ONLY__: 'false' },
  plugins: [react(), apiPlugin()],
  server: { port: 5173 },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
})
