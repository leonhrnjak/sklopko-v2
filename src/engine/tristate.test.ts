import { describe, expect, it } from 'vitest'
import { findGlitches } from './glitch'
import { DEFS, getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { X, Z, paramDefaults, type Params, type V } from './types'
import { toVcd } from './vcd'

type Spec = string | [string, Params]

/** Tiny builder: wire('a.Q', 'b.A') connects output Q of a to input A of b. */
function build(comps: Record<string, Spec>, wires: [string, string][]): SimCircuit {
  return {
    comps: Object.entries(comps).map(([id, t]) => {
      const [type, params] = typeof t === 'string' ? [t, {}] : t
      return { id, type, params: { ...paramDefaults(getDef(type)), ...params } }
    }),
    wires: wires.map(([f, t]) => {
      const [fc, fp] = f.split('.')
      const [tc, tp] = t.split('.')
      return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
    }),
  }
}

function sim(c: SimCircuit) {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}

const set = (s: Simulator, id: string, on: boolean) => {
  s.setParams(id, { on })
  s.settle()
}

/** A bus junction with `n` tri-state sources: switch `dK` carries the data of source K, switch `eK` enables it. */
function shared(n: number, junction: Params = {}) {
  const comps: Record<string, Spec> = { j: ['busjoin', { drivers: n, ...junction }], led: 'led' }
  const wires: [string, string][] = [['j.Y', 'led.A']]
  for (let i = 0; i < n; i++) {
    const pin = String.fromCharCode(65 + i)
    comps[`d${i}`] = 'switch'
    comps[`e${i}`] = 'switch'
    comps[`t${i}`] = 'tribuf'
    wires.push([`d${i}.Q`, `t${i}.A`], [`e${i}.Q`, `t${i}.EN`], [`t${i}.Y`, `j.${pin}`])
  }
  return build(comps, wires)
}

describe('tri-state buffer', () => {
  it('passes A while enabled and lets go (Z) while not', () => {
    const s = sim(build({ d: 'switch', e: 'switch', t: 'tribuf' }, [['d.Q', 't.A'], ['e.Q', 't.EN']]))
    expect(s.pinValue('t', 'Y')).toBe(Z)
    set(s, 'e', true)
    expect(s.pinValue('t', 'Y')).toBe(0)
    set(s, 'd', true)
    expect(s.pinValue('t', 'Y')).toBe(1)
    set(s, 'e', false)
    expect(s.pinValue('t', 'Y')).toBe(Z)
  })

  it('an unconnected enable is off, an unknown enable gives X, and an enabled unknown input gives X', () => {
    expect(sim(build({ d: 'switch', t: 'tribuf' }, [['d.Q', 't.A']])).pinValue('t', 'Y')).toBe(Z)
    expect(sim(build({ d: 'switch', x: ['netrecv', { name: 'NOPE' }], t: 'tribuf' }, [['d.Q', 't.A'], ['x.Y', 't.EN']])).pinValue('t', 'Y')).toBe(X)
    expect(sim(build({ e: ['switch', { on: true }], t: 'tribuf' }, [['e.Q', 't.EN']])).pinValue('t', 'Y')).toBe(X)
  })
})

describe('bus junction', () => {
  it('follows the one enabled source and floats (X) when none is', () => {
    const s = sim(shared(3))
    expect(s.pinValue('j', 'Y')).toBe(X)
    for (let i = 0; i < 3; i++) {
      set(s, `e${i}`, true)
      expect(s.pinValue('j', 'Y')).toBe(0)
      set(s, `d${i}`, true)
      expect(s.pinValue('j', 'Y')).toBe(1)
      expect(s.pinValue('led', 'A')).toBe(1)
      set(s, `d${i}`, false)
      set(s, `e${i}`, false)
    }
  })

  it('two enabled sources that agree give their value, and two that disagree give X (contention)', () => {
    const s = sim(shared(3))
    set(s, 'e0', true)
    set(s, 'e1', true)
    expect(s.pinValue('j', 'Y')).toBe(0)
    set(s, 'd0', true)
    expect(s.pinValue('j', 'Y')).toBe(X)
    set(s, 'd1', true)
    expect(s.pinValue('j', 'Y')).toBe(1)
    set(s, 'e2', true)
    expect(s.pinValue('j', 'Y')).toBe(X)
    set(s, 'e2', false)
    set(s, 'e1', false)
    expect(s.pinValue('j', 'Y')).toBe(1)
  })

  it('an unknown driver makes the line X', () => {
    const c = shared(2)
    c.comps.push({ id: 'x', type: 'netrecv', params: { ...paramDefaults(getDef('netrecv')), name: 'NOPE' } })
    c.wires = c.wires.filter((w) => !(w.from.comp === 't0' && w.to.comp === 'j'))
    c.wires.push({ from: { comp: 'x', pin: 'Y' }, to: { comp: 'j', pin: 'A' } })
    const s = sim(c)
    set(s, 'e1', true)
    expect(s.pinValue('j', 'Y')).toBe(X)
  })

  it('an unconnected driver pin counts as not driving', () => {
    const s = sim(build({ d: 'switch', e: ['switch', { on: true }], t: 'tribuf', j: ['busjoin', { drivers: 3 }] }, [['d.Q', 't.A'], ['e.Q', 't.EN'], ['t.Y', 'j.B']]))
    expect(s.pinValue('j', 'Y')).toBe(0)
  })

  it('pull-up and pull-down give a floating line a value', () => {
    for (const [pull, want] of [['none', X], ['0', 0], ['1', 1]] as [string, V][]) {
      const s = sim(shared(2, { pull }))
      expect(s.pinValue('j', 'Y'), `pull ${pull}`).toBe(want)
      set(s, 'e0', true)
      set(s, 'd0', true)
      expect(s.pinValue('j', 'Y'), `driven, pull ${pull}`).toBe(1)
    }
  })

  it('its inputs show Z, and the part reading the line sees a value (the outputs of a tribuf are Z, not X)', () => {
    const s = sim(shared(2))
    expect(s.pinValue('t0', 'Y')).toBe(Z)
    expect(s.pinValue('j', 'A')).toBe(Z)
    expect(s.inputValues('j')).toEqual([Z, Z])
  })
})

describe('Z is read as X by every other part', () => {
  // For each part, feed every input pin from a floating tri-state output (Z) in one circuit and from a Receive label with
  // no sender (X) in another, and check that the part's outputs agree on every tick.
  const skip = new Set(['netsend', 'netrecv', 'note', 'frame', 'busjoin'])
  for (const def of DEFS) {
    if (skip.has(def.type) || def.acceptsZ) continue
    it(def.type, () => {
      const params = paramDefaults(def)
      const pins = def.layout(params).pins
      const make = (source: 'z' | 'x') => {
        const comps: Record<string, Spec> = { part: [def.type, params] }
        const wires: [string, string][] = []
        pins.forEach((p, i) => {
          if (p.dir !== 'in') return
          if (source === 'z') {
            comps[`src${i}`] = 'tribuf' // enable unconnected: always Z
            wires.push([`src${i}.Y`, `part.${p.name}`])
          } else {
            comps[`src${i}`] = ['netrecv', { name: 'NOPE' }]
            wires.push([`src${i}.Y`, `part.${p.name}`])
          }
        })
        const s = new Simulator()
        s.load(build(comps, wires))
        return s
      }
      const [z, x] = [make('z'), make('x')]
      for (let k = 0; k < 6; k++) {
        z.tick()
        x.tick()
        for (const p of pins) expect(z.pinValue('part', p.name), `${def.type}.${p.name} after tick ${k + 1}`).toBe(x.pinValue('part', p.name))
      }
    })
  }
})

describe('Z in recordings and exports', () => {
  it('step back restores a floating line', () => {
    const c = shared(2)
    c.comps.push({ id: 'clk', type: 'clock', params: { ...paramDefaults(getDef('clock')), hz: 1 } })
    c.wires.push({ from: { comp: 'clk', pin: 'Q' }, to: { comp: 't0', pin: 'EN' } })
    c.wires = c.wires.filter((w) => !(w.from.comp === 'e0'))
    const s = sim(c)
    const before = s.pinValue('t0', 'Y')
    s.advance(500)
    s.advance(500)
    s.stepBack()
    s.stepBack()
    expect(s.pinValue('t0', 'Y')).toBe(before)
  })

  it('a probe on a floating line records X, never Z', () => {
    const c = shared(2)
    c.comps.push({ id: 'p', type: 'probe', params: { ...paramDefaults(getDef('probe')) } })
    c.wires.push({ from: { comp: 't0', pin: 'Y' }, to: { comp: 'p', pin: 'A' } })
    const s = sim(c)
    s.advance(10)
    const trace = s.state('p') as { v: V[] }
    expect(trace.v.length).toBeGreaterThan(0)
    expect(trace.v.every((v) => v <= X)).toBe(true)
  })

  it('a net that goes through Z is not reported as a glitch', () => {
    const frames = [Uint8Array.of(0), Uint8Array.of(Z), Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(0)]
    expect(findGlitches(frames)).toEqual([])
    expect(findGlitches([Uint8Array.of(Z), Uint8Array.of(1), Uint8Array.of(0), Uint8Array.of(1)])).toEqual([])
  })

  it('the VCD writes z for a floating wire', () => {
    const text = toVcd([{ name: 'bus', width: 1, t: [0, 1, 2], v: [0, Z, 1] }], 3)
    expect(text).toMatch(/^z/m)
  })
})
