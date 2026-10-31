import { SimHost } from './remote'

/** The simulation of the canvas, run in a Web Worker (see `engine/remote.ts` and docs/spec-sim-worker.md). */
const host = new SimHost(self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void })
self.onmessage = (e: MessageEvent) => host.handle(e.data)
