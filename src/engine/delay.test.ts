import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { MAX_DELAY, Simulator, type SimCircuit } from './simulator'
import { paramDefaults, type Params, type V } from './types'

type Spec = string | [string, Params] | [string, Params, number]

/** Tiny builder: wire('a.Q', 'b.A') connects output Q of a to input A of b. The optional third item is the delay. */
function build(comps: Record<string, Spec>, wires: [string, string][]): SimCircuit {
  return {
    comps: Object.entries(comps).map(([id, t]) => {
      const [type, params, delay] = typeof t === 'string' ? [t, {}, undefined] : (t as [string, Params, number?])
      return { id, type, params: { ...paramDefaults(getDef(type)), ...params }, ...(delay ? { delay } : {}) }
    }),
    wires: wires.map(([f, t]) => {
      const [fc, fp] = f.split('.')
      const [tc, tp] = t.split('.')
      return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
    }),
  }
}

/** A switch feeding `n` buffers in a row, each with the given delay. */
const chain = (n: number, delay?: number) =>
  build(
    { sw: 'switch', ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`b${i}`, ['buf', {}, delay] as Spec])) },
    Array.from({ length: n }, (_, i) => [i ? `b${i - 1}.Y` : 'sw.Q', `b${i}.A`] as [string, string]),
  )

const loaded = (c: SimCircuit) => {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}

/**
 * Flip the switch and count the ticks until the pin changes (and check that it stays changed), from the moment the
 * switch's own output has changed (the switch is a part with a delay of one, too).
 */
function latency(s: Simulator, comp: string, pin: string, on = true): number {
  const before = s.pinValue(comp, pin)
  s.setParams('sw', { on })
  let ticks = 0
  while (s.pinValue(comp, pin) === before && ticks < 500) {
    s.tick()
    ticks++
  }
  for (let i = 0; i < 40; i++) s.tick()
  expect(s.pinValue(comp, pin)).not.toBe(before)
  return ticks - 1
}

describe('propagation delay', () => {
  it('a part with delay 1 is the old unit-delay part', () => {
    for (const c of [chain(4), chain(4, 1)]) {
      const s = loaded(c)
      expect(latency(s, 'b3', 'Y')).toBe(4)
    }
  })

  for (const d of [2, 3, 5, MAX_DELAY]) {
    it(`a chain of four buffers with delay ${d} takes ${4 * d} ticks`, () => {
      const s = loaded(chain(4, d))
      expect(s.pinValue('b3', 'Y')).toBe(0)
      expect(latency(s, 'b3', 'Y')).toBe(4 * d)
      expect(latency(s, 'b3', 'Y', false)).toBe(4 * d) // and back
    })
  }

  it('delays add up along a path, part by part', () => {
    const s = loaded(build({ sw: 'switch', a: ['buf', {}, 3], b: 'buf', c: ['buf', {}, 2] }, [['sw.Q', 'a.A'], ['a.Y', 'b.A'], ['b.Y', 'c.A']]))
    expect(latency(s, 'c', 'Y')).toBe(3 + 1 + 2)
  })

  it('a delay above the maximum is limited', () => {
    expect(latency(loaded(chain(1, 999)), 'b0', 'Y')).toBe(MAX_DELAY)
  })

  it('settle waits for outputs that are still on their way', () => {
    const s = loaded(chain(3, 4))
    s.setParams('sw', { on: true })
    expect(s.settle()).toBe(true)
    expect(s.pinValue('b2', 'Y')).toBe(1)
    expect(s.ticks).toBeGreaterThanOrEqual(12)
  })

  it('a pulse shorter than the delay still gets through (transport delay), a tick late each way', () => {
    const s = loaded(chain(1, 5))
    const seen: V[] = []
    s.setParams('sw', { on: true })
    s.tick()
    s.setParams('sw', { on: false }) // a one-tick pulse
    for (let i = 0; i < 12; i++) {
      s.tick()
      seen.push(s.pinValue('b0', 'Y'))
    }
    expect(seen.join('')).toBe('000010000000') // exactly one tick of 1: the pulse started at tick 2 and the part takes 5 ticks
  })

  it('a ring oscillator has a period of twice its delay', () => {
    for (const d of [1, 2, 3, 7]) {
      const s = loaded(build({ sw: 'switch', n: ['nand', {}, d] }, [['sw.Q', 'n.A'], ['n.Y', 'n.B']]))
      expect(s.pinValue('n', 'Y')).toBe(1) // disabled: held high
      s.setParams('sw', { on: true })
      const seen: number[] = []
      for (let i = 0; i < 12 * d; i++) {
        s.tick()
        seen.push(s.pinValue('n', 'Y'))
      }
      const flips = seen.flatMap((v, i) => (i && v !== seen[i - 1] ? [i] : []))
      expect(flips.length).toBeGreaterThan(4)
      for (let i = 1; i < flips.length; i++) expect(flips[i] - flips[i - 1]).toBe(d)
    }
  })

  it('a flip-flop with a delay is a clock-to-output delay: it samples at the edge, then the output follows', () => {
    const s = loaded(build({ d: 'switch', clk: 'switch', ff: ['dff', {}, 3] }, [['d.Q', 'ff.D'], ['clk.Q', 'ff.CLK']]))
    s.setParams('d', { on: true })
    s.settle()
    expect(s.pinValue('ff', 'Q')).toBe(0)
    s.setParams('clk', { on: true })
    let ticks = 0
    while (s.pinValue('ff', 'Q') !== 1 && ticks < 50) {
      // The data may change right after the edge without affecting what was sampled.
      if (ticks === 1) s.setParams('d', { on: false })
      s.tick()
      ticks++
    }
    expect(ticks).toBe(1 + 3)
    for (let i = 0; i < 10; i++) s.tick()
    expect(s.pinValue('ff', 'Q')).toBe(1)
  })

  it('reset clears what is on its way', () => {
    const s = loaded(chain(1, 6))
    s.setParams('sw', { on: true })
    s.tick()
    s.tick()
    s.reset()
    s.settle()
    expect(s.pinValue('b0', 'Y')).toBe(1) // the circuit starts again and reaches the same answer
    expect(s.ticks).toBeGreaterThanOrEqual(6)
  })

  it('reloading a circuit does not make a slow part move', () => {
    const s = loaded(chain(2, 4))
    s.setParams('sw', { on: true })
    s.settle()
    s.load(chain(2, 4))
    s.setParams('sw', { on: true })
    expect(s.settle(3)).toBe(true)
    expect(s.pinValue('b1', 'Y')).toBe(1)
  })

  it('stepping back restores slow parts and what they have on their way', () => {
    const make = () => build({ clk: ['clock', { hz: 4 }], n: ['counter', { mod: 16 }, 3], one: ['const', { value: 1 }] }, [['clk.Q', 'n.CLK'], ['one.Q', 'n.EN']])
    const s = loaded(make())
    const read = () => ['A', 'B', 'C', 'D'].map((p) => s.pinValue('n', p)).join('')
    const seen: string[] = []
    for (let i = 0; i < 8; i++) {
      s.stepClock()
      seen.push(`${s.time.toFixed(1)}:${read()}`)
    }
    for (let i = 6; i >= 0; i--) {
      expect(s.stepBack()).toBe(true)
      expect(`${s.time.toFixed(1)}:${read()}`).toBe(seen[i])
    }
    // Running forward again gives the same history.
    for (let i = 1; i < 8; i++) {
      s.stepClock()
      expect(`${s.time.toFixed(1)}:${read()}`).toBe(seen[i])
    }
  })
})
