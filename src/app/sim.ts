import { Simulator } from '../engine/simulator'
import type { Circuit } from '../model/circuit'

/** The one simulator instance driving the canvas. */
export const sim = new Simulator()

export function loadIntoSim(c: Circuit) {
  sim.load({
    comps: Object.values(c.comps).map(({ id, type, params }) => ({ id, type, params })),
    wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })),
  })
}
