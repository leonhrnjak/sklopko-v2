import { RECV, SEND } from '../engine/netlabels'
import { getDef, hasDef } from '../engine/registry'
import { encodePins, type IcPin } from '../engine/components/ic'
import { paramDefaults, type Params } from '../engine/types'
import { circuitRect } from './bounds'
import { emptyCircuit, snap, type Circuit, type Comp, type ICDef, type PinRef } from './circuit'
import { isLabel } from './labels'
import { reroute } from './ops'

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

// ---- Making, placing and unpacking ---------------------------------------------------------------

/** A deep copy that also works on the drafts of the store's circuit (`structuredClone` refuses a proxy). */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** The `placing` value of a custom IC in the palette: `ic:<definition id>`. */
export const placingIC = (defId: string) => `ic:${defId}`

/** What a `placing` value puts on the canvas: the part type, its params and its name, or null when it names nothing (an IC that is not there). */
export function placementOf(circuit: Circuit, placing: string): { type: string; params: Params; name: string } | null {
  if (!placing.startsWith('ic:')) return hasDef(placing) ? { type: placing, params: paramDefaults(getDef(placing)), name: getDef(placing).name } : null
  const def = circuit.ics?.[placing.slice(3)]
  return def ? { type: IC, params: icParams(def), name: def.name } : null
}

/** The circuit made of the parts with these ids and the wires between them (all of it when no ids are given), copied, without the ICs table. */
export function subCircuit(c: Circuit, ids?: string[]): Circuit {
  const keep = ids ? new Set(ids) : null
  const out = emptyCircuit()
  for (const k of Object.values(c.comps)) if (!keep || keep.has(k.id)) out.comps[k.id] = clone(k)
  for (const w of Object.values(c.wires)) if (out.comps[w.from.comp] && out.comps[w.to.comp]) out.wires[w.id] = clone(w)
  return out
}

/** Names of parts inside that a person would have to operate (a button, a keypad…): inside an IC nobody can reach them. */
export function operableInside(c: Circuit): string[] {
  const names = new Set<string>()
  for (const k of Object.values(c.comps)) {
    if (!hasDef(k.type) || INPUTS.has(k.type)) continue
    const def = getDef(k.type)
    if (def.interactive || k.type === 'keypad' || k.type === 'gamepad') names.add(k.label || def.name)
  }
  return [...names]
}

/** An id for a new definition: the name as a slug, with a number when it is taken. */
export function newICId(ics: Record<string, ICDef> | undefined, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ic'
  let id = base
  for (let n = 2; ics?.[id]; n++) id = `${base}-${n}`
  return id
}

/**
 * Replace an instance with the parts of its definition, in place (`c` is changed): the wires into its inputs now lead straight to
 * what the switches inside led to, and the wires out of its outputs start where the LEDs inside got their signal. The parts come
 * in at the instance's position with new ids; net labels inside that clash with a name in use are renamed. Returns the ids of the
 * new parts and wires, or null when the instance has no definition.
 */
export function inlineInstance(c: Circuit, instId: string, makeId: (prefix: string) => string): string[] | null {
  const inst = c.comps[instId]
  const def = inst?.type === IC ? c.ics?.[String(inst.params.ic)] : undefined
  if (!inst || !def) return null
  const inner = def.circuit
  const iface = deriveInterface(inner)
  const inputs = new Map(iface.inputs.map((p) => [p.comp, p]))
  const outputs = new Map(iface.outputs.map((p) => [p.comp, p]))

  // What the outside has at each pin.
  const driver = new Map<string, PinRef>() // input pin name → what feeds it
  const leaving = new Map<string, PinRef[]>() // output pin name → what it feeds
  const gone: string[] = []
  for (const w of Object.values(c.wires)) {
    if (w.to.comp === instId) {
      driver.set(w.to.pin, w.from)
      gone.push(w.id)
    }
    if (w.from.comp === instId) {
      leaving.set(w.from.pin, [...(leaving.get(w.from.pin) ?? []), w.to])
      gone.push(w.id)
    }
  }

  const box = circuitRect(inner, 0)
  const dx = snap(inst.x - box.x)
  const dy = snap(inst.y - box.y)
  const used = new Set<string>()
  for (const k of Object.values(c.comps)) if (k.id !== instId && isLabel(k.type) && k.params.name) used.add(String(k.params.name))
  const renamed = new Map<string, string>()
  const labelName = (name: string) => {
    let r = renamed.get(name)
    if (r === undefined) {
      r = name
      for (let n = 2; used.has(r); n++) r = `${name}_${n}`
      used.add(r)
      renamed.set(name, r)
    }
    return r
  }

  delete c.comps[instId]
  for (const id of gone) delete c.wires[id]
  const ids: string[] = []
  const map = new Map<string, string>()
  for (const k of Object.values(inner.comps)) {
    if (inputs.has(k.id) || outputs.has(k.id)) continue
    const id = makeId('c')
    map.set(k.id, id)
    ids.push(id)
    const copy = clone(k)
    c.comps[id] = { ...copy, id, x: k.x + dx, y: k.y + dy, params: isLabel(k.type) && k.params.name ? { ...copy.params, name: labelName(String(k.params.name)) } : copy.params }
  }

  /** Where a signal inside comes from, outside: through an input switch it is what feeds that input. */
  const source = (ref: PinRef): PinRef | undefined => {
    const pin = inputs.get(ref.comp)
    if (pin) return driver.get(pin.name)
    const id = map.get(ref.comp)
    return id ? { comp: id, pin: ref.pin } : undefined
  }
  const newWires: string[] = []
  const add = (from: PinRef, to: PinRef) => {
    const id = makeId('w')
    c.wires[id] = { id, from, to, path: [] }
    newWires.push(id)
  }
  const fed = new Map<string, PinRef | undefined>() // output pin name → the signal the LED inside shows
  for (const w of Object.values(inner.wires)) {
    const src = source(w.from)
    const out = outputs.get(w.to.comp)
    if (out) fed.set(out.name, src)
    else if (src && map.has(w.to.comp)) add(src, { comp: map.get(w.to.comp)!, pin: w.to.pin })
  }
  for (const [pin, targets] of leaving) {
    const src = fed.get(pin)
    if (src) for (const to of targets) add(src, to)
  }
  reroute(c, newWires)
  return [...ids, ...newWires]
}
