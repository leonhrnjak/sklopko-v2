import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

// The service worker exists only in the built app, so this spec runs against `vite preview` of `dist/` (CI builds before it
// runs the end-to-end tests; locally, `npm run build` first).
const PORT = 5198
const BASE = `http://localhost:${PORT}`
let server: ChildProcess | undefined

// One server for the file: its tests run in order, in one worker, however the rest are spread.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(!existsSync('dist/index.html'), 'dist/ is not built: run `npm run build`')
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('vite preview did not start')
})

test.afterAll(() => {
  server?.kill()
})

test('after one visit the app opens and runs with no network: the page, a short link and the examples', async ({ page, context }) => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  // The worker has installed and taken over, with every file of the build in its cache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith('sklopko-'))
    const cache = await caches.open(names[0])
    return { names: names.length, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) }
  })
  expect(cached.names).toBe(1)
  expect(cached.urls).toContain('/index.html')
  expect(cached.urls).toContain('/manifest.webmanifest')
  expect(cached.urls.filter((u) => u.startsWith('/examples/') && u.endsWith('.json'))).toHaveLength(47)
  expect(cached.urls.some((u) => /^\/assets\/index-.*\.js$/.test(u))).toBe(true)

  await context.setOffline(true)
  // A reload of the page works, and the welcome circuit runs.
  await page.reload({ waitUntil: 'load' })
  await expect(page.locator('.comp').first()).toBeVisible()
  // A short link opens an example from the cache; so does one chosen in the gallery.
  await page.goto(BASE + '/dice', { waitUntil: 'load' })
  expect(await page.locator('.comp').count()).toBeGreaterThan(5)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByLabel('Search examples').fill('adder')
  await page.getByTestId('example-adder').click()
  await expect(page).toHaveURL(/\/adder$/)
  expect(await page.locator('.comp').count()).toBe(5)
  // The panels that load on demand are in the cache too.
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await page.getByRole('menuitem', { name: 'Logic…' }).click()
  await expect(page.getByRole('dialog', { name: 'Logic tools' })).toBeVisible()
  await context.setOffline(false)
})

test('the manifest names the app and its icons', async ({ request }) => {
  const manifest = await (await request.get(BASE + '/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ short_name: 'Sklopko', start_url: '/', display: 'standalone' })
  for (const icon of manifest.icons) expect((await request.get(BASE + icon.src)).ok(), icon.src).toBe(true)
})
