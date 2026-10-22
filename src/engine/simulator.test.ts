import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { X, paramDefaults, type Params, type V } from './types'

/** Tiny builder: wire('a.Q', 'b.A') connects output Q of a to input A of b. */
function build(comps: Record<string, string | [string, Params]>, wires: [string, string][]): SimCircuit {
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

/** Evaluate a combinational def directly with numeric inputs. */
function evalComb(type: string, ins: number[], params: Params = {}): V[] {
  const def = getDef(type)
  const p = { ...paramDefaults(def), ...params }
  const outs = def.layout(p).pins.filter((x) => x.dir === 'out')
  const inst = { ins: ins as V[], outs: outs.map(() => X), state: def.init?.(p), params: p }
  def.evaluate(inst)
  return inst.outs
}

const bits = (n: number, k: number) => Array.from({ length: k }, (_, i) => (n >> i) & 1)
const val = (vs: V[]) => vs.reduce<number>((a, v, i) => a | (v << i), 0)

describe('gates', () => {
  const table: Record<string, (a: number, b: number) => number> = {
    and: (a, b) => a & b,
    or: (a, b) => a | b,
    nand: (a, b) => 1 - (a & b),
    nor: (a, b) => 1 - (a | b),
    xor: (a, b) => a ^ b,
    xnor: (a, b) => 1 - (a ^ b),
  }
  for (const [type, fn] of Object.entries(table)) {
    it(`${type} truth table through the simulator`, () => {
      const s = sim(build({ a: 'switch', b: 'switch', g: type }, [['a.Q', 'g.A'], ['b.Q', 'g.B']]))
      for (const a of [0, 1])
        for (const b of [0, 1]) {
          set(s, 'a', !!a)
          set(s, 'b', !!b)
          expect(s.pinValue('g', 'Y'), `${a},${b}`).toBe(fn(a, b))
        }
    })
  }

  it('propagates X only when it matters', () => {
    expect(evalComb('and', [0, X])).toEqual([0])
    expect(evalComb('and', [1, X])).toEqual([X])
    expect(evalComb('or', [1, X])).toEqual([1])
    expect(evalComb('xor', [1, X])).toEqual([X])
    expect(evalComb('not', [X])).toEqual([X])
  })

  it('supports many inputs', () => {
    expect(evalComb('and', [1, 1, 1, 1, 1], { inputs: 5 })).toEqual([1])
    expect(evalComb('xor', [1, 1, 1, 0], { inputs: 4 })).toEqual([1])
  })

  it('treats unconnected inputs as X', () => {
    const s = sim(build({ a: 'switch', g: 'and' }, [['a.Q', 'g.A']]))
    set(s, 'a', true)
    expect(s.pinValue('g', 'Y')).toBe(X)
    set(s, 'a', false)
    expect(s.pinValue('g', 'Y')).toBe(0)
  })
})

describe('bistable circuits from gates', () => {
  // Classic cross-coupled NOR latch: q = NOR(R, nq), nq = NOR(S, q).
  const latch = () =>
    sim(
      build({ s: 'switch', r: 'switch', g1: 'nor', g2: 'nor' }, [
        ['r.Q', 'g1.A'],
        ['g2.Y', 'g1.B'],
        ['s.Q', 'g2.A'],
        ['g1.Y', 'g2.B'],
      ]),
    )

  it('starts unknown, then sets, holds and resets', () => {
    const s = latch()
    expect(s.pinValue('g1', 'Y')).toBe(X)
    set(s, 's', true)
    expect([s.pinValue('g1', 'Y'), s.pinValue('g2', 'Y')]).toEqual([1, 0])
    set(s, 's', false)
    expect([s.pinValue('g1', 'Y'), s.pinValue('g2', 'Y')]).toEqual([1, 0])
    set(s, 'r', true)
    expect([s.pinValue('g1', 'Y'), s.pinValue('g2', 'Y')]).toEqual([0, 1])
    set(s, 'r', false)
    expect([s.pinValue('g1', 'Y'), s.pinValue('g2', 'Y')]).toEqual([0, 1])
    expect(s.unstable).toBe(false)
  })

  it('NAND latch is active-low', () => {
    const s = sim(
      build({ s: ['switch', { on: true }], r: ['switch', { on: true }], g1: 'nand', g2: 'nand' }, [
        ['s.Q', 'g1.A'],
        ['g2.Y', 'g1.B'],
        ['r.Q', 'g2.A'],
        ['g1.Y', 'g2.B'],
      ]),
    )
    set(s, 's', false)
    set(s, 's', true)
    expect([s.pinValue('g1', 'Y'), s.pinValue('g2', 'Y')]).toEqual([1, 0])
    set(s, 'r', false)
    set(s, 'r', true)
    expect([s.pinValue('g1', 'Y'), s.pinValue('g2', 'Y')]).toEqual([0, 1])
  })

  it('a feedback loop fed only by unknowns stays X', () => {
    const s = new Simulator()
    s.load(build({ c: ['const', { value: 1 }], g0: 'nand', n1: 'not', n2: 'not' }, [
      ['c.Q', 'g0.A'],
      ['n2.Y', 'g0.B'],
      ['g0.Y', 'n1.A'],
      ['n1.Y', 'n2.A'],
    ]))
    // Break the X deadlock: everything starts X, so force a known level first.
    s.settle()
    expect(s.pinValue('g0', 'Y')).toBe(X) // X feedback stays X: no fake oscillation
  })

  it('oscillates once given a known starting level', () => {
    const s = new Simulator()
    s.load(build({ e: 'switch', g0: 'nand', n1: 'not', n2: 'not' }, [
      ['e.Q', 'g0.A'],
      ['n2.Y', 'g0.B'],
      ['g0.Y', 'n1.A'],
      ['n1.Y', 'n2.A'],
    ]))
    s.settle() // enable=0 -> NAND output 1, loop settles
    expect(s.unstable).toBe(false)
    s.setParams('e', { on: true })
    expect(s.settle(200)).toBe(false)
    expect(s.unstable).toBe(true)
    const seen = new Set<V>()
    for (let i = 0; i < 12; i++) {
      s.tick()
      seen.add(s.pinValue('g0', 'Y'))
    }
    expect(seen).toEqual(new Set([0, 1]))
  })
})

describe('flip-flops', () => {
  it('D flip-flop samples on the rising edge only', () => {
    const s = sim(build({ d: 'switch', c: 'switch', ff: 'dff' }, [['d.Q', 'ff.D'], ['c.Q', 'ff.CLK']]))
    expect(s.pinValue('ff', 'Q')).toBe(0)
    set(s, 'd', true)
    expect(s.pinValue('ff', 'Q')).toBe(0)
    set(s, 'c', true)
    expect(s.pinValue('ff', 'Q')).toBe(1)
    set(s, 'd', false)
    expect(s.pinValue('ff', 'Q')).toBe(1)
    set(s, 'c', false)
    expect(s.pinValue('ff', 'Q')).toBe(1)
    set(s, 'c', true)
    expect(s.pinValue('ff', 'Q')).toBe(0)
    expect(s.pinValue('ff', 'NQ')).toBe(1)
  })

  it('three D flip-flops sharing a clock form a shift register without races', () => {
    const s = sim(
      build({ d: 'switch', c: 'switch', f1: 'dff', f2: 'dff', f3: 'dff' }, [
        ['d.Q', 'f1.D'],
        ['f1.Q', 'f2.D'],
        ['f2.Q', 'f3.D'],
        ['c.Q', 'f1.CLK'],
        ['c.Q', 'f2.CLK'],
        ['c.Q', 'f3.CLK'],
      ]),
    )
    const pulse = () => {
      set(s, 'c', true)
      set(s, 'c', false)
    }
    const q = () => ['f1', 'f2', 'f3'].map((f) => s.pinValue(f, 'Q'))
    set(s, 'd', true)
    pulse()
    expect(q()).toEqual([1, 0, 0])
    set(s, 'd', false)
    pulse()
    expect(q()).toEqual([0, 1, 0])
    pulse()
    expect(q()).toEqual([0, 0, 1])
  })

  it('JK toggles when J=K=1, T toggles when T=1', () => {
    const s = sim(
      build({ one: ['const', { value: 1 }], c: 'switch', jk: 'jkff', t: 'tff' }, [
        ['one.Q', 'jk.J'],
        ['one.Q', 'jk.K'],
        ['c.Q', 'jk.CLK'],
        ['c.Q', 't.CLK'],
      ]),
    )
    const seq: number[] = []
    for (let i = 0; i < 4; i++) {
      set(s, 'c', true)
      set(s, 'c', false)
      seq.push(s.pinValue('jk', 'Q'), s.pinValue('t', 'Q'))
    }
    expect(seq).toEqual([1, 1, 0, 0, 1, 1, 0, 0])
  })

  it('async reset overrides the clock', () => {
    const s = sim(build({ r: 'switch', c: 'switch', ff: 'tff' }, [['r.Q', 'ff.R'], ['c.Q', 'ff.CLK']]))
    set(s, 'c', true)
    expect(s.pinValue('ff', 'Q')).toBe(1)
    set(s, 'r', true)
    expect(s.pinValue('ff', 'Q')).toBe(0)
  })
})

describe('counters and registers', () => {
  const clocked = (type: string, params: Params = {}) => {
    const s = sim(build({ c: 'switch', u: [type, params] }, [['c.Q', 'u.CLK']]))
    const pulse = () => {
      set(s, 'c', true)
      set(s, 'c', false)
    }
    return { s, pulse }
  }

  it('decade counter counts 0..9 and wraps', () => {
    const { s, pulse } = clocked('counter', { mod: 10 })
    const seen: number[] = []
    for (let i = 0; i < 12; i++) {
      seen.push(val(['A', 'B', 'C', 'D'].map((p) => s.pinValue('u', p))))
      pulse()
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1])
  })

  it('binary counter reaches 15 and raises carry out', () => {
    const { s, pulse } = clocked('counter', { mod: 16 })
    for (let i = 0; i < 15; i++) pulse()
    expect(val(['A', 'B', 'C', 'D'].map((p) => s.pinValue('u', p)))).toBe(15)
    expect(s.pinValue('u', 'CO')).toBe(1)
  })

  it('counter counts down with U/D=0', () => {
    const s = sim(build({ c: 'switch', z: ['const', { value: 0 }], u: 'counter' }, [['c.Q', 'u.CLK'], ['z.Q', 'u.UD']]))
    set(s, 'c', true)
    expect(val(['A', 'B', 'C', 'D'].map((p) => s.pinValue('u', p)))).toBe(9)
  })

  it('ring and Johnson counters', () => {
    const ring = clocked('ringcounter', { kind: 'ring' })
    const john = clocked('ringcounter', { kind: 'johnson' })
    const r: number[] = []
    const j: number[] = []
    for (let i = 0; i < 5; i++) {
      r.push(val(['Q0', 'Q1', 'Q2', 'Q3'].map((p) => ring.s.pinValue('u', p))))
      j.push(val(['Q0', 'Q1', 'Q2', 'Q3'].map((p) => john.s.pinValue('u', p))))
      ring.pulse()
      john.pulse()
    }
    expect(r).toEqual([1, 2, 4, 8, 1])
    expect(j).toEqual([0, 1, 3, 7, 15])
  })

  it('shift register shifts serial input', () => {
    const s = sim(build({ c: 'switch', si: 'switch', u: 'shiftreg' }, [['c.Q', 'u.CLK'], ['si.Q', 'u.SI']]))
    const pulse = () => {
      set(s, 'c', true)
      set(s, 'c', false)
    }
    set(s, 'si', true)
    pulse()
    set(s, 'si', false)
    pulse()
    pulse()
    expect(['QA', 'QB', 'QC', 'QD'].map((p) => s.pinValue('u', p))).toEqual([0, 0, 1, 0])
  })
})

describe('combinational blocks', () => {
  it('4-bit adder is exhaustive-correct', () => {
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++)
        for (const c of [0, 1]) expect(val(evalComb('add4', [...bits(a, 4), ...bits(b, 4), c]))).toBe(a + b + c)
  })

  it('4-bit subtractor and adder/subtractor', () => {
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const d = evalComb('sub4', [...bits(a, 4), ...bits(b, 4), 0])
        expect(val(d.slice(0, 4))).toBe((a - b) & 15)
        expect(d[4]).toBe(a < b ? 1 : 0)
        const s = evalComb('addsub4', [...bits(a, 4), ...bits(b, 4), 1])
        expect(val(s.slice(0, 4))).toBe((a - b) & 15)
      }
  })

  it('adder/subtractor flags signed overflow', () => {
    // 7 + 1 = 8 overflows a signed 4-bit number.
    expect(evalComb('addsub4', [...bits(7, 4), ...bits(1, 4), 0])[5]).toBe(1)
    expect(evalComb('addsub4', [...bits(3, 4), ...bits(2, 4), 0])[5]).toBe(0)
  })

  it('full adder and comparator', () => {
    for (let n = 0; n < 8; n++) {
      const [a, b, c] = bits(n, 3)
      expect(val(evalComb('fulladd', [a, b, c]))).toBe(a + b + c)
    }
    expect(evalComb('cmp4', [...bits(9, 4), ...bits(3, 4)])).toEqual([1, 0, 0])
    expect(evalComb('cmp4', [...bits(5, 4), ...bits(5, 4)])).toEqual([0, 1, 0])
  })

  it('mux selects with S1 S0 (MSB first on the pins)', () => {
    // ins: I0..I3, S1, S0
    for (let s = 0; s < 4; s++) {
      const data = [0, 0, 0, 0]
      data[s] = 1
      expect(evalComb('mux', [...data, (s >> 1) & 1, s & 1])).toEqual([1])
    }
  })

  it('demux and decoder raise exactly one output', () => {
    expect(evalComb('demux', [1, 1, 0])).toEqual([0, 0, 1, 0])
    expect(evalComb('decoder', [1, 1, 3 - 2], { n: 2 })).toEqual([0, 0, 0, 1])
    expect(evalComb('decoder', [1, 1, 0], { n: 2 })).toEqual([0, 0, 0, 0])
  })

  it('priority encoder picks the highest active input', () => {
    expect(evalComb('encoder', [1, 0, 1, 0])).toEqual([0, 1, 1])
    expect(evalComb('encoder', [0, 0, 0, 0])).toEqual([0, 0, 0])
  })

  it('BCD to 7-segment draws the right digits', () => {
    expect(val(evalComb('bcd7', bits(8, 4)))).toBe(0x7f)
    expect(val(evalComb('bcd7', bits(1, 4)))).toBe(0x06)
    expect(val(evalComb('bcd7', bits(12, 4)))).toBe(0)
    expect(val(evalComb('bcd7', bits(12, 4), { mode: 'hex' }))).toBe(0x39)
  })

  it('code converters', () => {
    for (let n = 0; n < 16; n++) {
      const g = evalComb('gray', bits(n, 4))
      expect(val(g)).toBe(n ^ (n >> 1))
      expect(val(evalComb('gray', g, { dir: 'g2b' }))).toBe(n)
      const bcd = evalComb('bin2bcd', bits(n, 4))
      expect(val(bcd.slice(0, 4)) + 10 * bcd[4]).toBe(n)
    }
    expect(evalComb('parity', [1, 1, 1, 0])).toEqual([1, 0])
  })

  it('any X input makes block outputs X', () => {
    expect(evalComb('add4', [X, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual([X, X, X, X, X])
  })
})

describe('clocks', () => {
  it('toggles in real time and drives a counter', () => {
    const s = sim(build({ clk: ['clock', { hz: 1 }], u: ['counter', { mod: 16 }] }, [['clk.Q', 'u.CLK']]))
    expect(s.pinValue('clk', 'Q')).toBe(0)
    s.frame(500)
    expect(s.pinValue('clk', 'Q')).toBe(1)
    s.frame(2500) // 5 more half-periods -> 3 rising edges total
    expect(val(['A', 'B', 'C', 'D'].map((p) => s.pinValue('u', p)))).toBe(3)
  })

  it('stepClock jumps to the next edge', () => {
    const s = sim(build({ clk: ['clock', { hz: 0.25 }] }, []))
    s.stepClock()
    expect(s.pinValue('clk', 'Q')).toBe(1)
    s.stepClock()
    expect(s.pinValue('clk', 'Q')).toBe(0)
  })
})

describe('reload', () => {
  it('keeps values and state when the circuit is edited', () => {
    const s = sim(build({ c: 'switch', u: 'counter' }, [['c.Q', 'u.CLK']]))
    set(s, 'c', true)
    set(s, 'c', false)
    set(s, 'c', true)
    s.load(build({ c: ['switch', { on: true }], u: 'counter', led: 'led' }, [['c.Q', 'u.CLK'], ['u.A', 'led.A']]))
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(0)
    expect(s.pinValue('u', 'B')).toBe(1)
  })
})

describe('simulated time and sampling', () => {
  it('time follows the clocks and a probe records the clock edges', () => {
    const s = new Simulator()
    s.load(build({ c: ['clock', { hz: 4 }], p: 'probe' }, [['c.Q', 'p.A']]))
    s.settle()
    expect(s.time).toBe(0)
    for (let i = 0; i < 10; i++) s.frame(100) // one second
    expect(s.time).toBeCloseTo(1000, 6)
    const tr = s.state('p') as { t: number[]; v: V[] }
    // A 4 Hz clock toggles every 125 ms.
    expect(tr.t.slice(1, 5).map((t) => Math.round(t))).toEqual([125, 250, 375, 500])
    expect(tr.v.slice(1, 5)).toEqual([1, 0, 1, 0])
    s.reset()
    expect(s.time).toBe(0)
    expect((s.state('p') as { t: number[] }).t).toEqual([])
  })

  it('time also passes in circuits without clocks', () => {
    const s = new Simulator()
    s.load(build({ a: 'switch', p: 'probe' }, [['a.Q', 'p.A']]))
    s.frame(500)
    s.setParams('a', { on: true })
    s.frame(500)
    expect(s.time).toBe(1000)
    const tr = s.state('p') as { t: number[]; v: V[] }
    expect(tr.v).toEqual([0, 1])
    expect(tr.t[1]).toBe(500 + 500) // seen at the end of the frame in which it changed
  })
})
