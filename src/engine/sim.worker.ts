import { SimHost, type Command } from './remote'
import { installEngine } from './wasm'

/** The simulation of the canvas, run in a Web Worker (see `engine/remote.ts` and docs/spec-sim-worker.md). */
// Messages that arrive while the Rust engine's module is still being compiled wait for it, so the first Simulator already has it
// (docs/spec-sim-wasm.md). If the module cannot be loaded the simulation runs on the TypeScript engines, as before.
const early: Command[] = []
let host: SimHost | null = null
self.onmessage = (e: MessageEvent<Command>) => (host ? host.handle(e.data) : early.push(e.data))
installEngine()
  .catch(() => {})
  .then(() => {
    host = new SimHost(self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void })
    for (const m of early) host.handle(m)
  })
