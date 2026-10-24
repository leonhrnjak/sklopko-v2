import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { layoutOf } from './layoutcache'
import { X, Z, paramDefaults, type Params, type V } from './types'

/** A single part with its own state; call `step` with the input values to evaluate it once. */
function part(type: string, params: Params = {}) {
  const def = getDef(type)
  const p = { ...paramDefaults(def), ...params }
  const layout = layoutOf(type, p)
  const outs = layout.pins.filter((x) => x.dir === 'out')
  const inst = { ins: [] as V[], outs: outs.map(() => X) as V[], state: def.init?.(p), params: p }
  return {
    step(ins: number[]): V[] {
      inst.ins = ins as V[]
      def.evaluate(inst)
      return [...inst.outs]
    },
    inputs: layout.pins.filter((x) => x.dir === 'in').map((x) => x.name),
    outputs: outs.map((x) => x.name),
  }
}

const bits = (n: number, k: number) => Array.from({ length: k }, (_, i) => (n >> i) & 1)
const val = (vs: V[]) => vs.reduce<number>((a, v, i) => a | (v << i), 0)

/** A small seeded generator, so a failure repeats. */
function random(seed: number) {
  let s = seed
  return (below: number) => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s % below
  }
}

const WIDTHS = [2, 8, 16]
const pick = (rnd: (n: number) => number, w: number) => (rnd(3) === 0 ? [0, 2 ** w - 1][rnd(2)] : rnd(2 ** w))

describe('n-bit arithmetic against a reference', () => {
  for (const w of WIDTHS) {
    const mask = 2 ** w - 1
    const signed = (n: number) => (n >= 2 ** (w - 1) ? n - 2 ** w : n)

    it(`adder, subtractor, adder/subtractor and comparator at ${w} bits`, () => {
      const rnd = random(w)
      const add = part('busadd', { bits: w })
      const sub = part('bussub', { bits: w })
      const addsub = part('busaddsub', { bits: w })
      const cmp = part('buscmp', { bits: w })
      for (let i = 0; i < 200; i++) {
        const a = pick(rnd, w)
        const b = pick(rnd, w)
        const c = rnd(2)
        const ab = [...bits(a, w), ...bits(b, w)]

        const s = add.step([...ab, c])
        expect(val(s.slice(0, w))).toBe((a + b + c) & mask)
        expect(s[w]).toBe(a + b + c > mask ? 1 : 0)

        const d = sub.step([...ab, c])
        expect(val(d.slice(0, w))).toBe((a - b - c) & mask)
        expect(d[w]).toBe(a - b - c < 0 ? 1 : 0)

        const m = rnd(2)
        const r = addsub.step([...ab, m])
        const exact = m ? signed(a) - signed(b) : signed(a) + signed(b)
        expect(val(r.slice(0, w))).toBe((m ? a - b : a + b) & mask)
        expect(r[w + 1]).toBe(exact < -(2 ** (w - 1)) || exact >= 2 ** (w - 1) ? 1 : 0)

        expect(cmp.step(ab)).toEqual([a > b ? 1 : 0, a === b ? 1 : 0, a < b ? 1 : 0])
      }
    })

    it(`bitwise gates at ${w} bits`, () => {
      const rnd = random(100 + w)
      const ref: Record<string, (a: number, b: number) => number> = {
        and: (a, b) => a & b,
        or: (a, b) => a | b,
        xor: (a, b) => a ^ b,
        nand: (a, b) => ~(a & b) & mask,
        nor: (a, b) => ~(a | b) & mask,
        xnor: (a, b) => ~(a ^ b) & mask,
      }
      for (const [op, fn] of Object.entries(ref)) {
        const g = part('busgate', { bits: w, op })
        for (let i = 0; i < 50; i++) {
          const a = pick(rnd, w)
          const b = pick(rnd, w)
          expect(val(g.step([...bits(a, w), ...bits(b, w)])), `${op} ${a} ${b}`).toBe(fn(a, b))
        }
      }
      const not = part('busgate', { bits: w, op: 'not' })
      expect(not.inputs).toHaveLength(w)
      expect(val(not.step(bits(5 & mask, w)))).toBe(~5 & mask)
    })

    it(`multiplexer at ${w} bits picks the bus the select names`, () => {
      const rnd = random(200 + w)
      for (const n of [2, 4, 8]) {
        const mux = part('busmux', { bits: w, n })
        const k = Math.log2(n)
        for (let i = 0; i < 30; i++) {
          const inputs = Array.from({ length: n }, () => pick(rnd, w))
          const s = rnd(n)
          const out = mux.step([...inputs.flatMap((v) => bits(v, w)), ...bits(s, k)])
          expect(val(out)).toBe(inputs[s])
        }
      }
    })
  }

  it('an unknown input makes the outputs unknown, but an AND with a 0 is still 0', () => {
    const add = part('busadd', { bits: 4 })
    expect(add.step([X, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual(Array(5).fill(X))
    const and = part('busgate', { bits: 2, op: 'and' })
    expect(and.step([X, 1, 0, 1])).toEqual([0, 1])
    expect(part('busmux', { bits: 2, n: 2 }).step([0, 1, 1, 0, X])).toEqual([X, X])
  })
})

describe('n-bit register and counter', () => {
  for (const w of WIDTHS) {
    const mask = 2 ** w - 1
    it(`register at ${w} bits loads on the rising edge only while LD=1, and clears`, () => {
      const reg = part('busreg', { bits: w })
      expect(reg.inputs).toEqual([...Array.from({ length: w }, (_, i) => `D${i}`), 'LD', 'CLK', 'CLR'])
      const d = (n: number, ld: number, clk: number, clr = 0) => [...bits(n, w), ld, clk, clr]
      expect(val(reg.step(d(mask, 1, 0)))).toBe(0)
      expect(val(reg.step(d(mask, 1, 1)))).toBe(mask)
      expect(val(reg.step(d(1, 1, 0)))).toBe(mask)
      expect(val(reg.step(d(1, 0, 1)))).toBe(mask) // LD=0 holds
      expect(val(reg.step(d(1, 1, 0)))).toBe(mask)
      expect(val(reg.step(d(5 & mask, 1, 1)))).toBe(5 & mask)
      expect(val(reg.step(d(5 & mask, 1, 1, 1)))).toBe(0) // CLR
    })

    it(`counter at ${w} bits counts, wraps, loads and resets`, () => {
      const c = part('busctr', { bits: w })
      // Inputs: D0.., LD, EN, CLK, R. Outputs: Q0.., CO.
      const run = (d: number, ld: number, en: number, clk: number, r = 0) => c.step([...bits(d, w), ld, en, clk, r])
      const q = (o: V[]) => val(o.slice(0, w))
      run(0, 0, 1, 0)
      for (let i = 1; i <= 5; i++) {
        run(0, 0, 1, 1)
        expect(q(run(0, 0, 1, 0))).toBe(i & mask)
      }
      expect(q(run(mask, 1, 1, 1))).toBe(mask)
      run(0, 0, 1, 0)
      const wrapped = run(0, 0, 1, 1)
      expect(q(wrapped)).toBe(0)
      run(0, 0, 1, 0)
      expect(run(mask, 1, 0, 0)[w]).toBe(0)
      run(mask, 1, 1, 1)
      expect(run(mask, 0, 1, 0)[w]).toBe(1) // CO at the largest number while EN=1
      expect(q(run(0, 0, 1, 0, 1))).toBe(0)
    })
  }
})

describe('bus constant, input and display', () => {
  it('a constant and an input put their hex value on the bus, cut to the width', () => {
    expect(val(part('busconst', { bits: 8, value: 'A5' }).step([]))).toBe(0xa5)
    expect(val(part('busconst', { bits: 4, value: 'A5' }).step([]))).toBe(0x5)
    expect(val(part('busin', { bits: 16, value: 'beef' }).step([]))).toBe(0xbeef)
  })

  it('clicking an input counts up and wraps; an Alt-click counts down', () => {
    const def = getDef('busin')
    let p: Params = { ...paramDefaults(def), bits: 4, value: 'E' }
    p = def.cycle!(p, false)
    expect(p.value).toBe('F')
    p = def.cycle!(p, false)
    expect(p.value).toBe('0')
    p = def.cycle!(p, true)
    expect(p.value).toBe('F')
  })

  it('a display has one input per bit and no outputs', () => {
    const d = part('busdisp', { bits: 12 })
    expect(d.inputs).toHaveLength(12)
    expect(d.outputs).toEqual([])
  })
})

describe('tri-state buses', () => {
  it('a wide buffer passes the bus while enabled and lets go of all of it while not', () => {
    const t = part('tribuf', { bits: 4 })
    expect(t.inputs).toEqual(['A0', 'A1', 'A2', 'A3', 'EN'])
    expect(t.step([1, 0, 1, 1, 1])).toEqual([1, 0, 1, 1])
    expect(t.step([1, 0, 1, 1, 0])).toEqual([Z, Z, Z, Z])
    expect(t.step([1, 0, 1, 1, X])).toEqual([X, X, X, X])
  })

  it('a wide junction joins every bit on its own', () => {
    const j = part('busjoin', { bits: 3, drivers: 2 })
    expect(j.inputs).toEqual(['A0', 'A1', 'A2', 'B0', 'B1', 'B2'])
    // Bit 0 only A drives, bit 1 only B, bit 2 both with the same value; nothing floats.
    expect(j.step([1, Z, 1, Z, 0, 1])).toEqual([1, 0, 1])
    // Both drive bit 0 and disagree: contention on that bit alone.
    expect(j.step([1, Z, Z, 0, Z, Z])).toEqual([X, X, X])
    expect(j.step([1, 1, 1, Z, Z, Z])).toEqual([1, 1, 1])
    expect(j.step([Z, Z, Z, Z, Z, Z])).toEqual([X, X, X])
    expect(part('busjoin', { bits: 2, drivers: 2, pull: '1' }).step([Z, Z, Z, Z])).toEqual([1, 1])
  })

  it('the one-bit forms are unchanged', () => {
    expect(part('tribuf').inputs).toEqual(['A', 'EN'])
    expect(part('busjoin', { drivers: 3 }).inputs).toEqual(['A', 'B', 'C'])
  })
})
