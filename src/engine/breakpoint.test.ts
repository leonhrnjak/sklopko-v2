import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { paramDefaults, type Params } from './types'

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

const start = (c: SimCircuit) => {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}

/** A 4 Hz clock (an edge every 125 ms; the counter goes up on the rising ones) and a counter. */
const counter = { clk: ['clock', { hz: 4 }] as [string, Params], n: ['counter', { mod: 16 }] as [string, Params] }
const clocked: [string, string][] = [['clk.Q', 'n.CLK']]
const bits4: [string, string][] = ['A', 'B', 'C', 'D'].map((p, i) => [`n.${p}`, `bp.A${i}`])
const count = (s: Simulator) => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (s.pinValue('n', p) << i), 0)

describe('breakpoint', () => {
  it('stops the simulation right at the edge where its signal becomes 1', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 1 }] }, [...clocked, ['n.A', 'bp.A']]))
    s.advance(5000)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(1)
    expect(s.time).toBeCloseTo(125, 3) // not a frame later: the 5 s that were asked for are dropped
  })

  it('takeBreak hands the stop over once', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 1 }] }, [...clocked, ['n.A', 'bp.A']]))
    expect(s.takeBreak()).toBeNull()
    s.advance(500)
    expect(s.takeBreak()).toBe('bp')
    expect(s.takeBreak()).toBeNull()
  })

  it('carries on from where it stopped, and does not fire again while the condition still holds', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 1 }] }, [...clocked, ['n.A', 'bp.A']]))
    s.advance(5000)
    s.takeBreak()
    // A stays 1 through the falling edge at 250 ms, goes 0 at the rising edge at 375, and 1 again at 625.
    s.advance(5000)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(3)
    expect(s.time).toBeCloseTo(625, 3)
  })

  it('fires when a number reaches its value', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 4, when: 'equals', value: 5 }] }, [...clocked, ...bits4]))
    s.advance(60000)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(5)
    expect(s.time).toBeCloseTo(1125, 3)
  })

  it('fires when a number changes, and only then', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 4, when: 'changes' }] }, [...clocked, ...bits4]))
    s.advance(100) // before the first edge: nothing changes
    expect(s.takeBreak()).toBeNull()
    s.advance(100)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(1)
    s.advance(125) // the falling edge: the count stays
    expect(s.takeBreak()).toBeNull()
    s.advance(125)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(2)
  })

  it('never fires on unknown inputs', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 1, value: 0 }], bp2: ['breakpoint', { width: 1, when: 'changes' }] }, clocked))
    s.advance(2000)
    expect(s.takeBreak()).toBeNull()
  })

  it('the first look only sets the baseline: a signal that starts out met does not stop the simulation', () => {
    const s = start(build({ ...counter, one: ['const', { value: 1 }], bp: ['breakpoint', { width: 1, value: 1 }] }, [...clocked, ['one.Q', 'bp.A']]))
    s.advance(2000)
    expect(s.takeBreak()).toBeNull()
    expect(s.time).toBeCloseTo(2000, 0) // it simply ran
  })

  it('waits for a falling signal: it fires on the way down', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 1, value: 0 }] }, [...clocked, ['n.A', 'bp.A']]))
    s.advance(5000)
    // The baseline is A = 0 (met). It goes to 1 at 125 ms (no fire), and back to 0 at 375 ms: that fires.
    expect(s.takeBreak()).toBe('bp')
    expect(s.time).toBeCloseTo(375, 3)
    expect(count(s)).toBe(2)
  })

  it('stops on a single Clock step too, and reports it', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 1 }] }, [...clocked, ['n.A', 'bp.A']]))
    s.stepClock()
    expect(s.takeBreak()).toBe('bp')
  })

  it('reports the first breakpoint when several trip at once', () => {
    const s = start(
      build({ ...counter, one: ['breakpoint', { width: 1 }], two: ['breakpoint', { width: 1 }] }, [...clocked, ['n.A', 'one.A'], ['n.A', 'two.A']]),
    )
    s.advance(1000)
    expect(s.takeBreak()).toBe('one')
    expect(s.takeBreak()).toBeNull()
  })

  it('fires again after stepping back and running forward again', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 4, value: 5 }] }, [...clocked, ...bits4]))
    s.advance(60000)
    expect(s.takeBreak()).toBe('bp')
    expect(s.stepBack()).toBe(true)
    expect(count(s)).toBe(4)
    expect(s.takeBreak()).toBeNull() // looking afresh after stepping back must not fire by itself
    s.advance(60000)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(5)
  })

  it('starts over after Reset', () => {
    const s = start(build({ ...counter, bp: ['breakpoint', { width: 4, value: 2 }] }, [...clocked, ...bits4]))
    s.advance(60000)
    expect(s.takeBreak()).toBe('bp')
    s.reset()
    s.settle()
    s.advance(60000)
    expect(s.takeBreak()).toBe('bp')
    expect(count(s)).toBe(2)
  })

  it('layout: one pin A for one bit, A0…An for a number; the title says what it waits for', () => {
    const def = getDef('breakpoint')
    expect(def.layout({ width: 1 }).pins.map((p) => p.name)).toEqual(['A'])
    expect(def.layout({ width: 8 }).pins.map((p) => p.name)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'])
    expect(def.title!({ when: 'equals', value: 14 })).toBe('STOP\n= 14')
    expect(def.title!({ when: 'changes', value: 14 })).toBe('STOP\nchanges')
  })
})
