import { groupsOf, isBusLabel, pinWidth, splitOffsets, splitWidths } from '../engine/bus'
import { RECV, SEND, resolveLabels } from '../engine/netlabels'
import { getDef, hasDef } from '../engine/registry'
import type { SimCircuit, SimComp, SimWire } from '../engine/simulator'
import { isWiringPart } from '../engine/viewlayout'
import { findPin, simComps, type Circuit, type Comp, type PinRef, type Wire } from './circuit'
import { expandICs } from './ic'

/**
 * Buses are a front end. The model, the router and the canvas see one thick wire between two bus pins; before it is
 * simulated, `flatten` turns it into one wire per bit and drops the parts that are pure wiring (splitters, mergers, labels
 * that carry a bus). The simulator itself only knows single bits: it gets the parts' own ids and scalar pins, so probes,
 * breakpoints, glitch rows and VCD names keep working.
 */

/** What drives one bit of a wire: a scalar output pin of a real part, `X_SOURCE`, or nothing (null: an input left open). */
export type BitSource = PinRef | null

/** Reads X for ever: what a bus label nothing publishes (or a loop of labels) carries. The only part `flatten` adds. */
export const X_SOURCE: PinRef = { comp: '#x', pin: 'Y' }

export interface BusModel {
  /**
   * The circuit with its custom ICs expanded (see `expandICs`): the circuit itself when it has none. The wires of the circuit keep
   * their ids in it; what the simulator and `bits` name is in this circuit, and the parts inside an IC are only in this one.
   */
  circuit: Circuit
  /** Where the pins of the circuit's IC instances went (`inst:PIN` → a label part), for showing their values. */
  connectors: Map<string, PinRef>
  /** The circuit as the simulator wants it. */
  sim: SimCircuit
  /** For each wire (by id), what drives each of its bits, lowest first. One entry for an ordinary wire. */
  bits: Map<string, BitSource[]>
  /** The same by net (`comp:pin` of the wire's source pin), for what is drawn at the source: junction dots. */
  netBits: Map<string, BitSource[]>
  /** The wires that feed a wire through the splitters, mergers and bus labels at its start, nearest first. */
  upstream(w: Wire): Wire[]
}

const key = (p: PinRef) => `${p.comp}:${p.pin}`

const cache = new WeakMap<Circuit, BusModel>()

/** Everything about the buses of a circuit, worked out once per circuit (circuits are never changed in place). */
export function busModel(c: Circuit): BusModel {
  let m = cache.get(c)
  if (!m) {
    m = build(c)
    cache.set(c, m)
  }
  return m
}

/** The circuit as the simulator wants it: bus wires split per bit, pure wiring removed. */
export const flatten = (c: Circuit): SimCircuit => busModel(c).sim

/** The pin a scalar pin is drawn as: its bus pin when the part is in bus mode, else itself. */
export function viewPinOf(c: Circuit, ref: PinRef): PinRef {
  const k = c.comps[ref.comp]
  if (!k || !hasDef(k.type)) return ref
  const g = groupsOf(getDef(k.type), k.params).find((x) => x.pins.includes(ref.pin))
  return g ? { comp: ref.comp, pin: g.name } : ref
}

/** The scalar pins of a pin: its members when it is a bus pin of a part in bus mode, else just itself. */
export function scalarPins(k: Comp, pin: string): string[] {
  if (!hasDef(k.type)) return [pin]
  const g = groupsOf(getDef(k.type), k.params).find((x) => x.name === pin)
  return g ? g.pins : [pin]
}

function build(original: Circuit): BusModel {
  const { circuit: c, connectors } = expandICs(original)
  const wires = Object.values(c.wires)
  const feed = new Map<string, Wire>()
  for (const w of wires) feed.set(key(w.to), w)
  const wiring = (k: Comp | undefined) => !!k && isWiringPart(k.type, k.params)

  // The first Send label of a name that is driven publishes it (for the labels that carry a bus).
  const published = new Map<string, { wire: Wire; bits: number }>()
  for (const k of Object.values(c.comps)) {
    if (k.type !== SEND || !isBusLabel(k.type, k.params) || !k.params.name) continue
    const w = feed.get(`${k.id}:A`)
    if (w && !published.has(String(k.params.name))) published.set(String(k.params.name), { wire: w, bits: Number(k.params.bits) })
  }
  /** The wire a bus Receive label carries, if some Send label of its name and width publishes one. */
  const carried = (k: Comp) => {
    const p = published.get(String(k.params.name))
    return p && p.bits === Number(k.params.bits) ? p.wire : undefined
  }

  /** What drives bit `bit` of output pin `pin` of `comp`, looking back through pure wiring. */
  const source = (comp: Comp | undefined, pin: string, bit: number, seen: Set<string>): BitSource => {
    if (!comp || !hasDef(comp.type)) return null
    if (!wiring(comp)) {
      const g = groupsOf(getDef(comp.type), comp.params).find((x) => x.name === pin)
      if (!g) return { comp: comp.id, pin }
      return g.pins[bit] ? { comp: comp.id, pin: g.pins[bit] } : null
    }
    const at = `${comp.id}:${pin}:${bit}`
    if (seen.has(at)) return X_SOURCE // a loop of wiring
    seen.add(at)
    const through = (w: Wire | undefined, b: number): BitSource => (w ? source(c.comps[w.from.comp], w.from.pin, b, seen) : null)
    if (comp.type === 'splitter') {
      const o = splitOffsets(comp.params)[Number(pin.slice(1))]
      return o === undefined ? null : through(feed.get(`${comp.id}:A`), o + bit)
    }
    if (comp.type === 'merger') {
      const widths = splitWidths(comp.params)
      const offsets = splitOffsets(comp.params)
      const i = offsets.findIndex((o, n) => bit >= o && bit < o + widths[n])
      return i < 0 ? null : through(feed.get(`${comp.id}:A${i}`), bit - offsets[i])
    }
    // A Receive label that carries a bus.
    const w = carried(comp)
    return w ? through(w, bit) : X_SOURCE
  }

  const bits = new Map<string, BitSource[]>()
  const netBits = new Map<string, BitSource[]>()
  for (const w of wires) {
    const fc = c.comps[w.from.comp]
    const fp = fc && hasDef(fc.type) && findPin(fc, w.from.pin)
    if (!fp) continue
    const b = Array.from({ length: pinWidth(fp.def) }, (_, i) => source(fc, w.from.pin, i, new Set()))
    bits.set(w.id, b)
    netBits.set(key(w.from), b)
  }

  const simWires: SimWire[] = []
  let usesX = false
  for (const w of wires) {
    const tc = c.comps[w.to.comp]
    const b = bits.get(w.id)
    if (!b || !tc || !hasDef(tc.type) || wiring(tc)) continue
    const members = scalarPins(tc, w.to.pin)
    b.forEach((src, i) => {
      if (!src || !members[i]) return
      if (src === X_SOURCE) usesX = true
      simWires.push({ from: src, to: members.length === 1 && b.length === 1 ? w.to : { comp: tc.id, pin: members[i] } })
    })
  }
  const comps: SimComp[] = simComps(c).filter((k) => !isWiringPart(k.type, k.params))
  if (usesX) comps.push({ id: X_SOURCE.comp, type: RECV, params: { name: '', bits: 1 } })

  const upstream = (w: Wire): Wire[] => {
    const out: Wire[] = []
    const seen = new Set<string>()
    const visit = (x: Wire) => {
      const k = c.comps[x.from.comp]
      if (!k || !wiring(k)) return
      let ins: (Wire | undefined)[] = []
      if (k.type === 'splitter') ins = [feed.get(`${k.id}:A`)]
      else if (k.type === 'merger') ins = splitWidths(k.params).map((_, i) => feed.get(`${k.id}:A${i}`))
      else if (k.type === RECV) ins = [carried(k)]
      for (const f of ins)
        if (f && !seen.has(f.id)) {
          seen.add(f.id)
          out.push(f)
          visit(f)
        }
    }
    visit(w)
    return out
  }

  const sim = { comps, wires: simWires }
  return { circuit: c, connectors, sim: { ...sim, aliases: resolveLabels(sim) }, bits, netBits, upstream }
}
