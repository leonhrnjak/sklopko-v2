import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { setEmbed } from './embed'
import { addComp, deleteSelection, interact, loadCircuit, moveComps, redo, select, setParam, undo, useStore } from './store'

const circuit = () => useStore.getState().circuit

describe('embedded circuits', () => {
  let sw: string
  let gate: string
  beforeEach(() => {
    setEmbed(false)
    const b = new CircuitBuilder()
    sw = b.add('switch', 0, 0)
    gate = b.add('and', 200, 0)
    loadCircuit(b.c, false)
  })
  afterEach(() => setEmbed(false))

  it('can be loaded, and its switches can be operated', () => {
    setEmbed(true)
    expect(circuit().comps[sw].params.on).toBe(false)
    interact(sw, false)
    expect(circuit().comps[sw].params.on).toBe(true)
    interact(sw, false)
    expect(circuit().comps[sw].params.on).toBe(false)
    const b = new CircuitBuilder()
    b.add('led', 0, 0)
    loadCircuit(b.c, false)
    expect(Object.keys(circuit().comps)).toHaveLength(1)
  })

  it('cannot be edited: no new parts, moves, deletions, parameter changes, undo or redo', () => {
    setEmbed(true)
    const before = circuit()
    addComp('led', 100, 100)
    moveComps([gate], { x: 50, y: 0 }, true)
    select([gate])
    deleteSelection()
    setParam(gate, 'inputs', 3)
    undo()
    redo()
    expect(circuit()).toBe(before) // not even a new object: nothing changed
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('is editable again outside embed mode', () => {
    setEmbed(true)
    addComp('led', 100, 100)
    expect(Object.keys(circuit().comps)).toHaveLength(2)
    setEmbed(false)
    addComp('led', 100, 100)
    expect(Object.keys(circuit().comps)).toHaveLength(3)
    expect(useStore.getState().past).toHaveLength(1)
  })
})
