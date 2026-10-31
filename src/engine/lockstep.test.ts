import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { EXAMPLES } from '../model/examples'
import { DEFS } from './registry'
import { Simulator } from './simulator'
import { layoutOf } from './layoutcache'
import { ReferenceSimulator } from './testdata/reference/simulator'
import { getDef as referenceDef } from './testdata/reference/registry'
import type { Params, V } from './types'

/**
 * Guards the speed work (docs/spec-sim-speed-tier1.md): the engine must do exactly what it did before. `testdata/reference/` holds the
 * simulator and the word-wide, gate and sequential parts as they were, and these tests run the real ones against them.
 */

/** Every net, as the simulator keeps them. */
const netsOf = (s: Simulator | ReferenceSimulator) => (s as unknown as { values: Uint8Array }).values

/** A small deterministic random generator (mulberry32). */
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the simulator against the reference simulator', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: every net, the tick count and the time agree after each clock edge`, { timeout: 60000 }, () => {
      const circuit = flatten(ex.build())
      const a = new Simulator()
      const b = new ReferenceSimulator()
      a.load(circuit)
      b.load(circuit)
      a.settle()
      b.settle()
      const big = circuit.comps.length > 1500
      const edges = big ? 60 : 300
      const same = (where: string) => {
        expect(Array.from(netsOf(a)), where).toEqual(Array.from(netsOf(b)))
        expect([a.ticks, a.time, a.unstable], where).toEqual([b.ticks, b.time, b.unstable])
      }
      same('after the first settle')
      for (let i = 0; i < edges; i++) {
        a.stepClock()
        b.stepClock()
        same(`edge ${i}`)
        // Every tick of a settle from "nothing is known to be up to date": all parts evaluated, then the changes spreading.
        if (i % 50 === 25) {
          ;(a as unknown as { markAll(): void }).markAll()
          ;(b as unknown as { markAll(): void }).markAll()
          for (let t = 0; t < 12; t++) {
            expect(a.tick(), `tick ${t} after edge ${i}`).toBe(b.tick())
            same(`tick ${t} after edge ${i}`)
          }
        }
      }
    })
  }
})

/** A cheap fingerprint of a part's state (typed arrays are summed, not listed). */
function digest(x: unknown): string {
  if (ArrayBuffer.isView(x)) {
    const a = x as unknown as ArrayLike<number>
    let h = a.length
    for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + a[i]) | 0
    return `#${h}`
  }
  if (Array.isArray(x)) return `[${x.map(digest).join(',')}]`
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${k}:${digest((x as Record<string, unknown>)[k])}`).join(',')}}`
  return String(x)
}

const statesOf = (s: Simulator | ReferenceSimulator) => (s as unknown as { comps: { id: string; inst: { state: unknown } }[] }).comps.map((c) => `${c.id}=${digest(c.inst.state)}`)

describe('the fast engine against the reference simulator', () => {
  const accepted: string[] = []
  const staysExact: string[] = []
  for (const ex of EXAMPLES) {
    it(`${ex.id}: every net and every part's state agree after each clock edge`, { timeout: 120000 }, () => {
      const circuit = flatten(ex.build())
      const a = new Simulator()
      a.setFast(true)
      const b = new ReferenceSimulator()
      a.load(circuit)
      b.load(circuit)
      a.settle()
      b.settle()
      if (a.engine === 'fast') accepted.push(ex.id)
      else staysExact.push(ex.id)
      const edges = circuit.comps.length > 1500 ? 60 : 300
      const same = (where: string) => {
        const x = Array.from(netsOf(a))
        const y = Array.from(netsOf(b))
        expect(x.map((v, k) => (v !== y[k] ? `${k}:${v}/${y[k]}` : '')).filter(Boolean), where).toEqual([])
        expect(statesOf(a), where).toEqual(statesOf(b))
        expect([a.time, a.unstable], where).toEqual([b.time, b.unstable])
      }
      same('after the first settle')
      for (let i = 0; i < edges; i++) {
        a.stepClock()
        b.stepClock()
        same(`edge ${i}`)
      }
    })
  }
  it('runs all but the loops and delays of the teaching circuits on the fast engine', () => {
    // (65c02-timer and debounce have a second clock feeding the data of a part clocked by the first, e.g. the CPU's NMI: which edge comes first depends on gate depths, so it stays exact)
    expect(staysExact.sort()).toEqual(['65c02-timer', 'd-latch', 'debounce', 'oscillator', 'ripple', 'sr-latch'])
    expect(accepted.length).toBeGreaterThan(53)
  })
})

describe('the parts against the reference parts', () => {
  const draw = (r: () => number, acceptsZ: boolean): V => {
    const x = r()
    if (x < 0.08) return 2
    if (x < 0.1) return acceptsZ ? 3 : 2
    return x < 0.55 ? 0 : 1
  }
  /** The default params, and each param with a choice (a width, a list of options) set to each of its values, one at a time. */
  function variants(def: (typeof DEFS)[number]): Params[] {
    const base: Params = {}
    for (const p of def.params ?? []) base[p.key] = p.default
    const out: Params[] = [base]
    for (const p of def.params ?? []) {
      const values: (string | number | boolean)[] =
        p.kind === 'select' ? (p.options ?? []).map((o) => o.value) : p.key === 'bits' || p.key === 'n' ? Array.from({ length: (p.max ?? 16) - (p.min ?? 2) + 1 }, (_, i) => (p.min ?? 2) + i) : []
      for (const v of values) if (v !== p.default) out.push({ ...base, [p.key]: v })
    }
    return out
  }

  for (const def of DEFS) {
    const ref = referenceDef(def.type)
    it(`${def.type}: random 0/1/X/Z inputs give the same outputs and state`, () => {
      const r = rng(def.type.length * 7919 + def.type.charCodeAt(0))
      for (const params of variants(def)) {
        const layout = layoutOf(def.type, params)
        const nIn = layout.pins.filter((p) => p.dir === 'in').length
        const nOut = layout.pins.filter((p) => p.dir === 'out').length
        const mk = (d: typeof def) => ({ ins: new Array<V>(nIn).fill(2), outs: new Array<V>(nOut).fill(2), state: d.init?.(params), params })
        const x = mk(def)
        const y = mk(ref)
        const zOk = !!def.acceptsZ
        for (let step = 0; step < 120; step++) {
          for (let i = 0; i < nIn; i++) x.ins[i] = y.ins[i] = draw(r, zOk)
          def.evaluate(x)
          ref.evaluate(y)
          const where = `${def.type} ${JSON.stringify(params)} step ${step} ins ${x.ins.join('')}`
          expect(x.outs.join(''), where).toBe(y.outs.join(''))
          if (x.state !== undefined && !ArrayBuffer.isView(x.state) && JSON.stringify(x.state).length < 4000) expect(JSON.stringify(x.state), where).toBe(JSON.stringify(y.state))
        }
      }
    })
  }
})
