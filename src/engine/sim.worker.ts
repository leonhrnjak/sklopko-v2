import { SimHost, type Command } from './remote'
import { installEngine } from './wasm'

/** The simulation of the canvas, run in a Web Worker (see `engine/remote.ts` and docs/spec-sim-worker.md). */
// Messages that arrive while the Rust engine's module is still being compiled wait for it, so the first Simulator already has it
// (docs/spec-sim-wasm.md). If the module cannot be loaded there is no engine to run instead: the page is told (`fatal`) and shows it.
const out = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void }
const early: Command[] = []
let host: SimHost | null = null
let failed = false
self.onmessage = (e: MessageEvent<Command>) => {
  if (host) host.handle(e.data)
  else if (!failed) early.push(e.data)
}
installEngine()
  .then(() => {
    host = new SimHost(out)
    for (const m of early) host.handle(m)
    early.length = 0
  })
  .catch((e) => {
    failed = true
    early.length = 0
    out.postMessage({ t: 'fatal', message: e instanceof Error ? e.message : String(e) })
  })
