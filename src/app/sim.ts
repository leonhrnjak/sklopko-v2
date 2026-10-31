import { Simulator } from '../engine/simulator'
import { flatten } from '../model/buses'
import type { Circuit } from '../model/circuit'
import { exactOf, historyOf } from '../model/ic'

/** The one simulator instance driving the canvas. */
export const sim = new Simulator()

export function loadIntoSim(c: Circuit) {
  sim.setHistory(historyOf(c))
  sim.setFast(!exactOf(c))
  sim.load(flatten(c))
}
