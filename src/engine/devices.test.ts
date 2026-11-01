import { describe, expect, it } from 'vitest'
import { CONSOLE_COLS, CONSOLE_LINES, consolePut, speakerPitch, speakerTone, type ConsoleState } from './components/devices'
import { TRACE_MAX_POINTS } from './components/io'
import { getDef } from './testdata/oracle/registry'
import { X, paramDefaults, type Params, type V } from './types'

function part(type: string, params: Params = {}) {
  const def = getDef(type)
  const p = { ...paramDefaults(def), ...params }
  const layout = def.layout(p)
  const outs = layout.pins.filter((x) => x.dir === 'out')
  const inst = { ins: [] as V[], outs: outs.map(() => X) as V[], state: def.init?.(p) as any, params: p }
  return {
    inst,
    names: layout.pins.filter((x) => x.dir === 'in').map((x) => x.name),
    outNames: outs.map((o) => o.name),
    /** Evaluate once with the inputs given by name; the others are 0. */
    step(given: Record<string, number>): V[] {
      inst.ins = layout.pins.filter((x) => x.dir === 'in').map((x) => (given[x.name] ?? 0) as V)
      def.evaluate(inst)
      return [...inst.outs]
    },
  }
}

const bits = (prefix: string, n: number, k: number) => Object.fromEntries(Array.from({ length: k }, (_, i) => [`${prefix}${i}`, (n >> i) & 1]))
const val = (vs: V[]) => vs.reduce<number>((a, v, i) => a | (v << i), 0)

describe('text console', () => {
  const type = (c: ReturnType<typeof part>, code: number) => {
    c.step({ ...bits('D', code, 8), WE: 1, CLK: 0 })
    c.step({ ...bits('D', code, 8), WE: 1, CLK: 1 })
  }

  it('prints a character on each rising edge with WE=1', () => {
    const c = part('console')
    for (const ch of 'Hi') type(c, ch.charCodeAt(0))
    expect(c.inst.state.lines).toEqual(['Hi'])
    // Holding the clock high, or WE low, prints nothing more.
    c.step({ ...bits('D', 65, 8), WE: 1, CLK: 1 })
    c.step({ ...bits('D', 65, 8), WE: 0, CLK: 0 })
    c.step({ ...bits('D', 65, 8), WE: 0, CLK: 1 })
    expect(c.inst.state.lines).toEqual(['Hi'])
  })

  it('ignores an unknown character code', () => {
    const c = part('console')
    c.step({ ...bits('D', 0, 8), WE: 1, CLK: 0 })
    c.inst.ins = [X, 0, 0, 0, 0, 0, 0, 0, 1, 1] as V[]
    getDef('console').evaluate(c.inst)
    expect(c.inst.state.lines).toEqual([''])
  })

  it('understands newline, backspace and clear, and ignores other control codes', () => {
    const st: ConsoleState = { lines: [''], pc: 0, rev: 0 }
    for (const code of [...'ab'].map((x) => x.charCodeAt(0))) consolePut(st, code)
    consolePut(st, 8)
    consolePut(st, 10)
    consolePut(st, 'c'.charCodeAt(0))
    consolePut(st, 7)
    consolePut(st, 200)
    expect(st.lines).toEqual(['a', 'c'])
    const rev = st.rev
    consolePut(st, 7)
    expect(st.rev).toBe(rev)
    consolePut(st, 12)
    expect(st.lines).toEqual([''])
  })

  it('wraps a full line and keeps only the most recent lines', () => {
    const st: ConsoleState = { lines: [''], pc: 0, rev: 0 }
    for (let i = 0; i < CONSOLE_COLS + 1; i++) consolePut(st, 'x'.charCodeAt(0))
    expect(st.lines).toEqual(['x'.repeat(CONSOLE_COLS), 'x'])
    for (let i = 0; i < CONSOLE_LINES + 10; i++) consolePut(st, 10)
    expect(st.lines).toHaveLength(CONSOLE_LINES)
  })
})

describe('pixel screen', () => {
  const pins = (x: number, y: number, d: number, we: number, clk: number, clr = 0) => ({ ...bits('X', x, 4), ...bits('Y', y, 4), ...bits('D', d, 2), WE: we, CLK: clk, CLR: clr })

  it('sets the pixel at (X, Y) on a rising edge with WE=1', () => {
    const s = part('framebuffer', { colors: 4 })
    s.step(pins(3, 5, 2, 1, 0))
    expect(s.inst.state.px[5 * 16 + 3]).toBe(0)
    s.step(pins(3, 5, 2, 1, 1))
    expect(s.inst.state.px[5 * 16 + 3]).toBe(2)
    expect(s.inst.state.px.filter((v: number) => v)).toHaveLength(1)
    s.step(pins(15, 15, 3, 0, 0))
    s.step(pins(15, 15, 3, 0, 1)) // WE=0: nothing
    expect(s.inst.state.px[255]).toBe(0)
  })

  it('has one data pin in two-colour mode, and two in four-colour mode', () => {
    expect(part('framebuffer').names).toEqual(['X0', 'X1', 'X2', 'X3', 'Y0', 'Y1', 'Y2', 'Y3', 'D', 'WE', 'CLR', 'CLK'])
    expect(part('framebuffer', { colors: 4 }).names).toContain('D1')
  })

  it('blanks the screen while CLR=1', () => {
    const s = part('framebuffer')
    s.step({ ...bits('X', 1, 4), D: 1, WE: 1, CLK: 0 })
    s.step({ ...bits('X', 1, 4), D: 1, WE: 1, CLK: 1 })
    expect(s.inst.state.px[1]).toBe(1)
    s.step({ CLR: 1 })
    expect(s.inst.state.px.every((v: number) => v === 0)).toBe(true)
  })

  it('counts changes so the symbol redraws, but not a write that changes nothing', () => {
    const s = part('framebuffer')
    const write = () => {
      s.step({ D: 1, WE: 1, CLK: 0 })
      s.step({ D: 1, WE: 1, CLK: 1 })
    }
    write()
    const rev = s.inst.state.rev
    write()
    expect(s.inst.state.rev).toBe(rev)
  })
})

describe('speaker', () => {
  it('hears nothing from a quiet input, a single change, or one that stopped', () => {
    expect(speakerPitch([], 1000)).toBe(0)
    expect(speakerPitch([10, 20], 25)).toBe(0)
    expect(speakerPitch([0, 10, 20, 30], 500)).toBe(0)
  })

  it('works out the frequency from the time between changes', () => {
    // A change every 2 ms is a 250 Hz square wave.
    expect(speakerPitch([0, 2, 4, 6, 8], 9)).toBeCloseTo(250, 5)
    expect(speakerPitch([0, 1000, 2000], 2100)).toBeCloseTo(0.5, 5)
  })

  it('records the changes of its input as it is sampled, and forgets them when stepped back', () => {
    const def = getDef('speaker')
    const inst = { ins: [0] as V[], outs: [] as V[], state: def.init!({}) as any, params: { on: true } }
    const at = (v: V, t: number) => {
      inst.ins = [v]
      def.sample!(inst, t)
    }
    at(0, 0)
    at(1, 2)
    at(0, 4)
    at(1, 6)
    expect(inst.state.edges).toEqual([2, 4, 6])
    at(X, 7) // an unknown input is not a change
    expect(inst.state.edges).toEqual([2, 4, 6])
    def.rewind!(inst, 4)
    expect(inst.state.edges).toEqual([2, 4])
  })
})

describe('probe', () => {
  it('keeps no more than TRACE_MAX_POINTS transitions, the newest, however fast the signal changes', () => {
    const def = getDef('probe')
    const inst = { ins: [0] as V[], outs: [] as V[], state: def.init!({}) as { t: number[]; v: number[] }, params: {} }
    for (let i = 0; i < TRACE_MAX_POINTS * 3; i++) {
      inst.ins = [(i & 1) as V]
      def.sample!(inst, i * 0.001) // (a million transitions a second)
    }
    expect(inst.state.t.length).toBeLessThanOrEqual(TRACE_MAX_POINTS)
    expect(inst.state.t.length).toBeGreaterThan(TRACE_MAX_POINTS / 2)
    expect(inst.state.t[inst.state.t.length - 1]).toBeCloseTo((TRACE_MAX_POINTS * 3 - 1) * 0.001, 6)
    expect(inst.state.t.length).toBe(inst.state.v.length)
    // the times are still in order and each value is the one that was recorded with it
    expect(inst.state.t.every((t, i) => i === 0 || t > inst.state.t[i - 1])).toBe(true)
    expect(inst.state.v[inst.state.v.length - 1]).toBe(((TRACE_MAX_POINTS * 3 - 1) & 1) as V)
  })
})

describe('keypad', () => {
  it('outputs the code of the last key, and P while it is held', () => {
    const k = part('keypad')
    expect(k.names).toEqual(['RST'])
    expect(k.outNames).toEqual(['K0', 'K1', 'K2', 'K3', 'P'])
    k.inst.state.pressed = true
    k.inst.state.key = 11
    expect(k.step({})).toEqual([1, 1, 0, 1, 1])
    k.inst.state.pressed = false
    expect(k.step({})).toEqual([1, 1, 0, 1, 0]) // the code stays, P drops
  })

  it('keeps P high after the key is let go when sticky, until RST', () => {
    const k = part('keypad', { sticky: true })
    k.inst.state.pressed = true
    k.inst.state.key = 3
    k.step({})
    k.inst.state.pressed = false
    expect(k.step({})[4]).toBe(1)
    expect(k.step({ RST: 1 })[4]).toBe(0)
    expect(k.step({})[4]).toBe(0)
  })

  it('when sticky, a tap that is over before the part is evaluated still counts', () => {
    const k = part('keypad', { sticky: true })
    k.inst.state.tapped = true // pressed and released between two evaluations
    k.inst.state.key = 6
    expect(k.step({})[4]).toBe(1)
    expect(k.step({})[4]).toBe(1)
    expect(k.step({ RST: 1 })[4]).toBe(0)
  })

  it('when sticky, a key that is still held counts once: RST clears it and it does not come back', () => {
    const k = part('keypad', { sticky: true })
    k.inst.state.pressed = true
    k.inst.state.key = 9
    expect(k.step({})[4]).toBe(1)
    expect(k.step({ RST: 1 })[4]).toBe(0) // acknowledged while the key is still down
    expect(k.step({})[4]).toBe(0)
    expect(k.step({})[4]).toBe(0)
    k.inst.state.pressed = false
    k.step({})
    k.inst.state.pressed = true // a new press
    expect(k.step({})[4]).toBe(1)
  })
})

describe('lookup table', () => {
  it('reads the row the inputs select, A being the most significant', () => {
    const lut = part('lut', { inputs: 3, outputs: 1, data: '0 1 2 3 4 5 6 7' })
    // data are single bits: only the lowest bit of each word is used for one output.
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((r) => lut.step({ A: (r >> 2) & 1, B: (r >> 1) & 1, C: r & 1 })[0])
    expect(rows).toEqual([0, 1, 0, 1, 0, 1, 0, 1])
  })

  it('has several outputs, the least significant bit first', () => {
    const lut = part('lut', { inputs: 2, outputs: 4, data: '9 6 F 0' })
    expect(lut.outNames).toEqual(['Y0', 'Y1', 'Y2', 'Y3'])
    expect(val(lut.step({ A: 0, B: 0 }))).toBe(9)
    expect(val(lut.step({ A: 0, B: 1 }))).toBe(6)
    expect(val(lut.step({ A: 1, B: 0 }))).toBe(15)
    expect(val(lut.step({ A: 1, B: 1 }))).toBe(0)
  })

  it('is unknown when an input is unknown', () => {
    const lut = part('lut', { inputs: 2, outputs: 1, data: '1 1 1 1' })
    lut.inst.ins = [X, 0] as V[]
    getDef('lut').evaluate(lut.inst)
    expect(lut.inst.outs).toEqual([X])
  })

  it('is as big as its inputs say', () => {
    expect(part('lut', { inputs: 8 }).names).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
    const lut = part('lut', { inputs: 8, outputs: 8, data: Array.from({ length: 256 }, (_, i) => ((i * 7) & 255).toString(16)).join(' ') })
    expect(val(lut.step({ A: 1, H: 1 }))).toBe((129 * 7) & 255)
  })
})

describe('wider memories', () => {
  it('a ROM with 8 address bits reads 256 words', () => {
    const data = Array.from({ length: 256 }, (_, i) => ((i * 3) & 15).toString(16)).join(' ')
    const rom = part('rom', { abits: 8, dbits: 4, data })
    expect(rom.names).toHaveLength(8)
    const at = (a: number) => val(rom.step(bits('A', a, 8)))
    expect(at(0)).toBe(0)
    expect(at(200)).toBe((200 * 3) & 15)
    expect(at(255)).toBe((255 * 3) & 15)
  })

  it('a RAM with 8 address bits stores 256 words, and the 4-bit one is unchanged', () => {
    const ram = part('ram', { abits: 8, dbits: 8 })
    const io = (d: number, we: number, clk: number, a: number) => ({ ...bits('D', d, 8), WE: we, CLK: clk, ...bits('A', a, 8) })
    ram.step(io(0xab, 1, 0, 200))
    ram.step(io(0xab, 1, 1, 200))
    expect(val(ram.step(io(0, 0, 0, 200)))).toBe(0xab)
    expect(val(ram.step(io(0, 0, 0, 72)))).toBe(0) // 200 and 72 differ only in bit 7
    expect(ram.inst.state.mem).toHaveLength(256)
    expect(part('ram').inst.state.mem).toHaveLength(16)
    expect(part('ram').names).toEqual(['D0', 'D1', 'D2', 'D3', 'WE', 'CLK', 'A0', 'A1', 'A2', 'A3'])
  })
})

describe('speaker tone', () => {
  it('is the simulated pitch times the speed, within the audible range, while running with sound on', () => {
    expect(speakerTone(250, 1, true, true)).toBe(250)
    expect(speakerTone(250, 2, true, true)).toBe(500)
    expect(speakerTone(250, 1, false, true)).toBe(0)
    expect(speakerTone(250, 1, true, false)).toBe(0)
    expect(speakerTone(5, 1, true, true)).toBe(0) // too slow to be a tone
    expect(speakerTone(20000, 1, true, true)).toBe(0)
    expect(speakerTone(0, 4, true, true)).toBe(0)
    expect(speakerTone(25, 1, true, true, 3)).toBe(200) // three octaves up: ×8
    expect(speakerTone(5, 1, true, true, 2)).toBe(20)
  })
})

describe('changing the address size of a RAM', () => {
  it('keeps the words it had, and pads or cuts the rest', () => {
    const def = getDef('ram')
    const inst = { ins: [] as V[], outs: [] as V[], state: def.init!({ dbits: 4, abits: 4 }) as any, params: { dbits: 4, abits: 4 } as Params }
    inst.state.mem[3] = 9
    // The simulator keeps the state of a part whose parameters changed: now it has 6 address bits.
    inst.params = { dbits: 4, abits: 6 }
    inst.outs = [X, X, X, X]
    inst.ins = [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0] as V[] // address 3
    def.evaluate(inst)
    expect(inst.state.mem).toHaveLength(64)
    expect(inst.outs).toEqual([1, 0, 0, 1])
    inst.params = { dbits: 4, abits: 4 }
    inst.ins = [0, 0, 0, 0, 0, 0, 1, 1, 0, 0] as V[]
    def.evaluate(inst)
    expect(inst.state.mem).toHaveLength(16)
  })
})
