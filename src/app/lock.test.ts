import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { makeIC } from './ics'
import { updateSettings } from './settings'
import { addComp, deleteSelection, editsLocked, interact, loadCircuit, redo, select, setParam, setRunning, undo, useStore } from './store'

const circuit = () => useStore.getState().circuit
const count = () => Object.keys(circuit().comps).length

describe('locking editing while the simulation runs', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: () => 0 }) // the toast
    const b = new CircuitBuilder()
    b.add('switch', 100, 100)
    loadCircuit(b.c, false)
    updateSettings({ lockEdits: true })
    setRunning(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    updateSettings({ lockEdits: false })
    setRunning(true)
  })

  it('is on only while running, and only when asked for', () => {
    expect(editsLocked()).toBe(true)
    setRunning(false)
    expect(editsLocked()).toBe(false)
    setRunning(true)
    updateSettings({ lockEdits: false })
    expect(editsLocked()).toBe(false)
  })

  it('refuses to add, change or delete parts, and leaves the undo history alone', () => {
    const before = circuit()
    expect(addComp('and', 200, 200)).toBe('')
    const id = Object.keys(before.comps)[0]
    select([id])
    setParam(id, 'on', true)
    deleteSelection()
    expect(circuit()).toBe(before)
    expect(useStore.getState().past).toHaveLength(0)
    expect(makeIC('X', null)).toBe('')
    expect(circuit()).toBe(before)
  })

  it('still lets a switch be operated', () => {
    const id = Object.keys(circuit().comps)[0]
    expect(circuit().comps[id].params.on).toBeFalsy()
    interact(id, false)
    expect(circuit().comps[id].params.on).toBe(true)
  })

  it('lets go when the simulation is paused: the same edits work, and undo and redo too', () => {
    setRunning(false)
    const id = addComp('and', 200, 200)
    expect(id).not.toBe('')
    expect(count()).toBe(2)
    setRunning(true)
    undo()
    expect(count()).toBe(2) // refused while running
    setRunning(false)
    undo()
    expect(count()).toBe(1)
    setRunning(true)
    redo()
    expect(count()).toBe(1)
  })
})
