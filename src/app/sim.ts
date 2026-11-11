import { WorkerSim, type Port } from '../engine/remote'
import { Simulator } from '../engine/simulator'
import { flatten } from '../model/buses'
import type { Circuit } from '../model/circuit'
import { exactOf, historyOf } from '../model/ic'
import { clearSimFailure, reportSimFailure } from './simHealth'

/**
 * What the app (the canvas, the inspectors, the footer, the runtime loop) may use of the canvas's simulator, and nothing else: the
 * seam for running it somewhere else (see docs/spec-sim-worker.md). The names are in three groups, which is how a worker would
 * treat them.
 *
 * - **Commands**: change the simulation and need no answer. Their results, if any, are looked at later through the reads.
 *   (`load`, `reset`, `settle`, `tick`, `stepClock`, `stepBack`, `frame`, `setParams`, `setState`, `writeWord`, `force`,
 *   `clearForces`, `setHistory`, `setFast`, `setCapture`, `publish`.)
 * - **Reads of what is drawn**: the net values and part states, and the numbers beside them. These are what a mirror on
 *   the page would hold. (`pinValue`, `signature`, `inputValues`, `state`, `netOf`, `netNames`, `idsOfType`, `time`, `unstable`,
 *   `engine`, `fastOn`, `fastestClockHz`, `clockTime`, `lagging`, `forceCount`, `forcedValue`, `historyOn`, `canStepBack`,
 *   `getCapture`, `captureVersion`, `takeBreak`.)
 * - **Notification**: `subscribe`, called after `publish`, and `edgeHook`, called at every clock edge while a path goal watches.
 */
export type SimApi = Pick<
  Simulator,
  // commands
  | 'load'
  | 'reset'
  | 'settle'
  | 'tick'
  | 'stepClock'
  | 'stepBack'
  | 'stepCpu'
  | 'terminal'
  | 'frame'
  | 'run'
  | 'setParams'
  | 'setState'
  | 'writeWord'
  | 'force'
  | 'clearForces'
  | 'setHistory'
  | 'setFast'
  | 'setCapture'
  | 'publish'
  // reads
  | 'pinValue'
  | 'signature'
  | 'inputValues'
  | 'state'
  | 'netOf'
  | 'netNames'
  | 'idsOfType'
  | 'time'
  | 'unstable'
  | 'engine'
  | 'fastOn'
  | 'fastestClockHz'
  | 'clockTime'
  | 'lagging'
  | 'forceCount'
  | 'forcedValue'
  | 'historyOn'
  | 'wasmOn'
  | 'canStepBack'
  | 'getCapture'
  | 'captureVersion'
  | 'takeBreak'
  // notification
  | 'subscribe'
  | 'edgeHook'
  | 'threaded'
>

/**
 * The one simulator driving the canvas, seen only through `SimApi`. It runs in a Web Worker where there is one (docs/spec-sim-worker.md),
 * otherwise, and with `?thread=main` in the address, on the page itself.
 */
function makeSim(): SimApi {
  const inWorker = typeof Worker === 'function' && typeof location !== 'undefined' && !/[?&]thread=main\b/.test(location.search)
  if (!inWorker) return new Simulator()
  try {
    const spawn = () => new Worker(new URL('../engine/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as Port
    return new WorkerSim(spawn(), spawn, reportSimFailure)
  } catch {
    return new Simulator()
  }
}
export const sim: SimApi = makeSim()

export function loadIntoSim(c: Circuit) {
  sim.setHistory(historyOf(c))
  sim.setFast(!exactOf(c))
  sim.load(flatten(c))
}

/**
 * "Restart simulator": a new worker, loaded with the current circuit. The page's own engine is loaded again first (it is what the
 * analyses use, and the reason may have been a failed fetch). A failure is reported as before.
 */
export async function restartSim() {
  try {
    const { installEngine } = await import('../engine/wasm')
    await installEngine()
    if (sim instanceof WorkerSim && !sim.restart()) throw new Error('The simulator cannot be restarted here. Reload the page.')
    clearSimFailure()
  } catch (e) {
    reportSimFailure(e)
  }
}
