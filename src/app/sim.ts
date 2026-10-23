import { Simulator } from '../engine/simulator'
import { flatten } from '../model/buses'
import type { Circuit } from '../model/circuit'

/** The one simulator instance driving the canvas. */
export const sim = new Simulator()

export function loadIntoSim(c: Circuit) {
  sim.load(flatten(c))
}
