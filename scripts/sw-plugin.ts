import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** What the worker does; `__VERSION__` and `__SHELL__` are filled in when the site is built. */
const WORKER = `// Made by scripts/sw-plugin.ts when the site is built: do not edit.
// Keeps the whole app (page, scripts, styles, examples, icons) in a cache named for this build, so it opens without a network.
const VERSION = '__VERSION__'
const CACHE = 'sklopko-' + VERSION
const SHELL = __SHELL__

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

// A new build has a new name: the caches of older builds go.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sklopko-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

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
  // Everything else is in the cache under this build's name, or is asked of the network.
  // (ignoreVary: a file served with "Vary: Origin" would not match the request a module script makes.)
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)))
})
`

/**
 * Writes \`sw.js\`, a service worker that caches everything the build made (and the files of \`public/\`), so the app works offline.
 * The cache is named after a hash of the contents of those files: a deploy that changes anything makes a new worker, which
 * fills a new cache and removes the old ones.
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
      const urls = new Set<string>(['/'])
      for (const file of Object.values(bundle).sort((a, b) => a.fileName.localeCompare(b.fileName))) {
        if (file.fileName.endsWith('.map')) continue
        urls.add('/' + file.fileName)
        hash.update(file.fileName)
        hash.update(file.type === 'chunk' ? file.code : file.source)
      }
      // Files copied from public/ (the manifest, icons) are not in the bundle. _headers is for the host, not for the browser.
      for (const name of readdirSync(publicDir).sort()) {
        if (name === '_headers') continue
        urls.add('/' + name)
        hash.update(name)
        hash.update(readFileSync(join(publicDir, name)))
      }
      const source = WORKER.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__SHELL__', JSON.stringify([...urls].sort(), null, 1))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
