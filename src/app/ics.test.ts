import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { type Circuit } from '../model/circuit'
import { icParams } from '../model/ic'
import { expandInstance, makeIC } from './ics'
import { addComp, copySelection, loadCircuit, paste, select, undo, useStore } from './store'

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
