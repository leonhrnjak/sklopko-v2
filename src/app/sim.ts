import { Simulator } from '../engine/simulator'
import { simComps, type Circuit } from '../model/circuit'

/** The one simulator instance driving the canvas. */
export const sim = new Simulator()

export function loadIntoSim(c: Circuit) {
  sim.load({
    comps: simComps(c),
    wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })),
  })
}
