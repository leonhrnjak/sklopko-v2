import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { CircuitBuilder } from '../model/builder'
import { EXAMPLES } from '../model/examples'
import { micro6502, micro6502Basic } from '../model/micro6502'
import { screenText } from './testdata/oracle/acia'
import { layoutOf } from './layoutcache'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { OracleSimulator } from './testdata/oracle/simulator'
import { paramDefaults, type Params } from './types'
import { loadEngine } from './wasm'
import { openFor, ported, supports, WasmEngine } from './wasmengine'

/** The committed module, read from disk (a computed module name: the app's types do not include Node's). */
async function module() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
}

function fastSim(circuit: ReturnType<typeof micro6502>) {
  const sim = new OracleSimulator() as unknown as Simulator // (the TypeScript engine, to compare Rust against)
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
    expect(rust.wasmOn).toBe(true) // (the Rust engine runs the exact engine too)
    both(5000)
    same(rust, plain, 'after Step')
    expect(rust.wasmOn, 'and the Rust engine is back').toBe(true)
  }, 600000)

  it('runs Microsoft BASIC on the cpu6502 part the same as the TypeScript engine, nets and screen, then a program', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
      sim.setFast(true)
      sim.setHistory(false)
      sim.setWasm(rust ? openFor(x) : null)
      sim.load(flatten(EXAMPLES.find((e) => e.id === '6502-basic')!.build()))
      sim.settle()
      return sim
    }
    const rust = mk(true)
    const plain = mk(false)
    const both = (n: number) => {
      for (let i = 0; i < n; i++) {
        rust.stepClock()
        plain.stepClock()
      }
    }
    const same = (what: string) => {
      const a = rust.viewValues()
      const b = plain.viewValues()
      for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) throw new Error(`${what}: net ${n} is ${a[n]} with Rust and ${b[n]} without`)
    }
    const id = plain.idsOfType('acia6551')[0]
    const screen = (s: Simulator) => screenText(s.state(id) as Parameters<typeof screenText>[0])
    both(10)
    expect(rust.wasmOn).toBe(true)
    for (let i = 0; i < 400 && !screen(plain).includes('OK'); i++) {
      both(5000)
      if (i % 20 === 0) same(`at ${i * 5000} edges`)
    }
    expect(screen(rust)).toContain('OK')
    same('at the prompt')
    for (const sim of [rust, plain]) sim.terminal(id, { op: 'type', text: '10 FOR I=1 TO 5:PRINT I*I;SQR(I):NEXT\rRUN\r', capitals: true })
    for (let i = 0; i < 160; i++) {
      both(5000)
      if (i % 20 === 0) same(`running, ${i}`)
    }
    same('after RUN')
    expect(screen(rust)).toBe(screen(plain))
    expect(screen(rust)).toMatch(/ 25 /)
    expect(rust.wasmOn).toBe(true)
  }, 900000)

  for (const chip of ['nmos', 'cmos']) {
    it(`runs random opcodes on the ${chip} cpu6502 part the same as the TypeScript engine: every instruction, mode and interrupt`, async () => {
      const x = await module()
      for (let seed = 1; seed <= 6; seed++) {
        let h = seed * 2654435761
        const next = () => {
          h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) | 0
          return (h >>> 8) & 255
        }
        const data = Array.from({ length: 4096 }, () => next().toString(16).padStart(2, '0')).join(' ')
        const b = new CircuitBuilder()
        const clk = b.add('clock', 0, 0)
        const cpu = b.add('cpu6502', 200, 0, { params: { chip } })
        const rom = b.add('rom', 600, 0, { params: { abits: 12, dbits: 8, data } })
        // (the interrupt pins are driven by switches that change now and then)
        const irq = b.add('switch', 0, 100, { params: { on: true } })
        const nmi = b.add('switch', 0, 140, { params: { on: true } })
        b.wire(`${clk}.Q`, `${cpu}.PHI2`)
        b.wire(`${irq}.Q`, `${cpu}.IRQB`)
        b.wire(`${nmi}.Q`, `${cpu}.NMIB`)
        for (let i = 0; i < 12; i++) b.wire(`${cpu}.A${i}`, `${rom}.A${i}`)
        for (let i = 0; i < 8; i++) b.wire(`${rom}.D${i}`, `${cpu}.DI${i}`)
        const mk = (rust: boolean) => {
          const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
          sim.setFast(true)
          sim.setHistory(false)
          sim.setWasm(rust ? openFor(x) : null)
          sim.load(flatten(b.c))
          sim.settle()
          return sim
        }
        const rust = mk(true)
        const plain = mk(false)
        for (let step = 0; step < 400; step++) {
          if (step % 37 === 20) {
            const on = step % 74 !== 20
            for (const sim of [rust, plain]) sim.setParams(step % 2 ? irq : nmi, { on })
          }
          for (let i = 0; i < 50; i++) {
            rust.stepClock()
            plain.stepClock()
          }
          if (step === 0) expect(rust.wasmOn).toBe(true)
          if (step === 399) expect((plain.state(cpu) as { cpu: { cycles: number } }).cpu.cycles, 'it ran').toBeGreaterThan(5000)
          expect(JSON.stringify(rust.state(cpu)), `seed ${seed} step ${step}: state`).toBe(JSON.stringify(plain.state(cpu)))
          const a = rust.viewValues()
          const c = plain.viewValues()
          for (let n = 0; n < a.length; n++) if (a[n] !== c[n]) throw new Error(`${chip} seed ${seed} step ${step}: net ${n} is ${a[n]} with Rust and ${c[n]} without`)
        }
      }
    }, 600000)
  }

  it('steps back over a terminal board in the Rust engine: the same nets, screen and keyboard as the TypeScript engine', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
      sim.setFast(true)
      sim.setWasm(rust ? openFor(x) : null)
      const basic = micro6502Basic()
      delete basic.history // absent means on
      sim.load(flatten(basic))
      sim.settle()
      return sim
    }
    const rust = mk(true)
    const plain = mk(false)
    const term = plain.idsOfType('acia6551')[0]
    // (the TypeScript terminal reads its queue with an index, the Rust one's page copy starts at 0: compare what waits)
    const look = (s: Simulator) => {
      const st = s.state(term) as { keys: string; next: number }
      return JSON.stringify([Array.from(s.viewValues()), s.time, { ...st, keys: st.keys.slice(st.next), next: 0 }], (k, v) => (k === 'rev' || k === 'tapped' ? undefined : v))
    }
    const both = (f: (s: Simulator) => unknown) => [f(rust), f(plain)]
    for (let i = 0; i < 30; i++) both((s) => s.stepClock())
    both((s) => s.terminal(term, { op: 'type', text: 'PRINT 1\r', capitals: true }))
    for (let i = 0; i < 300; i++) {
      both((s) => s.stepClock())
      if (i % 50 === 0) expect(look(rust), `forward ${i}`).toBe(look(plain))
    }
    expect(rust.wasmOn, 'the Rust engine runs a terminal with the history on').toBe(true)
    for (let i = 0; i < 120; i++) {
      const [a, b] = both((s) => s.stepBack())
      expect(a).toBe(b)
      expect(look(rust), `after ${i + 1} steps back`).toBe(look(plain))
    }
    for (let i = 0; i < 60; i++) {
      both((s) => s.stepClock())
      expect(look(rust), `forward again ${i}`).toBe(look(plain))
    }
    expect(rust.wasmOn).toBe(true)
  }, 600000)

  it('leaves the Rust engine for a capture, and runs without a module', async () => {
    const x = await module()
    const rust = new Simulator()
    rust.setFast(true)
    rust.setWasm(openFor(x))
    const basic = micro6502Basic()
    rust.load(flatten(basic))
    rust.settle()
    for (let i = 0; i < 20; i++) rust.stepClock()
    expect(rust.wasmOn).toBe(true)
    rust.setCapture(true)
    expect(rust.wasmOn, 'a capture is taken by the page').toBe(false)
    expect(rust.engine).toBe('exact')
  })

  it('steps back over clock edges in the Rust engine: the same nets, parts and RAM as the TypeScript engine, forward and back again', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
      sim.setFast(true)
      sim.setWasm(rust ? openFor(x) : null)
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
    expect(rust.wasmOn, 'the exact engine in Rust has it').toBe(true)
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
      const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
      sim.setFast(true)
      sim.setHistory(false)
      sim.setWasm(rust ? openFor(x) : null)
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
  }, 30_000) // (400 edges on both engines of a big example: over the default 5 s on a loaded CI runner)
})

describe('every example the Rust engine takes', () => {
  /** How many examples the module takes, so that a part that loses its port (or a new one that gains it) shows up; raise it as parts are ported. */
  const TAKEN_AT_LEAST = 16

  it('gives the same nets as the TypeScript engine after every clock edge, for each example it takes', async () => {
    const x = await module()
    const taken: string[] = []
    const missing = new Map<string, number>()
    for (const ex of EXAMPLES) {
      const mk = (rust: boolean) => {
        const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
        sim.setFast(true)
        sim.setWasm(rust ? openFor(x) : null)
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
      // and the screens they drew
      // (`tapped` is a note for the page that the module does not keep; `rev` only says that something changed, so that the symbol is drawn again: the module's screen counts the changes between two looks as one)
      const look = (s: Simulator, id: string) => JSON.stringify(s.state(id), (k, v) => (k === 'rev' || k === 'tapped' ? undefined : v))
      for (const type of ['framebuffer', 'console', 'keypad']) for (const id of plain.idsOfType(type)) expect(look(rust, id), `${ex.id} ${id}`).toBe(look(plain, id))
    }
    console.log(`Rust engine takes ${taken.length} examples: ${taken.join(' ')}`)
    console.log('parts that keep examples out:', [...missing].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '))
    expect(taken.length).toBeGreaterThanOrEqual(TAKEN_AT_LEAST)
  }, 600000)
})

describe('the exact (unit-delay) engine in Rust', () => {
  it('gives the same nets after every gate delay as the TypeScript exact engine, for each example', async () => {
    const x = await module()
    let taken = 0
    for (const ex of EXAMPLES) {
      const mk = (rust: boolean) => {
        const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
        sim.setFast(false)
        sim.setWasm(rust ? openFor(x) : null)
        sim.load(flatten(ex.build()))
        sim.settle()
        return sim
      }
      const rust = mk(true)
      const plain = mk(false)
      if (!rust.wasmOn) continue
      taken++
      for (let i = 0; i < 60; i++) {
        rust.stepClock()
        plain.stepClock()
        for (let k = 0; k < 3; k++) {
          const a = rust.tick()
          const b = plain.tick()
          expect(a, `${ex.id}: moving after tick ${k} of edge ${i}`).toBe(b)
          const va = rust.viewValues()
          const vb = plain.viewValues()
          for (let n = 0; n < va.length; n++) if (va[n] !== vb[n]) throw new Error(`${ex.id}: net ${n} is ${va[n]} with Rust and ${vb[n]} without, tick ${k} of edge ${i}`)
        }
      }
    }
    console.log(`Rust exact engine takes ${taken} examples`)
    expect(taken).toBeGreaterThan(30)
  }, 600000)
})

describe('circuits without a clock in Rust', () => {
  it('give the same nets as the TypeScript engine as the switches are flipped, for every example', async () => {
    const x = await module()
    let taken = 0
    for (const ex of EXAMPLES) {
      const mk = (rust: boolean) => {
        const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
        sim.setWasm(rust ? openFor(x) : null)
        sim.load(flatten(ex.build()))
        sim.settle()
        return sim
      }
      const rust = mk(true)
      const plain = mk(false)
      if (plain.hasClocks || !rust.wasmOn) continue
      taken++
      for (const id of plain.idsOfType('switch')) {
        for (const sim of [rust, plain]) {
          const params = (sim as unknown as { byId: Map<string, { inst: { params: Record<string, unknown> } }> }).byId.get(id)!.inst.params
          sim.setParams(id, { ...params, on: !params.on })
          sim.settle()
        }
        const a = rust.viewValues()
        const b = plain.viewValues()
        for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) throw new Error(`${ex.id}: net ${n} is ${a[n]} with Rust and ${b[n]} without, after flipping ${id}`)
      }
    }
    console.log(`${taken} examples without a clock run in Rust`)
    expect(taken).toBeGreaterThan(10)
  }, 300000)
})

describe('the exact engine in Rust: loops, delays, forces and capture', () => {
  const circuit = (): SimCircuit => {
    const comps: [string, string, Params, number?][] = [
      ['clk', 'clock', { hz: 4 }], ['s', 'switch', { on: false }], ['r', 'switch', { on: false }],
      ['n1', 'not', {}, 3], ['a1', 'and', {}], ['led', 'led', {}],
      ['q', 'nor', {}], ['qn', 'nor', {}], ['o1', 'not', {}, 2], ['dd', 'dff', {}],
    ]
    const wires: [string, string][] = [
      ['clk.Q', 'n1.A'], ['n1.Y', 'a1.A'], ['clk.Q', 'a1.B'], ['a1.Y', 'led.A'],
      ['r.Q', 'q.A'], ['qn.Y', 'q.B'], ['s.Q', 'qn.A'], ['q.Y', 'qn.B'],
      ['q.Y', 'dd.D'], ['clk.Q', 'dd.CLK'], ['dd.Q', 'o1.A'],
    ]
    return {
      comps: comps.map(([id, type, params, delay]) => ({ id, type, params: { ...paramDefaults(getDef(type)), ...params }, ...(delay ? { delay } : {}) })),
      wires: wires.map(([f, t]) => {
        const [fc, fp] = f.split('.')
        const [tc, tp] = t.split('.')
        return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
      }),
    }
  }
  it('keeps step with the TypeScript exact engine through edges, switches, a force and a capture', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
      sim.setWasm(rust ? openFor(x) : null)
      sim.load(circuit())
      sim.settle()
      return sim
    }
    const rust = mk(true)
    const plain = mk(false)
    expect(rust.wasmOn).toBe(true)
    const same = (what: string) => {
      const a = rust.viewValues()
      const b = plain.viewValues()
      for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) throw new Error(`${what}: net ${n} is ${a[n]} with Rust and ${b[n]} without`)
    }
    const both = (f: (s: Simulator) => void) => {
      f(rust)
      f(plain)
    }
    for (let i = 0; i < 30; i++) {
      both((s) => s.stepClock())
      same(`edge ${i}`)
      if (i === 5) both((s) => s.setParams('s', { ...paramDefaults(getDef('switch')), on: true }))
      if (i === 8) both((s) => s.setParams('s', { ...paramDefaults(getDef('switch')), on: false }))
      if (i === 10) both((s) => s.force('n1', 'Y', 1))
      if (i === 14) both((s) => s.force('n1', 'Y', null))
      if (i === 16) both((s) => s.setCapture(true))
      if (i === 20) both((s) => s.setCapture(false))
      if (i % 3 === 0) {
        for (let k = 0; k < 4; k++) {
          expect(rust.tick(), `moving at tick ${k} of edge ${i}`).toBe(plain.tick())
          same(`tick ${k} of edge ${i}`)
        }
      }
    }
    expect(rust.wasmOn || rust.engine === 'exact').toBe(true)
  })
})

describe('single parts in the Rust engine, against the TypeScript engine, with unknown inputs and random switches', () => {
  /** A deterministic random generator (mulberry32). */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const CASES: [string, Record<string, string | number | boolean>][] = [
    ['srlatch', {}], ['dlatch', {}], ['jkff', {}],
    ['counter', { mod: 10 }], ['counter', { mod: 16 }], ['counter', { mod: 3 }],
    ['counterld', {}], ['register', {}], ['shiftreg', {}],
    ['add4', {}], ['cmp4', {}], ['alu', {}], ['mul', { n: 2 }], ['mul', { n: 4 }],
    ['decoder', { n: 2 }], ['decoder', { n: 3 }], ['decoder', { n: 4 }], ['encoder', { n: 4 }], ['encoder', { n: 8 }],
    ['bcd7', { mode: 'bcd' }], ['bcd7', { mode: 'hex' }], ['bcddec', {}],
    ['halfadd', {}], ['fulladd', {}], ['halfsub', {}], ['fullsub', {}], ['sub4', {}], ['addsub4', {}],
    ['tribuf', {}], ['tribuf', { bits: 4 }], ['busjoin', {}], ['busjoin', { drivers: 4, bits: 3, pull: '1' }], ['busjoin', { pull: '0' }],
    ['via6522', {}],
    ['demux', { n: 2 }], ['demux', { n: 4 }], ['demux', { n: 8 }], ['ringcounter', {}], ['ringcounter', { kind: 'johnson' }],
    ['bussub', { bits: 4 }], ['bussub', { bits: 8 }], ['busaddsub', { bits: 4 }], ['busaddsub', { bits: 8 }], ['busaddsub', { bits: 16 }],
    ['gray', {}], ['gray', { dir: 'g2b' }], ['parity', { n: 4 }], ['parity', { n: 8 }],
    ['lut', {}], ['lut', { inputs: 4, outputs: 4, data: '1 2 3 4 5 6 7 8 9 A B C D E F 0' }], ['lut', { inputs: 2, outputs: 8, data: 'AB CD' }],
    ['netrecv', {}], ['netrecv', { bits: 4 }],
    ['cpu6502', {}], ['cpu6502', { chip: 'cmos' }], ['cpu6502', { tristate: true }],
    ['hd44780', {}], ['hd44780', { busy: 'short' }], ['hd44780', { busy: 'none' }],
    ['bcdadd', {}],
    ['bin2bcd', {}],
    ['tff', {}],
    ['rom', { abits: 4, dbits: 8, data: '12 34 56 78 9A BC DE F0 01 23 45 67 89 AB CD EF', table: 'on', tdata: 'AA 55 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E' }],
    ['rom', { abits: 6, dbits: 16, data: '1234 5678 9ABC DEF0', table: 'on', tdata: '10 20 30' }],
    ['framebuffer', {}],
    ['framebuffer', { colors: 4, read: 'on' }],
    ['console', {}],
    ['keypad', {}],
    ['keypad', { sticky: true }],
  ]
  for (const [type, params] of CASES) {
    it(`${type} ${JSON.stringify(params).slice(0, 40)}`, async () => {
      const x = await module()
      for (let seed = 1; seed <= 16; seed++) {
        const r = rng(seed * 7919)
        const b = new CircuitBuilder()
        const clk = b.add('clock', 0, 0)
        const part = b.add(type, 200, 0, { params })
        const pins = layoutOf(type, b.c.comps[part].params).pins
        const switches: string[] = []
        let clocked = false
        for (const pin of pins.filter((q) => q.dir === 'in')) {
          if (pin.clock && !clocked) {
            b.wire(`${clk}.Q`, `${part}.${pin.name}`)
            clocked = true
          } else if (r() < 0.8) {
            // (the rest stay unconnected: unknown, or the pin's own default)
            const sw = b.add('switch', 0, 100 + switches.length * 40, { params: { on: r() < 0.5 } })
            switches.push(sw)
            b.wire(`${sw}.Q`, `${part}.${pin.name}`)
          }
        }
        if (!clocked) {
          const led = b.add('led', 100, 0)
          b.wire(`${clk}.Q`, `${led}.A`)
        }
        const mk = (rust: boolean) => {
          const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
          sim.setFast(true)
          sim.setHistory(false)
          sim.setWasm(rust ? openFor(x) : null)
          sim.load(flatten(b.c))
          sim.settle()
          return sim
        }
        const rust = mk(true)
        const plain = mk(false)
        for (let step = 0; step < 120; step++) {
          if (step % 3 === 0 && switches.length) {
            const sw = switches[Math.floor(r() * switches.length)]
            const on = r() < 0.5
            for (const sim of [rust, plain]) sim.setParams(sw, { on })
          }
          // (a keypad is pressed and let go from the page, which hands the circuit to the page for that moment)
          if (type === 'keypad' && step % 5 === 1) for (const sim of [rust, plain]) sim.setState(part, { pressed: step % 10 === 1, key: step % 16 })
          // a quick tap: down and up again before anything was evaluated (the canvas says so with `tapped`)
          if (type === 'keypad' && step % 7 === 3) for (const sim of [rust, plain]) {
            sim.setState(part, { pressed: true, tapped: true, key: step % 16 })
            sim.setState(part, { pressed: false })
          }
          rust.stepClock()
          plain.stepClock()
          if (step === 0) expect(rust.wasmOn, `${type} is taken`).toBe(true)
          // what the part keeps (the screens, the keys) is the same, too
          const noNote = (_: string, v: unknown) => (_ === 'tapped' ? undefined : v) // (a note for the page that the module does not keep)
          expect(JSON.stringify(rust.state(part), noNote), `${type} seed ${seed} step ${step}: state`).toBe(JSON.stringify(plain.state(part), noNote))
          const a = rust.viewValues()
          const c = plain.viewValues()
          for (let n = 0; n < a.length; n++) if (a[n] !== c[n]) throw new Error(`${type} seed ${seed} step ${step}: net ${n} is ${a[n]} with Rust and ${c[n]} without`)
        }
      }
    })
  }
})

describe('stepping back in the Rust engine over a pixel screen', () => {
  it('computer-ant: the pixels and the nets go back with the clock, as in the TypeScript engine', async () => {
    const x = await module()
    const mk = (rust: boolean) => {
      const sim = (rust ? new Simulator() : new OracleSimulator()) as unknown as Simulator
      sim.setFast(true)
      sim.setWasm(rust ? openFor(x) : null)
      sim.load(flatten(EXAMPLES.find((e) => e.id === 'computer-ant')!.build()))
      sim.settle()
      return sim
    }
    const rust = mk(true)
    const plain = mk(false)
    const look = (s: Simulator) => JSON.stringify([Array.from(s.viewValues()), s.time, s.idsOfType('framebuffer').map((id) => (s.state(id) as { px: number[] }).px)])
    const drawn = (sim: Simulator) => sim.idsOfType('framebuffer').some((id) => (sim.state(id) as { px: number[] }).px.some((v) => v > 0))
    for (let i = 0; i < 6000 && !drawn(plain); i++) {
      rust.stepClock()
      plain.stepClock()
    }
    for (let i = 0; i < 200; i++) {
      rust.stepClock()
      plain.stepClock()
    }
    expect(drawn(plain), 'something was drawn').toBe(true)
    expect(rust.wasmOn, 'the Rust engine runs it with the history on').toBe(true)
    for (let i = 0; i < 300; i++) {
      expect(rust.stepBack()).toBe(plain.stepBack())
      if (i % 10 === 0) expect(look(rust), `step back ${i + 1}`).toBe(look(plain))
    }
    expect(look(rust)).toBe(look(plain))
  }, 120000)
})
