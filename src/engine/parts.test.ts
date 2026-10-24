import { describe, expect, it } from 'vitest'
import { ALU_OPS } from './components/combinational'
import { parseWords } from './components/memory'
import { getDef } from './registry'
import { X, paramDefaults, type Params, type V } from './types'

/** A single part with its own state; call `step` with the input values to evaluate it once. */
function part(type: string, params: Params = {}) {
  const def = getDef(type)
  const p = { ...paramDefaults(def), ...params }
  const outs = def.layout(p).pins.filter((x) => x.dir === 'out')
  const inst = { ins: [] as V[], outs: outs.map(() => X) as V[], state: def.init?.(p), params: p }
  return {
    step(ins: number[]): V[] {
      inst.ins = ins as V[]
      def.evaluate(inst)
      return [...inst.outs]
    },
    inputs: def.layout(p).pins.filter((x) => x.dir === 'in').map((x) => x.name),
  }
}

const bits = (n: number, k: number) => Array.from({ length: k }, (_, i) => (n >> i) & 1)
const val = (vs: V[]) => vs.reduce<number>((a, v, i) => a | (v << i), 0)

describe('ALU', () => {
  // Pin order: A0–A3, B0–B3, then S2 S1 S0.
  const run = (a: number, b: number, op: number) =>
    part('alu').step([...bits(a, 4), ...bits(b, 4), (op >> 2) & 1, (op >> 1) & 1, op & 1])

  it('has the pins the select lines are documented with', () => {
    expect(part('alu').inputs.slice(8)).toEqual(['S2', 'S1', 'S0'])
    expect(ALU_OPS).toHaveLength(8)
  })

  it('computes every operation for every input pair', () => {
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const expected: [number, number][] = [
          [(a + b) & 15, a + b > 15 ? 1 : 0],
          [(a - b) & 15, a < b ? 1 : 0],
          [a & b, 0],
          [a | b, 0],
          [a ^ b, 0],
          [~a & 15, 0],
          [(a + 1) & 15, a === 15 ? 1 : 0],
          [(a - 1) & 15, a === 0 ? 1 : 0],
        ]
        expected.forEach(([f, co], op) => {
          const r = run(a, b, op)
          expect(val(r.slice(0, 4)), `${ALU_OPS[op]} ${a},${b}`).toBe(f)
          expect(r[4], `carry ${ALU_OPS[op]} ${a},${b}`).toBe(co)
          expect(r[5], `zero ${ALU_OPS[op]} ${a},${b}`).toBe(f === 0 ? 1 : 0)
        })
      }
  })

  it('ignores B for single-operand operations but needs it for the others', () => {
    const noB = [X, X, X, X]
    expect(val(part('alu').step([...bits(5, 4), ...noB, 1, 0, 1]).slice(0, 4))).toBe(10) // NOT A
    expect(part('alu').step([...bits(5, 4), ...noB, 0, 0, 0])[0]).toBe(X) // ADD
    expect(part('alu').step([...bits(5, 4), ...bits(1, 4), X, 0, 0])[0]).toBe(X) // unknown operation
  })
})

describe('multiplier', () => {
  it('4×4 gives the 8-bit product', () => {
    const m = part('mul')
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) expect(val(m.step([...bits(a, 4), ...bits(b, 4)])), `${a}×${b}`).toBe(a * b)
  })

  it('2×2 gives a 4-bit product', () => {
    const m = part('mul', { n: 2 })
    expect(m.inputs).toEqual(['A0', 'A1', 'B0', 'B1'])
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) expect(val(m.step([...bits(a, 2), ...bits(b, 2)]))).toBe(a * b)
  })
})

describe('BCD adder', () => {
  it('adds every pair of BCD digits with carry-in, correcting past 9', () => {
    const add = part('bcdadd')
    for (let a = 0; a < 10; a++)
      for (let b = 0; b < 10; b++)
        for (const ci of [0, 1]) {
          const r = add.step([...bits(a, 4), ...bits(b, 4), ci])
          const sum = a + b + ci
          expect(val(r.slice(0, 4)), `${a}+${b}+${ci}`).toBe(sum % 10)
          expect(r[4]).toBe(sum >= 10 ? 1 : 0)
        }
  })
})

describe('ROM', () => {
  it('parses hex words, filling and cutting to size', () => {
    expect(parseWords('1 2 3', 4, 4)).toEqual([1, 2, 3, 0])
    expect(parseWords('a,B\nf', 4, 4)).toEqual([10, 11, 15, 0])
    // The words of one text are shared by everyone who reads it, so they cannot be written into (a row editor once did, and the
    // old text then read back wrong).
    expect(() => ((parseWords('1 2 3', 4, 4) as number[])[0] = 9)).toThrow()
    expect(parseWords('1 2 3', 4, 4)).toEqual([1, 2, 3, 0])
    expect(parseWords('1F 20', 4, 4)).toEqual([15, 0, 0, 0]) // 0x1F & 15, 0x20 & 15
    expect(parseWords('1F 20', 4, 8)).toEqual([0x1f, 0x20, 0, 0])
    expect(parseWords('1 2 3 4 5 6', 4, 4)).toEqual([1, 2, 3, 4])
  })

  it('looks up the addressed word and goes unknown for an unknown address', () => {
    const rom = part('rom', { abits: 3, dbits: 8, data: '12 34 56 78 9A BC DE F0' })
    expect(rom.inputs).toEqual(['A0', 'A1', 'A2'])
    const words = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]
    words.forEach((w, a) => expect(val(rom.step(bits(a, 3))), `address ${a}`).toBe(w))
    expect(rom.step([1, X, 0])).toEqual(new Array(8).fill(X))
  })

  it('defaults to a 16×4 table that returns its own address', () => {
    const rom = part('rom')
    for (let a = 0; a < 16; a++) expect(val(rom.step(bits(a, 4)))).toBe(a)
  })
})

describe('RAM 16×4', () => {
  // Pin order: D0–D3, WE, CLK, then A0–A3.
  const io = (d: number, we: number, clk: number, a: number) => [...bits(d, 4), we, clk, ...bits(a, 4)]

  it('writes on the rising clock edge only while WE=1, and holds otherwise', () => {
    const ram = part('ram')
    expect(part('ram').inputs).toEqual(['D0', 'D1', 'D2', 'D3', 'WE', 'CLK', 'A0', 'A1', 'A2', 'A3'])
    expect(val(ram.step(io(9, 1, 0, 5)))).toBe(0) // nothing written yet
    expect(val(ram.step(io(9, 1, 1, 5)))).toBe(9) // rising edge with WE=1
    expect(val(ram.step(io(3, 1, 1, 5)))).toBe(9) // clock stays high: no new edge
    expect(val(ram.step(io(3, 0, 0, 5)))).toBe(9)
    expect(val(ram.step(io(3, 0, 1, 5)))).toBe(9) // edge with WE=0: no write
    expect(val(ram.step(io(3, 0, 0, 6)))).toBe(0) // other addresses are untouched
    expect(val(ram.step(io(3, 0, 0, 5)))).toBe(9)
  })

  it('ignores writes with an unknown address or data and reads X from an unknown address', () => {
    const ram = part('ram')
    ram.step(io(7, 1, 0, 1))
    ram.step([X, 0, 0, 0, 1, 1, ...bits(1, 4)]) // rising edge, but D0 is unknown
    expect(val(ram.step(io(0, 0, 0, 1)))).toBe(0)
    ram.step(io(7, 1, 0, 1))
    ram.step([...bits(7, 4), 1, 1, X, 0, 0, 0]) // rising edge, but A0 is unknown
    expect(val(ram.step(io(0, 0, 0, 1)))).toBe(0)
    expect(ram.step([0, 0, 0, 0, 0, 0, X, 0, 0, 0])).toEqual([X, X, X, X])
  })
})

describe('probe', () => {
  const rig = () => {
    const def = getDef('probe')
    const inst = { ins: [X] as V[], outs: [] as V[], state: def.init!({}), params: {} }
    return {
      inst,
      sample(v: V, t: number) {
        inst.ins = [v]
        def.sample!(inst, t)
      },
    }
  }

  it('records transitions only, with their times', () => {
    const { inst, sample } = rig()
    sample(X, 0)
    sample(X, 10)
    sample(0, 20)
    sample(0, 30)
    sample(1, 40)
    expect(inst.state).toEqual({ t: [0, 20, 40], v: [X, 0, 1] })
  })

  it('keeps about a minute of history, starting with the value in effect then', () => {
    const { inst, sample } = rig()
    for (let t = 0; t <= 200_000; t += 100) sample((t / 100) % 2 === 0 ? 0 : 1, t)
    const { t, v } = inst.state as { t: number[]; v: V[] }
    expect(t.length).toBe(v.length)
    // Everything from the last 60 s is there, and the first kept entry is the one just before that.
    expect(t[0]).toBeLessThanOrEqual(200_000 - 60_000)
    expect(t[1]).toBeGreaterThan(200_000 - 66_000 - 100) // at most a few seconds of slack
    expect(t.length).toBeLessThan(800)
    expect(t[t.length - 1]).toBe(200_000)
  })
})

describe('counter with load', () => {
  // Pin order: D0–D3, LD, EN, CLK, then R.
  const io = (d: number, ld: number, en: number, clk: number, r = 0) => [...bits(d, 4), ld, en, clk, r]

  it('counts on the rising edge, wraps at 16 and raises CO at 15', () => {
    const c = part('counterld')
    c.step(io(0, 0, 1, 0))
    for (let n = 1; n <= 20; n++) {
      c.step(io(0, 0, 1, 1))
      const r = c.step(io(0, 0, 1, 0))
      expect(val(r.slice(0, 4)), `after ${n} edges`).toBe(n % 16)
      expect(r[4]).toBe(n % 16 === 15 ? 1 : 0)
    }
  })

  it('loads D instead of counting when LD=1, holds when EN=0, and R clears at once', () => {
    const c = part('counterld')
    c.step(io(0, 0, 1, 0))
    c.step(io(9, 1, 1, 1))
    expect(val(c.step(io(9, 1, 1, 0)).slice(0, 4))).toBe(9)
    c.step(io(3, 0, 0, 1)) // EN=0: holds
    expect(val(c.step(io(3, 0, 0, 0)).slice(0, 4))).toBe(9)
    c.step(io(3, 1, 0, 1)) // LD wins even with EN=0
    expect(val(c.step(io(3, 1, 0, 0)).slice(0, 4))).toBe(3)
    expect(val(c.step(io(3, 0, 1, 0, 1)).slice(0, 4))).toBe(0) // R
  })

  it('leaves its state alone when a control input is unknown, and ignores unknown load data', () => {
    const c = part('counterld')
    c.step(io(5, 1, 1, 0))
    c.step(io(5, 1, 1, 1))
    expect(val(c.step(io(5, 1, 1, 0)).slice(0, 4))).toBe(5)
    c.step([0, 0, 0, 0, X, 1, 1, 0])
    expect(val(c.step([0, 0, 0, 0, X, 1, 0, 0]).slice(0, 4))).toBe(5)
    c.step([X, 0, 0, 0, 1, 1, 1, 0]) // load with unknown data
    expect(val(c.step([X, 0, 0, 0, 1, 1, 0, 0]).slice(0, 4))).toBe(5)
  })
})

describe('wide memories', () => {
  it('ROM with 16 data bits has D0–D15 and returns four-digit words', () => {
    const rom = part('rom', { abits: 2, dbits: 16, data: 'ABCD 1234 0001' })
    expect(rom.inputs).toEqual(['A0', 'A1'])
    expect(getDef('rom').layout({ abits: 2, dbits: 16 }).pins.filter((p) => p.dir === 'out')).toHaveLength(16)
    expect(val(rom.step(bits(0, 2)))).toBe(0xabcd)
    expect(val(rom.step(bits(1, 2)))).toBe(0x1234)
    expect(val(rom.step(bits(2, 2)))).toBe(1)
    expect(val(rom.step(bits(3, 2)))).toBe(0) // missing words are 0
    expect(parseWords('ABCDE 1', 2, 16)).toEqual([0xbcde, 1]) // cut to 16 bits
  })

  // Pin order for 8 bits: D0–D7, WE, CLK, then A0–A3.
  const io8 = (d: number, we: number, clk: number, a: number) => [...bits(d, 8), we, clk, ...bits(a, 4)]

  it('RAM with 8 data bits stores whole bytes', () => {
    const ram = part('ram', { dbits: 8 })
    expect(ram.inputs).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'WE', 'CLK', 'A0', 'A1', 'A2', 'A3'])
    expect(val(ram.step(io8(0xa5, 1, 0, 9)))).toBe(0)
    expect(val(ram.step(io8(0xa5, 1, 1, 9)))).toBe(0xa5)
    expect(val(ram.step(io8(0xff, 1, 1, 9)))).toBe(0xa5) // no new edge
    expect(val(ram.step(io8(0, 0, 0, 8)))).toBe(0)
    expect(val(ram.step(io8(0, 0, 0, 9)))).toBe(0xa5)
    expect(ram.step(io8(0, 0, 0, 9))).toHaveLength(8)
  })

  it('RAM with 8 data bits ignores a write when any data bit is unknown', () => {
    const ram = part('ram', { dbits: 8 })
    ram.step(io8(0x12, 1, 0, 3))
    ram.step([...bits(0x12, 7), X, 1, 1, ...bits(3, 4)])
    expect(val(ram.step(io8(0, 0, 0, 3)))).toBe(0)
  })

  it('RAM keeps its 4-bit default', () => {
    expect(getDef('ram').layout({ dbits: 4 }).pins.filter((p) => p.dir === 'out')).toHaveLength(4)
    expect(paramDefaults(getDef('ram')).dbits).toBe(4)
    expect(getDef('ram').title!({ dbits: 8 })).toBe('RAM 16×8')
  })
})
