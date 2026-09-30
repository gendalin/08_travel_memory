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
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5173',
    // Photos from cache only: a test run buys no images (server/places.ts).
    env: { PHOTOS_OFFLINE: '1' },
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
