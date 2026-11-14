// Fails when the JavaScript the page loads before its first draw grows past the budget. Run after `npm run build`.
// The budget is gzipped size, what Cloudflare Pages sends (it serves gzip or brotli), so it does not move with the minifier.
// "Startup" is read from Vite's manifest (dist/.vite/manifest.json), not from index.html: it is the entry script, its static
// imports, and the chunks the entry loads with import() (src/main.tsx imports the engine, the runtime and App before it renders),
// each with its own static imports. Panels, the examples' builders and the exporters are chunks that load later and do not count.
// The WebAssembly module, the simulator's worker and the stylesheet are reported on their own lines, outside the budget.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 250
const dist = new URL('../dist/', import.meta.url).pathname
const manifestPath = join(dist, '.vite/manifest.json')
if (!existsSync(manifestPath)) {
  console.error('No dist/.vite/manifest.json: run `npm run build` first (vite.config.ts sets build.manifest).')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const entry = Object.values(manifest).find((c) => c.isEntry)
if (!entry) {
  console.error('The manifest has no entry chunk.')
  process.exit(1)
}

const chunks = new Set() // manifest keys of the chunks loaded at startup
const addWithImports = (key) => {
  if (chunks.has(key)) return
  chunks.add(key)
  for (const dep of manifest[key].imports ?? []) addWithImports(dep)
}
const entryKey = Object.keys(manifest).find((k) => manifest[k] === entry)
addWithImports(entryKey)
for (const dep of entry.dynamicImports ?? []) addWithImports(dep)

const gz = (file) => {
  const bytes = readFileSync(join(dist, file))
  return { kb: gzipSync(bytes, { level: 9 }).length / 1000, rawKb: bytes.length / 1000 }
}
const line = (s, file) => `${s.kb.toFixed(1).padStart(8)} kB gzip  (${s.rawKb.toFixed(1)} kB raw)  ${file}`

let total = 0
let raw = 0
for (const key of chunks) {
  const file = manifest[key].file
  const s = gz(file)
  total += s.kb
  raw += s.rawKb
  console.log(line(s, file))
}
console.log(`${total.toFixed(1).padStart(8)} kB gzip  (${raw.toFixed(1)} kB raw) loaded before the first draw (budget ${BUDGET_KB} kB gzip)`)

// Reported, not budgeted.
const extra = new Set([...(entry.assets ?? []), ...(entry.css ?? [])])
for (const key of chunks) for (const f of [...(manifest[key].assets ?? []), ...(manifest[key].css ?? [])]) extra.add(f)
for (const file of readdirSyncAssets()) if (/^assets\/sim\.worker-.*\.js$/.test(file)) extra.add(file)
console.log('Outside the budget:')
for (const file of [...extra].sort()) console.log(line(gz(file), file))

if (total > BUDGET_KB) {
  console.error(`Over budget by ${(total - BUDGET_KB).toFixed(1)} kB: load the new code on demand (React.lazy or import()).`)
  process.exit(1)
}

function readdirSyncAssets() {
  return readdirSync(join(dist, 'assets')).map((f) => 'assets/' + f)
}
