import { layoutOf } from '../engine/layoutcache'
import type { Expr, Program } from '../logic/expr'
import { minimizeExpr } from '../logic/minimize'
import { tableOfProgram, type Cell, type TruthTable } from '../logic/table'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/** The most inputs one gate has (the gate parts go up to 8); wider ones are built from several. */
const MAX_FAN_IN = 8

type Kind = 'in' | 'const' | 'not' | 'and' | 'or' | 'xor'

/** One part of the circuit to be: an input, a constant or a gate, with what feeds it. */
interface Node {
  id: number
  kind: Kind
  name: string
  value: boolean
  args: Node[]
  level: number
}

/**
 * The logic as a graph of gates in which identical parts exist once, however many times they are written (`A·B` in
 * two outputs is one AND gate). Constants and repeats are folded away as it goes.
 */
class Graph {
  nodes: Node[] = []
  private memo = new Map<string, Node>()

  private make(kind: Kind, args: Node[], name = '', value = false): Node {
    // The inputs of AND, OR and XOR gates are interchangeable: order them so that the same gate is found again.
    const ordered = kind === 'and' || kind === 'or' || kind === 'xor' ? [...args].sort((a, b) => a.id - b.id) : args
    const key = `${kind}|${name}|${value}|${ordered.map((a) => a.id).join(',')}`
    let node = this.memo.get(key)
    if (!node) {
      node = { id: this.nodes.length, kind, name, value, args: ordered, level: ordered.length ? 1 + Math.max(...ordered.map((a) => a.level)) : 0 }
      this.nodes.push(node)
      this.memo.set(key, node)
    }
    return node
  }

  input = (name: string) => this.make('in', [], name)
  constant = (value: boolean) => this.make('const', [], '', value)

  not(a: Node): Node {
    if (a.kind === 'const') return this.constant(!a.value)
    if (a.kind === 'not') return a.args[0]
    return this.make('not', [a])
  }

  /** An AND, OR or XOR of any number of inputs, with constants and repeats folded away and wide gates split. */
  gate(kind: 'and' | 'or' | 'xor', args: Node[]): Node {
    let list = args
    let invert = false
    if (kind === 'xor') {
      // x⊕0 = x, x⊕1 = ¬x, x⊕x = 0.
      invert = list.filter((a) => a.kind === 'const' && a.value).length % 2 === 1
      list = list.filter((a) => a.kind !== 'const')
      const count = new Map<Node, number>()
      for (const a of list) count.set(a, (count.get(a) ?? 0) + 1)
      list = [...count].filter(([, n]) => n % 2 === 1).map(([a]) => a)
    } else {
      const absorbing = kind === 'or' // OR with a 1 is 1, AND with a 0 is 0
      if (list.some((a) => a.kind === 'const' && a.value === absorbing)) return this.constant(absorbing)
      list = [...new Set(list.filter((a) => a.kind !== 'const'))]
    }
    let node: Node
    if (list.length === 0) node = this.constant(kind === 'and')
    else if (list.length === 1) node = list[0]
    else node = this.wide(kind, list)
    return invert ? this.not(node) : node
  }

  /** A gate with more inputs than a part has: a tree of gates of at most 8 inputs each. */
  private wide(kind: 'and' | 'or' | 'xor', list: Node[]): Node {
    if (list.length <= MAX_FAN_IN) return this.make(kind, list)
    const groups: Node[] = []
    for (let i = 0; i < list.length; i += MAX_FAN_IN) {
      const part = list.slice(i, i + MAX_FAN_IN)
      groups.push(part.length === 1 ? part[0] : this.make(kind, part))
    }
    return this.wide(kind, groups)
  }
}

export interface SynthOptions {
  /** Replace each output by the smallest sum of products of its truth table, instead of building it as written. */
  simplify?: boolean
  /** Inputs that come from a Receive label of the same name instead of a switch (something else sends them). */
  labelInputs?: string[]
  /** Outputs that go out through a Send label of the same name instead of an LED (something else receives them). */
  labelOutputs?: string[]
}

/** What `synthesizeInto` added: the part of each input and each output, and the area it covers. */
export interface Synthesized {
  /** The switch (or Receive label) of each input, by name. */
  inputs: Record<string, string>
  /** The LED (or Send label) of each output, by name. */
  outputs: Record<string, string>
  /** Every part it added. */
  parts: string[]
  /** The width and height it covers, from the origin it was built at. */
  width: number
  height: number
}

/** The part of a node: its type, and the parameters that give it the right number of inputs. */
function partOf(n: Node, labelled: ReadonlySet<string>): { type: string; params: Record<string, number | string> } {
  if (n.kind === 'in') return labelled.has(n.name) ? { type: 'netrecv', params: { name: n.name } } : { type: 'switch', params: {} }
  if (n.kind === 'const') return { type: 'const', params: { value: n.value ? 1 : 0 } }
  if (n.kind === 'not') return { type: 'not', params: {} }
  return { type: n.kind, params: { inputs: Math.max(2, n.args.length) } }
}

const COLUMN_GAP = 110
const ROW_GAP = 30
const INPUT_PITCH = 70

/**
 * A circuit for a program: a switch for each input, the gates, and an LED for each output, laid out from left to right
 * by how deep the logic is, and wired. Lines of the program may use each other's names; shared logic is built once.
 */
export function synthesize(program: Program, options: SynthOptions = {}): Circuit {
  const b = new CircuitBuilder()
  synthesizeInto(b, program, options)
  return b.build()
}

/**
 * The same, built into a circuit that is being put together, with its top left corner at `origin`. The caller wires up
 * whatever it needs (the inputs and outputs are in the result) and builds the circuit.
 */
export function synthesizeInto(b: CircuitBuilder, program: Program, options: SynthOptions = {}, origin: { x: number; y: number } = { x: 0, y: 0 }): Synthesized {
  const labelIn = new Set(options.labelInputs ?? [])
  const labelOut = new Set(options.labelOutputs ?? [])
  const g = new Graph()
  for (const name of program.inputs) g.input(name) // every input gets a switch, even one the logic ends up not using

  const outputNodes = new Map<string, Node>()
  const byName = new Map(program.outputs.map((o) => [o.name, o]))
  const nodeOf = (name: string): Node => {
    const known = outputNodes.get(name)
    if (known) return known
    const o = byName.get(name)!
    const node = options.simplify
      ? fromExpr(minimizeExpr(tableOfProgram({ inputs: program.inputs, outputs: [o] }).values[0], program.inputs), false)
      : fromExpr(o.written, true)
    outputNodes.set(name, node)
    return node
  }
  function fromExpr(e: Expr, useNames: boolean): Node {
    switch (e.k) {
      case 'const':
        return g.constant(e.v)
      case 'var':
        return useNames && byName.has(e.name) ? nodeOf(e.name) : g.input(e.name)
      case 'not':
        return g.not(fromExpr(e.a, useNames))
      default:
        return g.gate(e.k, e.args.map((a) => fromExpr(a, useNames)))
    }
  }
  for (const o of program.outputs) nodeOf(o.name)

  // Only what some output uses gets built (a folded-away part would be left dangling), plus every input.
  const used = new Set<Node>()
  const mark = (n: Node) => {
    if (used.has(n)) return
    used.add(n)
    n.args.forEach(mark)
  }
  for (const o of program.outputs) mark(nodeOf(o.name))
  const inputs = program.inputs.map((name) => g.input(name))
  inputs.forEach((n) => used.add(n))
  const nodes = g.nodes.filter((n) => used.has(n))

  // ---- Layout: a column per level, inputs and constants in the first ----------------------------
  const size = (n: Node) => {
    const p = partOf(n, labelIn)
    const l = layoutOf(p.type, p.params)
    return { w: l.w + 20, h: l.h } // the output pin or inversion bubble sticks out a little
  }
  const maxLevel = Math.max(0, ...nodes.map((n) => n.level))
  const byLevel: Node[][] = Array.from({ length: maxLevel + 1 }, (_, l) => nodes.filter((n) => n.level === l))
  const colX: number[] = []
  let x = 0
  byLevel.forEach((col, l) => {
    colX[l] = x
    x += Math.max(0, ...col.map((n) => size(n).w)) + COLUMN_GAP
  })
  const ledX = x

  const top = new Map<Node, number>()
  const center = (n: Node) => top.get(n)! + size(n).h / 2
  const round10 = (v: number) => Math.round(v / 10) * 10
  // Inputs first, in the order they were given, then constants.
  const first = [...inputs, ...byLevel[0].filter((n) => !inputs.includes(n))]
  first.forEach((n, i) => top.set(n, i * INPUT_PITCH))
  for (let l = 1; l <= maxLevel; l++) {
    // Each gate would like to sit level with the middle of what feeds it; take them in that order and keep them apart.
    const wanted = new Map(byLevel[l].map((n) => [n, n.args.reduce((s, a) => s + center(a), 0) / n.args.length] as const))
    let bottom = -Infinity
    for (const n of [...byLevel[l]].sort((a, b) => wanted.get(a)! - wanted.get(b)!)) {
      const y = Math.max(round10(wanted.get(n)! - size(n).h / 2), bottom + ROW_GAP)
      top.set(n, y)
      bottom = y + size(n).h
    }
  }

  // ---- Build ---------------------------------------------------------------------------------------
  const ids = new Map<Node, string>()
  const added: string[] = []
  for (const n of nodes) {
    const p = partOf(n, labelIn)
    const id = b.add(p.type, origin.x + colX[n.level], origin.y + top.get(n)!, { params: p.params, ...(n.kind === 'in' && !labelIn.has(n.name) ? { label: n.name } : {}) })
    ids.set(n, id)
    added.push(id)
  }
  const sourcePin = (n: Node) => (n.kind === 'in' ? (labelIn.has(n.name) ? 'Y' : 'Q') : n.kind === 'const' ? 'Q' : 'Y')
  for (const n of nodes) n.args.forEach((a, i) => b.wire(`${ids.get(a)}.${sourcePin(a)}`, `${ids.get(n)}.${n.kind === 'not' ? 'A' : String.fromCharCode(65 + i)}`))

  // An LED for each output (or a Send label), level with the gate that drives it and kept apart from the others.
  let ledBottom = -Infinity
  const outputs: Record<string, string> = {}
  const driven = program.outputs.map((o) => ({ o, node: nodeOf(o.name) })).sort((a, c) => center(a.node) - center(c.node))
  for (const { o, node } of driven) {
    const y = Math.max(round10(center(node) - 10), ledBottom + 50)
    const out = labelOut.has(o.name) ? b.add('netsend', origin.x + ledX, origin.y + y, { params: { name: o.name } }) : b.add('led', origin.x + ledX, origin.y + y, { label: o.name })
    b.wire(`${ids.get(node)}.${sourcePin(node)}`, `${out}.A`)
    outputs[o.name] = out
    added.push(out)
    ledBottom = y + 20
  }
  const rects = added.map((id) => boundsRect(b.c.comps[id]))
  return {
    inputs: Object.fromEntries(program.inputs.map((name) => [name, ids.get(g.input(name))!])),
    outputs,
    parts: added,
    width: rects.length ? Math.max(...rects.map((r) => r.x + r.w)) - origin.x : 0,
    height: rects.length ? Math.max(...rects.map((r) => r.y + r.h)) - origin.y : 0,
  }
}

/** A circuit for a truth table: each output as its smallest sum of products (unknown values are don't cares). */
export function synthesizeTable(table: TruthTable): Circuit {
  const outputs = table.outputs.map((name, o) => {
    const expr = minimizeExpr(table.values[o] as Cell[], table.inputs)
    return { name, written: expr, expr }
  })
  return synthesize({ inputs: table.inputs, outputs })
}
