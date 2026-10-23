import { firing, type EncodingKind, type Fsm, type FsmIssue, type FsmState, type FsmTransition } from './fsm'

/**
 * Editing a state machine: every operation takes a machine and returns a new one (the editor keeps the old ones for undo), plus
 * saving and loading. Ids never change when something is renamed, so renaming a state touches nothing else.
 */

const lowestFree = (prefix: string, taken: Iterable<string>) => {
  const used = new Set(taken)
  let n = 0
  while (used.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

/** A machine to start from: one state and one input and output to rename. */
export function blankFsm(): Fsm {
  return { name: 'My machine', type: 'moore', inputs: ['A'], outputs: ['Y'], reset: 's0', states: [{ id: 's0', name: 'S0', outputs: [], x: 200, y: 200 }], transitions: [] }
}

// ---- Layout ------------------------------------------------------------------------------------

export const STATE_RADIUS = 34

/** Positions for the states that have none: on an ellipse, the reset state at the left and the rest in the order they are reached. */
export function layoutFsm(fsm: Fsm): Fsm {
  if (fsm.states.every((s) => s.x !== undefined && s.y !== undefined)) return fsm
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    const queue = [id]
    while (queue.length) {
      const cur = queue.shift()!
      if (seen.has(cur) || !fsm.states.some((s) => s.id === cur)) continue
      seen.add(cur)
      order.push(cur)
      for (const t of fsm.transitions) if (t.from === cur) queue.push(t.to)
    }
  }
  visit(fsm.reset)
  for (const s of fsm.states) visit(s.id)
  const n = order.length
  const rx = Math.max(230, n * 42)
  const ry = Math.max(120, n * 26)
  const cx = rx + 90
  const cy = ry + 90
  const at = new Map(order.map((id, i) => [id, n === 1 ? { x: cx, y: cy } : { x: Math.round(cx - rx * Math.cos((2 * Math.PI * i) / n)), y: Math.round(cy - ry * Math.sin((2 * Math.PI * i) / n)) }]))
  return { ...fsm, states: fsm.states.map((s) => (s.x !== undefined && s.y !== undefined ? s : { ...s, ...at.get(s.id)! })) }
}

/** A spot for a new state: near the wanted point, but not on top of another state. */
export function freeSpot(fsm: Fsm, x: number, y: number): { x: number; y: number } {
  let p = { x, y }
  for (let i = 0; i < 200; i++) {
    const clash = fsm.states.some((s) => Math.hypot((s.x ?? 0) - p.x, (s.y ?? 0) - p.y) < STATE_RADIUS * 2.4)
    if (!clash) return p
    p = { x: x + ((i % 6) + 1) * 90, y: y + Math.floor(i / 6) * 90 }
  }
  return p
}

// ---- States ----------------------------------------------------------------------------------------

export function addState(fsm: Fsm, x: number, y: number): { fsm: Fsm; id: string } {
  const id = lowestFree('s', fsm.states.map((s) => s.id))
  const names = new Set(fsm.states.map((s) => s.name))
  let n = fsm.states.length
  while (names.has(`S${n}`)) n++
  const spot = freeSpot(fsm, x, y)
  const state: FsmState = { id, name: `S${n}`, outputs: [], x: Math.round(spot.x), y: Math.round(spot.y) }
  return { fsm: { ...fsm, states: [...fsm.states, state], reset: fsm.states.length ? fsm.reset : id }, id }
}

const mapState = (fsm: Fsm, id: string, f: (s: FsmState) => FsmState): Fsm => ({ ...fsm, states: fsm.states.map((s) => (s.id === id ? f(s) : s)) })

export const moveState = (fsm: Fsm, id: string, x: number, y: number): Fsm => mapState(fsm, id, (s) => ({ ...s, x: Math.round(x), y: Math.round(y) }))
export const renameState = (fsm: Fsm, id: string, name: string): Fsm => mapState(fsm, id, (s) => ({ ...s, name }))
export const setReset = (fsm: Fsm, id: string): Fsm => ({ ...fsm, reset: id })

const toggled = (list: string[], name: string, order: string[]) => {
  const on = new Set(list)
  if (on.has(name)) on.delete(name)
  else on.add(name)
  return [...order.filter((o) => on.has(o)), ...[...on].filter((o) => !order.includes(o))]
}

/** Turn an output on or off in a state (Moore). */
export const toggleStateOutput = (fsm: Fsm, id: string, output: string): Fsm => mapState(fsm, id, (s) => ({ ...s, outputs: toggled(s.outputs, output, fsm.outputs) }))

/** Remove a state and every transition that joins it. If it was the reset state, the first state left takes over. */
export function deleteState(fsm: Fsm, id: string): Fsm {
  const states = fsm.states.filter((s) => s.id !== id)
  return { ...fsm, states, transitions: fsm.transitions.filter((t) => t.from !== id && t.to !== id), reset: fsm.reset === id ? (states[0]?.id ?? '') : fsm.reset }
}

// ---- Transitions ---------------------------------------------------------------------------------------

export function addTransition(fsm: Fsm, from: string, to: string, guard = ''): { fsm: Fsm; id: string } {
  const id = lowestFree('t', fsm.transitions.map((t) => t.id))
  return { fsm: { ...fsm, transitions: [...fsm.transitions, { id, from, to, guard, outputs: [] }] }, id }
}

export const updateTransition = (fsm: Fsm, id: string, patch: Partial<Pick<FsmTransition, 'from' | 'to' | 'guard'>>): Fsm => ({
  ...fsm,
  transitions: fsm.transitions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
})

/** Turn an output on or off in a transition (Mealy). */
export const toggleTransitionOutput = (fsm: Fsm, id: string, output: string): Fsm => ({
  ...fsm,
  transitions: fsm.transitions.map((t) => (t.id === id ? { ...t, outputs: toggled(t.outputs, output, fsm.outputs) } : t)),
})

export const deleteTransition = (fsm: Fsm, id: string): Fsm => ({ ...fsm, transitions: fsm.transitions.filter((t) => t.id !== id) })

/**
 * Move a transition earlier (-1) or later (+1) among the transitions that leave the same state: the first whose guard holds is taken, so
 * the order matters.
 */
export function moveTransition(fsm: Fsm, id: string, by: -1 | 1): Fsm {
  const t = fsm.transitions.find((x) => x.id === id)
  if (!t) return fsm
  const mine = fsm.transitions.filter((x) => x.from === t.from)
  const at = mine.indexOf(t)
  const other = mine[at + by]
  if (!other) return fsm
  const list = [...fsm.transitions]
  const i = list.indexOf(t)
  const j = list.indexOf(other)
  list[i] = other
  list[j] = t
  return { ...fsm, transitions: list }
}

// ---- Inputs and outputs ---------------------------------------------------------------------------------

/** Replace a whole name in an expression, leaving longer names that contain it alone. */
const renameIn = (text: string, from: string, to: string) => text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) => (w === from ? to : w))

/** The next unused name from a list of likely ones. */
function freshName(taken: string[], candidates: string[], fallback: string) {
  const free = candidates.find((c) => !taken.includes(c))
  if (free) return free
  let n = 1
  while (taken.includes(`${fallback}${n}`)) n++
  return `${fallback}${n}`
}

export const addInput = (fsm: Fsm): Fsm => ({ ...fsm, inputs: [...fsm.inputs, freshName([...fsm.inputs, ...fsm.outputs], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 'In')] })
export const addOutput = (fsm: Fsm): Fsm => ({ ...fsm, outputs: [...fsm.outputs, freshName([...fsm.inputs, ...fsm.outputs], ['Y', 'Z', 'W', 'V', 'U'], 'Out')] })

/** Rename an input everywhere it is used: in the list and in every guard. */
export const renameInput = (fsm: Fsm, index: number, name: string): Fsm => {
  const old = fsm.inputs[index]
  return { ...fsm, inputs: fsm.inputs.map((n, i) => (i === index ? name : n)), transitions: fsm.transitions.map((t) => (t.guard ? { ...t, guard: renameIn(t.guard, old, name) } : t)) }
}

/** Remove an input. Guards that used it are left as they are, so the checker points at them. */
export const removeInput = (fsm: Fsm, index: number): Fsm => ({ ...fsm, inputs: fsm.inputs.filter((_, i) => i !== index) })

/** Rename an output everywhere it is switched on: in the list, in states and in transitions. */
export const renameOutput = (fsm: Fsm, index: number, name: string): Fsm => {
  const old = fsm.outputs[index]
  const swap = (list: string[]) => list.map((o) => (o === old ? name : o))
  return {
    ...fsm,
    outputs: fsm.outputs.map((n, i) => (i === index ? name : n)),
    states: fsm.states.map((s) => ({ ...s, outputs: swap(s.outputs) })),
    transitions: fsm.transitions.map((t) => ({ ...t, outputs: swap(t.outputs) })),
  }
}

export function removeOutput(fsm: Fsm, index: number): Fsm {
  const old = fsm.outputs[index]
  const drop = (list: string[]) => list.filter((o) => o !== old)
  return { ...fsm, outputs: fsm.outputs.filter((_, i) => i !== index), states: fsm.states.map((s) => ({ ...s, outputs: drop(s.outputs) })), transitions: fsm.transitions.map((t) => ({ ...t, outputs: drop(t.outputs) })) }
}

// ---- What the machine does, as a table --------------------------------------------------------------------

export interface StateTableRow {
  state: string
  /** For each combination of the inputs (the first input is the most significant bit): the state it goes to and the outputs that are 1. */
  cells: { to: string; outputs: string[] }[]
}

/** The state table: for each state and each combination of the inputs, the next state and the outputs (empty when there are too many inputs to list). */
export function stateTable(fsm: Fsm, maxInputs = 4): { conditions: string[]; rows: StateTableRow[] } {
  if (fsm.inputs.length > maxInputs) return { conditions: [], rows: [] }
  const n = fsm.inputs.length
  const combos = Array.from({ length: 2 ** n }, (_, row) => {
    const env: Record<string, boolean> = {}
    fsm.inputs.forEach((name, i) => (env[name] = ((row >> (n - 1 - i)) & 1) === 1))
    return env
  })
  const conditions = combos.map((env) => (n ? fsm.inputs.map((name) => (env[name] ? '1' : '0')).join('') : 'always'))
  const rows = fsm.states.map((s) => ({
    state: s.id,
    cells: combos.map((env) => {
      const t = firing(fsm, s.id, env)
      const on = new Set(fsm.type === 'moore' ? s.outputs : (t?.outputs ?? []))
      return { to: t?.to ?? s.id, outputs: fsm.outputs.filter((o) => on.has(o)) }
    }),
  }))
  return { conditions, rows }
}

// ---- Issues for one thing -------------------------------------------------------------------------------------

/** The issues that concern a state or a transition (those about the machine as a whole have neither). */
export const issuesFor = (issues: FsmIssue[], what: { state?: string; transition?: string }) =>
  issues.filter((i) => (what.transition !== undefined ? i.transition === what.transition : what.state !== undefined ? i.state === what.state && i.transition === undefined : false))

// ---- Saving and loading ---------------------------------------------------------------------------------------

export interface FsmDocument {
  fsm: Fsm
  encoding: EncodingKind
  /** The codes of the `custom` encoding, by state id. */
  custom: Record<string, number>
}

const ENCODINGS: EncodingKind[] = ['binary', 'gray', 'onehot', 'custom']

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Read a saved machine, checking its shape (what the machine says is left to `validateFsm`). Throws with a reason when it is not one. */
export function parseFsmDocument(text: string): FsmDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a state machine file (it is not JSON).')
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const f = (obj.fsm ?? raw) as Record<string, unknown> | null
  const bad = (why: string): never => {
    throw new Error(`This is not a state machine file: ${why}.`)
  }
  if (!f || typeof f !== 'object' || !Array.isArray(f.states)) return bad('it has no states')
  if (!isStrings(f.inputs) || !isStrings(f.outputs)) return bad('the inputs and outputs have to be lists of names')
  const states: FsmState[] = (f.states as unknown[]).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') return bad('a state needs an id and a name')
    return { id: o.id, name: o.name, outputs: isStrings(o.outputs) ? o.outputs : [], x: num(o.x), y: num(o.y) }
  })
  const transitions: FsmTransition[] = (Array.isArray(f.transitions) ? f.transitions : []).map((t: unknown, i: number) => {
    const o = (t ?? {}) as Record<string, unknown>
    if (typeof o.from !== 'string' || typeof o.to !== 'string') return bad('a transition needs a from and a to state')
    return { id: typeof o.id === 'string' ? o.id : `t${i}`, from: o.from, to: o.to, guard: typeof o.guard === 'string' ? o.guard : '', outputs: isStrings(o.outputs) ? o.outputs : [] }
  })
  const fsm: Fsm = {
    name: typeof f.name === 'string' ? f.name : 'Machine',
    type: f.type === 'mealy' ? 'mealy' : 'moore',
    inputs: f.inputs,
    outputs: f.outputs,
    reset: typeof f.reset === 'string' ? f.reset : (states[0]?.id ?? ''),
    states,
    transitions,
  }
  const custom: Record<string, number> = {}
  if (obj.custom && typeof obj.custom === 'object') for (const [k, v] of Object.entries(obj.custom)) if (Number.isInteger(v)) custom[k] = v as number
  return { fsm: layoutFsm(fsm), encoding: ENCODINGS.includes(obj.encoding as EncodingKind) ? (obj.encoding as EncodingKind) : 'binary', custom }
}

export const fsmDocumentJson = (doc: FsmDocument) => JSON.stringify({ format: 'sklopko-fsm', version: 1, ...doc }, null, 2)
