import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { EXAMPLES } from '../model/examples'
import { micro6502, micro6502Basic } from '../model/micro6502'
import { screenText } from './acia'
import { Simulator } from './simulator'
import { loadEngine } from './wasm'
import { openFor, ported, supports, WasmEngine } from './wasmengine'

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

  it('stays off where it must: with a terminal and the history for stepping back, with a capture, and without a module', async () => {
    const x = await module()
    const rust = new Simulator()
    rust.setFast(true)
    rust.setWasm(openFor(x))
    const basic = micro6502Basic()
    delete basic.history // absent means on
    rust.load(flatten(basic))
    rust.settle()
    for (let i = 0; i < 20; i++) rust.stepClock()
    expect(rust.wasmOn, 'a terminal and history on').toBe(false)
    rust.setHistory(false)
    rust.settle()
    for (let i = 0; i < 20; i++) rust.stepClock()
    expect(rust.wasmOn).toBe(true)
    rust.setCapture(true)
    expect(rust.wasmOn, 'a capture needs the exact engine').toBe(false)
    expect(rust.engine).toBe('exact')
  })

  it('steps back over clock edges in the Rust engine: the same nets, parts and RAM as the TypeScript engine, forward and back again', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = new Simulator()
      sim.setFast(true)
      if (rust) sim.setWasm(openFor(x))
      sim.load(flatten(micro6502()))
      sim.settle()
      return sim
    }
    const rust = mk(true)
    const plain = mk(false)
    const look = (s: Simulator) => JSON.stringify([Array.from(s.viewValues()), s.time, s.ticks > 0, Object.fromEntries(s.idsOfType('ram').map((id) => [id, Array.from((s.state(id) as { mem: Uint8Array }).mem.slice(0, 64))]))])
    const both = (f: (s: Simulator) => unknown) => [f(rust), f(plain)]
    for (let i = 0; i < 80; i++) both((s) => s.stepClock())
    expect(rust.wasmOn, 'the Rust engine runs with the history on').toBe(true)
    expect(plain.wasmOn).toBe(false)
    expect(look(rust)).toBe(look(plain))
    for (let i = 0; i < 50; i++) {
      const [a, b] = both((s) => s.stepBack())
      expect(a).toBe(b)
      expect(look(rust), `after ${i + 1} steps back`).toBe(look(plain))
    }
    // forward again from the middle of the history, and back once more
    for (let i = 0; i < 30; i++) both((s) => s.stepClock())
    expect(look(rust)).toBe(look(plain))
    for (let i = 0; i < 20; i++) {
      both((s) => s.stepBack())
      expect(look(rust), `second walk back, step ${i + 1}`).toBe(look(plain))
    }
    expect(rust.wasmOn, 'still the Rust engine').toBe(true)
    // Step (one gate delay) is for the exact engine, which takes the circuit and gives it back; going back works over snapshots of both kinds
    both((s) => s.tick())
    expect(rust.wasmOn, 'the exact engine has it').toBe(false)
    for (let i = 0; i < 10; i++) both((s) => s.stepClock())
    expect(rust.wasmOn, 'and the Rust engine again').toBe(true)
    for (let i = 0; i < 40; i++) {
      const [a, b] = both((s) => s.stepBack())
      expect(a).toBe(b)
      expect(look(rust), `third walk back, step ${i + 1}`).toBe(look(plain))
    }
  }, 120000)
})

describe('probes and breakpoints with the Rust engine', () => {
  /** The 6502 from parts with a probe and a breakpoint on the SYNC line (the one the LED shows). */
  function withProbes() {
    const c = micro6502()
    c.history = false
    const wires = c.wires as unknown as Record<string, { id: string; from: { comp: string; pin: string }; to: { comp: string; pin: string }; path: unknown[] }>
    const led = Object.values(c.comps).find((k) => k.type === 'led' && String(k.label).startsWith('SYNC'))!
    const sync = Object.values(wires).find((w) => w.to.comp === led.id)!
    const base = { x: 0, y: 0, rot: 0, flip: false } as const
    const comps = c.comps as unknown as Record<string, unknown>
    comps.zProbe = { ...base, id: 'zProbe', type: 'probe', params: { bits: 1 }, label: 'SYNC' }
    comps.zStop = { ...base, id: 'zStop', type: 'breakpoint', params: { width: 1, when: 'equals', value: 1 }, label: 'stop' }
    wires.zw1 = { id: 'zw1', from: sync.from, to: { comp: 'zProbe', pin: 'A' }, path: [] }
    wires.zw2 = { id: 'zw2', from: sync.from, to: { comp: 'zStop', pin: 'A' }, path: [] }
    return c
  }
  const trace = (s: Simulator) => JSON.stringify(s.state('zProbe'))

  it('keeps the Rust engine on, and records the same trace and stops at the same edge as the TypeScript engine', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = new Simulator()
      sim.setFast(true)
      sim.setHistory(false)
      if (rust) sim.setWasm(openFor(x))
      sim.load(flatten(withProbes()))
      sim.settle()
      return sim
    }
    const rust = mk(true)
    const plain = mk(false)
    const hits: (string | null)[][] = [[], []]
    for (let i = 0; i < 400; i++) {
      for (const [k, sim] of [rust, plain].entries()) {
        sim.stepClock()
        hits[k].push(sim.takeBreak())
      }
    }
    expect(rust.wasmOn, 'the Rust engine took the circuit with its probes').toBe(true)
    expect(hits[0]).toEqual(hits[1])
    expect(hits[0].some((h) => h === 'zStop'), 'the breakpoint fired').toBe(true)
    expect(trace(rust)).toBe(trace(plain))
    expect(JSON.parse(trace(rust)).v.length, 'the probe saw SYNC change').toBeGreaterThan(2)
  })
})

describe('every example the Rust engine takes', () => {
  /** How many examples the module takes, so that a part that loses its port (or a new one that gains it) shows up; raise it as parts are ported. */
  const TAKEN_AT_LEAST = 7

  it('gives the same nets as the TypeScript engine after every clock edge, for each example it takes', async () => {
    const x = await module()
    const taken: string[] = []
    const missing = new Map<string, number>()
    for (const ex of EXAMPLES) {
      const mk = (rust: boolean) => {
        const sim = new Simulator()
        sim.setFast(true)
        if (rust) sim.setWasm(openFor(x))
        sim.load(flatten(ex.build()))
        sim.settle()
        return sim
      }
      const rust = mk(true)
      const plain = mk(false)
      if (plain.engine !== 'fast') continue
      for (let i = 0; i < 40; i++) {
        rust.stepClock()
        plain.stepClock()
      }
      if (!rust.wasmOn) {
        const c = plain.compiled()
        if (c) for (const t of new Set(c.comps.filter((cc) => !ported(cc)).map((cc) => cc.def.type))) missing.set(t, (missing.get(t) ?? 0) + 1)
        continue
      }
      taken.push(ex.id)
      for (let i = 0; i < 200; i++) {
        rust.stepClock()
        plain.stepClock()
        const a = rust.viewValues()
        const b = plain.viewValues()
        for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) throw new Error(`${ex.id}: net ${n} is ${a[n]} with Rust and ${b[n]} without, after ${i + 41} edges`)
      }
    }
    console.log(`Rust engine takes ${taken.length} examples: ${taken.join(' ')}`)
    console.log('parts that keep examples out:', [...missing].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '))
    expect(taken.length).toBeGreaterThanOrEqual(TAKEN_AT_LEAST)
  }, 600000)
})
