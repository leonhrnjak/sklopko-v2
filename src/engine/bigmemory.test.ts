import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { paramDefaults, toNum, type Params } from './types'

/** Tiny builder: `wire('a.Q', 'b.A')` connects output Q of a to input A of b. */
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

/** Constants that hold `value` on the address pins `A0…` of a memory. */
function address(id: string, bits: number, value: number) {
  const comps: Record<string, [string, Params]> = {}
  const wires: [string, string][] = []
  for (let i = 0; i < bits; i++) {
    comps[`a${i}`] = ['const', { value: (value >> i) & 1 }]
    wires.push([`a${i}.Q`, `${id}.A${i}`])
  }
  return { comps, wires }
}

const start = (c: SimCircuit) => {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}
const out = (s: Simulator, id: string, bits: number) => toNum(Array.from({ length: bits }, (_, i) => s.pinValue(id, `Q${i}`)), 0, bits)

describe('RAM of 2048 words', () => {
  it('keeps a word at the last address, which the memory editor can change', () => {
    const a = address('ram', 11, 0x7ff)
    const s = start(build({ ram: ['ram', { dbits: 8, abits: 11 }], ...a.comps }, a.wires))
    expect(s.state('ram').mem).toHaveLength(2048)
    expect(s.writeWord('ram', 0x7ff, 0xa5)).toBe(true)
    expect(s.writeWord('ram', 2048, 1)).toBe(false)
    s.settle()
    expect(out(s, 'ram', 8)).toBe(0xa5)
  })

  it('is written on a clock edge and stepped back without sharing its words with the snapshot', () => {
    const a = address('ram', 11, 0x7ff)
    const s = start(
      build(
        { clk: ['clock', { hz: 4 }], n: ['counter', { mod: 16 }], one: ['const', { value: 1 }], ram: ['ram', { dbits: 4, abits: 11 }], ...a.comps },
        [
          ['clk.Q', 'n.CLK'],
          ['clk.Q', 'ram.CLK'],
          ['one.Q', 'ram.WE'],
          ['n.A', 'ram.D0'],
          ['n.B', 'ram.D1'],
          ['n.C', 'ram.D2'],
          ['n.D', 'ram.D3'],
          ...a.wires,
        ],
      ),
    )
    const mem = () => s.state('ram').mem as Uint8Array
    s.stepClock()
    s.stepClock()
    const before = mem()[0x7ff]
    const object = mem()
    s.stepClock()
    s.stepClock()
    const after = mem()[0x7ff]
    expect(after).not.toBe(before) // the counter moved on and the RAM took the new count
    expect(s.stepBack()).toBe(true)
    expect(mem()[0x7ff]).toBe(after) // back to the edge before: still the value written at it
    expect(s.stepBack()).toBe(true)
    expect(mem()[0x7ff]).toBe(before)
    expect(mem()).not.toBe(object)
  })

  it('cuts or pads its words when the address size is changed while it runs', () => {
    const small = build({ ram: ['ram', { dbits: 8, abits: 4 }] }, [])
    const s = start(small)
    s.writeWord('ram', 15, 7)
    s.load(build({ ram: ['ram', { dbits: 8, abits: 6 }] }, []))
    s.settle()
    const mem = s.state('ram').mem as Uint8Array
    expect(mem).toHaveLength(64)
    expect(mem[15]).toBe(7)
    expect(mem[63]).toBe(0)
  })
})

describe('ROM of 4096 words', () => {
  it('reads a word at the last address', () => {
    const a = address('rom', 12, 0xfff)
    const data = `${'00 '.repeat(4095)}7E`
    const s = start(build({ rom: ['rom', { dbits: 8, abits: 12, data }], ...a.comps }, a.wires))
    expect(toNum(Array.from({ length: 8 }, (_, i) => s.pinValue('rom', `D${i}`)), 0, 8)).toBe(0x7e)
  })
})
