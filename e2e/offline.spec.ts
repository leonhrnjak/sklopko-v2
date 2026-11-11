import { expect, test, type Page } from '@playwright/test'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

// The service worker exists only in the built app, so this spec serves `dist/` itself (CI builds before it runs the end-to-end
// tests; locally, `npm run build` first). It serves the build from a folder that a test can switch to a second build.
const PORT = 5198
const BASE = `http://localhost:${PORT}`
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}
let server: Server | undefined
let root = 'dist'
let requested: string[] = []

// One server for the file: its tests run in order, in one worker, however the rest are spread.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(!existsSync('dist/index.html'), 'dist/ is not built: run `npm run build`')
  server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    requested.push(path)
    let file = join(root, path)
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html') // (short links like /dice)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(readFileSync(file))
  })
  await new Promise<void>((r) => server!.listen(PORT, r))
})

test.afterAll(() => {
  server?.close()
})

/** Names of the files in a cache of this origin. */
const cacheUrls = (page: Page, prefix: string) =>
  page.evaluate(async (prefix) => {
    const out: string[] = []
    for (const name of await caches.keys()) {
      if (!name.startsWith(prefix)) continue
      for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname)
    }
    return out
  }, prefix)

async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
}

test('after one visit the app opens offline, with the example that was opened and the panel that was used', async ({ page, context }) => {
  await page.goto(BASE + '/dice', { waitUntil: 'networkidle' })
  await controlled(page)
  // (The first load came before the worker was in control: load again, so that the example and the panel pass through it.)
  await page.reload({ waitUntil: 'networkidle' })
  await expect.poll(() => page.locator('.comp').count()).toBeGreaterThan(5)
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await page.getByRole('menuitem', { name: 'Logic' }).click()
  await expect(page.getByRole('dialog', { name: 'Logic tools' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Kept: the page, the manifest and the start-up files; of the examples only the one that was opened.
  expect(await cacheUrls(page, 'sklopko-shell-')).toEqual(expect.arrayContaining(['/index.html', '/manifest.webmanifest', '/icon-192.png']))
  const assets = await cacheUrls(page, 'sklopko-assets')
  expect(assets.some((u) => /^\/assets\/index-.*\.js$/.test(u))).toBe(true)
  expect(assets.some((u) => u.endsWith('.wasm'))).toBe(true)
  const examples = (await cacheUrls(page, 'sklopko-examples')).filter((u) => u.endsWith('.json'))
  expect(examples).toContain('/examples/dice.json')
  expect(examples.length).toBeLessThan(10)

  await context.setOffline(true)
  await page.goto(BASE + '/dice', { waitUntil: 'load' })
  await expect.poll(() => page.locator('.comp').count()).toBeGreaterThan(5)
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await page.getByRole('menuitem', { name: 'Logic' }).click()
  await expect(page.getByRole('dialog', { name: 'Logic tools' })).toBeVisible()
  await context.setOffline(false)
})

test('File → Keep all examples offline fetches the rest, and then any example opens with no network', async ({ page, context }) => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await controlled(page)
  const all = readdirSync('dist/examples').filter((f) => f.endsWith('.json'))
  // The message shows for a moment when the last example is in, so start watching for it before the click.
  const message = expect(page.getByText('All examples are kept for offline use.')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File ▾' }).click()
  await page.getByRole('menuitem', { name: 'Keep all examples offline' }).click()
  await message
  const kept = (await cacheUrls(page, 'sklopko-examples')).filter((u) => u.endsWith('.json'))
  expect(kept).toHaveLength(all.length)

  await context.setOffline(true)
  await page.goto(BASE + '/adder', { waitUntil: 'load' })
  await expect.poll(() => page.locator('.comp').count()).toBe(6) // with the note
  await context.setOffline(false)
})

/**
 * Makes a "second build" of `dist/` in a new folder: the chunk `name` changes (its file is renamed and gets one more line), and
 * so does every file that imports it, as the hashes of a real build would; `sw.js` is rewritten to match. Returns the names
 * of the files that are new.
 */
function secondBuild(name: string): { dir: string; changed: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'sklopko-b-'))
  cpSync('dist', dir, { recursive: true })
  const assets = join(dir, 'assets')
  const renamed = new Map<string, string>()
  const bump = (file: string) => {
    if (renamed.has(file)) return
    const next = file.replace(/\.(js)$/, 'b.$1')
    renamed.set(file, next)
    renameSync(join(assets, file), join(assets, next))
    for (const other of readdirSync(assets))
      if (other.endsWith('.js') && !renamed.has(other) && readFileSync(join(assets, other), 'utf8').includes(file)) bump(other)
  }
  bump(readdirSync(assets).find((f) => f.startsWith(name + '-') && f.endsWith('.js'))!)
  const rewrite = (path: string, extra = '') => {
    let text = readFileSync(path, 'utf8')
    for (const [from, to] of renamed) text = text.split(from).join(to)
    writeFileSync(path, text + extra)
  }
  for (const f of readdirSync(assets)) if (f.endsWith('.js')) rewrite(join(assets, f), renamed.has(f.replace(/\.js$/, 'b.js')) || [...renamed.values()].includes(f) ? '\n// second build\n' : '')
  rewrite(join(dir, 'index.html'))
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*'/, "const VERSION = 'second-build'")
  writeFileSync(join(dir, 'sw.js'), sw)
  rewrite(join(dir, 'sw.js'))
  return { dir, changed: [...renamed.values()].map((f) => '/assets/' + f) }
}

test('a new build waits behind a prompt, and only the files that changed are fetched', async ({ page }) => {
  test.setTimeout(120_000)
  root = 'dist'
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await controlled(page)
  const before = await cacheUrls(page, 'sklopko-assets')

  // Deploy a second build in which one chunk (and what imports it) is different.
  const second = secondBuild('opcodes65c02')
  expect(second.changed.length).toBeGreaterThan(1)
  root = second.dir
  requested = []
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    await reg!.update()
  })

  // The new worker waits: the page shows the prompt instead of switching under the open tab.
  await expect(page.getByText('A new version of Sklopko is available.')).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting))).toBe(true)
  const fetched = requested.filter((u) => u.startsWith('/assets/'))
  // Of the start-up files only the changed ones came over the network: not the WebAssembly module, nor the unchanged chunks.
  for (const url of fetched) expect(second.changed, url).toContain(url)
  expect(fetched.some((u) => u.endsWith('.wasm'))).toBe(false)
  expect(fetched.length).toBeGreaterThan(0)

  // Reload: the new worker takes over, and the files of the old build that the new one does not use are still there (one build back).
  const reloaded = page.waitForEvent('load')
  await page.getByRole('button', { name: 'Reload' }).click()
  await reloaded
  await expect(page.locator('.comp').first()).toBeVisible({ timeout: 30_000 })
  await controlled(page)
  await expect.poll(() => cacheUrls(page, 'sklopko-assets').then((urls) => fetched.every((u) => urls.includes(u)))).toBe(true)
  const after = await cacheUrls(page, 'sklopko-assets')
  for (const url of before) expect(after, url).toContain(url)
  root = 'dist'
})

test('the manifest names the app and its icons', async ({ request }) => {
  const manifest = await (await request.get(BASE + '/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ short_name: 'Sklopko', start_url: '/', display: 'standalone' })
  for (const icon of manifest.icons) expect((await request.get(BASE + icon.src)).ok(), icon.src).toBe(true)
})
