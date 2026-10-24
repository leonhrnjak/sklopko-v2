/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { examplesPlugin } from './scripts/examples-plugin.ts'
import { serviceWorkerPlugin } from './scripts/sw-plugin.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; buildOffset?: number }

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

/**
 * The version shown in the app: `package.json`'s version, then the build number, the number of commits on the main line of the
 * history (so each merge to `main` is the next number, and no PR has to bump anything) plus `buildOffset`, which keeps the numbers
 * going on from where the version was once bumped by hand. A shallow clone (CI, Cloudflare Pages) is deepened first; where the
 * history cannot be read, the build number is left out.
 */
function version(): string {
  const git = (cmd: string) => execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  try {
    if (git('rev-parse --is-shallow-repository') === 'true') git('fetch --unshallow --quiet')
    return `${pkg.version}-${Number(git('rev-list --first-parent --count HEAD')) + (pkg.buildOffset ?? 0)}`
  } catch {
    return pkg.version
  }
}

// Served from the site root: example links like /intersection rely on absolute asset paths.
export default defineConfig({
  base: '/',
  plugins: [react(), examplesPlugin(), serviceWorkerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(version()),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
