import { aciaAccepted, aciaPut, aciaWipe, KEYBOARD_MAX, type AciaState } from './acia'
import { consolePut, type ConsoleState, type FramebufferState } from './components/devices'
import type { CpuState } from './components/cpu'
import { parseWords } from './components/memory'
import { ramBits } from './components/sequential'
import type { LcdPartState } from './components/lcd'
import type { ViaPartState } from './components/via'
import type { VideoState } from './components/video'
import { BY_OPCODE_65C02 } from './opcodes65c02'
import { BY_OPCODE_6502, type Opcode6502 } from './opcodes6502'
import { instantiateEngine, type EngineExports } from './wasm'
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
  /** What a part with a delay has computed in the last `delay - 1` ticks (see `CComp.pipe`). */
  pipe?: Uint8Array
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

/** The numbers of a 6522 part, in the order of the module's `Via` struct (engine-rs/src/parts/via.rs). */
const VIA_KEYS = [
  'orb', 'ora', 'ddrb', 'ddra', 't1c', 't1l', 't1armed', 't1reload', 'pb7', 't2c', 't2l', 't2armed', 'sr', 'acr', 'pcr', 'ifr', 'ier',
  'ca1', 'cb1', 'ca2', 'cb2', 'pb6', 'ca2out', 'cb2out', 'ca2pulse', 'cb2pulse', 'ira', 'irb', 'pc', 'out',
] as const
const VIA_FLAGS = new Set<string>(['t1armed', 't1reload', 't2armed', 'ca2pulse', 'cb2pulse'])
const VIA_FIELDS = VIA_KEYS.length
const viaNumbers = (st: ViaPartState) => VIA_KEYS.map((k) => Number(st[k]))
function setViaNumbers(st: ViaPartState, v: Int32Array) {
  const o = st as unknown as Record<string, number | boolean>
  VIA_KEYS.forEach((k, i) => {
    o[k] = VIA_FLAGS.has(k) ? v[i] !== 0 : v[i]
  })
}

/** The numbers of an LCD part, in the order of the module's `Lcd` struct (engine-rs/src/parts/lcd.rs): the 128 display and 64 character memory words, then these. */
const LCD_KEYS = [
  'ac', 'cg', 'up', 'entryShift', 'display', 'cursor', 'blink', 'shift', 'dl8', 'twoLine', 'busy', 'dropped', 'nibble', 'readByte', 'readHalf', 'rev',
  'lastKind', 'lastA', 'lastB', 'lastC', 'cp', 'ep', 'drive', 'mask',
] as const
const LCD_FLAGS = new Set<string>(['cg', 'up', 'entryShift', 'display', 'cursor', 'blink', 'dl8', 'twoLine'])
const LCD_FIELDS = 192 + LCD_KEYS.length
/** The page's own sentence stays until the module says something. */
const LCD_LAST_KEEP = 99
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
/** What the inspector says was done last, from the module's code and numbers (the sentences of `lcdExec` in hd44780.ts). */
function lcdLast(kind: number, a: number, b: number, c: number): string {
  const onOff = (v: number) => (v ? 'on' : 'off')
  switch (kind) {
    case 0:
      return 'power on: display off'
    case 1:
      return `ignored data ${hex2(a)}: the chip was busy`
    case 2:
      return `ignored instruction ${hex2(a)}: the chip was busy`
    case 3:
      return `data ${hex2(a)}${a >= 0x20 && a < 0x7f ? ` (${String.fromCharCode(a)})` : ''}`
    case 4:
      return `DDRAM address ${hex2(a)}`
    case 5:
      return `CGRAM address ${hex2(a)}`
    case 6:
      return 'function set: 4-bit interface'
    case 7:
      return `function set: ${a ? '8' : '4'}-bit, ${b ? '2 lines' : '1 line'}`
    case 8:
      return `shift ${a ? 'display' : 'cursor'} ${b ? 'right' : 'left'}`
    case 9:
      return `display ${onOff(a)}, cursor ${onOff(b)}, blink ${onOff(c)}`
    case 10:
      return `entry mode: ${a ? 'increment' : 'decrement'}${b ? ', shift display' : ''}`
    case 11:
      return 'return home'
    case 12:
      return 'clear display'
    default:
      return 'no operation'
  }
}
const lcdNumbers = (st: LcdPartState) => [
  ...st.ddram,
  ...st.cgram,
  ...LCD_KEYS.map((k) => (k === 'lastKind' ? LCD_LAST_KEEP : k === 'lastA' || k === 'lastB' || k === 'lastC' ? 0 : Number(st[k]))),
]
function setLcdNumbers(st: LcdPartState, v: Int32Array) {
  for (let i = 0; i < 128; i++) st.ddram[i] = v[i]
  for (let i = 0; i < 64; i++) st.cgram[i] = v[128 + i]
  const o = st as unknown as Record<string, number | boolean>
  LCD_KEYS.forEach((k, i) => {
    if (k === 'lastKind' || k === 'lastA' || k === 'lastB' || k === 'lastC') return
    o[k] = LCD_FLAGS.has(k) ? v[192 + i] !== 0 : v[192 + i]
  })
  const at = (k: string) => v[192 + LCD_KEYS.indexOf(k as (typeof LCD_KEYS)[number])]
  if (at('lastKind') !== LCD_LAST_KEEP) st.last = lcdLast(at('lastKind'), at('lastA'), at('lastB'), at('lastC'))
}

/** The numbers of a 6502 part, in the order of the module's `Cpu` struct (engine-rs/src/parts/cpu6502.rs): the CPU's, then the part's own. */
const CPU_KEYS = [
  'a', 'x', 'y', 'sp', 'pc', 'p', 'addr', 'read', 'out', 'sync', 'irq', 'nmiPending', 'nmiPin', 'op', 'prog', 't', 'intr', 'vec', 'ea', 'lo', 'ptr', 'val',
  'base', 'cross', 'off', 'newpc', 'cycles', 'cmos', 'wait', 'bit', 'vp', 'ml',
] as const
const CPU_PART_KEYS = ['pc', 'started', 'held', 'waiting', 'stalled'] as const
const CPU_FIELDS = CPU_KEYS.length + CPU_PART_KEYS.length
const INTR = [null, 'irq', 'nmi'] as const
const cpuNumbers = (st: CpuState) => {
  const c = st.cpu as unknown as Record<string, number | boolean | string | null>
  return [
    ...CPU_KEYS.map((k) => (k === 'intr' ? INTR.indexOf(st.cpu.intr) : Number(c[k]))),
    ...CPU_PART_KEYS.map((k) => Number(st[k])),
  ]
}
function setCpuNumbers(st: CpuState, v: Int32Array) {
  const c = st.cpu as unknown as Record<string, number | boolean | string | null>
  const flags = new Set(['read', 'sync', 'irq', 'nmiPending', 'nmiPin', 'cross', 'cmos', 'vp', 'ml'])
  CPU_KEYS.forEach((k, i) => {
    c[k] = k === 'intr' ? INTR[v[i]] : flags.has(k) ? v[i] !== 0 : v[i]
  })
  const part = st as unknown as Record<string, number | boolean>
  CPU_PART_KEYS.forEach((k, i) => {
    part[k] = k === 'pc' ? v[CPU_KEYS.length + i] : v[CPU_KEYS.length + i] !== 0
  })
}
/** A mnemonic or a mode as a number: its characters, the first the lowest. */
const packChars = (s: string) => [...s].reduce((n, ch, i) => n | (ch.charCodeAt(0) << (8 * i)), 0)
const KIND_CODE = { read: 0, write: 1, rmw: 2, other: 3 }
/** The opcode tables of the NMOS chip and the 65C02, as the module takes them: 7 numbers for each of 256 opcodes. */
function opcodeTable(): number[] {
  const row = (o: Opcode6502 | undefined) =>
    o ? [1, packChars(o.mnemonic), packChars(o.mode), KIND_CODE[o.kind], o.cycles, o.pageCross ? 1 : 0, o.bit ?? -1] : [0, 0, 0, 0, 0, 0, -1]
  return [BY_OPCODE_6502, BY_OPCODE_65C02].flatMap((table) => Array.from({ length: 256 }, (_, op) => row(table[op])).flat())
}

/** The kinds of part, as engine-rs/src/parts/mod.rs numbers them. */
const KIND: Record<string, number> = {
  and: 1, or: 2, xor: 3, nand: 4, nor: 5, xnor: 6, not: 7, buf: 8, mux: 9,
  busmux: 10, busadd: 11, busreg: 12, busctr: 13, busgate: 14, buscmp: 15,
  dff: 16, tff: 17, jkff: 18, srlatch: 19, dlatch: 20, counter: 21, counterld: 22, register: 23, shiftreg: 24,
  add4: 25, sub4: 26, addsub4: 27, cmp4: 28, alu: 29, mul: 30, halfadd: 31, fulladd: 32, halfsub: 33, fullsub: 34, bcdadd: 35,
  decoder: 36, encoder: 37, bcd7: 38, bcddec: 39, bin2bcd: 40,
  rom: 41, ram: 42,
  clock: 43, keypad: 44, framebuffer: 45, console: 46,
  acia6551: 47,
  tribuf: 48, busjoin: 49, via6522: 50, hd44780: 51, cpu6502: 52,
  demux: 53, ringcounter: 54, bussub: 55, busaddsub: 56, gray: 57, parity: 58, lut: 59, netrecv: 60, video: 61,
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
  return c.comps.every(ported)
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
    def.evaluate?.({ ins, outs, state: undefined, params: p })
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
    def.evaluate?.({ ins, outs, state: undefined, params: p })
    words.push(outs.slice(0, dbits).reduce<number>((w, v, b) => w | (v << b), 0))
  }
  return words
}

/** What `Simulator.setWasm` takes: the engine for a compiled circuit, or null when a part of it is not in the module. */
/**
 * What `Simulator.defaultOpener` holds, for a compiled module: each Simulator calls it once and gets an opener with an instance of the
 * engine of its own (made when first needed and used for every circuit it loads), so many simulators can run at once.
 */
export const openerFor = (module: WebAssembly.Module) => () => {
  let x: EngineExports | null = null
  return (c: Compiled) => (supports(c) ? new WasmEngine((x ??= instantiateEngine(module)), c) : null)
}
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
  /** The pixel screens and video chips, in part order, with where each one's pixels start in the module's array and how many there are. */
  private screens: { part: number; start: number; size: number }[] = []
  private get screenBytes() {
    return this.screens.reduce((t, s) => t + s.size, 0)
  }
  /** The 6522 parts, in part order. */
  private vias: { part: number; st: ViaPartState }[] = []
  /** The LCD parts, in part order. */
  private lcds: { part: number; st: LcdPartState }[] = []
  /** The 6502 parts, in part order. */
  private cpus: { part: number; st: CpuState }[] = []
  /** The text consoles, in part order. */
  private consoles: { part: number; st: ConsoleState }[] = []
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
    const fb: number[] = []
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
      } else if (type === 'busadd' || type === 'buscmp' || type === 'bussub' || type === 'busaddsub') p0 = Number(p.bits)
      else if (type === 'busgate') {
        p0 = Number(p.bits)
        p1 = GATE[String(p.op)]
      } else if (type === 'busreg' || type === 'busctr') {
        p0 = Number(p.bits)
        n = st.n
        pc = st.pc
      } else if (type === 'dff' || type === 'tff' || type === 'srlatch' || type === 'dlatch' || type === 'jkff') {
        q = st.q
        pc = st.pc ?? 0
      } else if (type === 'counter') {
        p0 = Number(p.mod)
        n = st.n
        pc = st.pc
      } else if (type === 'counterld' || type === 'register') {
        n = st.n
        pc = st.pc
      } else if (type === 'shiftreg') {
        n = (st.bits as number[]).reduce((w, v, k) => w | (v << (2 * k)), 0)
        pc = st.pc
      } else if (type === 'demux') {
        p0 = Number(p.n)
        p1 = log2(p0)
      } else if (type === 'ringcounter') {
        p0 = p.kind === 'johnson' ? 1 : 0
        n = (st.bits as number[]).reduce((w, v, k) => w | (v << (2 * k)), 0)
        pc = st.pc
      } else if (type === 'gray') p0 = p.dir === 'g2b' ? 1 : 0
      else if (type === 'lut') {
        p0 = Number(p.inputs)
        memOff = rom.length
        for (const w of parseWords(String(p.data), 2 ** p0, Number(p.outputs))) rom.push(w)
      } else if (type === 'tribuf') p0 = Number(p.bits) || 1
      else if (type === 'busjoin') {
        p0 = Number(p.bits) || 1
        p1 = Number(p.drivers)
        p2 = p.pull === '0' ? 1 : p.pull === '1' ? 2 : 0
      } else if (type === 'mul' || type === 'decoder') p0 = Number(p.n)
      else if (type === 'encoder') p0 = Number(p.n)
      else if (type === 'bcd7') p0 = p.mode === 'hex' ? 1 : 0
      else if (type === 'rom') {
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
        // The words kept from before the address size was changed are cut or padded with zeros (the part's own evaluate did this).
        const words = 2 ** ramBits(p)
        if ((st.mem as Uint8Array).length !== words) {
          const resized = new Uint8Array(words)
          resized.set((st.mem as Uint8Array).subarray(0, words))
          st.mem = resized
        }
        for (const w of st.mem as Uint8Array) ram.push(w)
        this.ramBytes += (st.mem as Uint8Array).length
        pc = st.pc
      } else if (type === 'keypad') {
        p0 = p.sticky === true ? 1 : 0
        p1 = st.key
        p2 = st.pressed ? 1 : 0
        pc = st.prev ? 1 : 0
        // A key pressed and let go again before the module looked (`tapped`) still counts as a press: it latches, as the old copy did.
        q = st.latched || st.tapped ? 1 : 0
        st.tapped = false
      } else if (type === 'framebuffer') {
        p0 = Number(p.colors) === 4 ? 2 : 1
        p1 = p.read === 'on' ? 1 : 0
        memOff = fb.length
        this.screens.push({ part: i, start: fb.length, size: 256 })
        for (const v of st.px as number[]) fb.push(v)
        pc = st.pc
      } else if (type === 'video') {
        const v = st as VideoState
        memOff = fb.length
        this.screens.push({ part: i, start: fb.length, size: v.px.length })
        for (const b of v.px) fb.push(b)
        pc = v.pc
        n = (v.addr | (v.hold << 16) | (v.out << 24)) | 0
      } else if (type === 'via6522') {
        memOff = this.vias.length
        this.vias.push({ part: i, st: st as ViaPartState })
      } else if (type === 'cpu6502') {
        memOff = this.cpus.length
        this.cpus.push({ part: i, st: st as CpuState })
        p0 = p.chip === 'cmos' ? 1 : 0
        p1 = p.tristate ? 1 : 0
      } else if (type === 'hd44780') {
        memOff = this.lcds.length
        this.lcds.push({ part: i, st: st as LcdPartState })
        p0 = p.busy === 'short' ? 1 : p.busy === 'none' ? 2 : 0
      } else if (type === 'console') {
        memOff = this.consoles.length
        this.consoles.push({ part: i, st })
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
    push(fb.length)
    push(this.consoles.length)
    push(this.vias.length)
    push(this.lcds.length)
    push(this.cpus.length)
    push(c.comps.filter((cc) => cc.pipe).length)
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
    c.comps.forEach((cc, i) => {
      if (!cc.pipe) return
      push(i)
      push(cc.pipe.length)
      for (const v of cc.pipe) push(v)
    })
    for (const v of rom) push(v)
    for (const v of ram) push(v)
    for (const v of fb) push(v)
    for (const { st } of this.vias) for (const v of viaNumbers(st)) push(v)
    for (const { st } of this.lcds) for (const v of lcdNumbers(st)) push(v)
    for (const { st } of this.cpus) for (const v of cpuNumbers(st)) push(v)
    if (this.cpus.length) for (const v of opcodeTable()) push(v)
    for (const { st, part } of this.terminals) {
      push(c.comps[part].inst.params.resetClears === false ? 0 : 1)
      for (const v of [st.command, st.control, st.rx, st.full ? 1 : 0, st.interrupt ? 1 : 0, st.pc, st.out]) push(v)
    }
    const image = Int32Array.from(img)
    const ptr = x.alloc(image.byteLength)
    new Int32Array(x.memory.buffer, ptr, image.length).set(image)
    x.init(ptr, image.length)
    x.free(ptr, image.byteLength) // (the module has copied what it needs)
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

  /** Flag every part for the fast engine (true) or the exact one, which runs from now on. */
  markAll(fast: boolean) {
    this.x.mark_all(fast ? 1 : 0)
  }

  /** One gate delay of the exact engine. Returns true while the circuit is still moving. */
  tick(): boolean {
    return this.x.tick() === 1
  }

  /**
   * The parts the module does not run (switches, buttons, constants: they keep what the page puts on their nets) say again what they
   * show now. After `load` the nets are the ones of an earlier moment, and the page's switches may have been flipped since.
   */
  refreshInputs() {
    this.c.comps.forEach((cc) => {
      if (KIND[cc.def.type] !== undefined || cc.def.type === 'clock' || cc.outNets.length === 0) return
      cc.def.evaluate?.(cc.inst)
      cc.outNets.forEach((net, o) => this.x.set_net(net, cc.inst.outs[o]))
    })
  }

  /** Is this part one that the page runs (a switch, a button, a label...) rather than the module? Changing it needs no hand-over. */
  runsOnPage(part: number): boolean {
    const type = this.c.comps[part].def.type
    return KIND[type] === undefined && type !== 'clock'
  }

  /** A part the page runs was changed: say again what it shows, and put that on its nets. */
  refreshPart(part: number) {
    const cc = this.c.comps[part]
    if (cc.outNets.length === 0) return
    cc.def.evaluate?.(cc.inst)
    cc.outNets.forEach((net, o) => this.x.set_net(net, cc.inst.outs[o]))
  }

  /** Hold a net at 0 or 1 (or let it go with -1). */
  setForce(net: number, v: number) {
    this.x.set_force(net, v)
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
      if (cc.pipe) cc.pipe.set(new Uint8Array(buf, x.pipe_ptr(i), cc.pipe.length))
    })
    comps.forEach((cc, i) => {
      const type = cc.def.type
      const st = cc.inst.state
      if (type === 'busreg' || type === 'busctr') {
        st.n = n[i]
        st.pc = pc[i]
      } else if (type === 'dff' || type === 'tff' || type === 'jkff') {
        st.q = q[i]
        st.pc = pc[i]
      } else if (type === 'srlatch' || type === 'dlatch') st.q = q[i]
      else if (type === 'counter' || type === 'counterld' || type === 'register') {
        st.n = n[i]
        st.pc = pc[i]
      } else if (type === 'shiftreg' || type === 'ringcounter') {
        st.bits = [0, 1, 2, 3].map((k) => (n[i] >> (2 * k)) & 3)
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
    comps.forEach((cc, i) => {
      const type = cc.def.type
      if (type === 'keypad') {
        cc.inst.state.latched = q[i] !== 0
        cc.inst.state.prev = pc[i] !== 0
      } else if (type === 'framebuffer' || type === 'console') cc.inst.state.pc = pc[i]
      else if (type === 'video') {
        const st = cc.inst.state as VideoState
        const w = n[i] >>> 0
        st.pc = pc[i] as VideoState['pc']
        st.addr = w & 0xffff
        st.hold = (w >>> 16) & 1
        st.out = w >>> 24
      }
    })
    if (this.screens.length) {
      const pixels = new Uint8Array(buf, x.fb_ptr(), this.screenBytes)
      for (const { part, start, size } of this.screens) {
        const st = comps[part].inst.state as FramebufferState
        let changed = false
        for (let k = 0; k < size; k++) {
          if (st.px[k] !== pixels[start + k]) {
            st.px[k] = pixels[start + k]
            changed = true
          }
        }
        if (changed) st.rev++
      }
    }
    if (this.vias.length) {
      const regs = new Int32Array(buf, x.via_ptr(), this.vias.length * VIA_FIELDS)
      this.vias.forEach(({ st }, k) => setViaNumbers(st, regs.subarray(k * VIA_FIELDS, (k + 1) * VIA_FIELDS)))
    }
    if (this.lcds.length) {
      const regs = new Int32Array(buf, x.lcd_ptr(), this.lcds.length * LCD_FIELDS)
      this.lcds.forEach(({ st }, k) => setLcdNumbers(st, regs.subarray(k * LCD_FIELDS, (k + 1) * LCD_FIELDS)))
    }
    if (this.cpus.length) {
      const regs = new Int32Array(buf, x.cpu_ptr(), this.cpus.length * CPU_FIELDS)
      this.cpus.forEach(({ st }, k) => setCpuNumbers(st, regs.subarray(k * CPU_FIELDS, (k + 1) * CPU_FIELDS)))
    }
    this.consoles.forEach(({ st }, k) => {
      const events = x.console_take_events(k)
      if (!events) return
      const list = new Uint16Array(x.memory.buffer, x.console_events_ptr(k), events)
      for (let i = 0; i < events; i++) consolePut(st, list[i])
    })
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
   * flip-flops, the RAM and the terminals' registers (their keyboards and screens are on the page, which keeps copies, see `afterRestore`). It is what stepping back
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
      new Uint8Array(buf, x.fb_ptr(), this.screenBytes),
      new Uint8Array(buf, x.via_ptr(), this.vias.length * VIA_FIELDS * 4),
      new Uint8Array(buf, x.lcd_ptr(), this.lcds.length * LCD_FIELDS * 4),
      new Uint8Array(buf, x.cpu_ptr(), this.cpus.length * CPU_FIELDS * 4),
      ...this.pipeViews(),
      ...this.terminals.map((_, k) => new Uint8Array(buf, x.acia_regs_ptr(k), 8)),
    ]
    const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }

  /**
   * After `load`, and with the page's terminal and console states put back: what the terminals printed since is dropped, and the
   * keyboards hold what the restored states say.
   */
  afterRestore() {
    const { x } = this
    // (stepping back replaced the states by copies: look them up again)
    this.consoles.forEach((cs, k) => {
      cs.st = this.c.comps[cs.part].inst.state as ConsoleState
      x.console_take_events(k)
    })
    this.terminals.forEach((t, k) => {
      const st = (t.st = this.c.comps[t.part].inst.state as TerminalState)
      x.acia_take_events(k)
      x.acia_clear_keys(k)
      for (let i = st.next; i < st.keys.length; i++) x.acia_key(k, st.keys.charCodeAt(i))
    })
  }

  /** The delay pipelines of the parts that have one, in the module's memory. */
  private pipeViews(): Uint8Array[] {
    const buf = this.x.memory.buffer
    const out: Uint8Array[] = []
    this.c.comps.forEach((cc, i) => {
      if (cc.pipe) out.push(new Uint8Array(buf, this.x.pipe_ptr(i), cc.pipe.length))
    })
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
      new Uint8Array(buf, x.fb_ptr(), this.screenBytes),
      new Uint8Array(buf, x.via_ptr(), this.vias.length * VIA_FIELDS * 4),
      new Uint8Array(buf, x.lcd_ptr(), this.lcds.length * LCD_FIELDS * 4),
      new Uint8Array(buf, x.cpu_ptr(), this.cpus.length * CPU_FIELDS * 4),
      ...this.pipeViews(),
      ...this.terminals.map((_, k) => new Uint8Array(buf, x.acia_regs_ptr(k), 8)),
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
