import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { micro6502, micro6502Basic } from '../model/micro6502'
import { screenText } from './acia'
import { Simulator } from './simulator'
import { loadEngine } from './wasm'
import { openFor, supports, WasmEngine } from './wasmengine'

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

describe('the Rust engine inside the Simulator', () => {
  const screen = (s: Simulator) => screenText(s.state(s.idsOfType('acia6551')[0]) as Parameters<typeof screenText>[0])
  const same = (a: Simulator, b: Simulator, what: string) => {
    const x = a.viewValues()
    const y = b.viewValues()
    for (let n = 0; n < x.length; n++) if (x[n] !== y[n]) throw new Error(`${what}: net ${n} is ${x[n]} with Rust and ${y[n]} without`)
    expect(a.ticks > 0).toBe(true)
    expect(screen(a)).toBe(screen(b))
  }

  it('runs BASIC, keeps up with typing, stepping and edits, and agrees with the TypeScript engine throughout', async () => {
    const x = await module()
    const rust = fastSim(micro6502Basic())
    rust.setWasm(openFor(x))
    const plain = fastSim(micro6502Basic())
    const both = (n: number) => {
      for (let i = 0; i < n; i++) {
        rust.stepClock()
        plain.stepClock()
      }
    }
    both(10)
    expect(rust.wasmOn, 'the Rust engine took over').toBe(true)
    expect(plain.wasmOn).toBe(false)
    both(3990)
    same(rust, plain, 'after 4,000 edges')
    // up to the prompt
    for (let i = 0; i < 300 && !screen(plain).includes('OK'); i++) both(4000)
    expect(screen(rust)).toContain('OK')
    same(rust, plain, 'at the prompt')
    // typing goes to the keyboard queue in the Rust engine
    const id = plain.idsOfType('acia6551')[0]
    for (const sim of [rust, plain]) sim.terminal(id, { op: 'type', text: '10 FOR I=1 TO 3:PRINT I*I:NEXT\rRUN\r', capitals: true })
    for (let i = 0; i < 30; i++) both(20000)
    same(rust, plain, 'after RUN')
    expect(screen(rust)).toMatch(/\n 1\n 4\n 9\n/)
    expect(rust.wasmOn).toBe(true)
    // a break while a program runs
    for (const sim of [rust, plain]) sim.terminal(id, { op: 'type', text: '20 GOTO 20\rRUN\r', capitals: true })
    both(100000)
    for (const sim of [rust, plain]) sim.terminal(id, { op: 'break' })
    both(100000)
    same(rust, plain, 'after the break')
    // an edit in the middle (flipping a switch part is a setParams): the Rust engine stops and starts again
    const sw = plain.idsOfType('switch')[0]
    if (sw) {
      const params = (plain as unknown as { byId: Map<string, { inst: { params: Record<string, unknown> } }> }).byId.get(sw)!.inst.params
      for (const sim of [rust, plain]) sim.setParams(sw, { ...params, on: !params.on })
      both(2000)
      same(rust, plain, 'after an edit')
    }
    // Step (gate delays one by one) is for the exact engine: it takes over, and both go on the same way
    rust.tick()
    plain.tick()
    expect(rust.wasmOn).toBe(false)
    both(5000)
    same(rust, plain, 'after Step')
    expect(rust.wasmOn, 'and the Rust engine is back').toBe(true)
  }, 600000)

  it('stays off where it must: with the history for stepping back, with a capture, and without a module', async () => {
    const x = await module()
    const rust = new Simulator()
    rust.setFast(true)
    rust.setWasm(openFor(x))
    rust.load(flatten(micro6502()))
    rust.settle()
    for (let i = 0; i < 20; i++) rust.stepClock()
    expect(rust.wasmOn, 'history is on').toBe(false)
    rust.setHistory(false)
    rust.settle()
    for (let i = 0; i < 20; i++) rust.stepClock()
    expect(rust.wasmOn).toBe(true)
    rust.setCapture(true)
    expect(rust.wasmOn, 'a capture needs the exact engine').toBe(false)
    expect(rust.engine).toBe('exact')
  })
})
