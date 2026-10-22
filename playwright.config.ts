import { defineConfig } from '@playwright/test'

// PW_CHROMIUM: path to a Chromium binary to use instead of Playwright's own download, for machines where the
// installed Playwright wants a different browser build than the one available (e.g. `PW_CHROMIUM=/opt/pw-browsers/chromium`).
const executablePath = process.env.PW_CHROMIUM

export default defineConfig({
  testDir: 'e2e',
  use: {
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
