import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupsOf, pinWidth, splitOffsets, splitWidths } from '../engine/bus'
import { DEFS, getDef } from '../engine/registry'
import { Simulator, layoutOf } from '../engine/simulator'
import { legacyDefaults, paramDefaults, type V } from '../engine/types'
import { viewLayoutOf } from '../engine/viewlayout'
import { clearAll, connect, loadCircuit, setParam, useStore } from '../app/store'
import { CircuitBuilder } from './builder'
import { X_SOURCE, busModel, flatten, viewPinOf } from './buses'
import { simComps, type Circuit } from './circuit'
import { EXAMPLES } from './examples'
import { autoConnect, pruneWires } from './ops'
import { deserialize, serialize } from './serialize'
import { analyzeTiming } from './timing'
import { traceCone, traceNet } from './trace'

const run = (c: Circuit) => {
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  return sim
}
const wireId = (c: Circuit, from: string, to: string) =>
  Object.values(c.wires).find((w) => `${w.from.comp}.${w.from.pin}` === from && `${w.to.comp}.${w.to.pin}` === to)!.id
const nibble = (sim: Simulator, comp: string, pins: string[]) => pins.map((p) => sim.pinValue(comp, p))

describe('bus pins of the parts', () => {
  const modes = [true, false]
  it('no bus pin shares its name with a scalar pin of the same part, and no name has a delimiter', () => {
    for (const def of DEFS)
      for (const bus of modes) {
        const params = { ...paramDefaults(def), ...(def.params?.some((p) => p.key === 'bus') ? { bus } : {}) }
        const scalar = layoutOf(def.type, params).pins.map((p) => p.name)
        const view = viewLayoutOf(def.type, params).pins.map((p) => p.name)
        for (const g of def.groups?.(params) ?? []) {
          expect(scalar, `${def.type}: group ${g.name}`).not.toContain(g.name)
          for (const m of g.pins) expect(scalar, `${def.type}: ${g.name} member ${m}`).toContain(m)
        }
        for (const n of [...scalar, ...view]) expect(n, `${def.type}: ${n}`).not.toMatch(/[.:]/)
        expect(new Set(view).size, `${def.type} view pin names are unique`).toBe(view.length)
      }
  })

  it('a part in bus mode shows one pin per group, on the grid, with a shorter body', () => {
    const reg = paramDefaults(getDef('register'))
    expect(reg.bus).toBe(true)
    const scalar = layoutOf('register', reg)
    const view = viewLayoutOf('register', reg)
    expect(view.pins.map((p) => p.name).sort()).toEqual(['CLK', 'CLR', 'IN', 'LD', 'Q'])
    expect(pinWidth(view.pins.find((p) => p.name === 'IN')!)).toBe(4)
    expect(pinWidth(view.pins.find((p) => p.name === 'LD')!)).toBe(1)
    expect(view.h).toBeLessThan(scalar.h)
    for (const p of view.pins) {
      expect(Math.abs(p.x % 10)).toBe(0)
      expect(Math.abs(p.y % 10)).toBe(0)
    }
    // Pins on one side keep a 20px pitch and stay inside the body's span.
    const left = view.pins.filter((p) => p.side === 'l').map((p) => p.y).sort((a, b) => a - b)
    left.slice(1).forEach((y, i) => expect(y - left[i]).toBe(20))
    expect(Math.min(...left)).toBeGreaterThan(0)
    expect(Math.max(...left)).toBeLessThan(view.h)
  })

  it('with bus mode off, the layout is the scalar one', () => {
    const p = { ...paramDefaults(getDef('add4')), bus: false }
    expect(viewLayoutOf('add4', p)).toEqual(layoutOf('add4', p))
    expect(groupsOf(getDef('add4'), p)).toEqual([])
  })

  it('a placed part has bus mode on, a part from an old file or the example builders has it off', () => {
    expect(paramDefaults(getDef('register')).bus).toBe(true)
    expect(legacyDefaults(getDef('register')).bus).toBe(false)
    expect(new CircuitBuilder().c.comps).toEqual({})
    const b = new CircuitBuilder()
    const reg = b.add('register', 0, 0)
    expect(b.c.comps[reg].params.bus).toBe(false)
    const reg2 = b.add('register', 0, 100, { params: { bus: true } })
    expect(b.c.comps[reg2].params.bus).toBe(true)
  })

  it('splitter widths: pieces that add up are used, anything else is one bit each', () => {
    expect(splitWidths({ bits: 8, split: '4,4' })).toEqual([4, 4])
    expect(splitWidths({ bits: 8, split: '1,1,6' })).toEqual([1, 1, 6])
    expect(splitWidths({ bits: 4, split: '4,4' })).toEqual([1, 1, 1, 1])
    expect(splitWidths({ bits: 3, split: '' })).toEqual([1, 1, 1])
    expect(splitOffsets({ bits: 8, split: '1,1,6' })).toEqual([0, 1, 2])
  })
})

describe('flatten', () => {
  it('leaves a circuit without buses exactly as it was: same parts, same wires, same order', () => {
    for (const e of EXAMPLES) {
      if (e.id === 'buses' || e.id === 'databus' || e.id.startsWith('computer') || e.id === 'calculator') continue
      const c = e.build()
      const flat = flatten(c)
      expect(flat.comps, e.id).toEqual(simComps(c))
      expect(flat.wires, e.id).toEqual(Object.values(c.wires).map(({ from, to }) => ({ from, to })))
    }
  }, 60000)

  it('a bus wire becomes one wire per bit, between the scalar pins of the parts', () => {
    const b = new CircuitBuilder()
    const reg = b.add('register', 0, 0, { params: { bus: true } })
    const add = b.add('add4', 200, 0, { params: { bus: true } })
    b.wire(`${reg}.Q`, `${add}.A`)
    const flat = flatten(b.build())
    expect(flat.wires).toEqual(
      ['A', 'B', 'C', 'D'].map((q, i) => ({ from: { comp: reg, pin: `Q${q}` }, to: { comp: add, pin: `A${i}` } })),
    )
  })

  it('removes splitters, mergers and bus labels from what is simulated', () => {
    const b = new CircuitBuilder()
    b.add('merger', 0, 0, { params: { bits: 4, split: '1,1,1,1' } })
    b.add('splitter', 100, 0, { params: { bits: 4, split: '2,2' } })
    b.add('netsend', 200, 0, { params: { name: 'B', bits: 4 } })
    b.add('netrecv', 300, 0, { params: { name: 'B', bits: 4 } })
    b.add('netsend', 400, 0, { params: { name: 'S' } })
    expect(flatten(b.build()).comps.map((k) => k.type)).toEqual(['netsend'])
  })

  it('the bus accumulator behaves like the same circuit wired bit by bit, edge for edge', () => {
    const build = (bus: boolean) => {
      const b = new CircuitBuilder()
      const clk = b.add('clock', 0, 0, { params: { hz: 2 } })
      const input = b.add('hexin', 0, 90, { params: { value: 3 } })
      const add = b.add('add4', 300, 90, { params: { bus } })
      const reg = b.add('register', 500, 90, { params: { bus } })
      b.wire(`${clk}.Q`, `${reg}.CLK`)
      if (bus) {
        const merge = b.add('merger', 120, 90, { params: { bits: 4, split: '1,1,1,1' } })
        ;['A', 'B', 'C', 'D'].forEach((p, i) => b.wire(`${input}.${p}`, `${merge}.A${i}`))
        b.wire(`${merge}.Y`, `${add}.A`)
        b.wire(`${reg}.Q`, `${add}.B`)
        b.wire(`${add}.S`, `${reg}.IN`)
      } else {
        ;['A', 'B', 'C', 'D'].forEach((p, i) => {
          b.wire(`${input}.${p}`, `${add}.A${i}`)
          b.wire(`${reg}.Q${p}`, `${add}.B${i}`)
          b.wire(`${add}.S${i}`, `${reg}.${p}`)
        })
      }
      return { c: b.build(), reg }
    }
    const a = build(true)
    const s = build(false)
    const simA = run(a.c)
    const simS = run(s.c)
    const q = ['QA', 'QB', 'QC', 'QD']
    const seen: number[] = []
    for (let i = 0; i < 12; i++) {
      simA.advance(250)
      simA.settle()
      simS.advance(250)
      simS.settle()
      expect(nibble(simA, a.reg, q), `step ${i}`).toEqual(nibble(simS, s.reg, q))
      seen.push(nibble(simA, a.reg, q).reduce<number>((n, v, k) => n | (v === 1 ? 1 << k : 0), 0))
    }
    expect(seen).toContain(9) // it really counts: 0 0 3 3 6 6 9 9 12 12 15 15 (mod 16)
    expect(simA.ticks).toBe(simS.ticks)
  })

  it('splitters and mergers add no delay', () => {
    const direct = new CircuitBuilder()
    const via = new CircuitBuilder()
    const make = (b: CircuitBuilder, split: boolean) => {
      const sw = ['a', 'b', 'c', 'd'].map((n, i) => b.add('switch', 0, i * 40, { label: n }))
      const nots = sw.map((_, i) => b.add('not', 300, i * 40))
      const leds = sw.map((_, i) => b.add('led', 400, i * 40))
      if (split) {
        const m = b.add('merger', 100, 0, { params: { bits: 4, split: '1,1,1,1' } })
        const s = b.add('splitter', 200, 0, { params: { bits: 4, split: '2,2' } })
        const m2 = b.add('merger', 200, 200, { params: { bits: 4, split: '2,2' } })
        const s2 = b.add('splitter', 300, 200, { params: { bits: 4, split: '1,1,1,1' } })
        sw.forEach((id, i) => b.wire(`${id}.Q`, `${m}.A${i}`))
        b.wire(`${m}.Y`, `${s}.A`)
        b.wire(`${s}.Y0`, `${m2}.A0`)
        b.wire(`${s}.Y1`, `${m2}.A1`)
        b.wire(`${m2}.Y`, `${s2}.A`)
        nots.forEach((id, i) => b.wire(`${s2}.Y${i}`, `${id}.A`))
      } else sw.forEach((id, i) => b.wire(`${id}.Q`, `${nots[i]}.A`))
      nots.forEach((id, i) => b.wire(`${id}.Y`, `${leds[i]}.A`))
      return { sw, leds }
    }
    const d = make(direct, false)
    const v = make(via, true)
    const cd = direct.build()
    const cv = via.build()
    const simD = run(cd)
    const simV = run(cv)
    expect(simV.ticks).toBe(simD.ticks)
    const flip = (sim: Simulator, c: Circuit, id: string) => sim.setParams(id, { ...c.comps[id].params, on: true })
    flip(simD, cd, d.sw[2])
    flip(simV, cv, v.sw[2])
    simD.settle()
    simV.settle()
    expect(simV.ticks).toBe(simD.ticks)
    expect(v.leds.map((id) => simV.pinValue(id, 'A'))).toEqual(d.leds.map((id) => simD.pinValue(id, 'A')))
    expect(simV.pinValue(v.leds[2], 'A')).toBe(0)
    expect(simV.pinValue(v.leds[0], 'A')).toBe(1)
  })

  it('a merger of splitter pieces gives back the bits it was made of, at every width', () => {
    for (let n = 2; n <= 16; n++) {
      const cut = Array.from({ length: n }, (_, i) => (i % 3 === 2 ? 2 : 1))
      let total = cut.reduce((a, b) => a + b, 0)
      while (total > n) total -= cut.pop()!
      while (total < n) {
        cut.push(1)
        total++
      }
      const split = cut.join(',')
      const b = new CircuitBuilder()
      const sw = Array.from({ length: n }, (_, i) => b.add('switch', 0, i * 30))
      const m1 = b.add('merger', 100, 0, { params: { bits: n, split: '1,'.repeat(n - 1) + '1' } })
      const s = b.add('splitter', 200, 0, { params: { bits: n, split } })
      const m2 = b.add('merger', 300, 0, { params: { bits: n, split } })
      const out = b.add('netsend', 500, 0, { params: { name: 'OUT', bits: n } })
      sw.forEach((id, i) => b.wire(`${id}.Q`, `${m1}.A${i}`))
      b.wire(`${m1}.Y`, `${s}.A`)
      cut.forEach((_, i) => b.wire(`${s}.Y${i}`, `${m2}.A${i}`))
      b.wire(`${m2}.Y`, `${out}.A`)
      const c = b.build()
      const bits = busModel(c).bits.get(wireId(c, `${m2}.Y`, `${out}.A`))!
      expect(bits, `width ${n}`).toEqual(sw.map((id) => ({ comp: id, pin: 'Q' })))
    }
  })
})

describe('bus labels', () => {
  /** Four switches into a merger into a Send label; Receive labels at the other end feed a splitter into LEDs. */
  const rig = (extra?: (b: CircuitBuilder) => void) => {
    const b = new CircuitBuilder()
    const sw = [0, 1, 2, 3].map((i) => b.add('switch', 0, i * 40))
    const m = b.add('merger', 100, 0, { params: { bits: 4, split: '1,1,1,1' } })
    const tx = b.add('netsend', 250, 0, { params: { name: 'DATA', bits: 4 } })
    const rx = b.add('netrecv', 400, 0, { params: { name: 'DATA', bits: 4 } })
    const s = b.add('splitter', 550, 0, { params: { bits: 4, split: '1,1,1,1' } })
    const leds = [0, 1, 2, 3].map((i) => b.add('led', 700, i * 40))
    sw.forEach((id, i) => b.wire(`${id}.Q`, `${m}.A${i}`))
    b.wire(`${m}.Y`, `${tx}.A`)
    b.wire(`${rx}.Y`, `${s}.A`)
    leds.forEach((id, i) => b.wire(`${s}.Y${i}`, `${id}.A`))
    extra?.(b)
    const c = b.build()
    return { c, sw, leds, rx, tx }
  }

  it('carry a bus by name, with no delay and no wire between', () => {
    const { c, sw, leds } = rig()
    const sim = run(c)
    const values = () => leds.map((id) => sim.pinValue(id, 'A'))
    expect(values()).toEqual([0, 0, 0, 0])
    sim.setParams(sw[1], { ...c.comps[sw[1]].params, on: true })
    sim.setParams(sw[3], { ...c.comps[sw[3]].params, on: true })
    sim.settle()
    expect(values()).toEqual([0, 1, 0, 1])
  })

  it('read X when nothing publishes the name, or the widths differ', () => {
    const { c, leds } = rig((b) => {
      Object.values(b.c.comps).find((k) => k.type === 'netrecv')!.params.name = 'OTHER'
    })
    expect(leds.map((id) => run(c).pinValue(id, 'A'))).toEqual([2, 2, 2, 2] as V[])
    const { c: c2, leds: leds2 } = rig((b) => {
      Object.values(b.c.comps).find((k) => k.type === 'netrecv')!.params.bits = 3
    })
    expect(leds2.map((id) => run(c2).pinValue(id, 'A'))).toEqual([2, 2, 2, 2] as V[])
  })

  it('of several Send labels with a name, the first one that is driven publishes it', () => {
    const b = new CircuitBuilder()
    b.add('netsend', 0, 0, { params: { name: 'D', bits: 2 } }) // nothing drives it
    const sw = [b.add('switch', 0, 100, { params: { on: true } }), b.add('switch', 0, 140)]
    const m = b.add('merger', 100, 100, { params: { bits: 2, split: '1,1' } })
    const second = b.add('netsend', 250, 100, { params: { name: 'D', bits: 2 } })
    b.add('netsend', 250, 200, { params: { name: 'D', bits: 2 } }) // a later one, also driven by nothing
    const rx = b.add('netrecv', 400, 100, { params: { name: 'D', bits: 2 } })
    const s = b.add('splitter', 550, 100, { params: { bits: 2, split: '1,1' } })
    const leds = [b.add('led', 700, 100), b.add('led', 700, 140)]
    sw.forEach((id, i) => b.wire(`${id}.Q`, `${m}.A${i}`))
    b.wire(`${m}.Y`, `${second}.A`)
    b.wire(`${rx}.Y`, `${s}.A`)
    leds.forEach((id, i) => b.wire(`${s}.Y${i}`, `${id}.A`))
    expect(leds.map((id) => run(b.build()).pinValue(id, 'A'))).toEqual([1, 0])
  })

  it('a loop of labels resolves to X, not to a hang', () => {
    const b = new CircuitBuilder()
    const tx = b.add('netsend', 0, 0, { params: { name: 'LOOP', bits: 2 } })
    const rx = b.add('netrecv', 200, 0, { params: { name: 'LOOP', bits: 2 } })
    const led = b.add('led', 400, 0)
    const s = b.add('splitter', 300, 0, { params: { bits: 2, split: '1,1' } })
    b.wire(`${rx}.Y`, `${tx}.A`)
    b.wire(`${rx}.Y`, `${s}.A`)
    b.wire(`${s}.Y0`, `${led}.A`)
    const c = b.build()
    const flat = flatten(c)
    expect(flat.wires.some((w) => w.from.comp === X_SOURCE.comp)).toBe(true)
    expect(run(c).pinValue(led, 'A')).toBe(2)
  })
})

describe('widths of wires', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis)
    clearAll()
  })
  afterEach(() => vi.unstubAllGlobals())

  const place = () => {
    const b = new CircuitBuilder()
    const reg = b.add('register', 0, 0, { params: { bus: true } })
    const add = b.add('add4', 300, 0, { params: { bus: true } })
    const sw = b.add('switch', 0, 200)
    const m = b.add('merger', 300, 200, { params: { bits: 8, split: '4,4' } })
    loadCircuit(b.c, false)
    return { reg, add, sw, m }
  }

  it('connect joins pins of the same width and refuses the others, saying what to use', () => {
    const { reg, add, sw, m } = place()
    expect(connect({ comp: reg, pin: 'Q' }, { comp: add, pin: 'A' })).toBe(true)
    expect(connect({ comp: sw, pin: 'Q' }, { comp: add, pin: 'B' })).toBe(false)
    expect(connect({ comp: reg, pin: 'Q' }, { comp: m, pin: 'A0' })).toBe(true)
    expect(connect({ comp: m, pin: 'Y' }, { comp: add, pin: 'B' })).toBe(false)
    expect(useStore.getState().toast).toMatch(/8-bit bus/)
    expect(useStore.getState().toast).toMatch(/splitter/)
    expect(Object.keys(useStore.getState().circuit.wires)).toHaveLength(2)
  })

  it('pruneWires and deserialize drop a wire whose two ends differ in width', () => {
    const b = new CircuitBuilder()
    const reg = b.add('register', 0, 0, { params: { bus: true } })
    const add = b.add('add4', 300, 0, { params: { bus: true } })
    b.wire(`${reg}.Q`, `${add}.A`)
    const c = b.build()
    const saved = serialize(c)
    saved.wires.push({ id: 'bad', from: `${reg}.Q`, to: `${add}.Ci` })
    expect(Object.keys(deserialize(saved).wires)).toEqual([wireId(c, `${reg}.Q`, `${add}.A`)])
    c.wires.bad = { id: 'bad', from: { comp: reg, pin: 'Q' }, to: { comp: add, pin: 'B' }, path: [] }
    c.wires.worse = { id: 'worse', from: { comp: reg, pin: 'Q' }, to: { comp: add, pin: 'Ci' }, path: [] }
    pruneWires(c)
    expect(Object.keys(c.wires).sort()).toEqual(['bad', wireId(c, `${reg}.Q`, `${add}.A`)].sort())
  })

  it('autoConnect leaves touching pins of different widths alone', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const reg = b.add('register', 0, 0, { params: { bus: true } })
    b.c.comps[reg].x = b.c.comps[sw].x + 50 + 10
    // Put the register's IN pin where the switch's Q pin is.
    const q = viewLayoutOf('switch', {}).pins[0]
    const pin = viewLayoutOf('register', b.c.comps[reg].params).pins.find((p) => p.name === 'IN')!
    b.c.comps[reg].x = b.c.comps[sw].x + q.x - pin.x
    b.c.comps[reg].y = b.c.comps[sw].y + q.y - pin.y
    expect(autoConnect(b.c, [reg])).toBe(false)
    const sw2 = b.add('switch', 0, 300)
    const ld = viewLayoutOf('register', b.c.comps[reg].params).pins.find((p) => p.name === 'LD')!
    b.c.comps[sw2].x = b.c.comps[reg].x + ld.x - q.x
    b.c.comps[sw2].y = b.c.comps[reg].y + ld.y - q.y
    expect(autoConnect(b.c, [reg])).toBe(true)
  })

  it('switching bus mode off drops only the wires of the pins that go away', () => {
    const b = new CircuitBuilder()
    const clk = b.add('clock', 0, 0)
    const reg = b.add('register', 200, 0, { params: { bus: true } })
    const add = b.add('add4', 400, 0, { params: { bus: true } })
    b.wire(`${clk}.Q`, `${reg}.CLK`)
    b.wire(`${reg}.Q`, `${add}.A`)
    loadCircuit(b.build(), false)
    setParam(reg, 'bus', false)
    const wires = Object.values(useStore.getState().circuit.wires)
    expect(wires.map((w) => `${w.from.comp}.${w.from.pin}>${w.to.comp}.${w.to.pin}`)).toEqual([`${clk}.Q>${reg}.CLK`])
  })
})

describe('files', () => {
  it('a saved part without the bus param loads with scalar pins and simulates as before', () => {
    const b = new CircuitBuilder()
    const input = b.add('hexin', 0, 0, { params: { value: 5 } })
    const one = b.add('hexin', 0, 200, { params: { value: 1 } })
    const add = b.add('add4', 200, 0)
    ;['A', 'B', 'C', 'D'].forEach((p, i) => {
      b.wire(`${input}.${p}`, `${add}.A${i}`)
      b.wire(`${one}.${p}`, `${add}.B${i}`)
    })
    const saved = JSON.parse(JSON.stringify(serialize(b.build())))
    // What an old file looks like: no `bus` among the params.
    for (const k of saved.comps) delete k.params.bus
    const c = deserialize(saved)
    expect(c.comps[add].params.bus).toBe(false)
    expect(Object.keys(c.wires)).toHaveLength(8)
    const sim = run(c)
    expect(nibble(sim, add, ['S0', 'S1', 'S2', 'S3'])).toEqual([0, 1, 1, 0])
  })

  it('a circuit with buses survives a save and load', () => {
    const c = EXAMPLES.find((e) => e.id === 'buses')!.build()
    const back = deserialize(JSON.parse(JSON.stringify(serialize(c))))
    expect(Object.keys(back.wires).sort()).toEqual(Object.keys(c.wires).sort())
    expect(back.comps).toEqual(c.comps)
  })
})

describe('the buses example', () => {
  const c = EXAMPLES.find((e) => e.id === 'buses')!.build()
  const reg = Object.values(c.comps).find((k) => k.type === 'register')!.id
  const input = Object.values(c.comps).find((k) => k.type === 'hexin')!.id

  it('keeps a running total on the bus: the input is added at every clock edge', () => {
    const sim = run(c)
    const total = () => nibble(sim, reg, ['QA', 'QB', 'QC', 'QD']).reduce<number>((n, v, k) => n | (v === 1 ? 1 << k : 0), 0)
    const totals: number[] = []
    for (let i = 0; i < 8; i++) {
      sim.advance(500)
      sim.settle()
      totals.push(total())
    }
    // The clock's rising edges come every second tick of 500 ms; the first value is X-free after the first edge.
    expect(totals.at(-1)).toBe((3 * 4) & 15)
    sim.setParams(input, { ...c.comps[input].params, value: 1 })
    sim.settle()
    sim.advance(1000)
    sim.settle()
    expect(total()).toBe(13)
  })

  it('every wire has a known width; the thick ones are 4 bits wide', () => {
    const { bits } = busModel(c)
    expect(bits.size).toBe(Object.keys(c.wires).length)
    const widths = [...bits.values()].map((b) => b.length)
    expect(widths.filter((n) => n === 4).length).toBeGreaterThanOrEqual(3)
    expect(widths.every((n) => n === 1 || n === 4)).toBe(true)
  })

  it('traces a signal through splitters, mergers and labels', () => {
    const merge = Object.values(c.comps).find((k) => k.type === 'merger')!.id
    const add = Object.values(c.comps).find((k) => k.type === 'add4')!.id
    const w = wireId(c, `${merge}.Y`, `${add}.A`)
    const t = traceNet(c, w)
    // The wire out of the merger carries the four input bits: so does each wire from the input into the merger.
    expect(t.wires.has(w)).toBe(true)
    expect(t.wires.size).toBe(1 + 4)
    expect(t.source).toEqual({ comp: input, pin: 'A' })
    // What feeds the register's total: the adder, and through it the input and the total from the labels.
    const cone = traceCone(c, wireId(c, `${add}.S`, `${reg}.IN`))
    expect(cone.has(w)).toBe(true)
  })

  it('a wire from a splitter piece traces back to the register bit that drives it', () => {
    const split = Object.values(c.comps).find((k) => k.type === 'splitter')!.id
    const disp = Object.values(c.comps).find((k) => k.type === 'hexdisp')!.id
    const w = wireId(c, `${split}.Y2`, `${disp}.C`)
    const t = traceNet(c, w)
    expect(t.source).toEqual(viewPinOf(c, { comp: reg, pin: 'QC' }))
    expect(t.source).toEqual({ comp: reg, pin: 'Q' })
    expect(busModel(c).bits.get(w)).toEqual([{ comp: reg, pin: 'QC' }])
  })

  it('timing follows the path through the merger and the adder', () => {
    const t = analyzeTiming(c)
    expect(t.critical).not.toBeNull()
    const adder = Object.values(c.comps).find((k) => k.type === 'add4')!.id
    expect(t.critical!.steps.map((s) => s.comp)).toContain(adder)
  })
})
