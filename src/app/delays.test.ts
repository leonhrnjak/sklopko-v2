import { beforeEach, describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { hasDelay, MAX_DELAY, realisticDelay } from '../model/delays'
import { deserialize, fromShareHash, serialize, toShareHash } from '../model/serialize'
import { simComps } from '../model/circuit'
import { applyRealisticDelays, copySelection, loadCircuit, paste, select, setDelay, undo, useStore } from './store'

const comps = () => useStore.getState().circuit.comps

/** A switch, an XOR, a NOT, a constant, a clock, a flip-flop, a probe and a note. */
const setup = () => {
  const b = new CircuitBuilder()
  const ids = {
    sw: b.add('switch', 0, 0),
    xor: b.add('xor', 100, 0),
    not: b.add('not', 200, 0),
    one: b.add('const', 0, 100),
    clk: b.add('clock', 0, 200),
    ff: b.add('dff', 100, 200),
    probe: b.add('probe', 300, 0),
    note: b.add('note', 300, 100),
  }
  loadCircuit(b.c, false)
  return ids
}

describe('delays on parts', () => {
  beforeEach(() => loadCircuit(new CircuitBuilder().c, false))

  it('only parts that react have one to set', () => {
    const ids = setup()
    const has = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, hasDelay(comps()[id])]))
    expect(has).toEqual({ sw: false, xor: true, not: true, one: false, clk: false, ff: true, probe: false, note: false })
  })

  it('setDelay stores delays above 1, limits them, ignores parts without one, and undoes in one step', () => {
    const ids = setup()
    setDelay([ids.xor, ids.sw, ids.note], 4)
    expect(comps()[ids.xor].delay).toBe(4)
    expect(comps()[ids.sw].delay).toBeUndefined()
    expect(comps()[ids.note].delay).toBeUndefined()
    setDelay([ids.xor], 999)
    expect(comps()[ids.xor].delay).toBe(MAX_DELAY)
    setDelay([ids.xor], 1)
    expect('delay' in comps()[ids.xor]).toBe(false) // 1 is the default, so it is not stored
    undo()
    expect(comps()[ids.xor].delay).toBe(MAX_DELAY)
    undo()
    expect(comps()[ids.xor].delay).toBe(4)
  })

  it('"realistic delays" follow the part type, and "back" removes them', () => {
    const ids = setup()
    applyRealisticDelays(Object.values(ids))
    expect(comps()[ids.xor].delay).toBe(realisticDelay(comps()[ids.xor]))
    expect(comps()[ids.xor].delay).toBeGreaterThan(comps()[ids.not]?.delay ?? 1) // an inverter is quicker (it keeps the default)
    expect(comps()[ids.ff].delay).toBeGreaterThan(1)
    expect(comps()[ids.sw].delay).toBeUndefined()
    applyRealisticDelays(Object.values(ids), true)
    expect(Object.values(comps()).some((k) => k.delay)).toBe(false)
    undo()
    expect(comps()[ids.xor].delay).toBeGreaterThan(1)
  })

  it('every kind of part has a realistic delay between 1 and the maximum', () => {
    const ids = setup()
    for (const id of Object.values(ids)) expect(realisticDelay(comps()[id])).toBeGreaterThanOrEqual(1)
    for (const id of Object.values(ids)) expect(realisticDelay(comps()[id])).toBeLessThanOrEqual(MAX_DELAY)
  })

  it('goes to the simulator only when it is more than 1', () => {
    const ids = setup()
    setDelay([ids.xor, ids.ff], 3)
    const sc = Object.fromEntries(simComps(useStore.getState().circuit).map((k) => [k.id, k.delay]))
    expect(sc[ids.xor]).toBe(3)
    expect(sc[ids.ff]).toBe(3)
    expect(sc[ids.not]).toBeUndefined()
  })

  it('survives saving, loading and share links; delay 1 is not written; bad values are ignored', () => {
    const ids = setup()
    setDelay([ids.xor], 5)
    const c = useStore.getState().circuit
    const saved = serialize(c)
    expect(saved.comps.find((k) => k.id === ids.xor)?.delay).toBe(5)
    expect(saved.comps.find((k) => k.id === ids.not)).not.toHaveProperty('delay')
    expect(deserialize(JSON.parse(JSON.stringify(saved))).comps[ids.xor].delay).toBe(5)
    expect(fromShareHash('#' + toShareHash(c))?.comps[ids.xor].delay).toBe(5)
    for (const bad of [0, 1, -3, 2.5, '4', null, Infinity]) {
      const s = { ...saved, comps: saved.comps.map((k) => (k.id === ids.xor ? { ...k, delay: bad as number } : k)) }
      expect(deserialize(JSON.parse(JSON.stringify(s))).comps[ids.xor].delay).toBeUndefined()
    }
    const huge = { ...saved, comps: saved.comps.map((k) => (k.id === ids.xor ? { ...k, delay: 9999 } : k)) }
    expect(deserialize(huge).comps[ids.xor].delay).toBe(MAX_DELAY)
  })

  it('is copied with the part', () => {
    const ids = setup()
    setDelay([ids.xor], 6)
    select([ids.xor])
    copySelection()
    paste()
    const copies = Object.values(comps()).filter((k) => k.type === 'xor' && k.id !== ids.xor)
    expect(copies).toHaveLength(1)
    expect(copies[0].delay).toBe(6)
  })
})
