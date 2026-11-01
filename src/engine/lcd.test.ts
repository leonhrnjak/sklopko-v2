import { describe, expect, it } from 'vitest'
import { lcdPartInit, type LcdPartState } from './components/lcd'
import { getDef } from './testdata/oracle/registry'
import { X, Z, paramDefaults, type Params, type V } from './types'

const def = getDef('hd44780')
const layout = def.layout(paramDefaults(def))
const inNames = layout.pins.filter((p) => p.dir === 'in').map((p) => p.name)
const outNames = layout.pins.filter((p) => p.dir === 'out').map((p) => p.name)

/** An LCD wired like on a board: pins are set by name; a write is E high, then E low with the data steady. */
function lcd(params: Record<string, unknown> = { busy: 'none' }) {
  const inst = { ins: [] as V[], outs: outNames.map(() => X) as V[], state: lcdPartInit() as LcdPartState, params: { ...paramDefaults(def), ...params } as Params }
  let held: Record<string, number> = { CLK: 0, RS: 0, RW: 0, E: 0 }
  const set = (given: Record<string, number>) => {
    held = { ...held, ...given }
    inst.ins = inNames.map((n) => (held[n] ?? X) as V)
    def.evaluate(inst)
  }
  const bits = (d: number) => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`DIN${i}`, (d >> i) & 1]))
  /** Write a byte: RS and R/W and the data first, then E up and down. */
  const write = (rs: number, d: number) => {
    set({ RS: rs, RW: 0, E: 0, ...bits(d) })
    set({ E: 1 })
    set({ E: 0 })
  }
  const outs = () => [...inst.outs]
  const value = () => outs().reduce<number>((a, v, i) => a | (v === 1 ? 1 << i : 0), 0)
  /** Read: RS, R/W = 1, E up (the data are on D now), E down. Returns what D showed. */
  const read = (rs: number) => {
    set({ RS: rs, RW: 1, E: 0 })
    set({ E: 1 })
    const seen = outs()
    set({ E: 0 })
    return seen
  }
  set({})
  return { inst, set, write, read, outs, value, st: inst.state }
}

const asByte = (o: V[]) => o.reduce<number>((a, v, i) => a | (v === 1 ? 1 << i : 0), 0)

describe('the LCD part', () => {
  it('has the pins of the chip: a clock for the busy flag, RS, R/W, E, eight data pins to read and eight that it drives', () => {
    expect(inNames).toEqual(['CLK', 'RS', 'RW', 'E', ...Array.from({ length: 8 }, (_, i) => `DIN${i}`)])
    expect(outNames).toEqual(Array.from({ length: 8 }, (_, i) => `D${i}`))
  })

  it('takes a write when E falls, and not when it rises', () => {
    const c = lcd()
    c.set({ RS: 0, RW: 0, E: 0, ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`DIN${i}`, (0x38 >> i) & 1])) })
    c.set({ E: 1 })
    expect(c.st.twoLine).toBe(false)
    c.set({ E: 0 })
    expect(c.st.twoLine).toBe(true)
  })

  it('writes characters after the instructions, and shows them in the text', () => {
    const c = lcd()
    for (const i of [0x38, 0x0c, 0x06, 0x01]) c.write(0, i)
    for (const ch of 'Hi!') c.write(1, ch.charCodeAt(0))
    expect(c.st.ddram.slice(0, 3)).toEqual([0x48, 0x69, 0x21])
    expect(c.st.display).toBe(true)
  })

  it('lets go of the data pins (Z) except while it is read, and then drives the busy flag and the address', () => {
    const c = lcd({ busy: 'real' })
    expect(c.outs().every((v) => v === Z)).toBe(true)
    c.write(0, 0x38)
    const seen = c.read(0)
    expect(asByte(seen)).toBe(0x80) // busy, address 0
    expect(c.outs().every((v) => v === Z)).toBe(true) // E fell: let go
  })

  it('counts its busy time in rising edges of the clock', () => {
    const c = lcd({ busy: 'real' })
    c.write(0, 0x01)
    expect(c.st.busy).toBe(1520)
    for (let i = 0; i < 1520; i++) {
      c.set({ CLK: 0 })
      c.set({ CLK: 1 })
    }
    expect(c.st.busy).toBe(0)
    expect(asByte(c.read(0)) & 0x80).toBe(0)
  })

  it('reads a character back, and moves the address after the read', () => {
    const c = lcd()
    for (const i of [0x38, 0x0c, 0x06, 0x01]) c.write(0, i)
    for (const ch of 'AB') c.write(1, ch.charCodeAt(0))
    c.write(0, 0x80)
    expect(asByte(c.read(1))).toBe(0x41)
    expect(c.st.ac).toBe(1)
    expect(asByte(c.read(1))).toBe(0x42)
  })

  it('in 4-bit mode takes two writes for a byte from D4 in to D7 in, and drives only D4 to D7 when read', () => {
    const c = lcd()
    c.write(0, 0x20) // the 8-bit chip told to use 4 bits
    expect(c.st.dl8).toBe(false)
    c.write(0, 0x20)
    c.write(0, 0x80) // 0x28
    expect(c.st.twoLine).toBe(true)
    const seen = c.read(0)
    expect(seen.slice(0, 4).every((v) => v === Z)).toBe(true)
    expect(seen.slice(4).every((v) => v === 0 || v === 1)).toBe(true)
  })

  it('ignores a write whose upper data pins are unknown, and takes one whose lower pins nothing drives as 0', () => {
    const c = lcd()
    c.set({ RS: 0, RW: 0, E: 0, DIN4: 1, DIN5: 1, DIN6: 0, DIN7: 0 }) // 0x30 with D0–D3 unconnected
    c.set({ E: 1 })
    c.set({ E: 0 })
    expect(c.st.last).toBe('function set: 8-bit, 1 line')
    const before = c.st.last
    c.set({ DIN7: X, E: 1 })
    c.set({ E: 0 })
    expect(c.st.last).toBe(before)
  })
})
