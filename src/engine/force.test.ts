import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { paramDefaults, type Params } from './types'

function build(comps: Record<string, string | [string, Params]>, wires: [string, string][], delays: Record<string, number> = {}): SimCircuit {
  return {
    comps: Object.entries(comps).map(([id, t]) => {
      const [type, params] = typeof t === 'string' ? [t, {}] : t
      return { id, type, params: { ...paramDefaults(getDef(type)), ...params }, ...(delays[id] ? { delay: delays[id] } : {}) }
    }),
    wires: wires.map(([f, t]) => {
      const [fc, fp] = f.split('.')
      const [tc, tp] = t.split('.')
      return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
    }),
  }
}

/** Two switches that are on, an AND gate and an LED on its output. */
const gate = (delays?: Record<string, number>) =>
  build(
    { a: ['switch', { on: true }], b: ['switch', { on: true }], g: 'and', led: 'led' },
    [['a.Q', 'g.A'], ['b.Q', 'g.B'], ['g.Y', 'led.A']],
    delays,
  )

const start = (c: SimCircuit) => {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}

describe('forcing a signal', () => {
  it('holds an output at 0 or 1 whatever its part says, until it is let go', () => {
    const s = start(gate())
    expect(s.pinValue('led', 'A')).toBe(1)
    expect(s.force('g', 'Y', 0)).toBe(true)
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(0)
    expect(s.pinValue('g', 'Y')).toBe(0)
    expect(s.forcedValue('g', 'Y')).toBe(0)
    s.setParams('a', { ...paramDefaults(getDef('switch')), on: false })
    s.settle()
    s.force('g', 'Y', 1)
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(1) // the gate says 0, the force says 1
    s.force('g', 'Y', null)
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(0)
    expect(s.forcedValue('g', 'Y')).toBeNull()
    expect(s.forceCount).toBe(0)
  })

  it('lets the gate say what it says again when released', () => {
    const s = start(gate())
    s.force('g', 'Y', 0)
    s.settle()
    s.force('g', 'Y', null)
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(1)
  })

  it('stays when the circuit is compiled again, and goes when its pin is gone', () => {
    const s = start(gate())
    s.force('g', 'Y', 0)
    s.settle()
    s.load(gate())
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(0)
    expect(s.forceCount).toBe(1)
    s.load(build({ a: 'switch' }, []))
    s.settle()
    expect(s.forceCount).toBe(0)
  })

  it('refuses a pin that drives nothing', () => {
    const s = start(gate())
    expect(s.force('nothing', 'Y', 1)).toBe(false)
    expect(s.force('g', 'A', 1)).toBe(false) // an input
    expect(s.forceCount).toBe(0)
  })

  it('does not keep a slow part from settling', () => {
    const s = start(gate({ g: 4 }))
    expect(s.pinValue('led', 'A')).toBe(1)
    s.force('g', 'Y', 0)
    expect(s.settle()).toBe(true)
    expect(s.pinValue('led', 'A')).toBe(0)
  })

  it('lets every signal go at once', () => {
    const s = start(gate())
    s.force('g', 'Y', 0)
    s.force('a', 'Q', 0)
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(0)
    s.clearForces()
    s.settle()
    expect(s.forceCount).toBe(0)
    expect(s.pinValue('led', 'A')).toBe(1)
  })

  it('survives a reset (the fault stays when the power is cycled)', () => {
    const s = start(gate())
    s.force('g', 'Y', 0)
    s.reset()
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(0)
  })
})
