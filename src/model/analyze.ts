import { getDef, hasDef } from '../engine/registry'
import { resolveLabels } from '../engine/netlabels'
import { Simulator } from '../engine/simulator'
import { rowBits, type Cell, type TruthTable } from '../logic/table'
import { busModel, flatten } from './buses'
import type { Circuit, Comp } from './circuit'

/** The most inputs a circuit is swept over (2⁸ = 256 rows). */
export const MAX_ANALYZE_INPUTS = 8

export interface Port {
  id: string
  /** The name used in tables and expressions: the part's label made safe, or Switch1, LED2… */
  name: string
}

/** A label as a name that can be used in an expression: letters, digits and underscores, not starting with a digit. */
function safeName(label: string | undefined, fallback: string): string {
  const name = (label ?? '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (!name) return fallback
  return /^[0-9]/.test(name) ? `_${name}` : name
}

/** Parts in reading order: top to bottom, then left to right. */
const reading = (a: Comp, b: Comp) => a.y - b.y || a.x - b.x

/** Names for parts of one kind, unique among themselves and `taken`. */
function nameParts(parts: Comp[], prefix: string, taken: Set<string>): Port[] {
  return parts.map((k, i) => {
    const base = safeName(k.label, `${prefix}${i + 1}`)
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    taken.add(name)
    return { id: k.id, name }
  })
}

/** The switches and LEDs of a circuit, in reading order, with the names they would have in a table. */
export function circuitPorts(c: Circuit): { inputs: Port[]; outputs: Port[] } {
  const comps = Object.values(c.comps)
  const taken = new Set<string>()
  const inputs = nameParts(comps.filter((k) => k.type === 'switch').sort(reading), 'Switch', taken)
  const outputs = nameParts(comps.filter((k) => k.type === 'led').sort(reading), 'LED', taken)
  return { inputs, outputs }
}

/** Does this output depend on memory or a clock, not only on the switches? (Net labels are followed.) */
export function dependsOnState(circuit: Circuit, outputId: string): boolean {
  const m = busModel(circuit)
  // The circuit with its custom ICs expanded: what drives an output may be inside one.
  const c = m.circuit
  const labels = resolveLabels(m.sim)
  const feeders = new Map<string, string[]>()
  for (const w of Object.values(c.wires)) {
    // What drives the wire, bit by bit: through splitters, mergers and net labels, to the parts that really produce it.
    const drivers = (m.bits.get(w.id) ?? []).flatMap((b) => (b ? [labels.get(b.comp)?.comp ?? b.comp] : []))
    feeders.set(w.to.comp, [...(feeders.get(w.to.comp) ?? []), ...new Set(drivers)])
  }
  const seen = new Set<string>()
  const queue = [outputId]
  while (queue.length) {
    const id = queue.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const type = c.comps[id]?.type
    if (type && hasDef(type)) {
      const def = getDef(type)
      if ((def.init && !def.interactive) || def.clockHalfPeriod) return true
    }
    queue.push(...(feeders.get(id) ?? []))
  }
  return false
}

export interface Analysis {
  table: TruthTable
  /** Things to be careful about, in words. */
  warnings: string[]
}

/**
 * Sweep the chosen switches through every combination (the first is the most significant bit) and read the chosen LEDs.
 * This runs in a simulator of its own, so the one on the canvas is not disturbed. Other switches stay as they are. `max` lifts the limit
 * for a caller that wants more rows (a challenge of nine inputs).
 */
export function analyzeCircuit(c: Circuit, inputIds: string[], outputIds: string[], max = MAX_ANALYZE_INPUTS): Analysis {
  if (inputIds.length > max) throw new RangeError(`At most ${max} inputs can be swept.`)
  const ports = circuitPorts(c)
  const nameOf = (id: string) => [...ports.inputs, ...ports.outputs].find((p) => p.id === id)!.name
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()

  const n = inputIds.length
  const values: Cell[][] = outputIds.map(() => [])
  let unstable = false
  for (let row = 0; row < 2 ** n; row++) {
    const bits = rowBits(row, n)
    inputIds.forEach((id, i) => sim.setParams(id, { ...c.comps[id].params, on: bits[i] === 1 }))
    sim.settle()
    unstable ||= sim.unstable
    outputIds.forEach((id, o) => values[o].push(sim.pinValue(id, 'A') as Cell))
  }

  const warnings: string[] = []
  const stateful = outputIds.filter((id) => dependsOnState(c, id)).map(nameOf)
  if (stateful.length)
    warnings.push(`${stateful.join(', ')} depend${stateful.length === 1 ? 's' : ''} on flip-flops, memory or a clock, so ${stateful.length === 1 ? 'it is' : 'they are'} not a function of the switches alone: the table shows what happened while they were swept in this order.`)
  if (unstable) warnings.push('Some rows never settled: the circuit keeps changing by itself (a feedback loop without memory).')
  if (values.some((v) => v.includes(2)))
    warnings.push('Some values are unknown (?): an input of the circuit is not connected, or an output is not driven.')
  return { table: { inputs: inputIds.map(nameOf), outputs: outputIds.map(nameOf), values }, warnings }
}
