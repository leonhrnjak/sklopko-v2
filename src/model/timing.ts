import { RECV, SEND, resolveLabels } from '../engine/netlabels'
import { getDef, hasDef } from '../engine/registry'
import { isWiringPart } from '../engine/viewlayout'
import { busModel, viewPinOf } from './buses'
import { compLayout, isAnnotation, type Circuit, type Comp, type PinRef, type Wire } from './circuit'

/**
 * Static timing: how many gate delays the slowest signal takes to get from where it starts to where it is used. No
 * simulation is involved, only the circuit's structure and the delay of each part (`Comp.delay`, 1 by default).
 *
 * - A path **starts** at a switch, button, clock or constant (time 0), or at the output of a part that remembers
 *   (a flip-flop, register, counter, latch): its output is ready one clock-to-output delay after the clock edge.
 * - It **ends** at an input of a part that remembers (the value must be there before the clock edge), at a RAM (which also
 *   passes a changed address straight through to its output), or at a display or other part that only shows a value.
 * - Through everything else (gates, adders, multiplexers, ROMs) the time adds up: a part's outputs are ready its delay after
 *   the last of its inputs.
 * - Net labels add no time, and are followed.
 * - **Feedback loops** made of gates (a latch built from NANDs, a ring oscillator) have no longest path. They are listed and
 *   left out: paths start again at their outputs.
 */

/** Parts that remember a value across a clock edge. (A RAM also remembers, but is handled on its own.) */
const SEQUENTIAL = new Set(['srlatch', 'dlatch', 'dff', 'jkff', 'tff', 'counter', 'counterld', 'register', 'shiftreg', 'ringcounter', 'busreg', 'busctr'])
/** Parts that measure rather than are part of the hardware: nothing needs to arrive at them in time. */
const MEASURING = new Set(['probe', 'breakpoint'])

export interface PathStep {
  comp: string
  /** The part's own delay, in gate delays (0 for the start of a path that begins at a switch or clock, and for the end). */
  delay: number
  /** When this part's output is ready, counted from the start of the path. */
  arrival: number
}

export interface TimingPath {
  /** Gate delays from the start of the path to its end. */
  delay: number
  /** The parts along it, in order, with the end point last. */
  steps: PathStep[]
  /** Every wire it runs along (also those into and out of net labels). */
  wires: string[]
  /** Every pin it passes (`comp:pin`), for marking them on the canvas. */
  pins: Set<string>
  /** The input pin at the end of the path. */
  end: PinRef
}

export interface Endpoint {
  comp: string
  pin: string
  /** When the signal is ready there, in gate delays after the start. */
  arrival: number
}

export interface Timing {
  /** The slowest path, or null if the circuit has nothing to time. */
  critical: TimingPath | null
  /** Where signals arrive latest: the slowest few, one per input pin. */
  endpoints: Endpoint[]
  /** Groups of parts that feed back on themselves (not analysed). */
  loops: string[][]
}

const key = (p: PinRef) => `${p.comp}:${p.pin}`

/** How many end points are reported. */
export const ENDPOINTS_SHOWN = 10

type Role = 'source' | 'sequential' | 'ram' | 'combinational' | 'sink' | 'ignored'

function roleOf(k: Comp): Role {
  if (!hasDef(k.type) || isAnnotation(k) || k.type === SEND || k.type === RECV || isWiringPart(k.type, k.params)) return 'ignored'
  if (MEASURING.has(k.type)) return 'ignored'
  const def = getDef(k.type)
  if (def.interactive || def.clockHalfPeriod || k.type === 'const') return 'source'
  if (SEQUENTIAL.has(k.type)) return 'sequential'
  if (k.type === 'ram') return 'ram'
  return compLayout(k).pins.some((p) => p.dir === 'out') ? 'combinational' : 'sink'
}

/** Strongly connected components with a cycle (Tarjan's algorithm, without recursion so a long chain cannot overflow the stack). */
function cycles(nodes: string[], next: Map<string, string[]>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const found: string[][] = []
  let counter = 0
  for (const root of nodes) {
    if (index.has(root)) continue
    const work: { node: string; i: number }[] = [{ node: root, i: 0 }]
    index.set(root, counter)
    low.set(root, counter++)
    stack.push(root)
    onStack.add(root)
    while (work.length) {
      const frame = work[work.length - 1]
      const out = next.get(frame.node) ?? []
      if (frame.i < out.length) {
        const to = out[frame.i++]
        if (!index.has(to)) {
          index.set(to, counter)
          low.set(to, counter++)
          stack.push(to)
          onStack.add(to)
          work.push({ node: to, i: 0 })
        } else if (onStack.has(to)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!))
      } else {
        work.pop()
        const parent = work[work.length - 1]
        if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!))
        if (low.get(frame.node) === index.get(frame.node)) {
          const group: string[] = []
          let n: string
          do {
            n = stack.pop()!
            onStack.delete(n)
            group.push(n)
          } while (n !== frame.node)
          if (group.length > 1 || (next.get(group[0]) ?? []).includes(group[0])) found.push(group)
        }
      }
    }
  }
  return found
}

/** Work out the slowest paths of a circuit. */
export function analyzeTiming(circuit: Circuit): Timing {
  const m = busModel(circuit)
  // The circuit with its custom ICs expanded, so a path can run through one (its parts are named `inst/part`).
  const c = m.circuit
  const comps = Object.values(c.comps)
  const labels = resolveLabels(m.sim)
  const roles = new Map<string, Role>(comps.map((k) => [k.id, roleOf(k)]))
  const role = (id: string) => roles.get(id) ?? 'ignored'

  /**
   * The output pins that really drive a wire, one for each part that drives some of its bits: through receive labels,
   * splitters and mergers, to the signal they carry.
   */
  const driversOf = (w: Wire): PinRef[] => {
    const seen = new Set<string>()
    const out: PinRef[] = []
    for (const b of m.bits.get(w.id) ?? []) {
      const d = b && (labels.get(b.comp) ?? b)
      if (d && !seen.has(d.comp)) {
        seen.add(d.comp)
        out.push(d)
      }
    }
    return out
  }
  const delayOf = (id: string) => c.comps[id].delay ?? 1

  /** Does this input pin take part in the delay through the part? (A RAM's output follows its address, not its data.) */
  const passes = (id: string, pin: string) => c.comps[id].type !== 'ram' || /^A(\d|$)/.test(pin)

  interface Edge {
    wire: Wire
    from: string
    to: string
    pin: string
  }
  const edges: Edge[] = []
  for (const w of Object.values(c.wires)) {
    if (role(w.to.comp) === 'ignored') continue
    for (const d of driversOf(w)) {
      if (role(d.comp) === 'ignored') continue
      edges.push({ wire: w, from: d.comp, to: w.to.comp, pin: w.to.pin })
    }
  }

  // Feedback loops among the parts that pass a signal straight through.
  const through = (id: string) => role(id) === 'combinational' || role(id) === 'ram'
  const next = new Map<string, string[]>()
  for (const e of edges) if (through(e.from) && through(e.to) && passes(e.to, e.pin)) next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  const loops = cycles(comps.filter((k) => through(k.id)).map((k) => k.id), next)
  const inLoop = new Set(loops.flat())

  // Arrival time of each part's outputs, parts in order of dependence (Kahn's algorithm).
  const arrival = new Map<string, number>()
  const via = new Map<string, Edge>() // the input that arrives last
  const incoming = new Map<string, Edge[]>()
  const pending = new Map<string, number>()
  const dependants = new Map<string, Edge[]>()
  for (const k of comps) {
    const r = role(k.id)
    if (r === 'source' || r === 'ignored' || r === 'sink') arrival.set(k.id, 0)
    else if (r === 'sequential' || inLoop.has(k.id)) arrival.set(k.id, r === 'sequential' ? delayOf(k.id) : 0)
  }
  const ready: string[] = []
  for (const k of comps) {
    if (!through(k.id) || inLoop.has(k.id)) continue
    const ins = edges.filter((e) => e.to === k.id && passes(k.id, e.pin))
    incoming.set(k.id, ins)
    const waiting = ins.filter((e) => !arrival.has(e.from) || (through(e.from) && !inLoop.has(e.from))).length
    pending.set(k.id, waiting)
    for (const e of ins) dependants.set(e.from, [...(dependants.get(e.from) ?? []), e])
    if (!waiting) ready.push(k.id)
  }
  const settle = (id: string) => {
    let best = 0
    let bestEdge: Edge | undefined
    for (const e of incoming.get(id) ?? []) {
      const a = arrival.get(e.from) ?? 0
      if (a > best || !bestEdge) {
        best = a
        bestEdge = e
      }
    }
    arrival.set(id, best + delayOf(id))
    if (bestEdge) via.set(id, bestEdge)
  }
  while (ready.length) {
    const id = ready.pop()!
    settle(id)
    for (const e of dependants.get(id) ?? []) {
      if (!pending.has(e.to)) continue
      const n = pending.get(e.to)! - 1
      pending.set(e.to, n)
      if (n === 0) ready.push(e.to)
    }
  }

  // Where signals arrive.
  const ends: (Endpoint & { edge: Edge })[] = []
  for (const e of edges) {
    const r = role(e.to)
    if (r !== 'sequential' && r !== 'ram' && r !== 'sink') continue
    if (inLoop.has(e.from)) continue
    ends.push({ comp: e.to, pin: e.pin, arrival: arrival.get(e.from) ?? 0, edge: e })
  }
  ends.sort((a, b) => b.arrival - a.arrival)
  const seen = new Set<string>()
  const endpoints: Endpoint[] = []
  for (const e of ends) {
    const k = `${e.comp}:${e.pin}`
    if (seen.has(k)) continue
    seen.add(k)
    endpoints.push({ comp: e.comp, pin: e.pin, arrival: e.arrival })
    if (endpoints.length >= ENDPOINTS_SHOWN) break
  }

  const top = ends[0]
  if (!top || top.arrival === 0) return { critical: null, endpoints, loops }

  /**
   * The wires that bring a signal to a Send label on its way: the path runs along them too. `driver` is the part it came from.
   */
  const sends = (w: Wire, driver: PinRef): Wire[] => {
    const out: Wire[] = []
    for (const b of m.bits.get(w.id) ?? []) {
      if (!b || !labels.has(b.comp) || labels.get(b.comp)!.comp !== driver.comp) continue
      const name = String(c.comps[b.comp].params.name)
      for (const f of Object.values(c.wires))
        if (c.comps[f.to.comp]?.type === SEND && c.comps[f.to.comp].params.name === name && driversOf(f).some((d) => d.comp === driver.comp)) out.push(f)
    }
    return out
  }

  // Walk back from the end along the inputs that arrive last.
  const steps: PathStep[] = []
  const wires: string[] = []
  const pins = new Set<string>()
  const mark = (w: Wire) => {
    wires.unshift(w.id)
    pins.add(key(w.from))
    pins.add(key(w.to))
  }
  let edge: Edge | undefined = top.edge
  steps.unshift({ comp: top.comp, delay: 0, arrival: top.arrival })
  while (edge) {
    const driver = driversOf(edge.wire).find((d) => d.comp === edge!.from)!
    for (const f of sends(edge.wire, driver)) wires.unshift(f.id)
    for (const f of m.upstream(edge.wire)) {
      wires.unshift(f.id)
      pins.add(key(f.from))
      pins.add(key(f.to))
    }
    mark(edge.wire)
    pins.add(key(viewPinOf(c, driver)))
    const k: string = edge.from
    const own = role(k) === 'source' ? 0 : delayOf(k)
    steps.unshift({ comp: k, delay: own, arrival: arrival.get(k) ?? 0 })
    edge = through(k) && !inLoop.has(k) ? via.get(k) : undefined
  }
  return { critical: { delay: top.arrival, steps, wires, pins, end: { comp: top.comp, pin: top.pin } }, endpoints, loops }
}

/** The part's name for a list: its label, or what kind of part it is. */
export const partName = (k: Comp): string => k.label || getDef(k.type).name
