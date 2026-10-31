import { aciaAccepted, aciaPut, aciaWipe, KEYBOARD_MAX, type AciaState } from './acia'
import type { EngineExports } from './wasm'
import type { Instance, Params, ComponentDef } from './types'

/**
 * The simulator's fast engine in Rust (docs/spec-sim-wasm.md): `WasmEngine` loads a compiled circuit (`Simulator.compiled()`) into the
 * WebAssembly module, runs clock edges there, and reads what changed out of the module's memory. It follows the TypeScript fast engine
 * step for step (`settleFast`), so the two give the same nets after every clock edge; src/engine/lockstep.test.ts checks that.
 *
 * Only circuits made of parts that the module has are taken (`supports`): the others stay on the TypeScript engines.
 */

/** What the module needs to know of a compiled part. */
interface CompiledPart {
  id: string
  def: Pick<ComponentDef, 'type' | 'evaluate'>
  inst: Instance
  inNets: Int32Array
  outNets: Int32Array
}

/** The simulator's compiled circuit (see `Simulator.compiled`). */
export interface Compiled {
  comps: CompiledPart[]
  values: Uint8Array
  pins: Uint8Array
  readerStart: Int32Array
  readerPart: Int32Array
  readerSlot: Int32Array
  readerWake: Uint8Array
  /** The plan: the parts that are not registered in order, and the position of each in it (-1 for a registered part). */
  order: Int32Array
  rank: Int32Array
}

/** The kinds of part, as engine-rs/src/engine.rs numbers them. */
const KIND: Record<string, number> = {
  and: 1, or: 2, xor: 3, nand: 4, nor: 5, xnor: 6, not: 7, buf: 8, mux: 9, busmux: 10, busadd: 11, busreg: 12, busctr: 13, busgate: 14,
  buscmp: 15, dff: 16, rom: 17, ram: 18, clock: 19, acia6551: 20, bcdadd: 21, bin2bcd: 22, tff: 23,
}
/** Parts that put nothing on a net after the circuit has settled, or never change what they put (constants, labels, displays). */
const NOP = new Set(['busconst', 'const', 'button', 'switch', 'led', 'note', 'frame', 'busdisp', 'netsend', 'bar', 'hexdisp', 'seg7', 'dicedisp', 'hexin', 'busin', 'gamepad'])
/** Parts with no outputs that look at the settled nets after every settle (`sample`): the Simulator runs them itself, on the page's side. */
const SAMPLERS = new Set(['probe', 'breakpoint', 'matrix', 'speaker'])
/** busgate's gates, as engine.rs numbers them. */
const GATE: Record<string, number> = { and: 0, or: 1, xor: 2, nand: 3, nor: 4, xnor: 5, not: 6 }

const log2 = (n: number) => Math.round(Math.log2(n))

/** Terminal state, as the page keeps it for drawing (`TerminalState` in components/terminal.ts). */
type TerminalState = AciaState & { pc: number; out: number }

/** Can the module run this circuit? (Every part has a version in Rust, with the settings it handles.) */
export function supports(c: Compiled): boolean {
  return c.comps.filter((cc) => cc.def.type === 'clock').length === 1 && c.comps.every(ported)
}

/** Does the module have this part (with these settings)? */
export function ported(cc: CompiledPart): boolean {
  const type = cc.def.type
  const p = cc.inst.params
  if (type === 'ram') return Number(p.dbits) <= 8 && Number(p.abits) <= 15
  return type === 'clock' || KIND[type] !== undefined || NOP.has(type) || (SAMPLERS.has(type) && cc.inst.outs.length === 0)
}

const romCache = new WeakMap<Params, number[]>()
const tableCache = new WeakMap<Params, number[]>()

/** The words of a ROM, found by asking the part itself for each address (kept for as long as the part's params are the same object). */
function romWords(def: CompiledPart['def'], p: Params): number[] {
  const known = romCache.get(p)
  if (known) return known
  const words = romWordsOf(def, p)
  romCache.set(p, words)
  return words
}

/** The 256 bytes behind a ROM's table port, found the same way. */
function romTable(def: CompiledPart['def'], p: Params): number[] {
  const known = tableCache.get(p)
  if (known) return known
  const abits = Number(p.abits)
  const dbits = Number(p.dbits)
  const bytes: number[] = []
  for (let t = 0; t < 256; t++) {
    const ins = [...new Array<0 | 1 | 2 | 3>(abits).fill(0), ...Array.from({ length: 8 }, (_, b) => ((t >> b) & 1) as 0 | 1)]
    const outs = new Array<0 | 1 | 2 | 3>(dbits + 8).fill(2)
    def.evaluate({ ins, outs, state: undefined, params: p })
    bytes.push(outs.slice(dbits).reduce<number>((w, v, b) => w | (v << b), 0))
  }
  tableCache.set(p, bytes)
  return bytes
}

function romWordsOf(def: CompiledPart['def'], p: Params): number[] {
  const abits = Number(p.abits)
  const dbits = Number(p.dbits)
  const words: number[] = []
  for (let a = 0; a < 2 ** abits; a++) {
    // (with a table port, its address is held at 0)
    const ins: (0 | 1 | 2 | 3)[] = Array.from({ length: abits }, (_, b) => ((a >> b) & 1) as 0 | 1)
    if (p.table === 'on') for (let b = 0; b < 8; b++) ins.push(0)
    const outs = new Array<0 | 1 | 2 | 3>(dbits + (p.table === 'on' ? 8 : 0)).fill(2)
    def.evaluate({ ins, outs, state: undefined, params: p })
    words.push(outs.slice(0, dbits).reduce<number>((w, v, b) => w | (v << b), 0))
  }
  return words
}

/** What `Simulator.setWasm` takes: the engine for a compiled circuit, or null when a part of it is not in the module. */
export const openFor = (x: EngineExports) => (c: Compiled) => (supports(c) ? new WasmEngine(x, c) : null)

export class WasmEngine {
  private x: EngineExports
  private c: Compiled
  /** The part number of the clock. */
  readonly clock: number
  /** The terminals, in part order: the part, and its state (the screen is kept there). */
  private terminals: { part: number; st: TerminalState }[] = []
  /** The part number of each RAM, with where its words start in the module's RAM. */
  private rams: { part: number; start: number }[] = []
  /** The bytes of all the RAMs together. */
  private ramBytes = 0
  private buffer: ArrayBuffer | null = null
  private valuesView = new Uint8Array(0)
  private pinsView = new Uint8Array(0)

  constructor(x: EngineExports, c: Compiled) {
    this.x = x
    this.c = c
    const img: number[] = []
    const push = (v: number) => img.push(v)
    const rom: number[] = []
    const ram: number[] = []
    const outNets: number[] = []
    const rows: number[][] = []
    let clock = -1
    c.comps.forEach((cc, i) => {
      const type = cc.def.type
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
        p1 = GATE[String(p.op)]
      } else if (type === 'busreg' || type === 'busctr') {
        p0 = Number(p.bits)
        n = st.n
        pc = st.pc
      } else if (type === 'dff' || type === 'tff') {
        q = st.q
        pc = st.pc
      } else if (type === 'rom') {
        p0 = Number(p.abits)
        p1 = Number(p.dbits)
        p2 = p.table === 'on' ? 1 : 0
        memOff = rom.length
        for (const w of romWords(cc.def, p)) rom.push(w)
        // A table port (TA in, TD out) reads 256 more bytes, which follow the words.
        if (p2) for (const w of romTable(cc.def, p)) rom.push(w)
      } else if (type === 'ram') {
        p0 = Number(p.dbits)
        p1 = Number(p.abits)
        memOff = ram.length
        this.rams.push({ part: i, start: ram.length })
        for (const w of st.mem as Uint8Array) ram.push(w)
        this.ramBytes += (st.mem as Uint8Array).length
        pc = st.pc
      } else if (type === 'clock') {
        clock = i
        q = st.phase
      } else if (type === 'acia6551') {
        memOff = this.terminals.length
        this.terminals.push({ part: i, st })
      }
      kind = KIND[type] ?? 0
      rows.push([kind, (cc.inst.ins as unknown as Uint8Array).byteOffset, cc.inNets.length, outNets.length, cc.outNets.length, p0, p1, p2, memOff, n, pc, q])
      for (const net of cc.outNets) outNets.push(net)
    })
    this.clock = clock
    push(c.comps.length)
    push(c.values.length)
    push(c.pins.length)
    push(outNets.length)
    push(c.readerPart.length)
    push(c.order.length)
    push(rom.length)
    push(ram.length)
    push(clock)
    push(this.terminals.length)
    for (const v of c.values) push(v)
    for (const v of c.pins) push(v)
    for (const r of rows) for (const v of r) push(v)
    for (const v of outNets) push(v)
    for (const v of c.readerStart) push(v)
    for (const v of c.readerPart) push(v)
    for (const v of c.readerSlot) push(v)
    for (const v of c.readerWake) push(v)
    for (const v of c.order) push(v)
    for (const v of c.rank) push(v)
    for (const v of rom) push(v)
    for (const v of ram) push(v)
    for (const { st, part } of this.terminals) {
      push(c.comps[part].inst.params.resetClears === false ? 0 : 1)
      for (const v of [st.command, st.control, st.rx, st.full ? 1 : 0, st.interrupt ? 1 : 0, st.pc, st.out]) push(v)
    }
    const image = Int32Array.from(img)
    const ptr = x.alloc(image.byteLength)
    new Int32Array(x.memory.buffer, ptr, image.length).set(image)
    x.init(ptr, image.length)
    // The keyboard: what waits in a terminal's buffer goes into the module's queue.
    this.terminals.forEach(({ st }, k) => {
      for (let i = st.next; i < st.keys.length; i++) x.acia_key(k, st.keys.charCodeAt(i))
    })
  }

  /** The module's memory can move when it grows: views made on an old buffer are stale. */
  private views() {
    const buffer = this.x.memory.buffer
    if (buffer !== this.buffer) {
      this.buffer = buffer
      this.valuesView = new Uint8Array(buffer, this.x.values_ptr(), this.c.values.length)
      this.pinsView = new Uint8Array(buffer, this.x.pins_ptr(), this.c.pins.length)
    }
  }

  /** The nets, in the module's memory (live: the next edge changes them). */
  get values(): Uint8Array {
    this.views()
    return this.valuesView
  }

  /** The input pins of all parts, in the module's memory. */
  get pins(): Uint8Array {
    this.views()
    return this.pinsView
  }

  /** The clock changes and the circuit settles. Returns false if it did not settle. */
  edge(): boolean {
    return this.x.edge(this.clock) === 1
  }

  /** The clock part (any clock; there is one) shows `phase`: it is evaluated at the next `settle`. */
  setPhase(part: number, phase: number) {
    this.x.set_phase(part, phase)
  }

  /** Settle the circuit. Returns false if it did not within 64 rounds. */
  settle(): boolean {
    return this.x.settle() === 1
  }

  /** How many registered rounds the module has run (the engine's `ticks`). */
  get ticks(): number {
    return this.x.ticks()
  }

  /** Which terminal of the module the part with this number in `comps` is, or -1. */
  terminalOf(part: number): number {
    return this.terminals.findIndex((t) => t.part === part)
  }

  /** `n` clock edges in a row. Returns how many did not settle. */
  edges(n: number): number {
    return this.x.edges(n)
  }

  /**
   * What the page keeps of each part's state, brought up to date from the module (registers, counters, flip-flops, RAM, the terminals'
   * registers), and the screen events printed. The nets are not copied: `values` is the module's own.
   */
  syncOut() {
    const { x } = this
    const buf = x.memory.buffer
    const comps = this.c.comps
    const n = new Int32Array(buf, x.st_n_ptr(), comps.length)
    const pc = new Uint8Array(buf, x.st_pc_ptr(), comps.length)
    const q = new Uint8Array(buf, x.st_q_ptr(), comps.length)
    comps.forEach((cc, i) => {
      const type = cc.def.type
      const st = cc.inst.state
      if (type === 'busreg' || type === 'busctr') {
        st.n = n[i]
        st.pc = pc[i]
      } else if (type === 'dff' || type === 'tff') {
        st.q = q[i]
        st.pc = pc[i]
      } else if (type === 'ram') st.pc = pc[i]
    })
    if (this.rams.length) {
      const total = this.rams.reduce((t, r) => t + (comps[r.part].inst.state.mem as Uint8Array).length, 0)
      const ram = new Uint8Array(buf, x.ram_ptr(), total)
      for (const { part, start } of this.rams) {
        const mem = comps[part].inst.state.mem as Uint8Array
        mem.set(ram.subarray(start, start + mem.length))
      }
    }
    this.terminals.forEach(({ st }, k) => {
      const r = new Uint8Array(buf, x.acia_regs_ptr(k), 8)
      st.command = r[0]
      st.control = r[1]
      st.rx = r[2]
      st.full = r[3] !== 0
      st.interrupt = r[4] !== 0
      st.pc = r[5]
      st.out = r[6]
      const events = x.acia_take_events(k)
      if (events) {
        const list = new Uint16Array(x.memory.buffer, x.acia_events_ptr(k), events)
        for (let i = 0; i < events; i++) {
          if (list[i] === 256) aciaWipe(st)
          else aciaPut(st, list[i])
        }
      }
      // What waits on the keyboard is in the module: the page keeps a copy of it (the inspector shows how much).
      const pending = x.acia_pending(k)
      st.keys = pending ? String.fromCharCode(...new Uint8Array(x.memory.buffer, x.acia_queue_ptr(k), pending)) : ''
      st.next = 0
    })
  }

  /**
   * Everything the module keeps that changes while it runs, as one copy: the nets, the input pins, the registers, counters and
   * flip-flops, and the RAM (not the terminals: a circuit with one does not keep its history in the module). It is what stepping back
   * goes back to (`load`), and does not depend on this engine object, only on the circuit being the same.
   */
  save(): Uint8Array {
    this.views()
    const { x } = this
    const buf = x.memory.buffer
    const n = this.c.comps.length
    const parts = [
      this.valuesView,
      this.pinsView,
      new Uint8Array(buf, x.st_n_ptr(), n * 4),
      new Uint8Array(buf, x.st_pc_ptr(), n),
      new Uint8Array(buf, x.st_q_ptr(), n),
      new Uint8Array(buf, x.ram_ptr(), this.ramBytes),
    ]
    const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }

  /** Put back what `save` took (of this circuit). The nets and pins come back in `values` and `pins`. */
  load(blob: Uint8Array) {
    this.views()
    const { x } = this
    const buf = x.memory.buffer
    const n = this.c.comps.length
    const parts = [
      this.valuesView,
      this.pinsView,
      new Uint8Array(buf, x.st_n_ptr(), n * 4),
      new Uint8Array(buf, x.st_pc_ptr(), n),
      new Uint8Array(buf, x.st_q_ptr(), n),
      new Uint8Array(buf, x.ram_ptr(), this.ramBytes),
    ]
    let at = 0
    for (const p of parts) {
      p.set(blob.subarray(at, at + p.length))
      at += p.length
    }
  }

  /** Type or paste text on terminal `k`; returns how many characters were taken (`aciaType`, with the queue in the module). */
  type(k: number, text: string, capitals = true): number {
    const s = aciaAccepted({ keys: '\0'.repeat(this.x.acia_pending(k)), next: 0 } as AciaState, text, capitals)
    for (let i = 0; i < s.length; i++) this.x.acia_key(k, s.charCodeAt(i))
    return s.length
  }

  /** A key that is not a character (`aciaKey`). */
  key(k: number, code: number) {
    if (this.x.acia_pending(k) < KEYBOARD_MAX) this.x.acia_key(k, code)
  }

  /** Control+C (`aciaBreak`): what waits is thrown away, and the break is next. */
  stop(k: number) {
    this.x.acia_clear_keys(k)
    this.x.acia_key(k, 3)
  }
}
