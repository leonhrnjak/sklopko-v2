import { getDef, hasDef } from '../engine/registry'
import { RECV, SEND, resolveLabels } from '../engine/netlabels'
import type { SimCircuit } from '../engine/simulator'
import type { Circuit, PinRef, Wire } from './circuit'

export interface Trace {
  /** The output pin that really drives the signal (label hops followed), or null for an unknown wire. */
  source: PinRef | null
  /** Every wire of the signal: the ones leaving the source, and the ones leaving receive labels that carry it. */
  wires: Set<string>
  /** Every pin the signal reaches (`comp:pin`), the source included. */
  pins: Set<string>
}

/** The most wires a fan-in cone may include; a deep design would otherwise light up everything. */
export const CONE_LIMIT = 400

const key = (p: PinRef) => `${p.comp}:${p.pin}`

const asSim = (c: Circuit): SimCircuit => ({
  comps: Object.values(c.comps).map(({ id, type, params }) => ({ id, type, params })),
  wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })),
})

/** The output pin that drives `wire`: its own source, or, for a wire leaving a receive label, the signal that label carries. */
function driverOf(wire: Wire, labels: Map<string, PinRef>): PinRef {
  return labels.get(wire.from.comp) ?? wire.from
}

/** The signal a wire belongs to: every wire and pin it reaches, also through net labels. */
export function traceNet(c: Circuit, wireId: string): Trace {
  const start = c.wires[wireId]
  const trace: Trace = { source: null, wires: new Set(), pins: new Set() }
  if (!start) return trace
  const labels = resolveLabels(asSim(c))
  const source = driverOf(start, labels)
  trace.source = source
  trace.pins.add(key(source))
  for (const w of Object.values(c.wires)) {
    if (key(driverOf(w, labels)) !== key(source)) continue
    trace.wires.add(w.id)
    trace.pins.add(key(w.to))
    // A receive label's own output pin is part of the path too.
    if (labels.has(w.from.comp)) trace.pins.add(key(w.from))
  }
  return trace
}

/** Parts whose outputs follow their inputs (gates, adders, ROMs…): a cone runs through them, but stops at memory and sources. */
function isCombinational(type: string): boolean {
  if (!hasDef(type)) return false
  const def = getDef(type)
  return !def.init && !def.clockHalfPeriod && !def.interactive
}

/**
 * What feeds a signal: the wires into the part that drives it, and, through parts that are purely combinational, the
 * wires into those, and so on. It stops at flip-flops, registers, memories, clocks and switches (their outputs are
 * where the cone ends), and at `CONE_LIMIT` wires. Net labels are followed. The signal's own wires are not included.
 */
export function traceCone(c: Circuit, wireId: string): Set<string> {
  const cone = new Set<string>()
  const start = c.wires[wireId]
  if (!start) return cone
  const labels = resolveLabels(asSim(c))
  const own = traceNet(c, wireId).wires
  const visited = new Set<string>()
  const queue = [driverOf(start, labels).comp]
  while (queue.length && cone.size < CONE_LIMIT) {
    const comp = queue.shift()!
    if (visited.has(comp)) continue
    visited.add(comp)
    for (const w of Object.values(c.wires)) {
      if (w.to.comp !== comp) continue
      const driver = driverOf(w, labels)
      if (!own.has(w.id)) cone.add(w.id)
      // The wire that carries the signal into a Send label on its way to this part belongs to the cone as well.
      if (labels.has(w.from.comp)) {
        const name = String(c.comps[w.from.comp].params.name)
        for (const feed of Object.values(c.wires)) {
          const into = c.comps[feed.to.comp]
          if (into?.type === SEND && into.params.name === name && key(feed.from) === key(driver)) cone.add(feed.id)
        }
      }
      const src = c.comps[driver.comp]
      if (src && src.type !== RECV && isCombinational(src.type)) queue.push(driver.comp)
    }
  }
  return cone
}
