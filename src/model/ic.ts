import { RECV, SEND } from '../engine/netlabels'
import { getDef, hasDef } from '../engine/registry'
import { encodePins, type IcPin } from '../engine/components/ic'
import type { Params } from '../engine/types'
import { emptyCircuit, type Circuit, type Comp, type ICDef, type PinRef } from './circuit'
import { isLabel } from './labels'

/**
 * Custom ICs. A definition is a circuit; its interface is the labelled parts inside: switches and bus inputs are inputs, LEDs and
 * bus displays are outputs. An instance is an ordinary part (type `ic`) whose params carry the pins, so the model, router and
 * canvas treat it like any other part. For simulation `expandICs` puts the definition's parts in its place.
 */

/** The part type of an instance. */
export const IC = 'ic'

const INPUTS = new Set(['switch', 'busin'])
const OUTPUTS = new Set(['led', 'busdisp'])

/** One pin of an interface, and the part inside that it belongs to. */
export interface InterfacePin extends IcPin {
  comp: string
}
export interface Interface {
  inputs: InterfacePin[]
  outputs: InterfacePin[]
}

const reading = (a: Comp, b: Comp) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)

/** A pin name from a part's label: letters, digits and underscores only. */
const nameFrom = (label: string | undefined) => (label ?? '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)

const widthOf = (k: Comp) => (k.type === 'busin' || k.type === 'busdisp' ? Math.max(1, Math.min(32, Math.round(Number(k.params.bits)) || 1)) : 1)

/**
 * The pins of a circuit used as an IC: inputs and outputs, each from top to bottom as they were placed. A pin is named after its
 * part's label (`in1`, `in2`… and `out1`… when it has none); a name already taken gets `_2`.
 */
export function deriveInterface(c: Circuit): Interface {
  const taken = new Set<string>()
  const pins = (types: Set<string>, fallback: string): InterfacePin[] =>
    Object.values(c.comps)
      .filter((k) => types.has(k.type))
      .sort(reading)
      .map((k, i) => {
        const base = nameFrom(k.label) || `${fallback}${i + 1}`
        let name = base
        for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
        taken.add(name)
        return { name, bits: widthOf(k), comp: k.id }
      })
  return { inputs: pins(INPUTS, 'in'), outputs: pins(OUTPUTS, 'out') }
}

/** The params an instance of this IC has: what it is, what it is called and its pins. */
export function icParams(def: ICDef): Params {
  const { inputs, outputs } = deriveInterface(def.circuit)
  const strip = ({ name, bits }: InterfacePin) => ({ name, bits })
  return { ic: def.id, name: def.name, ins: encodePins(inputs.map(strip)), outs: encodePins(outputs.map(strip)) }
}

/** The ICs a circuit places directly (ids, each once). */
export const placedICs = (c: Circuit): string[] => [...new Set(Object.values(c.comps).filter((k) => k.type === IC).map((k) => String(k.params.ic)))]

/** An IC that contains itself, directly or through others: the ids on the loop, or null when there is none. */
export function findCycle(ics: Record<string, ICDef>): string[] | null {
  const state = new Map<string, 'open' | 'done'>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    const s = state.get(id)
    if (s === 'done') return null
    if (s === 'open') return path.slice(path.indexOf(id))
    state.set(id, 'open')
    path.push(id)
    for (const inner of placedICs(ics[id].circuit)) {
      if (!ics[inner]) continue
      const loop = visit(inner)
      if (loop) return loop
    }
    path.pop()
    state.set(id, 'done')
    return null
  }
  for (const id of Object.keys(ics)) {
    const loop = visit(id)
    if (loop) return loop
  }
  return null
}

/** Would placing `inner` in the definition `host` make an IC contain itself? */
export function wouldLoop(ics: Record<string, ICDef>, host: string, inner: string): boolean {
  if (host === inner) return true
  const seen = new Set<string>()
  const reaches = (id: string): boolean => {
    if (id === host) return true
    if (seen.has(id) || !ics[id]) return false
    seen.add(id)
    return placedICs(ics[id].circuit).some(reaches)
  }
  return reaches(inner)
}

/** What is wrong with a circuit as an IC, in words (empty: it is fine). */
export function icProblems(c: Circuit): string[] {
  const { inputs, outputs } = deriveInterface(c)
  const problems: string[] = []
  if (!inputs.length) problems.push('It has no inputs: put a switch (or bus input) in the circuit; each one becomes an input pin.')
  if (!outputs.length) problems.push('It has no outputs: put an LED (or bus display) in the circuit; each one becomes an output pin.')
  return problems
}

/** Parts inside an instance are not seen, so these do not exist there: displays, notes, probes, breakpoints, speakers. */
function droppedInside(k: Comp): boolean {
  if (!hasDef(k.type)) return true
  return k.type === 'probe' || k.type === 'breakpoint' || k.type === 'speaker' || ['display', 'annotation'].includes(getDef(k.type).category)
}

/** The deepest an IC can be placed in an IC (a guard: `findCycle` is what stops a loop). */
const MAX_DEPTH = 24

export interface Expansion {
  /** The circuit with every instance replaced by its parts. The same circuit when there is no instance. */
  circuit: Circuit
  /** Where the pins of the instances of the top-level circuit went: `inst:PIN` → the part that carries it (a Receive label for an output, a Send label for an input). */
  connectors: Map<string, PinRef>
}

/**
 * The circuit as a plain one, for simulation and everything built on it (`flatten`, `busModel`).
 * - The parts of an instance come in with ids `inst/inner`, and its wires with ids `inst/wire`. Wires of the top-level circuit
 *   keep their ids.
 * - An instance's inputs and outputs are joined to the inside by net labels, which add no delay: the wire into an input goes to a
 *   Send label, and inside, a Receive label of that name stands where the switch was; an LED inside becomes a Send label, and the
 *   wires that leave the output come from a Receive label of its name. An input nothing drives reads X.
 * - Net labels inside are scoped to the instance (their names get the instance's path in front). Displays, notes, probes,
 *   breakpoints and speakers inside are dropped. Memories keep their state through their ids.
 * - An instance of an IC that is not there, or that contains itself, is dropped with its wires.
 */
export function expandICs(c: Circuit): Expansion {
  const connectors = new Map<string, PinRef>()
  if (!Object.values(c.comps).some((k) => k.type === IC)) return { circuit: c, connectors }
  const ics = c.ics ?? {}
  const out = emptyCircuit()
  const interfaces = new Map<string, Interface>()
  const interfaceOf = (def: ICDef) => {
    let i = interfaces.get(def.id)
    if (!i) interfaces.set(def.id, (i = deriveInterface(def.circuit)))
    return i
  }

  /** `prefix` is the path of the instance whose body this is (`a/b/`), or '' for the top level. */
  const emit = (circ: Circuit, prefix: string, stack: string[]) => {
    const body = prefix !== ''
    const roles = new Map<string, { dir: 'in' | 'out'; pin: InterfacePin }>()
    if (body) {
      const i = deriveInterface(circ)
      for (const pin of i.inputs) roles.set(pin.comp, { dir: 'in', pin })
      for (const pin of i.outputs) roles.set(pin.comp, { dir: 'out', pin })
    }

    for (const k of Object.values(circ.comps)) {
      if (k.type === IC || (body && droppedInside(k))) continue
      if (!hasDef(k.type)) continue
      const role = roles.get(k.id)
      if (role) {
        // The interface part stands as a label: what the instance's pin carries comes in (or goes out) by this name.
        const type = role.dir === 'in' ? RECV : SEND
        out.comps[prefix + k.id] = { id: prefix + k.id, type, x: k.x, y: k.y, rot: 0, flip: false, params: { name: `${prefix}${role.dir}:${role.pin.name}`, bits: role.pin.bits } }
        continue
      }
      const scoped = body && isLabel(k.type) && k.params.name ? { ...k.params, name: `${prefix}l:${k.params.name}` } : k.params
      out.comps[prefix + k.id] = { ...k, id: prefix + k.id, params: scoped }
    }

    const instances = new Map<string, { def: ICDef; path: string }>()
    for (const k of Object.values(circ.comps)) {
      if (k.type !== IC) continue
      const def = ics[String(k.params.ic)]
      if (!def || stack.includes(def.id) || stack.length >= MAX_DEPTH) continue
      const path = `${prefix}${k.id}/`
      instances.set(k.id, { def, path })
      emit(def.circuit, path, [...stack, def.id])
    }

    /** A label at an instance's pin, made when a wire needs it. */
    const connector = (inst: string, pinName: string, dir: 'in' | 'out'): PinRef | null => {
      const it = instances.get(inst)
      const pin = it && (dir === 'in' ? interfaceOf(it.def).inputs : interfaceOf(it.def).outputs).find((p) => p.name === pinName)
      if (!it || !pin) return null
      const id = `${it.path}#${dir}:${pin.name}`
      if (!out.comps[id]) {
        const host = circ.comps[inst]
        out.comps[id] = { id, type: dir === 'in' ? SEND : RECV, x: host.x, y: host.y, rot: 0, flip: false, params: { name: `${it.path}${dir}:${pin.name}`, bits: pin.bits } }
      }
      const ref = { comp: id, pin: dir === 'in' ? 'A' : 'Y' }
      if (!body) connectors.set(`${inst}:${pinName}`, ref)
      return ref
    }
    /** Where a wire's pin is in the expanded circuit: on a part, or on the label standing for an instance's pin. */
    const place = (ref: PinRef, dir: 'from' | 'to'): PinRef | null => {
      if (circ.comps[ref.comp]?.type === IC) return connector(ref.comp, ref.pin, dir === 'from' ? 'out' : 'in')
      const id = prefix + ref.comp
      if (!out.comps[id]) return null
      // An input of this instance is a Receive label now (its pin is Y); an output is a Send label (its pin is A, as it was).
      return roles.get(ref.comp)?.dir === 'in' ? { comp: id, pin: 'Y' } : { comp: id, pin: ref.pin }
    }
    for (const w of Object.values(circ.wires)) {
      const from = place(w.from, 'from')
      const to = place(w.to, 'to')
      if (from && to) out.wires[prefix + w.id] = { ...w, id: prefix + w.id, from, to, path: body ? [] : w.path }
    }
  }
  emit(c, '', [])
  return { circuit: out, connectors }
}
