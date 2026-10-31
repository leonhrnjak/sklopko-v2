import { SimHost } from './remote'
import { engineUrl, loadEngine } from './wasm'
import { openFor } from './wasmengine'

/** The simulation of the canvas, run in a Web Worker (see `engine/remote.ts` and docs/spec-sim-worker.md). */
const host = new SimHost(self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void })
self.onmessage = (e: MessageEvent) => host.handle(e.data)

// The Rust engine (docs/spec-sim-wasm.md): started when the module has loaded; until then, and for circuits it cannot run, the TypeScript
// engines do the work. If the module cannot be loaded the simulation is simply as it was.
fetch(engineUrl)
  .then((r) => r.arrayBuffer())
  .then(loadEngine)
  .then((x) => host.useWasm(openFor(x)))
  .catch(() => {})
