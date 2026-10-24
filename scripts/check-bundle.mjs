// Fails when the JavaScript the page loads at startup grows past the budget. Run after `npm run build`.
// "Startup" is what dist/index.html asks for: the entry script and its modulepreloads. Panels, the examples' builders and
// the exporters are separate chunks that load on demand and do not count.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BUDGET_KB = 500
const dist = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const files = [...html.matchAll(/<(?:script|link)[^>]*?(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])
if (!files.length) {
  console.error('No scripts found in dist/index.html: run `npm run build` first.')
  process.exit(1)
}
let total = 0
for (const f of files) {
  const kb = statSync(join(dist, f)).size / 1000
  total += kb
  console.log(`${kb.toFixed(1).padStart(8)} kB  ${f}`)
}
console.log(`${total.toFixed(1).padStart(8)} kB  loaded at startup (budget ${BUDGET_KB} kB)`)
if (total > BUDGET_KB) {
  console.error(`Over budget by ${(total - BUDGET_KB).toFixed(1)} kB: load the new code on demand (React.lazy or import()).`)
  process.exit(1)
}
