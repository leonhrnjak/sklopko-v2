import { noteSize } from '../engine/components/annotation'
import { and, constant, evaluate, MAX_INPUTS, not, or, parseExpr, variable, variables, type Expr, type Program } from '../logic/expr'
import { minimizeExpr } from '../logic/minimize'
import { rowBits, type Cell } from '../logic/table'
import { frameAround } from './annotate'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'
import { synthesizeInto } from './synth'

/**
 * Finite state machines: described as states and transitions, checked, run directly (for tests), and turned into a circuit
 * of ordinary gates and D flip-flops. See `docs/plan-m9-timing-fsm.md` for the decisions behind it.
 *
 * - A **Moore** machine's outputs depend on its state only; a **Mealy** machine's depend on the state and the inputs: an
 *   output is 1 when the transition that fires lists it.
 * - A transition has a **guard**, an expression over the inputs (empty means always). Transitions are tried in the order they are
 *   written, and the first whose guard holds is taken. A state where no guard holds stays as it is.
 */

export interface FsmState {
  id: string
  name: string
  /** Moore: the outputs that are 1 while the machine is in this state. */
  outputs: string[]
  /** Where it is drawn in the editor. */
  x?: number
  y?: number
}

export interface FsmTransition {
  id: string
  from: string
  to: string
  /** An expression over the inputs, such as `A & !B`; empty means the transition is always taken. */
  guard: string
  /** Mealy: the outputs that are 1 when this transition is taken. */
  outputs: string[]
}

export interface Fsm {
  name: string
  type: 'moore' | 'mealy'
  inputs: string[]
  outputs: string[]
  /** The id of the state the machine starts in and goes back to on reset. */
  reset: string
  states: FsmState[]
  transitions: FsmTransition[]
}

export const MAX_FSM_INPUTS = 8
export const MAX_FSM_STATES = 32
export const MAX_FSM_OUTPUTS = 16

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Names the generated circuit uses itself: the state bits (Q0…), their next values (D0…), and the Clock and Reset switches. */
const RESERVED = /^(?:[QD]\d+|reset|clock)$/i

/** A machine from a short description: states by name (the name is the id), transitions as [from, to, guard?, outputs?]. */
export function fsmFrom(spec: {
  name: string
  type: Fsm['type']
  inputs?: string[]
  outputs?: string[]
  reset?: string
  states: (string | { name: string; outputs?: string[] })[]
  transitions: [from: string, to: string, guard?: string, outputs?: string[]][]
}): Fsm {
  const states = spec.states.map((s) => (typeof s === 'string' ? { id: s, name: s, outputs: [] } : { id: s.name, name: s.name, outputs: s.outputs ?? [] }))
  return {
    name: spec.name,
    type: spec.type,
    inputs: spec.inputs ?? [],
    outputs: spec.outputs ?? [],
    reset: spec.reset ?? states[0]?.id ?? '',
    states,
    transitions: spec.transitions.map(([from, to, guard = '', outputs = []], i) => ({ id: `t${i}`, from, to, guard, outputs })),
  }
}

// ---- Guards ------------------------------------------------------------------------------------

const guardCache = new WeakMap<FsmTransition, { text: string; expr: Expr | Error }>()

/** The guard as an expression (true for an empty one), or the error that says why it does not parse. */
export function parseGuard(t: FsmTransition): Expr | Error {
  const hit = guardCache.get(t)
  if (hit && hit.text === t.guard) return hit.expr
  let expr: Expr | Error
  if (!t.guard.trim()) expr = constant(true)
  else {
    try {
      expr = parseExpr(t.guard)
    } catch (e) {
      expr = e instanceof Error ? e : new Error(String(e))
    }
  }
  guardCache.set(t, { text: t.guard, expr })
  return expr
}

/** A row of the inputs' truth table as a lookup: the first input is the most significant bit, as in the Logic panel. */
const assignment = (inputs: string[], row: number) => {
  const bits = rowBits(row, inputs.length)
  return (name: string) => bits[inputs.indexOf(name)] === 1
}

const describeRow = (inputs: string[], row: number) => (inputs.length ? rowBits(row, inputs.length).map((b, i) => `${inputs[i]}=${b}`).join(', ') : 'always')

// ---- Checking ----------------------------------------------------------------------------------

export interface FsmIssue {
  level: 'error' | 'warning' | 'info'
  message: string
  state?: string
  transition?: string
}

/** Is `name` usable as the name of an input or an output: a plain name that the expression language reads as itself? */
function plainName(name: string): boolean {
  if (!IDENT.test(name) || /^(?:and|or|xor|not)$/i.test(name)) return false
  try {
    const e = parseExpr(name)
    return e.k === 'var' && e.name === name
  } catch {
    return false
  }
}

/** What is wrong with a machine, and what is only worth knowing. Generation needs no errors. */
export function validateFsm(fsm: Fsm): FsmIssue[] {
  const issues: FsmIssue[] = []
  const error = (message: string, extra: Partial<FsmIssue> = {}) => issues.push({ level: 'error', message, ...extra })
  const warn = (message: string, extra: Partial<FsmIssue> = {}) => issues.push({ level: 'warning', message, ...extra })
  const info = (message: string, extra: Partial<FsmIssue> = {}) => issues.push({ level: 'info', message, ...extra })

  const checkNames = (kind: 'input' | 'output', names: string[], max: number) => {
    const seen = new Set<string>()
    for (const n of names) {
      if (!plainName(n)) error(`“${n}” is not a usable ${kind} name: use letters, digits and underscores, starting with a letter (and not AND, OR, XOR or NOT).`)
      else if (RESERVED.test(n)) error(`“${n}” is a name the generated circuit uses itself (Q0, D0…, Clock and Reset): choose another ${kind} name.`)
      else if (seen.has(n)) error(`There are two ${kind}s called “${n}”.`)
      seen.add(n)
    }
    if (names.length > max) error(`There are ${names.length} ${kind}s; at most ${max} are supported.`)
  }
  checkNames('input', fsm.inputs, MAX_FSM_INPUTS)
  checkNames('output', fsm.outputs, MAX_FSM_OUTPUTS)
  for (const n of fsm.outputs) if (fsm.inputs.includes(n)) error(`“${n}” is both an input and an output.`)

  if (!fsm.states.length) {
    error('The machine has no states.')
    return issues
  }
  if (fsm.states.length > MAX_FSM_STATES) error(`There are ${fsm.states.length} states; at most ${MAX_FSM_STATES} are supported.`)
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const s of fsm.states) {
    if (ids.has(s.id)) error(`Two states have the id “${s.id}”.`, { state: s.id })
    ids.add(s.id)
    const name = s.name.trim()
    if (!name || name.length > 20) error(`A state name has to be 1 to 20 characters (“${s.name}”).`, { state: s.id })
    else if (names.has(name)) error(`There are two states called “${name}”.`, { state: s.id })
    names.add(name)
    for (const o of s.outputs) if (!fsm.outputs.includes(o)) error(`State “${s.name}” lists the output “${o}”, which is not one of the outputs.`, { state: s.id })
    if (fsm.type === 'mealy' && s.outputs.length) warn(`In a Mealy machine the outputs belong to transitions: the outputs of state “${s.name}” are ignored.`, { state: s.id })
  }
  if (!ids.has(fsm.reset)) error('The reset state is not one of the states.')
  const nameOf = (id: string) => fsm.states.find((s) => s.id === id)?.name ?? id

  // Transitions: where they go, what their guards say.
  const guardsOk = new Set<string>() // states whose guards all parse and use only inputs
  const bad = new Set<string>()
  for (const t of fsm.transitions) {
    if (!ids.has(t.from) || !ids.has(t.to)) {
      error(`A transition joins a state that does not exist (${t.from} → ${t.to}).`, { transition: t.id })
      bad.add(t.from)
      continue
    }
    const label = `“${nameOf(t.from)}” → “${nameOf(t.to)}”`
    const g = parseGuard(t)
    if (g instanceof Error) {
      error(`The guard of ${label} does not make sense: ${g.message}`, { state: t.from, transition: t.id })
      bad.add(t.from)
    } else {
      for (const v of variables(g))
        if (!fsm.inputs.includes(v)) {
          error(`The guard of ${label} uses “${v}”, which is not an input.`, { state: t.from, transition: t.id })
          bad.add(t.from)
        }
    }
    for (const o of t.outputs) if (!fsm.outputs.includes(o)) error(`The transition ${label} lists the output “${o}”, which is not one of the outputs.`, { state: t.from, transition: t.id })
    if (fsm.type === 'moore' && t.outputs.length) warn(`In a Moore machine the outputs belong to states: the outputs of ${label} are ignored.`, { state: t.from, transition: t.id })
  }
  for (const s of fsm.states) if (!bad.has(s.id)) guardsOk.add(s.id)

  // Guards of one state that can hold together (the first listed wins, but it is probably a mistake), and inputs where none holds.
  const rows = 2 ** Math.min(fsm.inputs.length, MAX_FSM_INPUTS)
  for (const s of fsm.states) {
    if (!guardsOk.has(s.id)) continue
    const out = fsm.transitions.filter((t) => t.from === s.id)
    if (!out.length) {
      info(`State “${s.name}” has no transitions: once the machine is there it stays.`, { state: s.id })
      continue
    }
    const exprs = out.map((t) => parseGuard(t) as Expr)
    let overlap: string | null = null
    let gap: number | null = null
    for (let row = 0; row < rows && (overlap === null || gap === null); row++) {
      const env = assignment(fsm.inputs, row)
      const holding = out.filter((_, i) => evaluate(exprs[i], env))
      if (holding.length > 1 && overlap === null) overlap = `Two transitions of state “${s.name}” can both fire (to “${nameOf(holding[0].to)}” and to “${nameOf(holding[1].to)}”) when ${describeRow(fsm.inputs, row)}. The first one listed is taken.`
      if (!holding.length && gap === null) gap = row
    }
    if (overlap) error(overlap, { state: s.id })
    if (gap !== null) info(`State “${s.name}” stays where it is when ${describeRow(fsm.inputs, gap)}: no transition fires.`, { state: s.id })
  }

  // States nothing leads to.
  if (ids.has(fsm.reset)) {
    const reached = new Set([fsm.reset])
    for (let grew = true; grew; ) {
      grew = false
      for (const t of fsm.transitions) {
        if (reached.has(t.from) && ids.has(t.to) && !reached.has(t.to)) {
          reached.add(t.to)
          grew = true
        }
      }
    }
    for (const s of fsm.states) if (!reached.has(s.id)) warn(`State “${s.name}” cannot be reached from the reset state.`, { state: s.id })
  }
  return issues
}

// ---- Running a machine directly ----------------------------------------------------------------

/** The transition that fires in a state for some inputs (the first whose guard holds), if any. */
export function firing(fsm: Fsm, stateId: string, inputs: Record<string, boolean>): FsmTransition | undefined {
  for (const t of fsm.transitions) {
    if (t.from !== stateId) continue
    const g = parseGuard(t)
    if (!(g instanceof Error) && evaluate(g, (name) => !!inputs[name])) return t
  }
  return undefined
}

/** The state after the next clock edge. */
export function stepFsm(fsm: Fsm, stateId: string, inputs: Record<string, boolean>): string {
  return firing(fsm, stateId, inputs)?.to ?? stateId
}

/** The outputs that are 1 right now, in the order of `fsm.outputs`: by state (Moore), or by the transition that would fire (Mealy). */
export function outputsOf(fsm: Fsm, stateId: string, inputs: Record<string, boolean>): string[] {
  const on = new Set(fsm.type === 'moore' ? (fsm.states.find((s) => s.id === stateId)?.outputs ?? []) : (firing(fsm, stateId, inputs)?.outputs ?? []))
  return fsm.outputs.filter((o) => on.has(o))
}

// ---- Encodings ---------------------------------------------------------------------------------

export type EncodingKind = 'binary' | 'gray' | 'onehot' | 'custom'

export const ENCODING_NAMES: Record<EncodingKind, string> = { binary: 'Binary', gray: 'Gray code', onehot: 'One-hot', custom: 'Custom' }

export interface Encoding {
  kind: EncodingKind
  /** How many flip-flops. */
  bits: number
  /** Each state's code (bit 0 is `Q0`). */
  codes: Record<string, number>
}

const bitLength = (n: number) => Math.max(1, n.toString(2).length)

/**
 * Give every state a code. The reset state comes first, so it gets 0 (or the first bit, for one-hot). `custom` gives the codes
 * (the others get the lowest numbers not taken yet).
 */
export function encodeStates(fsm: Fsm, kind: EncodingKind, custom: Record<string, number> = {}): Encoding {
  const order = [...fsm.states.filter((s) => s.id === fsm.reset), ...fsm.states.filter((s) => s.id !== fsm.reset)]
  const codes: Record<string, number> = {}
  if (kind === 'onehot') {
    order.forEach((s, i) => (codes[s.id] = 1 << i))
    return { kind, bits: Math.max(1, order.length), codes }
  }
  if (kind === 'custom') {
    const taken = new Set(Object.values(custom))
    let next = 0
    for (const s of order) {
      if (custom[s.id] !== undefined) codes[s.id] = custom[s.id]
      else {
        while (taken.has(next)) next++
        codes[s.id] = next
        taken.add(next)
      }
    }
    return { kind, bits: bitLength(Math.max(0, ...Object.values(codes))), codes }
  }
  order.forEach((s, i) => (codes[s.id] = kind === 'gray' ? i ^ (i >> 1) : i))
  return { kind, bits: bitLength(Math.max(0, ...Object.values(codes))), codes }
}

/** Problems with a set of codes: two states with the same one, or a code that is not a whole number. */
export function validateEncoding(fsm: Fsm, enc: Encoding): FsmIssue[] {
  const issues: FsmIssue[] = []
  const seen = new Map<number, string>()
  for (const s of fsm.states) {
    const code = enc.codes[s.id]
    if (!Number.isInteger(code) || code < 0 || code >= 2 ** 16) issues.push({ level: 'error', message: `State “${s.name}” has no usable code.`, state: s.id })
    else if (seen.has(code)) issues.push({ level: 'error', message: `States “${seen.get(code)}” and “${s.name}” have the same code.`, state: s.id })
    else seen.set(code, s.name)
  }
  return issues
}

/** The names of the state bits, lowest first. */
export const stateBits = (bits: number) => Array.from({ length: bits }, (_, i) => `Q${i}`)
/** The names of the next-state values that feed the flip-flops, lowest first. */
export const nextBits = (bits: number) => Array.from({ length: bits }, (_, i) => `D${i}`)

/** The code as binary digits, `Q` of the highest bit first. */
export const codeText = (code: number, bits: number) => code.toString(2).padStart(bits, '0')

// ---- The logic -----------------------------------------------------------------------------------

/** An expression with the constants folded away: `Q0·1 + Q1·¬1` becomes `Q0`. */
function fold(e: Expr): Expr {
  if (e.k === 'const' || e.k === 'var') return e
  if (e.k === 'not') {
    const a = fold(e.a)
    return a.k === 'const' ? constant(!a.v) : a.k === 'not' ? a.a : not(a)
  }
  const args = e.args.map(fold)
  const absorbing = e.k === 'or' // OR with a 1 is 1, AND with a 0 is 0
  if (args.some((a) => a.k === 'const' && a.v === absorbing)) return constant(absorbing)
  const rest = args.filter((a) => a.k !== 'const')
  if (!rest.length) return constant(!absorbing)
  return e.k === 'and' ? and(...rest) : e.k === 'or' ? or(...rest) : e
}

export interface LogicOptions {
  /** Treat the codes no state has as "don't care" when minimising (the default). */
  dontCares?: boolean
}

/**
 * The machine's logic as a program for `synthesize()`: inputs are the machine's inputs and the state bits `Q0…`; outputs are the
 * next-state values `D0…` and the machine's outputs. With binary, Gray and custom codes the functions are minimised from truth
 * tables while those are small; otherwise (one-hot, or too many variables) each is written out as "in this state, and this guard".
 */
export function fsmLogic(fsm: Fsm, enc: Encoding, options: LogicOptions = {}): Program {
  const bitNames = stateBits(enc.bits)
  const d = nextBits(enc.bits)
  const vars = [...fsm.inputs, ...bitNames]
  const outputNames = [...d, ...fsm.outputs]
  const codeOf = (id: string) => enc.codes[id]
  const byCode = new Map(fsm.states.map((s) => [codeOf(s.id), s.id]))

  const expressions = new Map<string, Expr>()
  if (enc.kind !== 'onehot' && vars.length <= MAX_INPUTS) {
    // From the truth table: every row of (inputs, state bits) run through the machine.
    const dontCares = options.dontCares ?? true
    const rows = 2 ** vars.length
    const values: Cell[][] = outputNames.map(() => new Array<Cell>(rows))
    for (let row = 0; row < rows; row++) {
      const bits = rowBits(row, vars.length)
      let code = 0
      bitNames.forEach((_, i) => (code |= bits[fsm.inputs.length + i] << i))
      const state = byCode.get(code)
      if (state === undefined) {
        for (const v of values) v[row] = dontCares ? 2 : 0
        continue
      }
      const env: Record<string, boolean> = {}
      fsm.inputs.forEach((n, i) => (env[n] = bits[i] === 1))
      const next = codeOf(stepFsm(fsm, state, env))
      const on = new Set(outputsOf(fsm, state, env))
      outputNames.forEach((name, o) => (values[o][row] = (o < enc.bits ? ((next >> o) & 1) === 1 : on.has(name)) ? 1 : 0))
    }
    outputNames.forEach((name, o) => expressions.set(name, minimizeExpr(values[o], vars)))
  } else {
    // Written out. A state is its code (or, one-hot, its one bit); a transition fires when its guard holds and no earlier one does.
    const is = (id: string): Expr => {
      const code = codeOf(id)
      if (enc.kind === 'onehot') return variable(`Q${Math.log2(code)}`)
      return and(...bitNames.map((n, i) => ((code >> i) & 1 ? variable(n) : not(variable(n)))))
    }
    const guards = new Map<string, { t: FsmTransition; fires: Expr }[]>()
    const stays = new Map<string, Expr>()
    for (const s of fsm.states) {
      const list: { t: FsmTransition; fires: Expr }[] = []
      const earlier: Expr[] = []
      for (const t of fsm.transitions.filter((x) => x.from === s.id)) {
        const g = parseGuard(t) as Expr
        list.push({ t, fires: earlier.length ? and(g, not(or(...earlier))) : g })
        earlier.push(g)
      }
      guards.set(s.id, list)
      stays.set(s.id, earlier.length ? not(or(...earlier)) : constant(true))
    }
    const anyOf = (terms: Expr[]) => (terms.length ? fold(or(...terms)) : constant(false))
    d.forEach((name, k) => {
      const terms: Expr[] = []
      for (const s of fsm.states) {
        for (const { t, fires } of guards.get(s.id)!) if ((codeOf(t.to) >> k) & 1) terms.push(and(is(s.id), fires))
        if ((codeOf(s.id) >> k) & 1) terms.push(and(is(s.id), stays.get(s.id)!))
      }
      expressions.set(name, anyOf(terms))
    })
    for (const o of fsm.outputs) {
      const terms: Expr[] = []
      for (const s of fsm.states) {
        if (fsm.type === 'moore') {
          if (s.outputs.includes(o)) terms.push(is(s.id))
        } else for (const { t, fires } of guards.get(s.id)!) if (t.outputs.includes(o)) terms.push(and(is(s.id), fires))
      }
      expressions.set(o, anyOf(terms))
    }
  }
  return { inputs: vars, outputs: outputNames.map((name) => ({ name, written: expressions.get(name)!, expr: expressions.get(name)! })) }
}

// ---- The circuit -----------------------------------------------------------------------------------

export interface GenerateOptions {
  /** Which codes. */
  encoding?: EncodingKind
  /** The codes for `custom`. */
  custom?: Record<string, number>
  /** Speed of the clock, in Hz. */
  hz?: number
  /** Leave the wires unrouted (enough for simulating, and much faster). */
  unrouted?: boolean
  dontCares?: boolean
}

export interface Generated {
  circuit: Circuit
  encoding: Encoding
  /** The switch of each input, the LED of each output, the Reset switch, the clock and the flip-flops (bit 0 first). */
  parts: { inputs: Record<string, string>; outputs: Record<string, string>; reset: string; clock: string; flops: string[] }
}

/** The flip-flops, clock and reset around the logic: each state bit is a D flip-flop whose next value and current value travel by net labels. */
export function generateFsm(fsm: Fsm, options: GenerateOptions = {}): Generated {
  const errors = validateFsm(fsm).filter((i) => i.level === 'error')
  if (errors.length) throw new Error(errors[0].message)
  const enc = encodeStates(fsm, options.encoding ?? 'binary', options.custom)
  const codeErrors = validateEncoding(fsm, enc)
  if (codeErrors.length) throw new Error(codeErrors[0].message)

  const program = fsmLogic(fsm, enc, { dontCares: options.dontCares })
  const bitNames = stateBits(enc.bits)
  const d = nextBits(enc.bits)
  const b = new CircuitBuilder()
  const logic = synthesizeInto(b, program, { labelInputs: bitNames, labelOutputs: d })

  // The flip-flops, to the right of the logic: a Receive label brings D in, a Send label takes Q out.
  const fx = logic.width + 320
  const clock = b.add('clock', fx, 0, { params: { hz: options.hz ?? 1 }, label: 'Clock' })
  const reset = b.add('switch', fx, 120, { params: { on: true }, label: 'Reset' })
  const flops: string[] = []
  let y = 260
  for (let i = 0; i < enc.bits; i++) {
    const recv = b.add('netrecv', fx + 170, y + 20, { params: { name: d[i] } })
    const ff = b.add('dff', fx + 330, y, { label: `State bit ${i}` })
    const send = b.add('netsend', fx + 520, y + 20, { params: { name: bitNames[i] } })
    b.wire(`${recv}.Y`, `${ff}.D`)
    b.wire(`${clock}.Q`, `${ff}.CLK`)
    b.wire(`${ff}.Q`, `${send}.A`)
    // Reset puts the machine in its first state: a 1 in that code sets the flip-flop, a 0 clears it.
    b.wire(`${reset}.Q`, `${ff}.${(enc.codes[fsm.reset] >> i) & 1 ? 'S' : 'R'}`)
    flops.push(ff)
    y += boundsRect(b.c.comps[ff]).h + 90
  }

  const all = Object.keys(b.c.comps)
  const frame = frameAround(b, `State machine: ${fsm.name}`.slice(0, 40), all, 'green')
  const codes = fsm.states.map((s) => `${s.name} = ${codeText(enc.codes[s.id], enc.bits)}`).join(', ')
  const text = `${fsm.name}: a ${fsm.type === 'moore' ? 'Moore' : 'Mealy'} machine, ${ENCODING_NAMES[enc.kind].toLowerCase()} codes (${enc.bits} flip-flop${enc.bits === 1 ? '' : 's'}, Q${enc.bits - 1}…Q0). ${codes}. Reset holds it in ${fsm.states.find((s) => s.id === fsm.reset)?.name}; turn Reset off to run.`
  const cols = 56
  const noteParams = { text: text.length > 600 ? `${text.slice(0, 597)}…` : text, cols, color: 'yellow' }
  b.add('note', b.c.comps[frame].x, b.c.comps[frame].y - noteSize(noteParams).h - 30, { params: noteParams })

  const circuit = options.unrouted ? b.c : b.build()
  return { circuit, encoding: enc, parts: { inputs: Object.fromEntries(fsm.inputs.map((n) => [n, logic.inputs[n]])), outputs: Object.fromEntries(fsm.outputs.map((n) => [n, logic.outputs[n]])), reset, clock, flops } }
}
