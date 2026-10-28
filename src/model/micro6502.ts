import { assemble6502 } from '../engine/asm6502'
import { MICRO_ABITS, MICRO_ROM_BITS, MICRO_SIGNALS_1, MICRO_SIGNALS_2, MICRO_SIGNALS_3, hexRom, microcodeWords } from '../engine/micro6502'
import { parseSignals, splitPlan } from '../engine/signals'
import { frameAround, note } from './annotate'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * A 6502 built from our own parts: registers, counters, multiplexers, an adder and a microcode ROM. It does what the real chip does
 * on its pins, one bus access in every clock, but inside it is the plain textbook machine (see `engine/micro6502.ts` for the
 * microcode and the datapath), not the chip's 3,510 transistors.
 *
 * It is a first step: a few dozen opcodes (loads, stores, ADC, SBC, the logic operations, compares, increments, transfers, the
 * flag instructions, the branches and JMP), and the reset sequence. The memory map is that of the first 6502 board:
 *
 *     $0000–$3FFF  RAM (2 KB, repeated)          $4000–$7FFF  the LED register (write only)
 *     $8000–$FFFF  ROM (4 KB, repeated)          the CPU starts at the address stored in $FFFC–$FFFD
 */

const BUS = { bus: true }

export interface Micro6502Options {
  /** Clock speed in Hz. */
  hz?: number
  /** The program in 6502 assembly, in the ROM at $F000 (it needs the reset vector, like every 6502 program). */
  source?: string
  /** The ROM's contents as hex text, instead of a program. */
  rom?: string
}

/** A program that counts on the LEDs: add 3 to the accumulator, show it, and go round again. */
export const MICRO_DEMO_SOURCE = `.org $F000
start:  LDA #$00
        CLC
loop:   ADC #$03       ; add three
        STA $4000      ; show it on the LEDs
        STA $10        ; keep it in the RAM, too
        LDX $10        ; and read it back
        INX
        CPX #$40       ; has X got as far as 64?
        BNE loop
        JMP start      ; start again
.org $FFFC
.word start`

const romText = (o: Micro6502Options) => {
  if (o.rom) return o.rom
  const r = assemble6502(o.source ?? MICRO_DEMO_SOURCE, 0x1000)
  if (r.errors.length) throw new Error(`The program does not assemble: line ${r.errors[0].line}: ${r.errors[0].message}`)
  if (r.base !== 0xf000) throw new Error('The program must start at $F000.')
  return r.bytes.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

export function micro6502Builder(o: Micro6502Options = {}) {
  const b = new CircuitBuilder()
  const keys: Record<string, string> = {}
  // The parts of a section flow down a column and on to the next one when it is full; the sections are put side by side at the end,
  // each at the right of the one before, so none can run into another.
  const sections = new Map<number, { col: number; y: number; ids: { id: string; x: number }[] }>()
  const COLUMN = 380
  const MAX_HEIGHT = 1100
  /** Add a part at the next free spot of a section and remember it under `key`. */
  const part = (section: number, key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const s = sections.get(section) ?? { col: 0, y: 0, ids: [] }
    sections.set(section, s)
    if (opts.label && opts.label.length > 40) throw new Error(`Label too long: ${opts.label}`)
    const id = b.add(type, 0, 0, opts)
    const h = boundsRect(b.c.comps[id]).h
    if (s.y > 0 && s.y + h > MAX_HEIGHT) {
      s.col++
      s.y = 0
    }
    b.c.comps[id].x = s.col * COLUMN
    b.c.comps[id].y = s.y
    s.ids.push({ id, x: s.col * COLUMN })
    s.y += h + gap + (opts.label ? 20 : 0)
    return (keys[key] = id)
  }
  // Signals that reach many parts are sent by name, as in the 8-bit computer: a Send label at the source and a Receive label at each
  // destination are one wire. Labels are placed last; one that has no room is replaced by an ordinary wire.
  const links: { from: string; to: string }[] = []
  const netNames = new Map<string, { name: string; bits: number }>()
  const wire = (from: string, to: string) => links.push({ from, to })
  const named = (pin: string, name: string, bits = 1) => netNames.set(pin, { name, bits })
  const splitter = (col: number, key: string, bits: number, split: number[], label: string, from: string) => {
    const s = part(col, key, 'splitter', { params: { bits, split: split.join(',') }, label }, 20)
    wire(from, `${s}.A`)
    return s
  }
  const merger = (col: number, key: string, bits: number, split: number[], label: string, from: string[]) => {
    const m = part(col, key, 'merger', { params: { bits, split: split.join(',') }, label }, 20)
    from.forEach((f, i) => wire(f, `${m}.A${i}`))
    return `${m}.Y`
  }
  const busconst = (col: number, key: string, bits: number, value: number, label?: string) =>
    `${part(col, key, 'busconst', { params: { bits, value: value.toString(16).toUpperCase() }, ...(label ? { label } : {}) }, 20)}.Q`
  const bit = (col: number, key: string, value: 0 | 1) => `${part(col, key, 'const', { params: { value } }, 10)}.Q`
  const gate = (col: number, key: string, type: string, label: string, ins: string[]) => {
    const g = part(col, key, type, { ...(type === 'not' || ins.length === 2 ? {} : { params: { inputs: ins.length } }), label }, 20)
    ins.forEach((from, i) => wire(from, `${g}.${String.fromCharCode(65 + i)}`))
    return `${g}.Y`
  }
  const mux = (col: number, key: string, bitsWide: number, label: string, inputs: string[], select: string) => {
    const m = part(col, key, 'busmux', { params: { bits: bitsWide, n: inputs.length }, label }, 20)
    inputs.forEach((from, i) => wire(from, `${m}.I${i}`))
    wire(select, inputs.length === 2 ? `${m}.S0` : `${m}.S`)
    return `${m}.Y`
  }
  const reg = (col: number, key: string, label: string, d: string, ld: string, clk: string) => {
    const r = part(col, key, 'busreg', { params: { bits: 8 }, label }, 20)
    wire(d, `${r}.D`)
    wire(ld, `${r}.LD`)
    wire(clk, `${r}.CLK`)
    return `${r}.Q`
  }
  const show = (col: number, key: string, label: string, from: string, bits = 8, format = 'hex') => {
    const d = part(col, key, 'busdisp', { params: { bits, format }, label }, 20)
    wire(from, `${d}.A`)
  }

  // Columns, left to right.
  const [SEQ, ROMS, CTL, REGS, ALU, ADDR, MEM] = [0, 1, 2, 3, 4, 5, 6]

  // ---- The sequencer: the clock, the step counter T, the instruction register IR and the microcode ROMs -----------------------
  const clk = part(SEQ, 'clk', 'clock', { params: { hz: o.hz ?? 4 }, label: 'Clock' })
  const CLK = `${clk}.Q`
  named(CLK, 'CLK')
  const reset = part(SEQ, 'reset', 'button', { label: 'Reset (hold it for a clock or two)' })
  // Not ready: from power-on, and while the button is held, until the reset sequence has run its seven cycles.
  const ready = part(SEQ, 'ready', 'dff', { label: 'Ready: the reset sequence is over' })
  const RST = gate(SEQ, 'rst', 'or', 'reset: button or sequence running', [`${reset}.Q`, `${ready}.NQ`])
  named(RST, 'RST')
  wire(CLK, `${ready}.CLK`)

  const t = part(SEQ, 't', 'busctr', { params: { bits: 3 }, label: 'T: the cycle of the instruction' })
  wire(busconst(SEQ, 'zero3', 3, 0), `${t}.D`)
  wire(CLK, `${t}.CLK`)
  wire(`${reset}.Q`, `${t}.R`)
  show(SEQ, 'showT', 'T', `${t}.Q`, 3)
  const ir = part(SEQ, 'ir', 'busreg', { params: { bits: 8 }, label: 'IR: the opcode' })
  wire(CLK, `${ir}.CLK`)
  show(SEQ, 'showIR', 'IR', `${ir}.Q`, 8)

  const romAddr = merger(SEQ, 'romAddr', 12, [3, 8, 1], 'microcode address: T, opcode, reset', [`${t}.Q`, `${ir}.Q`, RST])
  const words = microcodeWords()
  const bitsOfRom = MICRO_ROM_BITS
  const signals = [MICRO_SIGNALS_1, MICRO_SIGNALS_2, MICRO_SIGNALS_3]
  const roms = words.map((w, i) =>
    part(ROMS, `micro${i + 1}`, 'rom', {
      params: { ...BUS, abits: MICRO_ABITS, dbits: bitsOfRom[i], data: hexRom(w, bitsOfRom[i] / 4), signals: signals[i] },
      label: `Microcode ${i + 1}`,
    }),
  )
  roms.forEach((r) => wire(romAddr, `${r}.A`))

  // The control bits, one wire each (a field is a small bus). The signal lists say how the words are taken apart.
  const control = signals.map((text, i) => {
    const plan = splitPlan(parseSignals(text).layout, bitsOfRom[i])
    const s = splitter(CTL, `ctl${i + 1}`, bitsOfRom[i], plan.widths, `control bits ${i + 1}`, `${roms[i]}.D`)
    return (name: string) => {
      const pin = `${s}.Y${plan.output[name]}`
      named(pin, name, name === 'ASEL' || name === 'AIN' || name === 'BIN' ? 3 : name === 'OP' || name === 'CIN' || name === 'C_SRC' ? 2 : 1)
      return pin
    }
  })
  const c = (name: string) => {
    const i = [MICRO_SIGNALS_1, MICRO_SIGNALS_2, MICRO_SIGNALS_3].findIndex((text) => parseSignals(text).layout.signals.some((s) => s.name === name))
    return control[i](name)
  }

  // ---- The registers ----------------------------------------------------------------------------------------------------
  // Every register loads the ALU's result R; `RESULT` is wired once the ALU exists.
  const R = 'R'
  const regs: Record<string, string> = {}
  const rLoad: [string, string, string][] = [['A', 'A: accumulator', 'LD_A'], ['X', 'X', 'LD_X'], ['Y', 'Y', 'LD_Y'], ['SP', 'SP: stack pointer', 'LD_SP'], ['TL', 'TL: temporary, low', 'LD_TL'], ['TH', 'TH: temporary, high', 'LD_TH']]
  const rFrom: string[] = []
  for (const [key, label, ld] of rLoad) {
    const r = part(REGS, key, 'busreg', { params: { bits: 8 }, label }, 20)
    wire(c(ld), `${r}.LD`)
    wire(CLK, `${r}.CLK`)
    regs[key] = `${r}.Q`
    rFrom.push(`${r}.D`)
    show(REGS, `show${key}`, key, `${r}.Q`)
  }
  // The program counter: two counters, the low one carrying into the high one as it wraps.
  const pcl = part(REGS, 'PCL', 'busctr', { params: { bits: 8 }, label: 'PCL: program counter, low' }, 20)
  const pch = part(REGS, 'PCH', 'busctr', { params: { bits: 8 }, label: 'PCH: program counter, high' }, 20)
  wire(CLK, `${pcl}.CLK`)
  wire(CLK, `${pch}.CLK`)
  wire(c('LD_PCL'), `${pcl}.LD`)
  wire(c('LD_PCH'), `${pch}.LD`)
  wire(c('INC_PC'), `${pcl}.EN`)
  wire(`${pcl}.CO`, `${pch}.EN`)
  show(REGS, 'showPC', 'PCL', `${pcl}.Q`)
  show(REGS, 'showPCH', 'PCH', `${pch}.Q`)
  regs.PCL = `${pcl}.Q`
  regs.PCH = `${pch}.Q`
  const p = part(REGS, 'P', 'busreg', { params: { bits: 8 }, label: 'P: flags N V – – D I Z C' }, 20)
  wire(CLK, `${p}.CLK`)
  show(REGS, 'showP', 'P', `${p}.Q`, 8, 'bin')
  const ps = splitter(REGS, 'ps', 8, [1, 1, 1, 1, 1, 1, 1, 1], 'the flags', `${p}.Q`)
  const [FC, FZ, FI, FD, , , FV, FN] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${ps}.Y${i}`)
  for (const [name, pin] of [['FLAG_C', FC], ['FLAG_Z', FZ], ['FLAG_N', FN]] as const) named(pin, name)

  // ---- The ALU: A input, B input, adder and logic, result -------------------------------------------------------------
  const one8 = busconst(ALU, 'one8', 8, 1, '1')
  const minus1 = busconst(ALU, 'minus1', 8, 0xff, '−1')
  const zero8 = busconst(ALU, 'zero8', 8, 0, '0')
  const aIn = mux(ALU, 'aIn', 8, 'ALU input A', [regs.A, regs.X, regs.Y, regs.SP, regs.PCL, regs.PCH, regs.TL, zero8], c('AIN'))
  // The B input's select is BIN, except that PAGEFIX makes ONE into MINUS1 when the offset in TL is negative.
  const tls = splitter(ALU, 'tls', 8, [7, 1], 'TL: the offset’s sign', regs.TL)
  const TL7 = `${tls}.Y1`
  named(TL7, 'TL7')
  const binSplit = splitter(ALU, 'binSplit', 3, [1, 2], 'BIN: bit 0, bits 1–2', c('BIN'))
  const bin0 = gate(ALU, 'bin0', 'or', 'BIN bit 0, or a backward page fix', [`${binSplit}.Y0`, gate(ALU, 'fixNeg', 'and', 'PAGEFIX and TL7', [c('PAGEFIX'), TL7])])
  const binSel = merger(ALU, 'binSel', 3, [1, 2], 'BIN', [bin0, `${binSplit}.Y1`])
  const bIn = mux(ALU, 'bIn', 8, 'ALU input B', [`DI`, regs.TL, one8, minus1, zero8, zero8, zero8, zero8], binSel)
  const nb = part(ALU, 'nb', 'busgate', { params: { bits: 8, op: 'not' }, label: 'B inverted' }, 20)
  wire(bIn, `${nb}.A`)
  const bx = mux(ALU, 'bx', 8, 'B, or its opposite (SBC, CMP)', [bIn, `${nb}.Y`], c('INVB'))
  // The carry in: 0, 1, or the carry flag.
  const cinSplit = splitter(ALU, 'cinSplit', 2, [1, 1], 'CIN', c('CIN'))
  const cin = gate(ALU, 'cin', 'or', 'carry in: ONE, or FLAG and the carry', [`${cinSplit}.Y0`, gate(ALU, 'cinFlag', 'and', 'FLAG and the carry flag', [`${cinSplit}.Y1`, FC])])
  const adder = part(ALU, 'adder', 'busadd', { params: { bits: 8 }, label: 'Adder' }, 20)
  wire(aIn, `${adder}.A`)
  wire(bx, `${adder}.B`)
  wire(cin, `${adder}.Ci`)
  const logic = ['and', 'or', 'xor'].map((op) => {
    const g = part(ALU, `logic${op}`, 'busgate', { params: { bits: 8, op }, label: op.toUpperCase() }, 20)
    wire(aIn, `${g}.A`)
    wire(bx, `${g}.B`)
    return `${g}.Y`
  })
  const result = mux(ALU, 'result', 8, 'R: the ALU’s result', [`${adder}.S`, ...logic], c('OP'))
  named(result, R, 8)

  // The flags: N and Z from the result, C from the adder, V from the signs of the operands and the result.
  const rs = splitter(ALU, 'rs', 8, [7, 1], 'R: its sign', result)
  const R7 = `${rs}.Y1`
  const zeroCmp = part(ALU, 'zeroCmp', 'buscmp', { params: { bits: 8 }, label: 'R is zero' }, 20)
  wire(result, `${zeroCmp}.A`)
  wire(zero8, `${zeroCmp}.B`)
  const as = splitter(ALU, 'as', 8, [7, 1], 'A input: its sign', aIn)
  const bs = splitter(ALU, 'bs', 8, [7, 1], 'B input: its sign', bx)
  const overflow = gate(ALU, 'overflow', 'and', 'overflow: operands agree, result not', [
    gate(ALU, 'ovA', 'xor', 'A sign ≠ result sign', [`${as}.Y1`, R7]),
    gate(ALU, 'ovB', 'xor', 'B sign ≠ result sign', [`${bs}.Y1`, R7]),
  ])
  const cSrc = splitter(ALU, 'cSrc', 2, [1, 1], 'C_SRC', c('C_SRC'))
  const cNew = part(ALU, 'cNew', 'mux', { params: { n: 4 }, label: 'the carry: adder, 0, 1' }, 20)
  const cOne = bit(ALU, 'cOne', 1)
  wire(`${adder}.Co`, `${cNew}.I0`)
  wire(bit(ALU, 'cZero', 0), `${cNew}.I1`)
  wire(cOne, `${cNew}.I2`)
  wire(cOne, `${cNew}.I3`)
  wire(`${cSrc}.Y0`, `${cNew}.S0`)
  wire(`${cSrc}.Y1`, `${cNew}.S1`)
  const choose = (key: string, label: string, old: string, fresh: string, when: string) => {
    const m = part(ALU, key, 'mux', { params: { n: 2 }, label }, 20)
    wire(old, `${m}.I0`)
    wire(fresh, `${m}.I1`)
    wire(when, `${m}.S0`)
    return `${m}.Y`
  }
  const nNext = choose('nNext', 'N: hold, or the sign of R', FN, R7, c('NZ'))
  const zNext = choose('zNext', 'Z: hold, or R = 0', FZ, `${zeroCmp}.EQ`, c('NZ'))
  const cNext = choose('cNext', 'C: hold, or the new carry', FC, `${cNew}.Y`, c('UPD_C'))
  const vNext = choose('vNext', 'V: hold, or the overflow', FV, overflow, c('V'))
  const iNext = gate(ALU, 'iNext', 'or', 'I: set by the reset', [FI, c('SETI')])
  const pNext = merger(ALU, 'pNext', 8, [1, 1, 1, 1, 1, 1, 1, 1], 'P: C Z I D – 1 V N', [cNext, zNext, iNext, FD, bit(ALU, 'bFlag', 0), bit(ALU, 'uFlag', 1), vNext, nNext])
  wire(pNext, `${p}.D`)

  // Every register loads R (the program counter's low byte may load TL instead).
  for (const d of rFrom) wire(R, d)
  const pclD = mux(REGS, 'pclD', 8, 'PCL loads R, or TL (JMP, vectors)', [R, regs.TL], c('PCL_TL'))
  wire(pclD, `${pcl}.D`)
  wire(R, `${pch}.D`)

  // ---- The address bus ---------------------------------------------------------------------------------------------------
  const pc = merger(ADDR, 'pc', 16, [8, 8], 'PC', [regs.PCL, regs.PCH])
  const addr = merger(ADDR, 'addrReg', 16, [8, 8], 'the address built in TL and TH', [regs.TL, regs.TH])
  const stack = merger(ADDR, 'stack', 16, [8, 8], 'stack: page 1 and SP', [regs.SP, busconst(ADDR, 'page1', 8, 1)])
  const zp = merger(ADDR, 'zp', 16, [8, 8], 'zero page: TL', [regs.TL, busconst(ADDR, 'page0', 8, 0)])
  const vec = [0xfffc, 0xfffd, 0xfffe, 0xffff].map((v) => busconst(ADDR, `vec${v}`, 16, v))
  const A = mux(ADDR, 'abus', 16, 'ADDRESS BUS', [pc, addr, stack, zp, ...vec], c('ASEL'))
  named(A, 'ADDRESS', 16)

  // ---- Memory: RAM, ROM and the LED register --------------------------------------------------------------------------------
  const split = splitter(MEM, 'split', 16, [11, 1, 1, 1, 1, 1], 'address: A0–A10, A11, A12, A13, A14, A15', A)
  const A14 = `${split}.Y4`
  const A15 = `${split}.Y5`
  const romA = merger(MEM, 'romA', 12, [11, 1], 'A0–A11', [`${split}.Y0`, `${split}.Y1`])
  const rom = part(MEM, 'rom', 'rom', { params: { ...BUS, abits: 12, dbits: 8, data: romText(o) }, label: 'ROM $F000 (4 KB, seen from $8000)' })
  wire(romA, `${rom}.A`)
  const nA15 = gate(MEM, 'nA15', 'not', 'A15 = 0', [A15])
  const nA14 = gate(MEM, 'nA14', 'not', 'A14 = 0', [A14])
  const ramWe = gate(MEM, 'ramWe', 'and', 'write RAM', [c('WRITE'), nA15, nA14])
  const ledWe = gate(MEM, 'ledWe', 'and', 'write the LEDs', [c('WRITE'), nA15, A14])
  const ram = part(MEM, 'ram', 'ram', { params: { ...BUS, dbits: 8, abits: 11 }, label: 'RAM $0000–$07FF' })
  wire(`${split}.Y0`, `${ram}.A`)
  wire(R, `${ram}.D`)
  wire(ramWe, `${ram}.WE`)
  wire(CLK, `${ram}.CLK`)
  const DI = mux(MEM, 'di', 8, 'what is read: RAM, or ROM if A15 = 1', [`${ram}.Q`, `${rom}.D`], A15)
  named(DI, 'DI', 8)
  // `DI` is the ALU's B input and the instruction register's input.
  wire('DI', `${ir}.D`)
  wire(c('FETCH'), `${ir}.LD`)
  const leds = reg(MEM, 'ledReg', 'LED register $4000', R, ledWe, CLK)
  const bar = part(MEM, 'bar', 'bar', { params: { bus: true, n: 8 }, label: 'LEDs' })
  wire(leds, `${bar}.I`)
  const sync = part(MEM, 'sync', 'led', { label: 'SYNC (the opcode is being read)' })
  wire(c('FETCH'), `${sync}.A`)
  const writing = part(MEM, 'writing', 'led', { label: 'writing', params: { color: 'red' } })
  wire(c('WRITE'), `${writing}.A`)
  show(MEM, 'showAddr', 'address', A, 16)

  // ---- The sequencer's decisions: when the instruction ends -------------------------------------------------------------
  const irs = splitter(CTL, 'irs', 8, [5, 1, 1, 1], 'IR: the branch bits', `${ir}.Q`)
  const flag = part(CTL, 'flag', 'mux', { params: { n: 4 }, label: 'the flag a branch looks at: N V C Z' }, 20)
  wire(FN, `${flag}.I0`)
  wire(FV, `${flag}.I1`)
  wire(FC, `${flag}.I2`)
  wire(FZ, `${flag}.I3`)
  wire(`${irs}.Y2`, `${flag}.S0`)
  wire(`${irs}.Y3`, `${flag}.S1`)
  const notTaken = gate(CTL, 'notTaken', 'xor', 'not taken: flag is not the wanted value', [`${flag}.Y`, `${irs}.Y1`])
  const endBranch = gate(CTL, 'endBranch', 'and', 'a branch that is not taken ends', [c('BRANCH'), notTaken])
  const sameSign = gate(CTL, 'sameSign', 'xnor', 'no page crossed: carry = sign of offset', [`${adder}.Co`, TL7])
  const endNoCross = gate(CTL, 'endNoCross', 'and', 'no page crossed: the branch ends', [c('NOCROSS'), sameSign])
  const end = gate(CTL, 'end', 'or', 'the instruction ends', [c('END'), endBranch, endNoCross])
  named(end, 'END_NOW')
  wire(end, `${t}.LD`)
  const nButton = gate(CTL, 'nButton', 'not', 'the button is not held', [`${reset}.Q`])
  wire(gate(CTL, 'readyNext', 'and', 'ready, or the sequence ends; not held', [gate(CTL, 'endsReset', 'or', 'ready, or the reset ends', [`${ready}.Q`, c('END_RESET')]), nButton]), `${ready}.D`)

  // ---- Put the sections side by side ------------------------------------------------------------------------------------------
  let left = 0
  for (const section of [...sections.keys()].sort((a, b) => a - b)) {
    const { col, ids } = sections.get(section)!
    for (const { id, x } of ids) b.c.comps[id].x = x + left
    left += (col + 1) * COLUMN + 120
  }

  // ---- Wire everything: a signal that goes to three or more places is sent by name ---------------------------------------------
  const byFrom = new Map<string, string[]>()
  for (const l of links) byFrom.set(l.from, [...(byFrom.get(l.from) ?? []), l.to])
  // The names 'DI' and 'R' stand for pins that are not known yet while the parts are placed; they are the pins the muxes made.
  const named2 = new Map(netNames)
  named2.set(DI, { name: 'DI', bits: 8 })
  const alias = new Map<string, string>([['DI', DI], [R, result]])
  for (const [from0, targets] of byFrom) {
    const from = alias.get(from0) ?? from0
    const net = named2.get(from)
    const sent = net && targets.length >= 3 ? b.tap(from, net.name, 20, net.bits) : undefined
    for (const to of targets) if (!(sent && net && b.tag(to, net.name, 20, net.bits))) b.wire(from, to)
  }

  const frame = (section: number, title: string, color: string) => frameAround(b, title, sections.get(section)!.ids.map((i) => i.id), color)
  frame(SEQ, 'SEQUENCER: clock, cycle T, opcode IR', 'blue')
  frame(ROMS, 'MICROCODE: what each cycle switches on', 'blue')
  frame(CTL, 'CONTROL: the bits, and when it ends', 'blue')
  frame(REGS, 'REGISTERS', 'green')
  frame(ALU, 'ALU and FLAGS', 'yellow')
  frame(ADDR, 'ADDRESS BUS: what goes on it', 'pink')
  frame(MEM, 'MEMORY and the LEDs', 'green')
  note(b, 0, -300, 'A 6502 built from registers, counters, multiplexers, an adder and a microcode ROM. One clock is one bus cycle, as on the real chip: the microcode names, for every cycle of every opcode, which register goes on the ALU, what it does, and where the result goes. It resets itself when it starts; hold the Reset button for a clock to start over.', 48)
  return { b, keys }
}

/** The microcoded 6502 running the demo program. */
export function micro6502(o: Micro6502Options = {}): Circuit {
  return micro6502Builder(o).b.build(0)
}
