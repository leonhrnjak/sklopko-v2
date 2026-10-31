import { Simulator } from '../engine/simulator'
import { flatten } from '../model/buses'
import type { Circuit } from '../model/circuit'
import { exactOf, historyOf } from '../model/ic'

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
  | 'frame'
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
  | 'canStepBack'
  | 'getCapture'
  | 'captureVersion'
  | 'takeBreak'
  // notification
  | 'subscribe'
  | 'edgeHook'
>

/** The one simulator driving the canvas, seen only through `SimApi`. */
export const sim: SimApi = new Simulator()

export function loadIntoSim(c: Circuit) {
  sim.setHistory(historyOf(c))
  sim.setFast(!exactOf(c))
  sim.load(flatten(c))
}
