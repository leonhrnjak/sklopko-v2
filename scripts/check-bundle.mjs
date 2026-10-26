// Fails when the JavaScript the page loads at startup grows past the budget. Run after `npm run build`.
// The budget is gzipped size, what Cloudflare Pages sends (it serves gzip or brotli), so it does not move with the minifier.
// "Startup" is what dist/index.html asks for: the entry script and its modulepreloads. Panels, the examples' builders and
// the exporters are separate chunks that load on demand and do not count.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 183
const dist = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const files = [...html.matchAll(/<(?:script|link)[^>]*?(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])
if (!files.length) {
  console.error('No scripts found in dist/index.html: run `npm run build` first.')
  process.exit(1)
}
let total = 0
let raw = 0
for (const f of files) {
  const bytes = readFileSync(join(dist, f))
  const kb = gzipSync(bytes, { level: 9 }).length / 1000
  total += kb
  raw += bytes.length / 1000
  console.log(`${kb.toFixed(1).padStart(8)} kB gzip  (${(bytes.length / 1000).toFixed(1)} kB raw)  ${f}`)
}
console.log(`${total.toFixed(1).padStart(8)} kB gzip  (${raw.toFixed(1)} kB raw) loaded at startup (budget ${BUDGET_KB} kB gzip)`)
if (total > BUDGET_KB) {
  console.error(`Over budget by ${(total - BUDGET_KB).toFixed(1)} kB: load the new code on demand (React.lazy or import()).`)
  process.exit(1)
}
