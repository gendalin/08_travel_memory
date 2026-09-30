import { defineConfig } from '@playwright/test'

/**
 * E2E for the Gate 3 vertical slice.
 *
 * Uses the installed system Chrome (`channel: 'chrome'`) because Playwright's
 * bundled Chromium has no macOS 13 build.
 *
 * The app is loaded with `?stub=1`, which swaps in the deterministic LLM. The
 * application layer, domain engine and persistence are identical to a real run
 * — only the model's two judgments are fixed, so the run is reproducible and
 * costs nothing.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // Its own port and its own server: never the developer's `npm run dev` on 5173,
    // which is online and would buy photos for a test run.
    command: 'npx vite --port 5174 --strictPort',
    // Photos from cache only: a test run buys no images (server/places.ts).
    env: { PHOTOS_OFFLINE: '1' },
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
