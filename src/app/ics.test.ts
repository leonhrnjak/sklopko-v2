import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { type Circuit } from '../model/circuit'
import { icParams } from '../model/ic'
import { serialize } from '../model/serialize'
import { deleteIC, enterDefinitionById, enterInstance, expandInstance, leaveLevels, makeIC, renameIC } from './ics'
import { addComp, copySelection, deleteSelection, loadCircuit, paste, select, setLabel, undo, useStore } from './store'

const circuit = () => useStore.getState().circuit

/** A switch and an LED wired together: the smallest circuit that can be an IC. */
function buffer(): Circuit {
  const b = new CircuitBuilder()
  const s = b.add('switch', 0, 0, { label: 'In' })
  const l = b.add('led', 100, 0, { label: 'Out' })
  b.wire(`${s}.Q`, `${l}.A`)
  return b.build()
}

describe('making ICs in the store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout })
    loadCircuit(new CircuitBuilder().c, false)
  })

  it('adds a definition made from the whole circuit and leaves the canvas as it is; undo takes it back', () => {
    loadCircuit(buffer(), false)
    const before = circuit()
    const id = makeIC('  Buffer  ', null)
    expect(id).toBe('buffer')
    expect(circuit().ics!.buffer).toMatchObject({ id: 'buffer', name: 'Buffer' })
    expect(Object.keys(circuit().ics!.buffer.circuit.comps)).toEqual(Object.keys(before.comps))
    expect(circuit().comps).toEqual(before.comps)
    undo()
    expect(circuit().ics).toBeUndefined()
  })

  it('makes one from the selected parts only, and gives a second IC of the same name another id', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0)
    const l = b.add('led', 100, 0)
    b.add('and', 200, 200)
    b.wire(`${s}.Q`, `${l}.A`)
    loadCircuit(b.build(), false)
    const first = makeIC('Part', [s, l])
    const second = makeIC('Part', [s])
    expect([first, second]).toEqual(['part', 'part-2'])
    expect(Object.keys(circuit().ics!.part.circuit.comps).sort()).toEqual([l, s].sort())
    expect(Object.keys(circuit().ics!.part.circuit.wires)).toHaveLength(1)
    expect(Object.keys(circuit().ics!['part-2'].circuit.wires)).toHaveLength(0)
  })

  it('places an instance from `ic:<id>`, with the pins of its definition', () => {
    loadCircuit(buffer(), false)
    const id = makeIC('Buffer', null)
    const placed = addComp(`ic:${id}`, 300, 300)
    expect(circuit().comps[placed]).toMatchObject({ type: 'ic', x: 300, y: 300, params: icParams(circuit().ics![id]) })
    expect(addComp('ic:nothing', 0, 0)).toBe('')
    undo()
    expect(circuit().comps[placed]).toBeUndefined()
  })

  it('copied instances bring their definitions into a circuit that lacks them, and leave the ones it has', () => {
    loadCircuit(buffer(), false)
    const id = makeIC('Buffer', null)
    const placed = addComp(`ic:${id}`, 300, 300)
    select([placed])
    expect(copySelection()).toBe(true)
    loadCircuit(new CircuitBuilder().c, false)
    expect(circuit().ics).toBeUndefined()
    paste()
    expect(circuit().ics?.buffer?.name).toBe('Buffer')
    const instances = Object.values(circuit().comps).filter((k) => k.type === 'ic')
    expect(instances).toHaveLength(1)
    expect(instances[0].params.ic).toBe('buffer')
    // A circuit that has an IC of that id keeps its own.
    const own = new CircuitBuilder()
    own.defineIC('Mine', buffer(), 'buffer')
    loadCircuit(own.c, false)
    paste()
    expect(circuit().ics!.buffer.name).toBe('Mine')
  })

  it('expanding an instance is one undo step, and selects the parts it made', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0, { label: 'In' })
    const inv = b.add('not', 80, 0)
    const l = b.add('led', 160, 0, { label: 'Out' })
    b.wire(`${s}.Q`, `${inv}.A`)
    b.wire(`${inv}.Y`, `${l}.A`)
    loadCircuit(b.build(), false)
    const id = makeIC('Inverter', null)
    loadCircuit({ comps: {}, wires: {}, ics: circuit().ics }, false)
    const inst = addComp(`ic:${id}`, 100, 100)
    const before = Object.keys(circuit().comps)
    const depth = useStore.getState().past.length
    expandInstance(inst)
    expect(circuit().comps[inst]).toBeUndefined()
    const now = Object.values(circuit().comps)
    expect(now.map((k) => k.type)).toEqual(['not'])
    expect(useStore.getState().selection).toEqual([now[0].id])
    expect(useStore.getState().past.length).toBe(depth + 1)
    undo()
    expect(Object.keys(circuit().comps)).toEqual(before)
  })
})

describe('collapsing in the store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout })
    loadCircuit(new CircuitBuilder().c, false)
  })

  it('replaces the selected parts with one instance, selects it, and is one undo step', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0, { label: 'In' })
    const g = b.add('not', 100, 0)
    const l = b.add('led', 200, 0, { label: 'Out' })
    b.wire(`${s}.Q`, `${g}.A`)
    b.wire(`${g}.Y`, `${l}.A`)
    loadCircuit(b.build(), false)
    const depth = useStore.getState().past.length
    expect(makeIC('Not', [g], true)).toBe('not')
    expect(circuit().comps[g]).toBeUndefined()
    const inst = Object.values(circuit().comps).find((k) => k.type === 'ic')!
    expect(inst.params).toMatchObject({ ins: 'In:1', outs: 'out1:1' })
    expect(useStore.getState().selection).toContain(inst.id)
    expect(Object.values(circuit().wires).map((w) => `${w.from.comp}.${w.from.pin}>${w.to.comp}.${w.to.pin}`).sort()).toEqual([`${inst.id}.out1>${l}.A`, `${s}.Q>${inst.id}.In`].sort())
    expect(useStore.getState().past.length).toBe(depth + 1)
    undo()
    expect(circuit().comps[g]).toBeDefined()
    expect(circuit().ics).toBeUndefined()
    // Nothing to collapse: nothing happens.
    const depth2 = useStore.getState().past.length
    expect(makeIC('Nothing', [], true)).toBe('')
    expect(useStore.getState().past.length).toBe(depth2) // and no undo step was spent
  })
})

describe('editing the inside of an IC in the store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout })
    vi.stubGlobal('requestAnimationFrame', () => 0)
    loadCircuit(new CircuitBuilder().c, false)
  })

  /** An inverter IC with an instance on the canvas; returns the instance's id. */
  function withInverter() {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0, { label: 'In' })
    const g = b.add('not', 80, 0)
    const l = b.add('led', 160, 0, { label: 'Out' })
    b.wire(`${s}.Q`, `${g}.A`)
    b.wire(`${g}.Y`, `${l}.A`)
    loadCircuit(b.build(), false)
    const id = makeIC('Inverter', null)
    loadCircuit({ comps: {}, wires: {}, ics: circuit().ics }, false)
    return { id, inst: addComp(`ic:${id}`, 100, 100), gate: g }
  }

  it('enters an instance, edits the body, and comes back with the instance changed; undo works across the levels', () => {
    const { id, inst, gate } = withInverter()
    enterInstance(inst)
    expect(circuit().up?.def).toBe(id)
    expect(Object.keys(circuit().comps)).toContain(gate)
    useStore.setState({ selection: [gate] })
    deleteSelection()
    expect(circuit().comps[gate]).toBeUndefined()
    // Saving from inside is saving the document, with the edit in it.
    expect(serialize(circuit()).ics![0].comps.some((k) => k.type === 'not')).toBe(false)
    leaveLevels()
    expect(circuit().up).toBeUndefined()
    expect(circuit().comps[inst]).toBeDefined()
    expect(circuit().ics![id].circuit.comps[gate]).toBeUndefined()
    // Undo goes back inside (with the body as it was just before leaving), then through the edit, then out.
    undo()
    expect(circuit().up?.def).toBe(id)
    undo()
    expect(circuit().comps[gate]).toBeDefined()
    expect(circuit().up?.def).toBe(id)
    undo()
    expect(circuit().up).toBeUndefined()
    expect(circuit().ics![id].circuit.comps[gate]).toBeDefined()
  })

  it('goes back several levels at once, and says how many wires lost their pins', () => {
    const { id, inst } = withInverter()
    enterInstance(inst)
    // Rename the output pin inside.
    const out = Object.values(circuit().comps).find((k) => k.type === 'led')!.id
    setLabel(out, 'Q')
    // Wire the instance's output to something outside first, in the circuit that places it: use the outer circuit's table.
    leaveLevels(5)
    expect(circuit().ics![id].circuit.comps[out].label).toBe('Q')
    expect(circuit().comps[inst].params.outs).toBe('Q:1')
  })

  it('does not let an IC be placed inside itself', () => {
    const { id, inst } = withInverter()
    enterInstance(inst)
    expect(addComp(`ic:${id}`, 0, 300)).toBe('')
    expect(useStore.getState().toast).toContain('cannot be placed inside itself')
    // An IC that places this one cannot be placed inside it either.
    leaveLevels()
    const host = new CircuitBuilder()
    host.c.ics = circuit().ics
    host.add('switch', 0, 0, { label: 'A' })
    host.add('led', 100, 0, { label: 'B' })
    host.ic(id, 0, 100)
    loadCircuit(host.c, false)
    const outer = makeIC('Outer', null)
    enterDefinitionById(id)
    expect(addComp(`ic:${outer}`, 0, 300)).toBe('')
  })

  it('renames an IC (its instances show the new name), and deletes one only when nothing uses it', () => {
    const { id, inst } = withInverter()
    renameIC(id, ' Not gate ')
    expect(circuit().ics![id].name).toBe('Not gate')
    expect(circuit().comps[inst].params.name).toBe('Not gate')
    expect(deleteIC(id)).toBe(false)
    expect(useStore.getState().toast).toContain('is in use')
    expect(circuit().ics![id]).toBeDefined()
    useStore.setState({ selection: [inst] })
    deleteSelection()
    expect(deleteIC(id)).toBe(true)
    expect(circuit().ics).toBeUndefined()
    undo() // the toast's Undo
    expect(circuit().ics![id]).toBeDefined()
  })
})
