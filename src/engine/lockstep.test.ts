import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { EXAMPLES } from '../model/examples'
import { Simulator } from './simulator'
import { OracleSimulator } from './testdata/oracle/simulator'

/**
 * Guards the engine: it must do what it did before. `testdata/oracle/` holds the old TypeScript simulator and parts, and these tests run
 * the real simulator (the Rust engine inside it) against them on every example. The single parts, with random 0/1/X/Z inputs, are the
 * `CASES` of `wasmengine.test.ts`.
 */

/** Every net, as the simulator keeps them. */
const netsOf = (s: Simulator | OracleSimulator) => (s as unknown as { values: Uint8Array }).values

describe('the simulator against the oracle', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: every net, the tick count and the time agree after each clock edge`, { timeout: 60000 }, () => {
      const circuit = flatten(ex.build())
      const a = new Simulator()
      const b = new OracleSimulator()
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
          ;(a as unknown as { we: { markAll(fast: boolean): void } | null }).we?.markAll(false)
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
  // (`tapped` is a note the keypad's TypeScript copy leaves for the page: the module does not keep it)
  if (x && typeof x === 'object') return `{${Object.keys(x).filter((k) => k !== 'tapped').sort().map((k) => `${k}:${digest((x as Record<string, unknown>)[k])}`).join(',')}}`
  return String(x)
}

const statesOf = (s: Simulator | OracleSimulator) => {
  // (with the Rust engine running, the parts' states are brought up to date from the module first)
  ;(s as unknown as { syncWasm?: () => void }).syncWasm?.()
  return (s as unknown as { comps: { id: string; inst: { state: unknown } }[] }).comps.map((c) => `${c.id}=${digest(c.inst.state)}`)
}

describe('the fast engine against the oracle', () => {
  const accepted: string[] = []
  const staysExact: string[] = []
  for (const ex of EXAMPLES) {
    it(`${ex.id}: every net and every part's state agree after each clock edge`, { timeout: 120000 }, () => {
      const circuit = flatten(ex.build())
      const a = new Simulator()
      a.setFast(true)
      const b = new OracleSimulator()
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
  it('keeps 65c02-timer exact for a reason it names: a second clock (the timer) feeds the NMI pin of a CPU clocked by the first', () => {
    // (the note of the example says so; if the planner starts to take it, the note and this test go)
    const a = new Simulator()
    a.setFast(true)
    a.load(flatten(EXAMPLES.find((e) => e.id === '65c02-timer')!.build()))
    a.settle()
    expect([a.engine, a.fastRejected]).toEqual(['exact', 'race'])
  })
  it('runs all but the loops and delays of the teaching circuits on the fast engine', () => {
    // (65c02-timer and debounce have a second clock feeding the data of a part clocked by the first, e.g. the CPU's NMI: which edge comes first depends on gate depths, so it stays exact)
    expect(staysExact.sort()).toEqual(['65c02-timer', 'd-latch', 'debounce', 'oscillator', 'ripple', 'sr-latch'])
    expect(accepted.length).toBeGreaterThan(53)
  })
})
