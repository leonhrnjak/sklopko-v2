import { describe, expect, it } from 'vitest'
import type { Trace } from './components/io'
import { getDef } from './registry'
import { HISTORY_EDGES, Simulator, type SimCircuit } from './simulator'
import { paramDefaults, type Params } from './types'

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

/**
 * A clock counting up, a RAM that stores the count at address 0 on every rising edge, and a probe on the lowest bit:
 * state in the nets, in a part (the counter), in a memory, and in a recording.
 */
const machine = (hz = 4) =>
  build(
    {
      clk: ['clock', { hz }],
      n: ['counter', { mod: 16 }],
      mem: ['ram', { dbits: 4 }],
      one: ['const', { value: 1 }],
      zero: ['const', { value: 0 }],
      p: 'probe',
    },
    [
      ['clk.Q', 'n.CLK'],
      ['clk.Q', 'mem.CLK'],
      ['one.Q', 'mem.WE'],
      ['n.A', 'mem.D0'],
      ['n.B', 'mem.D1'],
      ['n.C', 'mem.D2'],
      ['n.D', 'mem.D3'],
      ['zero.Q', 'mem.A0'],
      ['zero.Q', 'mem.A1'],
      ['zero.Q', 'mem.A2'],
      ['zero.Q', 'mem.A3'],
      ['n.A', 'p.A'],
    ],
  )

const start = (c: SimCircuit) => {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}

/** What can be seen of the simulation: time, every pin of the counter, the memory, and the probe's recording. (Not the tick counter: it is only a statistic, and `stepClock` settles once more after the edge.) */
const look = (s: Simulator) => ({
  time: Math.round(s.time * 1000) / 1000, // stepClock nudges time 1e-6 ms past the edge; that doesn't matter
  count: ['A', 'B', 'C', 'D'].map((p) => s.pinValue('n', p)),
  clk: s.pinValue('clk', 'Q'),
  signature: s.signature('n') + s.signature('mem'),
  mem: [...(s.state('mem').mem as number[])],
  trace: structuredClone(s.state('p') as Trace),
})

describe('stepping back', () => {
  it('returns to exactly the state after each earlier clock edge: nets, parts, memory, time and recordings', () => {
    const s = start(machine())
    const seen = [look(s)]
    for (let i = 0; i < 12; i++) {
      s.stepClock()
      seen.push(look(s))
    }
    expect(seen[12].count).not.toEqual(seen[0].count)
    for (let i = 11; i >= 0; i--) {
      expect(s.canStepBack(), `back to ${i}`).toBe(true)
      expect(s.stepBack()).toBe(true)
      expect(look(s), `after going back to edge ${i}`).toEqual(seen[i])
    }
  })

  it('can go back exactly as far as the start, and no further', () => {
    const s = start(machine())
    expect(s.canStepBack()).toBe(false)
    expect(s.stepBack()).toBe(false)
    for (let i = 0; i < 5; i++) s.stepClock()
    let backs = 0
    while (s.stepBack()) backs++
    expect(backs).toBe(5)
    expect(s.canStepBack()).toBe(false)
    expect(look(s).count).toEqual([0, 0, 0, 0])
    expect(s.time).toBe(0)
  })

  it('stepping forward again repeats the same history', () => {
    const s = start(machine())
    const seen = [look(s)]
    for (let i = 0; i < 8; i++) {
      s.stepClock()
      seen.push(look(s))
    }
    for (let i = 0; i < 5; i++) s.stepBack()
    for (let i = 4; i <= 8; i++) {
      if (i > 3) {
        s.stepClock()
        expect(look(s), `forward to ${i}`).toEqual(seen[Math.min(i, 8)])
      }
    }
    // Going back after going forward again still reaches every earlier edge.
    let backs = 0
    while (s.stepBack()) backs++
    expect(backs).toBe(8)
  })

  it('after going back, a new run replaces the future: the history stays a single line', () => {
    const s = start(machine())
    for (let i = 0; i < 6; i++) s.stepClock()
    s.stepBack()
    s.stepBack()
    s.stepClock()
    let backs = 0
    while (s.stepBack()) backs++
    expect(backs).toBe(5) // 6 forward, 2 back, 1 forward = 5 edges from the start
  })

  it('time that passed since the last edge is undone first, then the edge before', () => {
    const s = start(machine())
    s.stepClock()
    s.stepClock()
    const atEdge = look(s)
    s.advance(40) // less than half a clock period: no edge, but time moves
    expect(s.time).toBeGreaterThan(atEdge.time + 1)
    expect(s.stepBack()).toBe(true)
    expect(look(s)).toEqual(atEdge) // back to the edge we were after
    expect(s.stepBack()).toBe(true) // and now the one before
    expect(s.time).toBeLessThan(atEdge.time - 1)
  })

  it('a memory edit made since the last edge is undone first', () => {
    const s = start(machine())
    s.stepClock()
    s.stepClock()
    const atEdge = look(s)
    s.writeWord('mem', 7, 9)
    expect(s.stepBack()).toBe(true)
    expect(look(s)).toEqual(atEdge)
    expect(s.state('mem').mem[7]).toBe(0)
  })

  it('does not step over an edge that never happened: settling alone leaves the history alone', () => {
    const s = start(machine())
    s.stepClock()
    s.stepClock()
    s.settle()
    s.settle()
    expect(s.stepBack()).toBe(true)
    expect(s.time).toBeLessThan(look(s).time + 1)
    let backs = 1
    while (s.stepBack()) backs++
    expect(backs).toBe(2)
  })

  it('forgets everything on reset and on load', () => {
    const s = start(machine())
    for (let i = 0; i < 4; i++) s.stepClock()
    expect(s.canStepBack()).toBe(true)
    s.reset()
    s.settle()
    expect(s.canStepBack()).toBe(false)
    for (let i = 0; i < 4; i++) s.stepClock()
    s.load(machine())
    expect(s.canStepBack()).toBe(false)
  })

  it('keeps the last HISTORY_EDGES edges', () => {
    const s = start(machine(256))
    for (let i = 0; i < HISTORY_EDGES + 200; i++) s.stepClock()
    let backs = 0
    while (s.stepBack()) backs++
    expect(backs).toBe(HISTORY_EDGES - 1)
  })

  it('works on a circuit without clocks: there is nothing to go back to', () => {
    const s = start(build({ sw: 'switch', led: 'led' }, [['sw.Q', 'led.A']]))
    s.setParams('sw', { on: true })
    s.settle()
    expect(s.canStepBack()).toBe(false)
    expect(s.stepBack()).toBe(false)
  })

  it('after stepping back a flipped switch still counts: the circuit settles with the switches as they are now', () => {
    const c = build(
      { clk: ['clock', { hz: 4 }], n: ['counter', { mod: 16 }], sw: 'switch', led: 'led' },
      [['clk.Q', 'n.CLK'], ['sw.Q', 'led.A']],
    )
    const s = start(c)
    s.stepClock()
    s.stepClock()
    s.stepClock()
    s.setParams('sw', { on: true })
    s.settle()
    expect(s.pinValue('led', 'A')).toBe(1)
    expect(s.stepBack()).toBe(true) // the flip changed the nets, so this is back to the edge we were after
    expect(s.pinValue('led', 'A')).toBe(1)
    expect(s.stepBack()).toBe(true) // and this one goes one edge further: not stuck
    expect(s.pinValue('led', 'A')).toBe(1)
    expect(s.time).toBeLessThan(375)
  })

  describe('with the history off', () => {
    it('takes no snapshots: there is nothing to step back to, running or stepping', () => {
      const s = new Simulator()
      s.setHistory(false)
      s.load(machine(256))
      s.settle()
      for (let i = 0; i < 6; i++) s.stepClock()
      s.frame(100)
      expect(s.canStepBack()).toBe(false)
      expect(s.stepBack()).toBe(false)
      expect(s.time).toBeGreaterThan(0)
    })

    it('runs to the same state as with the history on', () => {
      const run = (history: boolean) => {
        const s = new Simulator()
        s.setHistory(history)
        s.load(machine(256))
        s.settle()
        for (let i = 0; i < 40; i++) s.stepClock()
        s.advance(200)
        return look(s)
      }
      expect(run(false)).toEqual(run(true))
    })

    it('forgets the history when it is switched off, and begins a new one when it is switched on', () => {
      const s = start(machine())
      for (let i = 0; i < 4; i++) s.stepClock()
      expect(s.canStepBack()).toBe(true)
      s.setHistory(false)
      expect(s.historyOn).toBe(false)
      expect(s.canStepBack()).toBe(false)
      for (let i = 0; i < 4; i++) s.stepClock()
      expect(s.canStepBack()).toBe(false)
      s.setHistory(true)
      expect(s.canStepBack()).toBe(false) // (nothing yet: the history begins at the next edge)
      const before = look(s)
      for (let i = 0; i < 3; i++) s.stepClock()
      let backs = 0
      while (s.stepBack()) backs++
      expect(backs).toBe(3)
      expect(look(s).time).toBeCloseTo(before.time, 6) // (back to where the history began, and no further)
    })

    it('stays off when a circuit is loaded or reset', () => {
      const s = new Simulator()
      s.setHistory(false)
      s.load(machine())
      s.settle()
      s.reset()
      s.settle()
      s.load(machine())
      s.settle()
      s.stepClock()
      s.stepClock()
      expect(s.historyOn).toBe(false)
      expect(s.canStepBack()).toBe(false)
    })
  })
})
