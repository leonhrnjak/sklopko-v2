import { defineConfig } from '@playwright/test'

// PW_CHROMIUM: path to a Chromium binary to use instead of Playwright's own download, for machines where the
// installed Playwright wants a different browser build than the one available (e.g. `PW_CHROMIUM=/opt/pw-browsers/chromium`).
const executablePath = process.env.PW_CHROMIUM

export default defineConfig({
  testDir: 'e2e',
  // Tests are independent (each opens its own page and storage), so they spread evenly over the shards CI splits them into.
  fullyParallel: true,
  // On CI (the CI variable is set there): a leftover test.only fails the run, and a failing test is tried once more, so a flaky test
  // is reported as "flaky" (with a trace of the first failure) instead of turning the whole run red. A test that fails twice is red.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    trace: 'on-first-retry',
    baseURL: 'http://localhost:5199',
    viewport: { width: 1400, height: 860 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
  },
})
