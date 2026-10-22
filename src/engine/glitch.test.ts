import { describe, expect, it } from 'vitest'
import { findGlitches, traceOf } from './glitch'
import { getDef } from './registry'
import { CAPTURE_TICKS, Simulator, type SimCircuit } from './simulator'
import { paramDefaults, type Params } from './types'

type Spec = string | [string, Params] | [string, Params, number]

function build(comps: Record<string, Spec>, wires: [string, string][]): SimCircuit {
  return {
    comps: Object.entries(comps).map(([id, t]) => {
      const [type, params, delay] = typeof t === 'string' ? [t, {}, undefined] : (t as [string, Params, number?])
      return { id, type, params: { ...paramDefaults(getDef(type)), ...params }, ...(delay ? { delay } : {}) }
    }),
    wires: wires.map(([f, t]) => {
      const [fc, fp] = f.split('.')
      const [tc, tp] = t.split('.')
      return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
    }),
  }
}

/** Y = A·B + ¬A·C, with B and C on: Y should stay 1 when A flips, but the inverter makes one product fall before the other rises. */
const hazard = (and1Delay = 1, consensus = false) =>
  build(
    {
      A: ['switch', { on: true }],
      B: ['switch', { on: true }],
      C: ['switch', { on: true }],
      n: 'not',
      p1: ['and', {}, and1Delay],
      p2: 'and',
      ...(consensus ? { p3: 'and' } : {}),
      y: ['or', consensus ? { inputs: 3 } : {}],
    },
    [
      ['A.Q', 'n.A'],
      ['A.Q', 'p1.A'],
      ['B.Q', 'p1.B'],
      ['n.Y', 'p2.A'],
      ['C.Q', 'p2.B'],
      ['p1.Y', 'y.A'],
      ['p2.Y', 'y.B'],
      ...(consensus ? ([['B.Q', 'p3.A'], ['C.Q', 'p3.B'], ['p3.Y', 'y.C']] as [string, string][]) : []),
    ],
  )

/** Settle the circuit, start recording, flip A and settle again. */
function flipA(c: SimCircuit) {
  const s = new Simulator()
  s.load(c)
  s.settle()
  s.setCapture(true)
  s.setParams('A', { on: false })
  s.settle()
  return s
}

describe('capture', () => {
  it('records every net at every tick of a settle, starting with the values before the first tick', () => {
    const s = new Simulator()
    s.load(build({ sw: 'switch', b0: 'buf', b1: 'buf', b2: 'buf' }, [['sw.Q', 'b0.A'], ['b0.Y', 'b1.A'], ['b1.Y', 'b2.A']]))
    s.settle()
    s.setCapture(true)
    s.setParams('sw', { on: true })
    s.settle()
    const cap = s.getCapture()!
    const trace = (comp: string, pin: string) => [...traceOf(cap.frames, s.netOf(comp, pin))].join('')
    expect(trace('sw', 'Q')).toBe('011111') // the switch, then each buffer one tick behind
    expect(trace('b0', 'Y')).toBe('001111')
    expect(trace('b1', 'Y')).toBe('000111')
    expect(trace('b2', 'Y')).toBe('000011')
    expect(cap.frames.length).toBe(1 + 5) // before, ticks 1-4 (the last one changes b2) and the tick that finds nothing changes
    expect(cap.truncated).toBe(false)
  })

  it('is off until asked, and keeps nothing while off', () => {
    const s = new Simulator()
    s.load(hazard())
    s.settle()
    s.setParams('A', { on: false })
    s.settle()
    expect(s.getCapture()).toBeNull()
  })

  it('does not change what the circuit does', () => {
    const run = (capture: boolean) => {
      const s = new Simulator()
      s.load(hazard())
      s.settle()
      s.setCapture(capture)
      const seen: string[] = []
      for (const on of [false, true, false]) {
        s.setParams('A', { on })
        s.settle()
        seen.push(`${s.ticks}:${s.pinValue('y', 'Y')}`)
      }
      return seen.join(' ')
    }
    expect(run(true)).toBe(run(false))
  })

  it('keeps the latest settle in which something changed, not the quiet ones after it', () => {
    const s = flipA(hazard())
    const kept = s.getCapture()
    s.settle() // nothing changes now
    s.settle()
    expect(s.getCapture()).toBe(kept)
  })

  it('says what started it: a clock edge, or something else', () => {
    const s = new Simulator()
    s.load(build({ clk: ['clock', { hz: 4 }], t: 'tff', one: ['const', { value: 1 }] }, [['clk.Q', 't.CLK'], ['one.Q', 't.T']]))
    s.settle()
    s.setCapture(true)
    s.advance(300) // the clock's first edge, at 125 ms, and the next one, at 250 ms
    expect(s.getCapture()!.cause).toBe('clock')
    s.setParams('one', { value: 0 })
    s.settle()
    // The constant changed, but it does not alter any net other than its own: still a capture, now caused by an input.
    expect(s.getCapture()!.cause).toBe('input')
  })

  it('records at most CAPTURE_TICKS ticks, and says so', () => {
    const n = CAPTURE_TICKS + 50
    const comps: Record<string, Spec> = { sw: 'switch' }
    const wires: [string, string][] = []
    for (let i = 0; i < n; i++) {
      comps[`b${i}`] = 'buf'
      wires.push([i ? `b${i - 1}.Y` : 'sw.Q', `b${i}.A`])
    }
    const s = new Simulator()
    s.load(build(comps, wires))
    s.settle(2000)
    s.setCapture(true)
    s.setParams('sw', { on: true })
    s.settle(2000)
    const cap = s.getCapture()!
    expect(cap.truncated).toBe(true)
    expect(cap.frames.length).toBeLessThanOrEqual(CAPTURE_TICKS + 2)
  })

  it('is forgotten when the circuit is reloaded or reset, and when recording stops', () => {
    const s = flipA(hazard())
    expect(s.getCapture()).not.toBeNull()
    const version = s.captureVersion
    s.reset()
    expect(s.getCapture()).toBeNull()
    expect(s.captureVersion).toBeGreaterThan(version)
    const t = flipA(hazard())
    t.load(hazard())
    expect(t.getCapture()).toBeNull()
    const u = flipA(hazard())
    u.setCapture(false)
    expect(u.getCapture()).toBeNull()
  })

  it('names nets by the pin that drives them, and finds the net of an input pin', () => {
    const s = new Simulator()
    s.load(hazard())
    s.settle()
    expect(s.netNames()[s.netOf('n', 'Y')]).toBe('n:Y')
    expect(s.netOf('p2', 'A')).toBe(s.netOf('n', 'Y')) // an input reads the net that feeds it
    expect(s.netOf('y', 'C')).toBe(-1) // the OR has only two inputs
    expect(s.netOf('nope', 'Y')).toBe(-1)
  })
})

describe('glitches', () => {
  it('a static-1 hazard: Y dips for a tick when A flips, though it should stay 1', () => {
    const s = flipA(hazard())
    const cap = s.getCapture()!
    expect(s.pinValue('y', 'Y')).toBe(1) // it ends where it began
    const y = s.netOf('y', 'Y')
    expect([...traceOf(cap.frames, y)].join('')).toMatch(/^1+01+$/)
    const g = findGlitches(cap.frames)
    const mine = g.find((x) => x.net === y)!
    expect(mine).toMatchObject({ kind: 'static-1', first: 1, last: 1, changes: 2 })
    expect(mine.to).toBe(mine.from + 1) // one tick wide
    // The two products are the cause: p1 falls and p2 rises, in different ticks. They are not glitches themselves.
    expect(g.map((x) => x.net)).toEqual([y])
  })

  it('goes away when the two paths take the same time', () => {
    const s = flipA(hazard(2)) // the direct product is as slow as the inverted one
    expect(findGlitches(s.getCapture()!.frames)).toEqual([])
    expect(s.pinValue('y', 'Y')).toBe(1)
  })

  it('goes away with the consensus term B·C, which holds Y up while A changes', () => {
    const s = flipA(hazard(1, true))
    expect(findGlitches(s.getCapture()!.frames)).toEqual([])
  })

  it('a dynamic glitch: changes more than once on the way to the other value', () => {
    // A XOR (A delayed by three buffers): A rises, the XOR goes 0 → 1, then back 1 → 0 once the slow copy catches up; and with
    // B on the other input of an OR, the net can swing 0 → 1 → 0 → 1.
    const frames = [Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(1)]
    expect(findGlitches(frames)).toEqual([{ net: 0, kind: 'dynamic', first: 0, last: 1, changes: 3, from: 1, to: 3 }])
  })

  it('one change is not a glitch, and neither is no change', () => {
    expect(findGlitches([Uint8Array.of(0, 1), Uint8Array.of(0, 1), Uint8Array.of(0, 1), Uint8Array.of(0, 1)])).toEqual([])
    expect(findGlitches([Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(1), Uint8Array.of(1)])).toEqual([])
  })

  it('a net that starts unknown, or goes unknown on the way, is skipped', () => {
    const X = 2
    expect(findGlitches([Uint8Array.of(X), Uint8Array.of(1), Uint8Array.of(0), Uint8Array.of(1)])).toEqual([])
    expect(findGlitches([Uint8Array.of(1), Uint8Array.of(X), Uint8Array.of(1), Uint8Array.of(1)])).toEqual([])
  })

  it('static-0 and static-1 are told apart', () => {
    const zero = findGlitches([Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(0), Uint8Array.of(0)])
    expect(zero[0].kind).toBe('static-0')
    const one = findGlitches([Uint8Array.of(1), Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(1)])
    expect(one[0].kind).toBe('static-1')
  })

  it('a power-up settle has no glitches: every net starts unknown', () => {
    const s = new Simulator()
    s.load(hazard())
    s.setCapture(true)
    s.reset()
    s.settle()
    expect(findGlitches(s.getCapture()!.frames)).toEqual([])
  })
})
