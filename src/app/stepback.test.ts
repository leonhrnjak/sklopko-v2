import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { historyOf } from '../model/ic'
import { deserialize, serialize } from '../model/serialize'
import { enterDefinitionById, makeIC } from './ics'
import { loadIntoSim, sim } from './sim'
import { setHistoryOn } from './stepback'
import { loadCircuit, undo, redo, useStore } from './store'

const circuit = () => useStore.getState().circuit

/** A clock and a counter: something that has clock edges to step back over. */
function counter() {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 0, { params: { hz: 8 } })
  const n = b.add('counter', 100, 0)
  b.wire(`${clk}.Q`, `${n}.CLK`)
  return b.build()
}

describe('the history setting in the store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout })
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => f())
    loadCircuit(counter(), false)
  })

  it('is on for a new circuit, and switching it off and on is one undo step each', () => {
    expect(historyOf(circuit())).toBe(true)
    setHistoryOn(false)
    expect(circuit().history).toBe(false)
    setHistoryOn(true)
    expect(circuit().history).toBeUndefined() // (absent, so the file does not change)
    undo()
    expect(circuit().history).toBe(false)
    undo()
    expect(circuit().history).toBeUndefined()
    redo()
    expect(circuit().history).toBe(false)
  })

  it('does nothing, and makes no undo step, when it is already so', () => {
    const past = useStore.getState().past.length
    setHistoryOn(true)
    expect(useStore.getState().past.length).toBe(past)
  })

  it('is saved with the circuit', () => {
    setHistoryOn(false)
    expect(deserialize(JSON.parse(JSON.stringify(serialize(circuit())))).history).toBe(false)
  })

  it('is the setting of the document, also while the body of an IC is edited', () => {
    loadCircuit(counter(), false)
    const id = makeIC('Counter', null)!
    setHistoryOn(false)
    enterDefinitionById(id)
    expect(circuit().up).toBeDefined()
    expect(historyOf(circuit())).toBe(false)
    setHistoryOn(true)
    expect(historyOf(circuit())).toBe(true)
    expect(serialize(circuit()).history).toBeUndefined()
  })

  it('is handed to the simulator when the circuit is loaded into it', () => {
    setHistoryOn(false)
    loadIntoSim(circuit())
    expect(sim.historyOn).toBe(false)
    sim.settle()
    sim.stepClock()
    sim.stepClock()
    expect(sim.canStepBack()).toBe(false)
    loadIntoSim(counter())
    expect(sim.historyOn).toBe(true)
    sim.settle()
    sim.stepClock()
    sim.stepClock()
    expect(sim.canStepBack()).toBe(true)
  })
})
