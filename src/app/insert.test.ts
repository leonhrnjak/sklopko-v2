import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { boundsRect } from '../model/circuit'
import { synthesize } from '../model/synth'
import { parseProgram, resolveProgram } from '../logic/expr'
import { setEmbed } from './embed'
import { insertCircuit, loadCircuit, undo, useStore } from './store'

const circuit = () => useStore.getState().circuit
const built = () => synthesize(resolveProgram(parseProgram('Y = A·B + ¬C').statements).program!)

describe('inserting a built circuit', () => {
  beforeEach(() => loadCircuit(new CircuitBuilder().c, false))
  afterEach(() => setEmbed(false))

  it('adds every part and wire, with new ids, near the top left of an empty canvas, and selects them', () => {
    const sub = built()
    const ids = insertCircuit(sub)
    const c = circuit()
    expect(Object.keys(c.comps)).toHaveLength(Object.keys(sub.comps).length)
    expect(Object.keys(c.wires)).toHaveLength(Object.keys(sub.wires).length)
    expect(ids).toHaveLength(Object.keys(c.comps).length + Object.keys(c.wires).length)
    expect(useStore.getState().selection.sort()).toEqual(ids.sort())
    const x = Math.min(...Object.values(c.comps).map((k) => boundsRect(k).x))
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThan(80)
    // Every wire joins parts that exist in the circuit, and its path starts and ends at them.
    for (const w of Object.values(c.wires)) {
      expect(c.comps[w.from.comp]).toBeDefined()
      expect(c.comps[w.to.comp]).toBeDefined()
      expect(w.path.length).toBeGreaterThan(1)
    }
  })

  it('goes below what is already on the canvas, lined up with its left edge, without touching it', () => {
    const b = new CircuitBuilder()
    b.add('and', 100, 100)
    b.add('led', 400, 300)
    loadCircuit(b.c, false)
    const before = Object.values(circuit().comps).map((k) => ({ ...k }))
    const ids = insertCircuit(built())
    const old = Object.values(circuit().comps).filter((k) => before.some((o) => o.id === k.id))
    expect(old).toEqual(before) // nothing that was there has moved
    const fresh = Object.values(circuit().comps).filter((k) => !before.some((o) => o.id === k.id))
    expect(fresh.length).toBeGreaterThan(0)
    expect(Math.min(...fresh.map((k) => boundsRect(k).y))).toBeGreaterThan(300 + 20) // below the lowest old part
    expect(Math.min(...fresh.map((k) => boundsRect(k).x))).toBe(Math.min(...before.map((k) => boundsRect(k).x)))
    expect(ids.length).toBeGreaterThan(0)
  })

  it('is one undo step', () => {
    const steps = useStore.getState().past.length
    insertCircuit(built())
    expect(useStore.getState().past).toHaveLength(steps + 1)
    undo()
    expect(Object.keys(circuit().comps)).toHaveLength(0)
    expect(Object.keys(circuit().wires)).toHaveLength(0)
  })

  it('does nothing in an embedded circuit', () => {
    setEmbed(true)
    const before = circuit()
    expect(insertCircuit(built())).toEqual(expect.any(Array))
    expect(circuit()).toBe(before)
    expect(useStore.getState().selection).toEqual([])
  })
})
