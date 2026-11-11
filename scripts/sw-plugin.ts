import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * What the worker does. Made when the site is built: `__VERSION__` is a hash of the build, and the lists are filled in:
 * `__SHELL__` the files that are not hashed (the page, icons, manifest), `__STARTUP__` the files the first draw needs,
 * `__ASSETS__` every hashed file of the build, `__EXAMPLES__` every example.
 */
const WORKER = `// Made by scripts/sw-plugin.ts when the site is built: do not edit.
// Three caches. 'sklopko-assets' holds the hashed files under /assets/ (their name is their content, so a file is fetched once, ever)
// and is kept across builds; only files that neither this build nor the one before lists are removed. 'sklopko-shell-<build>' holds
// the page, icons and manifest of this build. 'sklopko-examples' holds the examples, as they are first opened (or all of them, from
// File > Keep all examples offline), and is refreshed in the background each time.
const VERSION = '__VERSION__'
const SHELL_CACHE = 'sklopko-shell-' + VERSION
const ASSETS_CACHE = 'sklopko-assets'
const EXAMPLES_CACHE = 'sklopko-examples'
const META_CACHE = 'sklopko-meta'
const SHELL = __SHELL__
const STARTUP = __STARTUP__
const ASSETS = __ASSETS__
const EXAMPLES = __EXAMPLES__

// A new build installs beside the running one and waits: the page offers "reload" and then sends 'skip-waiting'.
// (With nothing running yet, the first install activates at once.)
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)),
      caches.open(ASSETS_CACHE).then(async (cache) => {
        const missing = []
        for (const url of STARTUP) if (!(await cache.match(url))) missing.push(url)
        await cache.addAll(missing)
      }),
    ]),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanUp().then(() => self.clients.claim()))
})

// Remove what no build in use needs: other builds' shells, the older caches (named by a hash), and hashed files that neither
// this build nor the one before lists. The previous build's list is kept in 'sklopko-meta'.
async function cleanUp() {
  const meta = await caches.open(META_CACHE)
  const saved = await meta.match('/builds')
  const old = saved ? await saved.json() : { version: '', current: [], previous: [] }
  const previous = old.version === VERSION ? old.previous : old.current
  await meta.put('/builds', new Response(JSON.stringify({ version: VERSION, current: ASSETS, previous })))
  const keep = new Set([...ASSETS, ...previous])
  const assets = await caches.open(ASSETS_CACHE)
  for (const req of await assets.keys()) if (!keep.has(new URL(req.url).pathname)) await assets.delete(req)
  const own = new Set([SHELL_CACHE, ASSETS_CACHE, EXAMPLES_CACHE, META_CACHE])
  for (const name of await caches.keys()) if (name.startsWith('sklopko-') && !own.has(name)) await caches.delete(name)
}

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'skip-waiting') self.skipWaiting()
  if (type === 'keep-examples') event.waitUntil(keepExamples(event.source))
})

// Fetch the examples that are not kept yet, a few at a time, and tell the page how far it is.
async function keepExamples(client) {
  const cache = await caches.open(EXAMPLES_CACHE)
  let done = 0
  let failed = 0
  const queue = EXAMPLES.slice()
  const work = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url)
          if (!res.ok) throw new Error(String(res.status))
          await cache.put(url, res)
        }
      } catch {
        failed++
      }
      done++
      if (client) client.postMessage({ type: 'examples-progress', done, total: EXAMPLES.length })
    }
  }
  await Promise.all([work(), work(), work(), work(), work(), work()])
  if (client) client.postMessage({ type: 'examples-done', failed, total: EXAMPLES.length })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // A page (the app, or a short link like /dice): the network first, so a new deploy shows at once, else the cached app.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', { ignoreVary: true })))
    return
  }
  // (ignoreVary: a file served with "Vary: Origin" would not match the request a module script makes.)
  if (url.pathname.startsWith('/assets/')) {
    // Hashed: whatever is in the cache is the right file. Else fetch it and keep it.
    event.respondWith(
      caches.open(ASSETS_CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true })
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) event.waitUntil(cache.put(req, res.clone()))
        return res
      }),
    )
    return
  }
  if (url.pathname.startsWith('/examples/')) {
    // Stale while revalidate: show the kept copy now, fetch a fresh one for next time.
    event.respondWith(
      caches.open(EXAMPLES_CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true })
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone())
          return res
        })
        if (hit) {
          event.waitUntil(fresh.catch(() => {}))
          return hit
        }
        return fresh
      }),
    )
    return
  }
  // The icons, the manifest: this build's copy, else the network.
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)))
})
`

/**
 * Writes \`sw.js\`, a service worker that lets the app work offline without making every visitor download it all again after each
 * deploy: the hashed files are kept across builds, the page and icons per build, the examples as they are opened.
 */
export function serviceWorkerPlugin(): Plugin {
  let publicDir = ''
  return {
    name: 'sklopko-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const shell = new Set<string>(['/', '/index.html'])
      const assets: string[] = []
      const examples: string[] = []
      const files = Object.values(bundle)
        .filter((f) => !f.fileName.endsWith('.map'))
        .sort((a, b) => a.fileName.localeCompare(b.fileName))
      for (const file of files) {
        hash.update(file.fileName)
        hash.update(file.type === 'chunk' ? file.code : file.source)
        if (file.fileName.startsWith('assets/')) assets.push('/' + file.fileName)
        else if (file.fileName.startsWith('examples/')) examples.push('/' + file.fileName)
        else shell.add('/' + file.fileName)
      }
      // Files copied from public/ (the manifest, icons) are not in the bundle. _headers is for the host, not for the browser.
      for (const name of readdirSync(publicDir).sort()) {
        if (name === '_headers') continue
        shell.add('/' + name)
        hash.update(name)
        hash.update(readFileSync(join(publicDir, name)))
      }
      shell.delete('/sw.js')

      // What the first draw needs: the entry, the chunks it loads with import() and everything they import (the same set
      // scripts/check-bundle.mjs counts), the stylesheet, the WebAssembly module and the simulator's worker.
      const startup = new Set<string>()
      const add = (name: string) => {
        const f = bundle[name]
        if (!f || startup.has('/' + name)) return
        startup.add('/' + name)
        if (f.type === 'chunk') {
          for (const dep of f.imports) add(dep)
          for (const css of f.viteMetadata?.importedCss ?? []) add(css)
        }
      }
      const entry = files.find((f) => f.type === 'chunk' && f.isEntry)
      if (entry && entry.type === 'chunk') {
        add(entry.fileName)
        for (const dep of entry.dynamicImports) add(dep)
      }
      for (const f of files) if (f.fileName.endsWith('.wasm') || /^assets\/sim\.worker-.*\.js$/.test(f.fileName)) add(f.fileName)

      const source = WORKER.replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__SHELL__', JSON.stringify([...shell].sort(), null, 1))
        .replace('__STARTUP__', JSON.stringify([...startup].sort(), null, 1))
        .replace('__ASSETS__', JSON.stringify(assets.sort(), null, 1))
        .replace('__EXAMPLES__', JSON.stringify(examples.sort(), null, 1))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
