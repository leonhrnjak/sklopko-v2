import { expect, test } from '@playwright/test'
import { type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chooseTool, startPreview } from './helpers'

// The other specs run on the dev server, where files are not bundled, split or renamed. A bug that appears only in the build (a chunk
// that imports another in the wrong order, a name that is minified away) passes them; this spec opens the pages of `dist/` through
// `vite preview` (CI builds before it runs the end-to-end tests; locally, `npm run build` first).
const PORT = 5197
const BASE = `http://localhost:${PORT}`
let server: ChildProcess | undefined

test.beforeAll(async () => {
  test.skip(!existsSync('dist/index.html'), 'dist/ is not built: run `npm run build`')
  server = await startPreview(PORT)
})

test.afterAll(() => {
  server?.kill()
})

for (const path of ['/', '/counter', '/6502-basic', '/learn', '/6502-doomlike']) {
  test(`the built app opens ${path}: the engine runs and nothing is logged as an error`, async ({ page }) => {
    const problems: string[] = []
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
    page.on('pageerror', (e) => problems.push(e.message))
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('engine')).toHaveText(/^(fast engine \(Rust\)|exact timing)$/)
    await expect(page.getByTestId('run-state')).not.toHaveText('Simulator stopped')
    await expect(page.getByTestId('canvas')).toBeVisible()
    expect(problems).toEqual([])
  })
}

// Chunk names (`LogicPanel-<hash>.js`) exist only here: a deploy that removed one answers with the page instead. The service worker is
// blocked so the request reaches the route (its own fetches are not seen by `page.route`).
test.describe('with the service worker blocked', () => {
  test.use({ serviceWorkers: 'block' })
  test('a lazy chunk that is gone from the server shows the panel card and the canvas stays', async ({ page }) => {
    await page.route(/\/assets\/LogicPanel-[^/]*\.js$/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }))
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await chooseTool(page, 'Logic')
    await expect(page.getByText('This panel could not load.')).toBeVisible()
    await expect(page.getByTestId('canvas')).toBeVisible()
  })
})

