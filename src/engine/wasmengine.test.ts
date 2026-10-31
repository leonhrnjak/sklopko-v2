import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { micro6502, micro6502Basic } from '../model/micro6502'
import { screenText } from './acia'
import { Simulator } from './simulator'
import { loadEngine } from './wasm'
import { supports, WasmEngine } from './wasmengine'

/** The committed module, read from disk (a computed module name: the app's types do not include Node's). */
async function module() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
}

function fastSim(circuit: ReturnType<typeof micro6502>) {
  const sim = new Simulator()
  sim.setFast(true)
  sim.setHistory(false)
  sim.load(flatten(circuit))
  sim.settle()
  expect(sim.engine).toBe('fast')
  return sim
}

describe('the WebAssembly engine against the TypeScript fast engine (docs/spec-sim-wasm.md)', () => {
  it('gives the same nets after every clock edge: the 6502 from parts with its LEDs', async () => {
    const sim = fastSim(micro6502())
    const c = sim.compiled()!
    expect(supports(c)).toBe(true)
    const w = new WasmEngine(await module(), c)
    for (let e = 0; e < 6000; e++) {
      sim.stepClock()
      expect(w.edge(), `edge ${e} settles`).toBe(true)
      const a = c.values
      const b = w.values
      for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) throw new Error(`edge ${e}: net ${n} is ${a[n]} in TypeScript and ${b[n]} in Rust`)
    }
    // and the state of the parts that the page shows
    w.syncOut()
  })

  it('runs Microsoft BASIC on the 6502 from parts: the same nets at the start, the same screen later', async () => {
    const ts = fastSim(micro6502Basic())
    const c = ts.compiled()!
    expect(supports(c)).toBe(true)
    const wasmSim = fastSim(micro6502Basic()) // (the page's copy of the state, which syncOut fills)
    const w = new WasmEngine(await module(), wasmSim.compiled()!)
    for (let e = 0; e < 4000; e++) {
      ts.stepClock()
      expect(w.edge()).toBe(true)
      const a = c.values
      const b = w.values
      for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) throw new Error(`edge ${e}: net ${n} is ${a[n]} in TypeScript and ${b[n]} in Rust`)
    }
    // Run on until the interpreter has started: both screens say the same at every step on the way.
    const term = (s: Simulator) => s.state(s.idsOfType('acia6551')[0]) as Parameters<typeof screenText>[0]
    const screens = () => {
      w.syncOut()
      return [screenText(term(ts)), screenText(term(wasmSim))]
    }
    const run = (edges: number) => {
      for (let i = 0; i < edges; i++) ts.stepClock()
      w.edges(edges)
      const [a, b] = screens()
      expect(b).toBe(a)
      return a
    }
    let screen = ''
    for (let i = 0; i < 300 && !screen.includes('OK'); i++) screen = run(4000)
    expect(screen).toContain('OK')
    // Type a program: the same keys go to both, and they print the same.
    const id = ts.idsOfType('acia6551')[0]
    ts.terminal(id, { op: 'type', text: '10 FOR I=1 TO 3:PRINT I*I:NEXT\rRUN\r', capitals: true })
    expect(w.type(0, '10 FOR I=1 TO 3:PRINT I*I:NEXT\rRUN\r')).toBeGreaterThan(20)
    for (let i = 0; i < 100 && !/\n 9\n/.test(screen); i++) screen = run(20000)
    expect(screen).toMatch(/\n 1\n 4\n 9\n/)
  }, 600000)
})
