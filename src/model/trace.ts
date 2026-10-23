import { getDef, hasDef } from '../engine/registry'
import { RECV, SEND, resolveLabels } from '../engine/netlabels'
import { busModel, viewPinOf } from './buses'
import type { Circuit, PinRef, Wire } from './circuit'

export interface Trace {
  /** The output pin that really drives the signal (label, splitter and merger hops followed; for a bus, its lowest bit), or null for an unknown wire. */
  source: PinRef | null
  /** Every wire of the signal: the ones leaving the source, and the ones leaving receive labels, splitters and mergers that carry some of its bits. */
  wires: Set<string>
  /** Every pin the signal reaches (`comp:pin`), the source included. */
  pins: Set<string>
}

/** The most wires a fan-in cone may include; a deep design would otherwise light up everything. */
export const CONE_LIMIT = 400

const key = (p: PinRef) => `${p.comp}:${p.pin}`

/** Everything the tracing functions need about how a circuit's signals are wired, worked out once per circuit. */
function wiring(c: Circuit) {
  const m = busModel(c)
  const labels = resolveLabels(m.sim)
  /** The output pins that really drive a wire, bit by bit: hops through splitters, mergers and net labels are followed. */
  const drivers = (w: Wire): PinRef[] => (m.bits.get(w.id) ?? []).flatMap((b) => (b ? [labels.get(b.comp) ?? b] : []))
  return { m, labels, drivers }
}

/** The signal a wire belongs to: every wire and pin it reaches, also through net labels, splitters and mergers. */
export function traceNet(c: Circuit, wireId: string): Trace {
  const start = c.wires[wireId]
  const trace: Trace = { source: null, wires: new Set(), pins: new Set() }
  if (!start) return trace
  const { drivers } = wiring(c)
  const own = drivers(start)
  if (!own.length) {
    // Nothing drives it (an open splitter, a label nobody publishes): just this wire.
    trace.wires.add(start.id)
    trace.pins.add(key(start.from)).add(key(start.to))
    return trace
  }
  const source = viewPinOf(c, own[0])
  trace.source = source
  trace.pins.add(key(source))
  const bitsOfSignal = new Set(own.map(key))
  for (const w of Object.values(c.wires)) {
    if (!drivers(w).some((d) => bitsOfSignal.has(key(d)))) continue
    trace.wires.add(w.id)
    trace.pins.add(key(w.to))
    // The output pin of a label, splitter or merger on the way is part of the path too.
    trace.pins.add(key(w.from))
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
 * where the cone ends), and at `CONE_LIMIT` wires. Net labels, splitters and mergers are followed. The signal's own wires
 * are not included.
 */
export function traceCone(c: Circuit, wireId: string): Set<string> {
  const cone = new Set<string>()
  const start = c.wires[wireId]
  if (!start) return cone
  const { m, labels, drivers } = wiring(c)
  const own = traceNet(c, wireId).wires
  const visited = new Set<string>()
  const queue = [...new Set(drivers(start).map((d) => d.comp))]
  while (queue.length && cone.size < CONE_LIMIT) {
    const comp = queue.shift()!
    if (visited.has(comp)) continue
    visited.add(comp)
    for (const w of Object.values(c.wires)) {
      if (w.to.comp !== comp) continue
      const ds = drivers(w)
      if (!own.has(w.id)) cone.add(w.id)
      // The wires that carry the signal through splitters, mergers and bus labels on its way to this part belong to the cone as well.
      for (const f of m.upstream(w)) if (!own.has(f.id)) cone.add(f.id)
      // So do the wires that bring it into a Send label on its way.
      for (const b of m.bits.get(w.id) ?? []) {
        const label = b && labels.has(b.comp) ? c.comps[b.comp] : undefined
        if (!label) continue
        const driver = labels.get(b!.comp)!
        for (const feed of Object.values(c.wires)) {
          const into = c.comps[feed.to.comp]
          if (into?.type === SEND && into.params.name === label.params.name && drivers(feed).some((d) => key(d) === key(driver))) cone.add(feed.id)
        }
      }
      for (const d of ds) {
        const src = c.comps[d.comp]
        if (src && src.type !== RECV && isCombinational(src.type)) queue.push(d.comp)
      }
    }
  }
  return cone
}
