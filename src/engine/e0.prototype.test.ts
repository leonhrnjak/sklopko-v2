import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { micro6502 } from '../model/micro6502'
import { Simulator } from './simulator'

/**
 * Step E0 of docs/spec-sim-wasm.md: a throw-away prototype. The fast engine's settle loop and the parts of the microcoded 6502 board
 * ('leds', no terminal) in Rust (engine-rs-prototype/), checked net for net against the TypeScript fast engine, and timed.
 *
 *   cd engine-rs-prototype && cargo build --release --target wasm32-unknown-unknown
 *   VITE_E0=1 npx vitest run src/engine/e0.prototype --silent=false
 */
const on = !!import.meta.env.VITE_E0
const WASM = 'engine-rs-prototype/target/wasm32-unknown-unknown/release/engine_rs.wasm'

const KIND: Record<string, number> = { and: 1, or: 2, xor: 3, nand: 4, nor: 5, xnor: 6, not: 7, buf: 8, mux: 9, busmux: 10, busadd: 11, busreg: 12, busctr: 13, busgate: 14, buscmp: 15, dff: 16, rom: 17, ram: 18, clock: 19 }
const NOP = new Set(['busconst', 'const', 'button', 'switch', 'led', 'note', 'frame', 'busdisp', 'netsend', 'bar'])
const GOP: Record<string, number> = { and: 0, or: 1, xor: 2, nand: 3, nor: 4, xnor: 5, not: 6 }
const log2 = (n: number) => Math.round(Math.log2(n))

// oxlint-disable-next-line no-explicit-any
type Any = any

/** Everything the Rust engine needs, from a loaded simulator that has settled, as one array of i32. */
function exportImage(sim: Simulator) {
  const s = sim as Any
  const comps = s.comps as Any[]
  const plan = s.plan as { order: Int32Array; rank: Int32Array }
  const img: number[] = []
  const push = (...v: number[]) => img.push(...v)
  const mem: number[] = []
  const nParts = comps.length
  const outNets: number[] = []
  const rows: number[][] = []
  let clock = -1
  const seen = new Set<string>()
  comps.forEach((cc, i) => {
    const type = cc.def.type as string
    const p = cc.inst.params
    const st = cc.inst.state
    let kind = 0
    let p0 = 0
    let p1 = 0
    let p2 = 0
    let memOff = 0
    let n = 0
    let pc = 0
    let q = 0
    if (KIND[type] !== undefined) {
      kind = KIND[type]
      if (type === 'mux') {
        p0 = Number(p.n)
        p1 = log2(p0)
      } else if (type === 'busmux') {
        p0 = Number(p.bits)
        p1 = Number(p.n)
        p2 = log2(p1)
      } else if (type === 'busadd' || type === 'buscmp') p0 = Number(p.bits)
      else if (type === 'busgate') {
        p0 = Number(p.bits)
        p1 = GOP[String(p.op)]
      } else if (type === 'rom') {
        expect(p.table === 'on', 'rom table').toBe(false)
        p0 = Number(p.abits)
        p1 = Number(p.dbits)
        memOff = mem.length
        for (let a = 0; a < 2 ** p0; a++) {
          const ins = Array.from({ length: p0 }, (_, b) => (a >> b) & 1)
          const outs = new Array(p1).fill(2)
          cc.def.evaluate({ ins, outs, state: undefined, params: p })
          mem.push(outs.reduce((w: number, v: number, b: number) => w | (v << b), 0))
        }
      } else if (type === 'ram') {
        p0 = Number(p.dbits)
        p1 = Number(p.abits)
        memOff = mem.length
        for (const w of st.mem as Uint8Array) mem.push(w)
        pc = st.pc
      } else if (type === 'dff') {
        q = st.q
        pc = st.pc
      } else if (type === 'busreg' || type === 'busctr') {
        p0 = Number(p.bits)
        n = st.n
        pc = st.pc
      } else if (type === 'clock') {
        expect(clock, 'one clock').toBe(-1)
        clock = i
        q = st.phase
      }
    } else if (!NOP.has(type)) {
      throw new Error(`the prototype has no ${type}`)
    }
    seen.add(type)
    rows.push([kind, cc.inst.ins.byteOffset, cc.inNets.length, outNets.length, cc.outNets.length, p0, p1, p2, memOff, n, pc, q])
    for (const net of cc.outNets) outNets.push(net)
  })
  const values: Uint8Array = s.values
  const pins: Uint8Array = s.pins
  const readerStart: Int32Array = s.readerStart
  const readerPart: Int32Array = s.readerPart
  const readerSlot: Int32Array = s.readerSlot
  const readerWake: Uint8Array = s.readerWake
  push(nParts, values.length, pins.length, outNets.length, readerPart.length, plan.order.length, mem.length, clock)
  for (const v of values) push(v)
  for (const v of pins) push(v)
  for (const r of rows) push(...r)
  for (const v of outNets) push(v)
  for (const v of readerStart) push(v)
  for (const v of readerPart) push(v)
  for (const v of readerSlot) push(v)
  for (const v of readerWake) push(v)
  for (const v of plan.order) push(v)
  for (const v of plan.rank) push(v)
  for (const v of mem) push(v)
  return { image: Int32Array.from(img), clock, types: [...seen] }
}

async function load(sim: Simulator) {
  const { image } = exportImage(sim)
  // (a computed name: this throw-away test is the only file that reads from disk, and the app's types do not include Node's)
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(WASM), {})
  const x = instance.exports as Any
  const ptr = x.alloc(image.byteLength) as number
  new Int32Array(x.memory.buffer, ptr, image.length).set(image)
  x.init(ptr, image.length)
  return x
}

function fresh() {
  const sim = new Simulator()
  sim.setFast(true)
  sim.setHistory(false)
  sim.load(flatten(micro6502()))
  sim.settle()
  expect(sim.engine).toBe('fast')
  return sim
}

describe.skipIf(!on)('E0: the fast engine in Rust (docs/spec-sim-wasm.md)', () => {
  it('agrees with the TypeScript fast engine, net for net, after every clock edge', async () => {
    const sim = fresh()
    const x = await load(sim)
    const s = sim as Any
    const nets = s.values.length as number
    const edges = 20000
    let bad = 0
    for (let e = 0; e < edges; e++) {
      sim.stepClock()
      bad += x.edges(1)
      const a = s.values as Uint8Array
      const b = new Uint8Array(x.memory.buffer, x.values_ptr(), nets)
      for (let n = 0; n < nets; n++) if (a[n] !== b[n]) throw new Error(`edge ${e}: net ${n} is ${a[n]} in TypeScript and ${b[n]} in Rust`)
    }
    expect(bad).toBe(0)
    // The state of the parts agrees, too (registers, counters, flip-flops, the RAM).
    const comps = s.comps as Any[]
    const stN = new Int32Array(x.memory.buffer, x.st_n_ptr(), comps.length)
    const stQ = new Uint8Array(x.memory.buffer, x.st_q_ptr(), comps.length)
    const ram = comps.find((cc) => cc.def.type === 'ram')!.inst.state.mem as Uint8Array
    const rom = comps.filter((cc) => cc.def.type === 'rom')
    const romWords = rom.reduce((n, cc) => n + 2 ** Number(cc.inst.params.abits), 0)
    const mem = new Uint16Array(x.memory.buffer, x.mem_ptr(), romWords + ram.length)
    let ramWords = 0
    comps.forEach((cc, i) => {
      const t = cc.def.type
      if (t === 'busreg' || t === 'busctr') expect(stN[i], `${t} ${i}`).toBe(cc.inst.state.n)
      if (t === 'dff') expect(stQ[i], `dff ${i}`).toBe(cc.inst.state.q)
    })
    // (the RAM is the last memory in the image: compare it by value)
    for (let a = 0; a < ram.length; a++) {
      expect(mem[romWords + a], `ram[${a}]`).toBe(ram[a])
      ramWords++
    }
    console.log(`E0: ${edges} edges agree on all ${nets} nets; ${ramWords} RAM words and the registers agree too`)
  }, 120000)

  it('timing', async () => {
    const reps = 5
    const edges = 200000
    const ts: number[] = []
    const rs: number[] = []
    for (let r = 0; r < reps; r++) {
      const sim = fresh()
      for (let i = 0; i < 4000; i++) sim.stepClock()
      let t0 = performance.now()
      for (let i = 0; i < edges; i++) sim.stepClock()
      ts.push(edges / 2 / (performance.now() - t0) * 1000)
      const x = await load(fresh())
      x.edges(4000)
      t0 = performance.now()
      x.edges(edges)
      rs.push(edges / 2 / (performance.now() - t0) * 1000)
    }
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
    console.log(`E0 cycles/s: TypeScript fast engine ${ts.map((v) => v.toFixed(0)).join(' ')} (median ${med(ts).toFixed(0)}); Rust ${rs.map((v) => v.toFixed(0)).join(' ')} (median ${med(rs).toFixed(0)}); ratio ${(med(rs) / med(ts)).toFixed(2)}x`)
  }, 300000)
})
