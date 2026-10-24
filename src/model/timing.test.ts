import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from './builder'
import type { Circuit } from './circuit'
import { EXAMPLES } from './examples'
import { busModel } from './buses'
import { analyzeTiming } from './timing'

/** Give parts a delay. */
const delays = (c: Circuit, d: Record<string, number>) => {
  for (const [id, n] of Object.entries(d)) c.comps[id].delay = n
}
const names = (t: ReturnType<typeof analyzeTiming>) => t.critical!.steps.map((s) => s.comp)

describe('timing: the longest path', () => {
  it('a switch, three buffers and an LED: three gate delays', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const bufs = [b.add('buf', 100, 0), b.add('buf', 200, 0), b.add('buf', 300, 0)]
    const led = b.add('led', 400, 0)
    b.wire(`${sw}.Q`, `${bufs[0]}.A`)
    b.wire(`${bufs[0]}.Y`, `${bufs[1]}.A`)
    b.wire(`${bufs[1]}.Y`, `${bufs[2]}.A`)
    b.wire(`${bufs[2]}.Y`, `${led}.A`)
    const t = analyzeTiming(b.c)
    expect(t.critical!.delay).toBe(3)
    expect(names(t)).toEqual([sw, ...bufs, led])
    expect(t.critical!.steps.map((s) => s.arrival)).toEqual([0, 1, 2, 3, 3])
    expect(t.critical!.steps.map((s) => s.delay)).toEqual([0, 1, 1, 1, 0])
    expect(t.critical!.end).toEqual({ comp: led, pin: 'A' })
    expect(t.loops).toEqual([])
  })

  it('adds up the parts\' own delays', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const g = [b.add('buf', 100, 0), b.add('buf', 200, 0), b.add('buf', 300, 0)]
    const led = b.add('led', 400, 0)
    b.wire(`${sw}.Q`, `${g[0]}.A`)
    b.wire(`${g[0]}.Y`, `${g[1]}.A`)
    b.wire(`${g[1]}.Y`, `${g[2]}.A`)
    b.wire(`${g[2]}.Y`, `${led}.A`)
    delays(b.c, { [g[0]]: 3, [g[2]]: 5 })
    expect(analyzeTiming(b.c).critical!.delay).toBe(3 + 1 + 5)
  })

  it('takes the slower of two routes that meet (reconvergent fan-out)', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const not = b.add('not', 100, 0)
    const and = b.add('and', 250, 0)
    const led = b.add('led', 400, 0)
    b.wire(`${sw}.Q`, `${not}.A`)
    b.wire(`${sw}.Q`, `${and}.A`)
    b.wire(`${not}.Y`, `${and}.B`)
    b.wire(`${and}.Y`, `${led}.A`)
    const t = analyzeTiming(b.c)
    expect(t.critical!.delay).toBe(2)
    expect(names(t)).toEqual([sw, not, and, led]) // through the inverter, not the direct wire
  })

  it('a register-to-register path starts after the clock-to-output delay and ends at the next register\'s input', () => {
    const b = new CircuitBuilder()
    const clk = b.add('clock', 0, 0)
    const ff1 = b.add('dff', 100, 0)
    const x = b.add('xor', 300, 0)
    const a = b.add('and', 420, 0)
    const ff2 = b.add('dff', 560, 0)
    b.wire(`${clk}.Q`, `${ff1}.CLK`)
    b.wire(`${clk}.Q`, `${ff2}.CLK`)
    b.wire(`${ff1}.Q`, `${x}.A`)
    b.wire(`${ff1}.NQ`, `${x}.B`)
    b.wire(`${x}.Y`, `${a}.A`)
    b.wire(`${ff1}.Q`, `${a}.B`)
    b.wire(`${a}.Y`, `${ff2}.D`)
    delays(b.c, { [ff1]: 3, [x]: 4, [a]: 2 })
    const t = analyzeTiming(b.c)
    expect(t.critical!.delay).toBe(3 + 4 + 2) // clock to Q, then XOR, then AND
    expect(t.critical!.end).toEqual({ comp: ff2, pin: 'D' })
    expect(names(t)).toEqual([ff1, x, a, ff2])
  })

  it('a switch straight into a register arrives at time 0, so there is nothing to time', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const ff = b.add('dff', 100, 0)
    b.wire(`${sw}.Q`, `${ff}.D`)
    const t = analyzeTiming(b.c)
    expect(t.critical).toBeNull()
    expect(t.endpoints).toEqual([{ comp: ff, pin: 'D', arrival: 0 }])
  })

  it('an empty circuit, and one with unconnected parts, have no path', () => {
    expect(analyzeTiming(new CircuitBuilder().c)).toEqual({ critical: null, endpoints: [], loops: [] })
    const b = new CircuitBuilder()
    b.add('and', 0, 0)
    b.add('led', 100, 0)
    expect(analyzeTiming(b.c).critical).toBeNull()
  })

  it('a RAM passes its address straight to its output (a path through it), and its inputs are end points', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const ram = b.add('ram', 100, 0, { params: { dbits: 4 } })
    const led = b.add('led', 300, 0)
    const buf = b.add('buf', 200, 0)
    b.wire(`${sw}.Q`, `${ram}.A0`)
    b.wire(`${ram}.Q0`, `${buf}.A`)
    b.wire(`${buf}.Y`, `${led}.A`)
    const d = b.add('switch', 0, 100)
    b.wire(`${d}.Q`, `${ram}.D0`)
    delays(b.c, { [ram]: 6 })
    const t = analyzeTiming(b.c)
    expect(t.critical!.delay).toBe(6 + 1)
    expect(names(t)).toEqual([sw, ram, buf, led])
    // The data input is an end point that arrives at once, and does not feed the output.
    expect(t.endpoints.find((e) => e.comp === ram && e.pin === 'D0')?.arrival).toBe(0)
  })

  it('a ripple-carry adder is as slow as it is wide', () => {
    for (const n of [2, 3, 4, 6, 8]) {
      const b = new CircuitBuilder()
      const cin = b.add('switch', 0, 0)
      let carry = `${cin}.Q`
      for (let i = 0; i < n; i++) {
        const fa = b.add('fulladd', 100 + i * 150, 0)
        b.wire(`${b.add('switch', 100 + i * 150, -80)}.Q`, `${fa}.A`)
        b.wire(carry, `${fa}.Ci`)
        carry = `${fa}.Co`
      }
      b.wire(carry, `${b.add('led', 100 + n * 150, 0)}.A`)
      expect(analyzeTiming(b.c).critical!.delay, `${n} bits`).toBe(n)
    }
  })

  it('is carried across net labels, which add no delay', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const g = b.add('buf', 100, 0)
    const send = b.add('netsend', 200, 0, { params: { name: 'X' } })
    const recv = b.add('netrecv', 400, 200, { params: { name: 'X' } })
    const h = b.add('buf', 500, 200)
    const led = b.add('led', 600, 200)
    const w = [b.wire(`${sw}.Q`, `${g}.A`), b.wire(`${g}.Y`, `${send}.A`), b.wire(`${recv}.Y`, `${h}.A`), b.wire(`${h}.Y`, `${led}.A`)]
    const t = analyzeTiming(b.c)
    expect(t.critical!.delay).toBe(2)
    expect(names(t)).toEqual([sw, g, h, led]) // the labels are not steps
    expect(t.critical!.wires.sort()).toEqual([...w].sort()) // but the wires into and out of them are on the path
  })

  it('every wire of the path leads from one step to the next', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const x = b.add('xor', 100, 0)
    const a = b.add('and', 250, 0)
    const led = b.add('led', 400, 0)
    b.wire(`${sw}.Q`, `${x}.A`)
    b.wire(`${sw}.Q`, `${x}.B`)
    b.wire(`${x}.Y`, `${a}.A`)
    b.wire(`${sw}.Q`, `${a}.B`)
    b.wire(`${a}.Y`, `${led}.A`)
    const t = analyzeTiming(b.c)
    const comps = names(t)
    t.critical!.wires.forEach((id, i) => {
      expect([b.c.wires[id].from.comp, b.c.wires[id].to.comp]).toEqual([comps[i], comps[i + 1]])
    })
    expect(t.critical!.pins.has(`${x}:Y`)).toBe(true)
    expect(t.critical!.pins.has(`${a}:A`)).toBe(true)
  })

  it('lists the slowest end points first, one per pin', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const g = [b.add('buf', 100, 0), b.add('buf', 100, 100), b.add('buf', 100, 200)]
    const leds = g.map((_, i) => b.add('led', 300, i * 100))
    g.forEach((id, i) => {
      b.wire(`${sw}.Q`, `${id}.A`)
      b.wire(`${id}.Y`, `${leds[i]}.A`)
    })
    delays(b.c, { [g[0]]: 2, [g[1]]: 9, [g[2]]: 5 })
    const t = analyzeTiming(b.c)
    expect(t.endpoints.map((e) => [e.comp, e.arrival])).toEqual([[leds[1], 9], [leds[2], 5], [leds[0], 2]])
  })
})

describe('timing: feedback loops', () => {
  const srLatch = () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0)
    const r = b.add('switch', 0, 100)
    const n1 = b.add('nand', 100, 0)
    const n2 = b.add('nand', 100, 100)
    const after = b.add('buf', 300, 0)
    const led = b.add('led', 400, 0)
    b.wire(`${s}.Q`, `${n1}.A`)
    b.wire(`${r}.Q`, `${n2}.A`)
    b.wire(`${n1}.Y`, `${n2}.B`)
    b.wire(`${n2}.Y`, `${n1}.B`)
    b.wire(`${n1}.Y`, `${after}.A`)
    b.wire(`${after}.Y`, `${led}.A`)
    return { b, n1, n2, after, led }
  }

  it('finds the loop, lists its parts, and starts paths again after it', () => {
    const { b, n1, n2, after, led } = srLatch()
    const t = analyzeTiming(b.c)
    expect(t.loops).toHaveLength(1)
    expect([...t.loops[0]].sort()).toEqual([n1, n2].sort())
    expect(t.critical!.delay).toBe(1) // only the buffer after the latch
    expect(names(t)).toEqual([n1, after, led])
  })

  it('a gate that feeds itself is a loop, and a ring oscillator is one loop', () => {
    const b = new CircuitBuilder()
    const g = b.add('nand', 0, 0)
    b.wire(`${g}.Y`, `${g}.B`)
    expect(analyzeTiming(b.c).loops).toEqual([[g]])
    const r = new CircuitBuilder()
    const ring = [r.add('not', 0, 0), r.add('not', 100, 0), r.add('not', 200, 0)]
    ring.forEach((id, i) => r.wire(`${id}.Y`, `${ring[(i + 1) % 3]}.A`))
    const t = analyzeTiming(r.c)
    expect(t.loops).toHaveLength(1)
    expect([...t.loops[0]].sort()).toEqual([...ring].sort())
  })

  it('a loop through a flip-flop is not a loop: the register breaks it', () => {
    const b = new CircuitBuilder()
    const ff = b.add('dff', 0, 0)
    const n = b.add('not', 200, 0)
    b.wire(`${ff}.Q`, `${n}.A`)
    b.wire(`${n}.Y`, `${ff}.D`)
    const t = analyzeTiming(b.c)
    expect(t.loops).toEqual([])
    expect(t.critical!.delay).toBe(1 + 1) // clock to Q, then the inverter
  })
})

describe('timing: the examples', () => {
  for (const ex of EXAMPLES)
    it(`"${ex.name}" can be analysed`, () => {
      const c = ex.build()
      const t = analyzeTiming(c)
      if (t.critical) {
        expect(t.critical.delay).toBeGreaterThan(0)
        expect(t.critical.steps.length).toBeGreaterThanOrEqual(2)
        expect(t.critical.wires.length).toBeGreaterThanOrEqual(1)
        // With custom ICs, the path also runs along wires inside them (named `inst/wire`).
        const wires = busModel(c).circuit.wires
        for (const id of t.critical.wires) expect(wires[id], id).toBeDefined()
        expect(t.endpoints[0].arrival).toBe(t.critical.delay)
      }
      for (let i = 1; i < t.endpoints.length; i++) expect(t.endpoints[i].arrival).toBeLessThanOrEqual(t.endpoints[i - 1].arrival)
    }, 30000)

  it('the 8-bit computer\'s slowest path goes through the ROM, the RAM and the adder, and gets longer with realistic delays', () => {
    const c = EXAMPLES.find((e) => e.id === 'computer')!.build()
    const plain = analyzeTiming(c)
    expect(plain.critical!.delay).toBeGreaterThan(8)
    const types = plain.critical!.steps.map((s) => c.comps[s.comp].type)
    expect(types.some((t) => t === 'rom' || t === 'counterld')).toBe(true)
    for (const k of Object.values(c.comps)) if (k.type !== 'switch') k.delay = 3
    expect(analyzeTiming(c).critical!.delay).toBeGreaterThan(plain.critical!.delay)
  }, 30000)

  it('the ring oscillator is reported as a feedback loop', () => {
    const t = analyzeTiming(EXAMPLES.find((e) => e.id === 'oscillator')!.build())
    expect(t.loops.length).toBeGreaterThanOrEqual(1)
  })

  it('the SR latch example from NOR gates has a loop', () => {
    expect(analyzeTiming(EXAMPLES.find((e) => e.id === 'sr-latch')!.build()).loops).toHaveLength(1)
  })
})
