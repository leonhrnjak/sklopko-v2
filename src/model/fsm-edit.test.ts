import { describe, expect, it } from 'vitest'
import { generateFsm, validateFsm, type Fsm } from './fsm'
import { FSM_EXAMPLES, SEQUENCE_DETECTOR, TRAFFIC_LIGHT, VENDING_MACHINE } from './fsm-examples'
import {
  addInput,
  addOutput,
  addState,
  addTransition,
  blankFsm,
  deleteState,
  deleteTransition,
  freeSpot,
  fsmDocumentJson,
  issuesFor,
  layoutFsm,
  moveState,
  moveTransition,
  parseFsmDocument,
  removeInput,
  removeOutput,
  renameInput,
  renameOutput,
  renameState,
  setReset,
  stateTable,
  toggleStateOutput,
  toggleTransitionOutput,
  updateTransition,
} from './fsm-edit'

const names = (f: Fsm) => f.states.map((s) => s.name)

describe('editing a state machine', () => {
  it('adds states with fresh ids and names, away from the others', () => {
    let f = blankFsm()
    const a = addState(f, 200, 200)
    f = a.fsm
    const b = addState(f, 200, 200)
    f = b.fsm
    expect(new Set(f.states.map((s) => s.id)).size).toBe(3)
    expect(names(f)).toEqual(['S0', 'S1', 'S2'])
    const [s0, s1, s2] = f.states
    expect(Math.hypot(s1.x! - s0.x!, s1.y! - s0.y!)).toBeGreaterThan(60)
    expect(Math.hypot(s2.x! - s1.x!, s2.y! - s1.y!)).toBeGreaterThan(60)
    expect(f.reset).toBe('s0')
    expect(a.id).not.toBe(b.id)
  })

  it('makes the first state added to an empty machine its reset state', () => {
    const f = addState({ ...blankFsm(), states: [], reset: '' }, 100, 100).fsm
    expect(f.reset).toBe(f.states[0].id)
  })

  it('finds a free spot when the wanted one is taken', () => {
    const f = blankFsm()
    const p = freeSpot(f, f.states[0].x!, f.states[0].y!)
    expect(Math.hypot(p.x - f.states[0].x!, p.y - f.states[0].y!)).toBeGreaterThan(60)
  })

  it('moves and renames a state without touching the transitions that use it', () => {
    const f0 = structuredClone(SEQUENCE_DETECTOR)
    const f = renameState(moveState(f0, 'One', 10.4, 20.6), 'One', 'Seen1')
    const s = f.states.find((x) => x.id === 'One')!
    expect([s.name, s.x, s.y]).toEqual(['Seen1', 10, 21])
    expect(f.transitions).toEqual(f0.transitions)
    expect(validateFsm(f).filter((i) => i.level === 'error')).toEqual([])
  })

  it('deleting a state deletes its transitions, and hands over the reset state', () => {
    const f = deleteState(TRAFFIC_LIGHT, 'Red')
    expect(names(f)).toEqual(['Green', 'Yellow'])
    expect(f.transitions.map((t) => `${t.from}>${t.to}`)).toEqual(['Green>Yellow'])
    expect(f.reset).toBe('Green')
    expect(deleteState(deleteState(deleteState(TRAFFIC_LIGHT, 'Red'), 'Green'), 'Yellow').reset).toBe('')
    expect(TRAFFIC_LIGHT.states).toHaveLength(3) // the original is untouched
  })

  it('adds, changes, reorders and deletes transitions', () => {
    let f = structuredClone(SEQUENCE_DETECTOR)
    const r = addTransition(f, 'Start', 'OneZero', 'X & X')
    f = r.fsm
    expect(f.transitions.find((t) => t.id === r.id)).toMatchObject({ from: 'Start', to: 'OneZero', guard: 'X & X', outputs: [] })
    expect(new Set(f.transitions.map((t) => t.id)).size).toBe(f.transitions.length)
    f = updateTransition(f, r.id, { guard: 'X', to: 'One' })
    expect(f.transitions.find((t) => t.id === r.id)).toMatchObject({ guard: 'X', to: 'One' })
    // Moves among the transitions of its own state only.
    const order = (x: Fsm) => x.transitions.filter((t) => t.from === 'Start').map((t) => t.id)
    const before = order(f)
    expect(before.at(-1)).toBe(r.id)
    f = moveTransition(f, r.id, -1)
    expect(order(f)).toEqual([before[0], r.id, before[1]])
    expect(moveTransition(f, order(f)[0], -1)).toBe(f) // already first
    f = deleteTransition(f, r.id)
    expect(order(f)).toEqual(order(SEQUENCE_DETECTOR)) // (other states' transitions may have shifted places in the list; only the order within a state matters)
    expect(f.transitions).toHaveLength(SEQUENCE_DETECTOR.transitions.length)
  })

  it('moving a transition changes which one is taken', () => {
    let f = structuredClone(VENDING_MACHINE)
    const t = f.transitions.find((x) => x.from === 'Cents10')!
    f = addTransition(f, 'Cents10', 'Cents0', '').fsm
    const catchAll = f.transitions.at(-1)!
    f = moveTransition(f, catchAll.id, -1)
    expect(f.transitions.filter((x) => x.from === 'Cents10').map((x) => x.id)).toEqual([catchAll.id, t.id])
  })

  it('outputs are switched on and off, in the order of the machine', () => {
    let f = structuredClone(FSM_EXAMPLES[3]) // up/down counter: outputs B1, B0
    f = toggleStateOutput(f, 'Zero', 'B0')
    f = toggleStateOutput(f, 'Zero', 'B1')
    expect(f.states[0].outputs).toEqual(['B1', 'B0'])
    f = toggleStateOutput(f, 'Zero', 'B1')
    expect(f.states[0].outputs).toEqual(['B0'])
    const m = toggleTransitionOutput(structuredClone(SEQUENCE_DETECTOR), SEQUENCE_DETECTOR.transitions[0].id, 'Z')
    expect(m.transitions[0].outputs).toEqual(['Z'])
  })

  it('the reset state can be changed', () => {
    expect(setReset(TRAFFIC_LIGHT, 'Green').reset).toBe('Green')
  })
})

describe('editing inputs and outputs', () => {
  it('adds inputs and outputs with names that are free', () => {
    let f = addInput(addInput(blankFsm())) // A already exists
    expect(f.inputs).toEqual(['A', 'B', 'C'])
    f = addOutput(f)
    expect(f.outputs).toEqual(['Y', 'Z'])
    expect(addInput({ ...blankFsm(), inputs: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }).inputs.at(-1)).toBe('In1')
  })

  it('renaming an input rewrites the guards, whole names only', () => {
    const f = fsmFrom2()
    const g = renameInput(f, 0, 'Go')
    expect(g.inputs).toEqual(['Go', 'AB'])
    expect(g.transitions.map((t) => t.guard)).toEqual(['Go & !AB', 'Go | (AB & !Go)', ''])
    expect(validateFsm(g).filter((i) => i.message.includes('not an input'))).toEqual([])
  })

  it('renaming an output renames it in states and transitions', () => {
    const g = renameOutput(SEQUENCE_DETECTOR, 0, 'Found')
    expect(g.outputs).toEqual(['Found'])
    expect(g.transitions.filter((t) => t.outputs.length).map((t) => t.outputs)).toEqual([['Found']])
    const h = renameOutput(TRAFFIC_LIGHT, 1, 'Amber')
    expect(h.states.find((s) => s.id === 'Yellow')!.outputs).toEqual(['Amber'])
    expect(validateFsm(h).filter((i) => i.level === 'error')).toEqual([])
  })

  it('removing an output takes it out of states and transitions; removing an input leaves guards for the checker to find', () => {
    const g = removeOutput(TRAFFIC_LIGHT, 0)
    expect(g.outputs).toEqual(['Yellow', 'Green'])
    expect(g.states.every((s) => !s.outputs.includes('Red'))).toBe(true)
    const f = removeInput(SEQUENCE_DETECTOR, 0)
    expect(f.inputs).toEqual([])
    expect(validateFsm(f).some((i) => i.level === 'error' && i.message.includes('“X”, which is not an input'))).toBe(true)
  })
})

function fsmFrom2(): Fsm {
  return {
    name: 'M',
    type: 'moore',
    inputs: ['A', 'AB'],
    outputs: [],
    reset: 's',
    states: [{ id: 's', name: 'S', outputs: [] }],
    transitions: [
      { id: 't0', from: 's', to: 's', guard: 'A & !AB', outputs: [] },
      { id: 't1', from: 's', to: 's', guard: 'A | (AB & !A)', outputs: [] },
      { id: 't2', from: 's', to: 's', guard: '', outputs: [] },
    ],
  }
}

describe('the layout', () => {
  it('places states that have no position, reset first, and keeps those that have one', () => {
    const f = layoutFsm(TRAFFIC_LIGHT)
    expect(f.states.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true)
    const positions = new Set(f.states.map((s) => `${s.x},${s.y}`))
    expect(positions.size).toBe(3)
    const reset = f.states.find((s) => s.id === f.reset)!
    expect(Math.min(...f.states.map((s) => s.x!))).toBe(reset.x)
    const placed = layoutFsm({ ...TRAFFIC_LIGHT, states: TRAFFIC_LIGHT.states.map((s, i) => (i === 0 ? { ...s, x: 5, y: 6 } : s)) })
    expect([placed.states[0].x, placed.states[0].y]).toEqual([5, 6])
    expect(layoutFsm(f)).toBe(f)
  })

  it('lays out every example without stacking states', () => {
    for (const ex of FSM_EXAMPLES) {
      const f = layoutFsm(ex)
      for (const a of f.states) for (const b of f.states) if (a !== b) expect(Math.hypot(a.x! - b.x!, a.y! - b.y!), ex.name).toBeGreaterThan(70)
    }
  })
})

describe('the state table', () => {
  it('lists the next state for every setting of the inputs', () => {
    const t = stateTable(VENDING_MACHINE)
    expect(t.conditions).toEqual(['00', '01', '10', '11'])
    const row = (id: string) => t.rows.find((r) => r.state === id)!.cells.map((c) => c.to)
    expect(row('Cents0')).toEqual(['Cents0', 'Cents10', 'Cents5', 'Cents0']) // N=1 D=1 at once: no guard holds, so it stays
    expect(row('Cents10')).toEqual(['Cents10', 'Cents15', 'Cents15', 'Cents15'])
    expect(row('Cents15')).toEqual(['Cents0', 'Cents0', 'Cents0', 'Cents0'])
    expect(t.rows.find((r) => r.state === 'Cents15')!.cells[0].outputs).toEqual(['Dispense'])
  })

  it('shows the outputs of the transition that fires in a Mealy machine, and one row when there are no inputs', () => {
    const t = stateTable(SEQUENCE_DETECTOR)
    expect(t.conditions).toEqual(['0', '1'])
    expect(t.rows.find((r) => r.state === 'OneZeroOne')!.cells.map((c) => c.outputs)).toEqual([[], ['Z']])
    expect(stateTable(TRAFFIC_LIGHT).conditions).toEqual(['always'])
    expect(stateTable({ ...TRAFFIC_LIGHT, inputs: ['A', 'B', 'C', 'D', 'E'] }).rows).toEqual([])
  })
})

describe('issues for one thing', () => {
  it('picks the issues of a state, or of a transition', () => {
    const f = { ...SEQUENCE_DETECTOR, transitions: SEQUENCE_DETECTOR.transitions.map((t, i) => (i === 0 ? { ...t, guard: 'X &' } : t)) }
    const issues = validateFsm(f)
    expect(issuesFor(issues, { transition: 't0' })).toHaveLength(1)
    expect(issuesFor(issues, { transition: 't1' })).toEqual([])
    expect(issuesFor(issues, {})).toEqual([])
  })
})

describe('saving and loading', () => {
  it('a saved machine reads back the same, with its encoding', () => {
    for (const fsm of FSM_EXAMPLES.map(layoutFsm)) {
      const back = parseFsmDocument(fsmDocumentJson({ fsm, encoding: 'gray', custom: { [fsm.states[0].id]: 3 } }))
      expect(back.fsm).toEqual(fsm)
      expect(back.encoding).toBe('gray')
      expect(back.custom).toEqual({ [fsm.states[0].id]: 3 })
    }
  })

  it('a loaded machine still generates the same circuit', () => {
    const back = parseFsmDocument(fsmDocumentJson({ fsm: SEQUENCE_DETECTOR, encoding: 'binary', custom: {} }))
    const a = generateFsm(SEQUENCE_DETECTOR, { unrouted: true }).circuit
    const b = generateFsm(back.fsm, { unrouted: true }).circuit
    expect(Object.values(b.comps).map((c) => c.type).sort()).toEqual(Object.values(a.comps).map((c) => c.type).sort())
  })

  it('fills in what a hand-written file leaves out', () => {
    const doc = parseFsmDocument(JSON.stringify({ states: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], inputs: ['X'], outputs: [], transitions: [{ from: 'a', to: 'b', guard: 'X' }] }))
    expect(doc.fsm).toMatchObject({ type: 'moore', reset: 'a', name: 'Machine' })
    expect(doc.fsm.transitions[0]).toMatchObject({ id: 't0', outputs: [] })
    expect(doc.fsm.states.every((s) => s.x !== undefined)).toBe(true)
    expect(doc.encoding).toBe('binary')
  })

  it('refuses things that are not machines, saying why', () => {
    expect(() => parseFsmDocument('hello')).toThrow('not JSON')
    expect(() => parseFsmDocument('{}')).toThrow('no states')
    expect(() => parseFsmDocument('{"states":[{"id":"a"}],"inputs":[],"outputs":[]}')).toThrow('an id and a name')
    expect(() => parseFsmDocument('{"states":[],"inputs":"A","outputs":[]}')).toThrow('lists of names')
    expect(() => parseFsmDocument('{"states":[{"id":"a","name":"A"}],"inputs":[],"outputs":[],"transitions":[{"from":"a"}]}')).toThrow('from and a to')
  })
})
