import { describe, expect, it } from 'vitest'
import { groupsOf } from '../engine/bus'
import { groupTrace } from '../engine/groups'
import { parseWords } from '../engine/components/memory'
import type { NumberTrace, Trace } from '../engine/components/io'
import { DEFS, getDef } from '../engine/registry'
import { layoutOf } from '../engine/layoutcache'
import { Simulator } from '../engine/simulator'
import { paramDefaults, type Params } from '../engine/types'
import { viewLayoutOf } from '../engine/viewlayout'
import { buildRows } from '../app/waveform'
import { CircuitBuilder } from './builder'
import { flatten } from './buses'
import { compLayout, type Circuit } from './circuit'
import { realisticDelay } from './delays'
import { deserialize, serialize } from './serialize'
import { analyzeTiming } from './timing'

const run = (c: Circuit) => {
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  return sim
}
const setValue = (sim: Simulator, c: Circuit, id: string, value: string) => {
  sim.setParams(id, { ...c.comps[id].params, value })
  sim.settle()
}
const on = (sim: Simulator, c: Circuit, id: string, v: boolean) => {
  sim.setParams(id, { ...c.comps[id].params, on: v })
  sim.settle()
}
const num = (sim: Simulator, comp: string, prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => sim.pinValue(comp, `${prefix}${i}`)).reduce<number>((a, v, i) => (v === 1 ? a | (1 << i) : v > 1 ? NaN : a), 0)

/** Every way of setting one param of a part, the others at their defaults. */
function variants(type: string): Params[] {
  const def = getDef(type)
  const base = paramDefaults(def)
  const out: Params[] = [base]
  for (const p of def.params ?? []) {
    const values = p.kind === 'select' ? (p.options ?? []).map((o) => o.value) : p.kind === 'number' ? [p.min!, p.max!] : p.kind === 'bool' ? [true, false] : []
    for (const v of values) out.push({ ...base, [p.key]: v })
  }
  return out
}

describe('bus mode of every part', () => {
  it('group names never clash with a scalar pin, members exist, and view pins are unique, on the grid and apart', () => {
    for (const def of DEFS)
      for (const params of variants(def.type)) {
        const where = `${def.type} ${JSON.stringify(params)}`
        const scalar = layoutOf(def.type, params).pins.map((p) => p.name)
        for (const g of groupsOf(def, params)) {
          expect(scalar, `${where}: group ${g.name}`).not.toContain(g.name)
          expect(g.pins.length, `${where}: ${g.name} is a bus`).toBeGreaterThan(1)
          for (const m of g.pins) expect(scalar, `${where}: ${g.name} member ${m}`).toContain(m)
        }
        const view = viewLayoutOf(def.type, params)
        const at = view.pins.map((p) => `${p.x},${p.y}`)
        expect(new Set(at).size, `${where}: pins on top of each other`).toBe(at.length)
        expect(new Set(view.pins.map((p) => p.name)).size, `${where}: names`).toBe(view.pins.length)
        for (const p of view.pins) {
          expect(Math.abs(p.x % 10), `${where} ${p.name} x`).toBe(0)
          expect(Math.abs(p.y % 10), `${where} ${p.name} y`).toBe(0)
          expect(p.name, where).not.toMatch(/[.:]/)
        }
      }
  })

  it('a part in bus mode is never taller, and never has more pins, than the same part wired bit by bit', () => {
    for (const def of DEFS) {
      if (!def.params?.some((p) => p.key === 'bus')) continue
      const on = paramDefaults(def)
      const off = { ...on, bus: false }
      const a = viewLayoutOf(def.type, on)
      const b = viewLayoutOf(def.type, off)
      expect(a.h, def.type).toBeLessThanOrEqual(b.h)
      expect(a.pins.length, def.type).toBeLessThanOrEqual(b.pins.length)
    }
  })

  it('every part still has the same scalar pins whatever the mode (the simulator never sees groups)', () => {
    for (const def of DEFS) {
      if (!def.params?.some((p) => p.key === 'bus')) continue
      const on = layoutOf(def.type, paramDefaults(def)).pins.map((p) => p.name)
      const off = layoutOf(def.type, { ...paramDefaults(def), bus: false }).pins.map((p) => p.name)
      expect(on, def.type).toEqual(off)
    }
  })

  it('the parts that have a bus mode are the ones the plan lists', () => {
    const withMode = DEFS.filter((d) => d.params?.some((p) => p.key === 'bus')).map((d) => d.type)
    expect(withMode.sort()).toEqual(
      ['add4', 'addsub4', 'alu', 'bar', 'bcdadd', 'bin2bcd', 'breakpoint', 'cmp4', 'console', 'counterld', 'cpu6502', 'framebuffer', 'gamepad', 'hexdisp', 'hexin', 'keypad', 'mux', 'ram', 'register', 'rom', 'sub4'].sort(),
    )
  })

  it('a bus-mode part round-trips through a file, and an old file without the param stays scalar', () => {
    const b = new CircuitBuilder()
    const rom = b.add('rom', 0, 0, { params: { bus: true } })
    const old = b.add('ram', 300, 0)
    const c = b.build()
    const back = deserialize(JSON.parse(JSON.stringify(serialize(c))))
    expect(back.comps[rom].params.bus).toBe(true)
    expect(back.comps[old].params.bus).toBe(false)
    expect(compLayout(back.comps[old]).pins.length).toBeGreaterThan(compLayout(back.comps[rom]).pins.length)
  })
})

describe('bus mode behaves like bit mode', () => {
  it('a ROM read through buses gives the words it holds', () => {
    const b = new CircuitBuilder()
    const addr = b.add('busin', 0, 0, { params: { bits: 4 } })
    const rom = b.add('rom', 200, 0, { params: { bus: true, abits: 4, dbits: 8, data: '12 34 56 78 9A BC DE F0' } })
    const out = b.add('busdisp', 500, 0, { params: { bits: 8 } })
    b.wire(`${addr}.Q`, `${rom}.A`)
    b.wire(`${rom}.D`, `${out}.A`)
    const c = b.build()
    const sim = run(c)
    const words = parseWords('12 34 56 78 9A BC DE F0', 16, 8)
    for (let a = 0; a < 16; a++) {
      setValue(sim, c, addr, a.toString(16))
      expect(num(sim, rom, 'D', 8), `address ${a}`).toBe(words[a])
      expect(sim.inputValues(out).reduce<number>((n, v, i) => n | (v << i), 0)).toBe(words[a])
    }
  })

  it('a RAM written through buses reads back what was written, like the scalar one', () => {
    const make = (bus: boolean) => {
      const b = new CircuitBuilder()
      const data = b.add('busin', 0, 0, { params: { bits: 4 } })
      const addr = b.add('busin', 0, 120, { params: { bits: 4 } })
      const we = b.add('switch', 0, 240)
      const clk = b.add('switch', 0, 300)
      const ram = b.add('ram', 250, 0, { params: { bus, abits: 4, dbits: 4 } })
      if (bus) {
        b.wire(`${data}.Q`, `${ram}.D`)
        b.wire(`${addr}.Q`, `${ram}.A`)
      } else {
        const sd = b.add('splitter', 100, 0, { params: { bits: 4, split: '1,1,1,1' } })
        const sa = b.add('splitter', 100, 120, { params: { bits: 4, split: '1,1,1,1' } })
        b.wire(`${data}.Q`, `${sd}.A`)
        b.wire(`${addr}.Q`, `${sa}.A`)
        for (let i = 0; i < 4; i++) {
          b.wire(`${sd}.Y${i}`, `${ram}.D${i}`)
          b.wire(`${sa}.Y${i}`, `${ram}.A${i}`)
        }
      }
      b.wire(`${we}.Q`, `${ram}.WE`)
      b.wire(`${clk}.Q`, `${ram}.CLK`)
      return { c: b.build(), data, addr, we, clk, ram }
    }
    const results = [true, false].map((bus) => {
      const m = make(bus)
      const sim = run(m.c)
      on(sim, m.c, m.we, true)
      for (let a = 0; a < 16; a++) {
        setValue(sim, m.c, m.addr, a.toString(16))
        setValue(sim, m.c, m.data, ((a * 7 + 3) & 15).toString(16))
        on(sim, m.c, m.clk, true)
        on(sim, m.c, m.clk, false)
      }
      on(sim, m.c, m.we, false)
      return Array.from({ length: 16 }, (_, a) => {
        setValue(sim, m.c, m.addr, a.toString(16))
        return num(sim, m.ram, 'Q', 4)
      })
    })
    expect(results[0]).toEqual(Array.from({ length: 16 }, (_, a) => (a * 7 + 3) & 15))
    expect(results[1]).toEqual(results[0])
  })

  it('a console fed through a bus prints the character', () => {
    const b = new CircuitBuilder()
    const ch = b.add('busin', 0, 0, { params: { bits: 8, value: '48' } })
    const we = b.add('switch', 0, 120, { params: { on: true } })
    const clk = b.add('switch', 0, 180)
    const con = b.add('console', 300, 0, { params: { bus: true } })
    b.wire(`${ch}.Q`, `${con}.D`)
    b.wire(`${we}.Q`, `${con}.WE`)
    b.wire(`${clk}.Q`, `${con}.CLK`)
    const c = b.build()
    const sim = run(c)
    on(sim, c, clk, true)
    on(sim, c, clk, false)
    setValue(sim, c, ch, '69')
    on(sim, c, clk, true)
    expect((sim.state(con) as { lines: string[] }).lines.join('\n')).toBe('Hi')
  })
})

describe('a bus probe', () => {
  it('records the same numbers as a group of single-bit probes', () => {
    const b = new CircuitBuilder()
    const clk = b.add('clock', 0, 0, { params: { hz: 4 } })
    const cnt = b.add('busctr', 100, 0, { params: { bits: 4 } })
    const bus = b.add('probe', 400, 0, { params: { bits: 4 }, label: 'COUNT' })
    const split = b.add('splitter', 400, 120, { params: { bits: 4, split: '1,1,1,1' } })
    const single = [0, 1, 2, 3].map((i) => b.add('probe', 600, i * 40, { params: { group: 'G', bit: i } }))
    b.wire(`${clk}.Q`, `${cnt}.CLK`)
    b.wire(`${cnt}.Q`, `${bus}.A`)
    b.wire(`${cnt}.Q`, `${split}.A`)
    single.forEach((id, i) => b.wire(`${split}.Y${i}`, `${id}.A`))
    const c = b.build()
    const sim = run(c)
    for (let i = 0; i < 40; i++) {
      sim.advance(125)
      sim.settle()
    }
    const trace = sim.state(bus) as NumberTrace
    const grouped = groupTrace(single.map((id) => sim.state(id) as Trace), [0, 1, 2, 3])
    expect(trace.v.length).toBeGreaterThan(8)
    // The bus probe knows the value from the first look; the single ones agree from the moment they all have one.
    expect(trace.v.slice(-grouped.v.length)).toEqual(grouped.v)
    expect(trace.v.at(-1)).toBeGreaterThan(0)
  })

  it('is one row of the waveform panel, with its width', () => {
    const b = new CircuitBuilder()
    b.add('probe', 0, 0, { params: { bits: 8 }, label: 'DATA' })
    b.add('probe', 0, 40, { label: 'CLK' })
    const rows = buildRows(b.c.comps)
    expect(rows.map((r) => [r.name, r.width, !!r.bus])).toEqual([
      ['DATA', 8, true],
      ['CLK', 1, false],
    ])
  })
})

describe('delays and timing of the n-bit parts', () => {
  it('a bitwise gate is as slow as the single gate, and the arithmetic parts are slow like the 4-bit ones', () => {
    const b = new CircuitBuilder()
    const delay = (type: string, params: Params = {}) => realisticDelay(b.c.comps[b.add(type, 0, 0, { params })])
    expect(delay('busgate', { op: 'not' })).toBe(delay('not'))
    expect(delay('busgate', { op: 'xor' })).toBe(delay('xor'))
    expect(delay('busgate', { op: 'nand' })).toBe(delay('nand'))
    expect(delay('busadd')).toBe(delay('add4'))
    expect(delay('busaddsub')).toBe(delay('addsub4'))
    expect(delay('busmux')).toBe(delay('mux'))
    expect(delay('busreg')).toBeGreaterThan(0)
  })

  it('a register ends a path, and the adder in front of it is on the critical path', () => {
    const b = new CircuitBuilder()
    const input = b.add('busin', 0, 0, { params: { bits: 8 } })
    const add = b.add('busadd', 200, 0, { params: { bits: 8 } })
    const reg = b.add('busreg', 450, 0, { params: { bits: 8 } })
    const clk = b.add('clock', 0, 300)
    b.wire(`${input}.Q`, `${add}.A`)
    b.wire(`${reg}.Q`, `${add}.B`)
    b.wire(`${add}.S`, `${reg}.D`)
    b.wire(`${clk}.Q`, `${reg}.CLK`)
    const t = analyzeTiming(b.build())
    expect(t.loops).toEqual([])
    expect(t.critical!.end).toEqual({ comp: reg, pin: 'D' })
    expect(t.critical!.steps.map((s) => s.comp)).toContain(add)
  })
})
