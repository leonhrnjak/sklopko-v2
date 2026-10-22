import { describe, expect, it } from 'vitest'
import { findGlitches, traceOf } from '../engine/glitch'
import { Simulator } from '../engine/simulator'
import { simComps, type Circuit } from './circuit'
import { EXAMPLES } from './examples'
import { analyzeTiming } from './timing'

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build()

/** Load a circuit, settle it, start recording, and run `change` followed by a settle. */
function record(c: Circuit, change: (sim: Simulator) => void) {
  const sim = new Simulator()
  sim.load({ comps: simComps(c), wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })) })
  sim.settle()
  sim.setCapture(true)
  change(sim)
  sim.settle()
  const cap = sim.getCapture()!
  return { sim, cap, glitches: findGlitches(cap.frames) }
}
const idOf = (c: Circuit, label: string) => Object.values(c.comps).find((k) => k.label === label)!.id

describe('the hazard example', () => {
  const c = example('hazard')
  const flip = (sim: Simulator) => sim.setParams(idOf(c, 'A'), { ...c.comps[idOf(c, 'A')].params, on: false })

  it('starts with both outputs on', () => {
    const sim = new Simulator()
    sim.load({ comps: simComps(c), wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })) })
    sim.settle()
    expect(sim.pinValue(idOf(c, 'Y (hazard)'), 'A')).toBe(1)
    expect(sim.pinValue(idOf(c, 'Y (with B·C)'), 'A')).toBe(1)
  })

  it('A falling makes the first output dip to 0 for one gate delay, and never the second', () => {
    const { sim, cap, glitches } = record(c, flip)
    const bad = sim.netOf(idOf(c, 'Y (hazard)'), 'A')
    const good = sim.netOf(idOf(c, 'Y (with B·C)'), 'A')
    expect(glitches.map((g) => g.net)).toEqual([bad]) // one glitching signal, and it is the unprotected output
    expect(glitches[0]).toMatchObject({ kind: 'static-1', changes: 2 })
    expect(glitches[0].to - glitches[0].from).toBe(1)
    expect([...traceOf(cap.frames, good)].every((v) => v === 1)).toBe(true) // the protected one never moves
    expect(sim.pinValue(idOf(c, 'Y (hazard)'), 'A')).toBe(1) // and the dip is over
  })

  it('A rising does not glitch (the product that rises is first)', () => {
    const rising = (sim: Simulator) => {
      flip(sim)
      sim.settle()
      sim.setParams(idOf(c, 'A'), { ...c.comps[idOf(c, 'A')].params, on: true })
    }
    expect(record(c, rising).glitches).toEqual([])
  })

  it('has no feedback and a short path, 3 gate delays', () => {
    const t = analyzeTiming(c)
    expect(t.loops).toEqual([])
    expect(t.critical!.delay).toBe(3)
  })
})

describe('the ripple-carry adder example', () => {
  const c = example('ripple')
  const sums = () => ['S0', 'S1', 'S2', 'S3'].map((l) => idOf(c, l))
  const clickA = (sim: Simulator) => {
    const a = idOf(c, 'A')
    sim.setParams(a, { ...c.comps[a].params, value: 6 })
  }

  it('adds: 5 + 1 = 6, and 6 + 1 = 7', () => {
    const sim = new Simulator()
    sim.load({ comps: simComps(c), wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })) })
    sim.settle()
    const read = () => sums().reduce((n, id, i) => n | (sim.pinValue(id, 'A') << i), 0)
    expect(read()).toBe(6)
    clickA(sim)
    sim.settle()
    expect(read()).toBe(7)
    expect(sim.pinValue(idOf(c, 'Carry out'), 'A')).toBe(0)
  })

  it('A going from 5 to 6 makes three sum bits flicker before they settle', () => {
    const { sim, cap, glitches } = record(c, clickA)
    const flickering = sums().filter((id) => glitches.some((g) => g.net === sim.netOf(id, 'A')))
    expect(flickering.length).toBe(3) // S1, S2 and S3
    expect(flickering).toEqual(sums().slice(1))
    // The carry has to get through another adder for each: they go wrong and settle one after another, six ticks (one adder) apart.
    const mine = sums().map((id) => glitches.find((g) => g.net === sim.netOf(id, 'A'))).filter((g) => g !== undefined)
    expect(mine.map((g) => g.from)).toEqual([7, 13, 19])
    expect(mine.map((g) => g.to)).toEqual([13, 19, 25])
    expect(cap.frames.length).toBeGreaterThan(20)
  })

  it('its slowest path is the carry through all four adders: 4 × 6 gate delays', () => {
    expect(analyzeTiming(c).critical!.delay).toBe(24)
  })
})
