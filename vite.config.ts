/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { examplesPlugin } from './scripts/examples-plugin.ts'
import { pathStepCount } from './scripts/pathStepCount.ts'
import { appVersion } from './scripts/version.ts'
import { serviceWorkerPlugin } from './scripts/sw-plugin.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Short commit hash of the build: Cloudflare Pages provides it, locally ask git. */
function commit(): string {
  const sha = process.env.CF_PAGES_COMMIT_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

/** Run git with these arguments, and return what it printed. */
const git = (...args: string[]) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()

// Served from the site root: example links like /intersection rely on absolute asset paths.
export default defineConfig({
  base: '/',
  plugins: [react(), examplesPlugin(), serviceWorkerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion(pkg.version, git)),
    __APP_COMMIT__: JSON.stringify(commit()),
    __PATH_STEP_COUNT__: pathStepCount(fileURLToPath(new URL('./src/model/path/steps', import.meta.url))),
  },
  test: {
    include: ['src/**/*.test.ts', 'api/src/**/*.test.ts'],
  },
})
