import { assemble6502 } from '../engine/asm6502'
import { basicRomBytes } from './basic-rom'
import { MICRO_ABITS, MICRO_ROM_BITS, MICRO_SIGNALS, hexRom, microSignal, microcodeWords } from '../engine/micro6502'
import { parseSignals, splitPlan } from '../engine/signals'
import { frameAround, note } from './annotate'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * A 6502 built from our own parts: registers, counters, multiplexers, an adder and a microcode ROM. It does what the real chip does
 * on its pins, one bus access in every clock, but inside it is the plain textbook machine (see `engine/micro6502.ts` for the
 * microcode and the datapath), not the chip's 3,510 transistors.
 *
 * It has all 151 documented opcodes and the reset sequence. Decimal mode is not built: SED and CLD set and clear the flag, but ADC and SBC
 * stay binary. There are no interrupt lines yet (BRK works). The memory map is that of the first 6502 board:
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
  /**
   * The memory and devices around the CPU. `'leds'` (the default): 2 KB of RAM, a 4 KB ROM and a register that drives eight LEDs.
   * `'basic'`: Ben Eater's map, 16 KB of RAM at $0000, a serial terminal at $5000 and 16 KB of ROM at $8000 holding Microsoft BASIC.
   */
  board?: 'leds' | 'basic'
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

const hexBytes = (bytes: number[]) => bytes.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ')

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
  let tag = ''
  const MAX_HEIGHT = 1100
  /** Add a part at the next free spot of a section and remember it under `key`. */
  const part = (section: number, key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const s = sections.get(section) ?? { col: 0, y: 0, ids: [] }
    sections.set(section, s)
    // A part that a note explains carries the note's letter in its label: "(a) CRS…" is what note (a) is about.
    const label = opts.label && tag ? `(${tag}) ${opts.label}` : opts.label
    if (label && label.length > 40) throw new Error(`Label too long: ${label}`)
    const id = b.add(type, 0, 0, label === opts.label ? opts : { ...opts, label })
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

  // The notes that explain a section are collected here and put in a band above it, once the sections are in place: the router
  // ignores notes, so one among the parts would have wires running across its text.
  const pendingNotes: { section: number; text: string; color: string }[] = []
  const noteIn = (section: number, text: string, color = 'yellow', letter = '') => void pendingNotes.push({ section, text: letter ? `(${letter}) ${text}` : text, color })

  // Columns, left to right.
  const [SEQ, ROMS, CTL, REGS, ALU, ADDR, MEM] = [0, 1, 2, 3, 4, 5, 6]

  // ---- The sequencer: the clock, the step counter T, the instruction register IR and the microcode ROMs -----------------------
  noteIn(SEQ, 'SEQUENCER. It decides what the CPU does in every clock cycle. The clock ticks once per bus cycle. T counts the cycles of the instruction that is running (0 is the fetch of its opcode); IR holds the opcode. T, IR and a reset flag are the address of the microcode ROMs, which say what to do in this cycle. When an instruction is over, T goes back to 0 and the next opcode is fetched.', 'yellow')
  const clk = part(SEQ, 'clk', 'clock', { params: { hz: o.hz ?? 4 }, label: 'Clock' })
  const CLK = `${clk}.Q`
  named(CLK, 'CLK')
  // The CPU works on the falling edge of the clock, as the 6502 does on the fall of Φ2: the address and the data to write are on the bus
  // from the fall before, memory and devices take what is written at the rise in the middle of the cycle, and the CPU takes what is read
  // (a chip like the terminal answers after that rise) as the cycle ends.
  noteIn(SEQ, 'The CPU works on the falling edge of the clock, as the real 6502 does on the fall of Φ2: the address and the data to write are on the bus from the fall before, memory and devices take a write at the rise in the middle of the cycle, and the CPU takes what it read (a chip like the terminal answers after that rise) as the cycle ends.', 'blue')
  const nclk = part(SEQ, 'nclk', 'not', { label: 'the CPU works on the falling edge' })
  wire(CLK, `${nclk}.A`)
  const CPU_CLK = `${nclk}.Y`
  named(CPU_CLK, 'CPU_CLK')
  noteIn(SEQ, 'RESET. “Ready” is 0 at power-on and while the Reset button is held. That makes the microcode run its reset sequence (7 cycles: two dummy reads, three reads of the stack that count SP down, then the vector at $FFFC is read into PC). In its last cycle Ready becomes 1 and the program starts.', 'pink')
  const reset = part(SEQ, 'reset', 'button', { label: 'Reset (hold it for a clock or two)' })
  // Not ready: from power-on, and while the button is held, until the reset sequence has run its seven cycles.
  const ready = part(SEQ, 'ready', 'dff', { label: 'Ready: the reset sequence is over' })
  const RST = gate(SEQ, 'rst', 'or', 'reset: button or sequence running', [`${reset}.Q`, `${ready}.NQ`])
  named(RST, 'RST')
  wire(CPU_CLK, `${ready}.CLK`)

  const nButton = gate(SEQ, 'nButton', 'not', 'the button is not held', [`${reset}.Q`])

  noteIn(SEQ, 'T counts 0, 1, 2… through the cycles of an instruction (at most 7). The END signal loads 0 into it: the instruction is over. IR loads the opcode when the microcode says FETCH (the SYNC LED).', 'yellow')
  const t = part(SEQ, 't', 'busctr', { params: { bits: 3 }, label: 'T: the cycle of the instruction' })
  wire(busconst(SEQ, 'zero3', 3, 0), `${t}.D`)
  wire(CPU_CLK, `${t}.CLK`)
  wire(`${reset}.Q`, `${t}.R`)
  show(SEQ, 'showT', 'T', `${t}.Q`, 3)
  const ir = part(SEQ, 'ir', 'busreg', { params: { bits: 8 }, label: 'IR: the opcode' })
  wire(CPU_CLK, `${ir}.CLK`)
  show(SEQ, 'showIR', 'IR', `${ir}.Q`, 8)

  const romAddr = merger(SEQ, 'romAddr', 12, [3, 8, 1], 'microcode address: T, opcode, reset', [`${t}.Q`, `${ir}.Q`, RST])
  const words = microcodeWords()
  const bitsOfRom = MICRO_ROM_BITS
  const signals = MICRO_SIGNALS
  noteIn(ROMS, 'MICROCODE. Four ROMs of 4096 words, addressed by the reset flag, the opcode and T: one row for each cycle of each instruction. Every output bit is a control signal and has a name: for example LD_A loads A, ASEL chooses where the address comes from, AIN and BIN choose what goes into the ALU. Select a ROM to read the signals; the table in its inspector lists every row.', 'blue')
  const roms = words.map((w, i) =>
    part(ROMS, `micro${i + 1}`, 'rom', {
      params: { ...BUS, abits: MICRO_ABITS, dbits: bitsOfRom[i], data: hexRom(w, bitsOfRom[i] / 4), signals: signals[i] },
      label: `Microcode ${i + 1}`,
    }),
  )
  roms.forEach((r) => wire(romAddr, `${r}.A`))

  // The control bits, one wire each (a field is a small bus). The signal lists say how the words are taken apart.
  noteIn(CTL, 'CONTROL. The words of the microcode ROMs taken apart into single wires, each named like its signal. A name that goes to many parts is sent by a label (a Send label here, a Receive label at each part that uses it) instead of a wire.', 'blue')
  const control = signals.map((text, i) => {
    const plan = splitPlan(parseSignals(text).layout, bitsOfRom[i])
    const s = splitter(CTL, `ctl${i + 1}`, bitsOfRom[i], plan.widths, `control bits ${i + 1}`, `${roms[i]}.D`)
    return (name: string) => {
      const pin = `${s}.Y${plan.output[name]}`
      named(pin, name, microSignal(name).signal.width)
      return pin
    }
  })
  const c = (name: string) => control[microSignal(name).rom](name)

  // Constants, and the carry an index added to the low byte of an address (an index that crossed a page changes what the next cycles do).
  noteIn(ALU, 'ALU. R = what the ALU does (OP) to its A and B inputs. A is a register chosen by AIN. B is the data bus, TL, TH, DL or a constant (0, 1, −1, $10), chosen by BIN, and INVB inverts it (SBC, CMP). The adder takes a carry in of 0, 1 or the carry flag (CIN). AND, OR, EOR and the shifter use the same inputs. R goes to every register, to memory when the cycle writes, and to the flag logic.', 'yellow')
  const one8 = busconst(ALU, 'one8', 8, 1, '1')
  const minus1 = busconst(ALU, 'minus1', 8, 0xff, '−1')
  const zero8 = busconst(ALU, 'zero8', 8, 0, '0')
  noteIn(REGS, "REGISTERS. Each one loads R, the ALU's result, at the end of a cycle in which its LD signal is on. A, X and Y are the programmer's registers. SP is the stack pointer (the stack is page 1). TL and TH are temporary registers where an address is built a byte at a time. DL holds a value that an instruction changes in memory. PCL and PCH are the program counter. P holds the flags.", 'green')
  noteIn(REGS, 'CRS remembers that adding an index (X or Y) to the low byte of an address carried. The cycle after reads at the address before the high byte is fixed, as the real chip does; then TH + CRS fixes it. An indexed read that did not carry is already done, and its operation runs in that cycle.', 'green', 'a')
  tag = 'a'
  const crs = part(REGS, 'crs', 'dff', { label: 'CRS: an index carried a page' })
  tag = ''
  wire(CPU_CLK, `${crs}.CLK`)
  const CRS = `${crs}.Q`
  // While an index has carried, the cycle that reads at the address before the fix does not do its operation.
  const opOk = gate(CTL, 'opOk', 'not', 'the operation is not skipped', [gate(CTL, 'skipOp', 'and', 'XOP, and an index carried', [c('XOP'), CRS])])
  const unlessSkipped = (name: string) => gate(CTL, `ok${name}`, 'and', `${name}, unless skipped`, [c(name), opOk])

  // ---- The registers ----------------------------------------------------------------------------------------------------
  // Every register loads the ALU's result R; `RESULT` is wired once the ALU exists.
  const R = 'R'
  const regs: Record<string, string> = {}
  const rLoad: [string, string, string][] = [['A', 'A: accumulator', 'LD_A'], ['X', 'X', 'LD_X'], ['Y', 'Y', 'LD_Y'], ['SP', 'SP: stack pointer', 'LD_SP'], ['TL', 'TL: temporary, low', 'LD_TL'], ['DL', 'DL: the value being changed', 'LD_DL']]
  const rFrom: string[] = []
  for (const [key, label, ld] of rLoad) {
    tag = key === 'SP' ? 'c' : ''
    const r = part(REGS, key, 'busreg', { params: { bits: 8 }, label }, 20)
    wire(['LD_A', 'LD_X', 'LD_Y'].includes(ld) ? unlessSkipped(ld) : c(ld), `${r}.LD`)
    wire(CPU_CLK, `${r}.CLK`)
    regs[key] = `${r}.Q`
    if (key === 'SP') {
      // SP loads the result (TXS), or itself plus one (a pull) or minus one (a push), by its own adders.
      noteIn(REGS, 'SP, the stack pointer (the stack is page 1), loads R (TXS), SP + 1 (a pull) or SP − 1 (a push) from two adders of its own, so a push can write the ALU result while SP counts down in the same cycle.', 'green', 'c')
      const up = part(REGS, 'spUp', 'busadd', { params: { bits: 8 }, label: 'SP + 1' }, 20)
      wire(`${r}.Q`, `${up}.A`)
      wire(one8, `${up}.B`)
      const down = part(REGS, 'spDown', 'busadd', { params: { bits: 8 }, label: 'SP − 1' }, 20)
      wire(`${r}.Q`, `${down}.A`)
      wire(minus1, `${down}.B`)
      wire(mux(REGS, 'spD', 8, 'SP: R, SP + 1 or SP − 1', [R, `${up}.S`, `${down}.S`, `${down}.S`], c('SPSRC')), `${r}.D`)
    } else rFrom.push(`${r}.D`)
    tag = ''
    show(REGS, `show${key}`, key, `${r}.Q`)
  }
  // TH loads the result, the data bus, or itself plus the carry of an index (the high byte of the address, fixed).
  noteIn(REGS, 'TH, the high byte of an address being built, loads R, the data bus (the second byte of an instruction) or TH + CRS (the high byte, fixed after an index carried). Its own small adder adds CRS.', 'green', 'b')
  tag = 'b'
  const th = part(REGS, 'TH', 'busreg', { params: { bits: 8 }, label: 'TH: temporary, high' }, 20)
  wire(c('LD_TH'), `${th}.LD`)
  wire(CPU_CLK, `${th}.CLK`)
  regs.TH = `${th}.Q`
  show(REGS, 'showTH', 'TH', regs.TH)
  const thPlus = part(REGS, 'thPlus', 'busadd', { params: { bits: 8 }, label: 'TH + the carry of the index' }, 20)
  wire(regs.TH, `${thPlus}.A`)
  wire(zero8, `${thPlus}.B`)
  wire(CRS, `${thPlus}.Ci`)
  tag = ''
  tag = 'b'
  wire(mux(REGS, 'thD', 8, 'TH: R, the data bus, or TH + carry', [R, 'DI', `${thPlus}.S`, `${thPlus}.S`], c('THSRC')), `${th}.D`)
  tag = ''
  // The program counter: two counters, the low one carrying into the high one as it wraps.
  const pcl = part(REGS, 'PCL', 'busctr', { params: { bits: 8 }, label: 'PCL: program counter, low' }, 20)
  const pch = part(REGS, 'PCH', 'busctr', { params: { bits: 8 }, label: 'PCH: program counter, high' }, 20)
  wire(CPU_CLK, `${pcl}.CLK`)
  wire(CPU_CLK, `${pch}.CLK`)
  wire(c('LD_PCL'), `${pcl}.LD`)
  wire(c('LD_PCH'), `${pch}.LD`)
  wire(c('INC_PC'), `${pcl}.EN`)
  wire(`${pcl}.CO`, `${pch}.EN`)
  show(REGS, 'showPC', 'PCL', `${pcl}.Q`)
  show(REGS, 'showPCH', 'PCH', `${pch}.Q`)
  regs.PCL = `${pcl}.Q`
  regs.PCH = `${pch}.Q`
  noteIn(REGS, 'P, the flags N V – – D I Z C (bit 5 is always 1, and the break flag only exists in the copy that is pushed). The next value of each flag is worked out in the ALU section (f); PLP and RTI load the whole register from R.', 'green', 'd')
  tag = 'd'
  const p = part(REGS, 'P', 'busreg', { params: { bits: 8 }, label: 'P: flags N V – – D I Z C' }, 20)
  wire(CPU_CLK, `${p}.CLK`)
  tag = ''
  show(REGS, 'showP', 'P', `${p}.Q`, 8, 'bin')
  const ps = splitter(REGS, 'ps', 8, [1, 1, 1, 1, 1, 1, 1, 1], 'the flags', `${p}.Q`)
  const [FC, FZ, FI, FD, , , FV, FN] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${ps}.Y${i}`)
  for (const [name, pin] of [['FLAG_C', FC], ['FLAG_Z', FZ], ['FLAG_N', FN]] as const) named(pin, name)

  // ---- The ALU: A input, B input, adder and logic, result -------------------------------------------------------------
  const ainSplit = splitter(ALU, 'ainSplit', 4, [3, 1], 'AIN: which, and which group', c('AIN'))
  const aLow = mux(ALU, 'aLow', 8, 'A input: A X Y SP PCL PCH TL 0', [regs.A, regs.X, regs.Y, regs.SP, regs.PCL, regs.PCH, regs.TL, zero8], `${ainSplit}.Y0`)
  const aHigh = mux(ALU, 'aHigh', 8, 'A input, second group: DL TH P', [regs.DL, regs.TH, `${p}.Q`, zero8, zero8, zero8, zero8, zero8], `${ainSplit}.Y0`)
  const aIn = mux(ALU, 'aIn', 8, 'ALU input A', [aLow, aHigh], `${ainSplit}.Y1`)
  // The B input's select is BIN, except that PAGEFIX makes ONE into MINUS1 when the offset in TL is negative.
  const tls = splitter(ALU, 'tls', 8, [7, 1], 'TL: the offset’s sign', regs.TL)
  const TL7 = `${tls}.Y1`
  named(TL7, 'TL7')
  const binSplit = splitter(ALU, 'binSplit', 3, [1, 2], 'BIN: bit 0, bits 1–2', c('BIN'))
  const bin0 = gate(ALU, 'bin0', 'or', 'BIN bit 0, or a backward page fix', [`${binSplit}.Y0`, gate(ALU, 'fixNeg', 'and', 'PAGEFIX and TL7', [c('PAGEFIX'), TL7])])
  const binSel = merger(ALU, 'binSel', 3, [1, 2], 'BIN', [bin0, `${binSplit}.Y1`])
  const bIn = mux(ALU, 'bIn', 8, 'ALU input B', ['DI', regs.TL, one8, minus1, zero8, regs.TH, regs.DL, busconst(ALU, 'flagB', 8, 0x10, '$10')], binSel)
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
  // The shifter works on the A input: left (ASL, ROL) or right (LSR, ROR), the rotates taking the carry flag in.
  noteIn(ALU, 'SHIFTER. ASL and ROL move the A input one bit left, LSR and ROR one bit right. ROL and ROR bring the carry flag in; the bit that falls out becomes the new carry (C_SRC = SHIFTED).', 'yellow', 'e')
  tag = 'e'
  const as = splitter(ALU, 'as', 8, [7, 1], 'A input: bit 7', aIn)
  const as2 = splitter(ALU, 'as2', 8, [1, 7], 'A input: bit 0', aIn)
  const ops = splitter(ALU, 'ops', 3, [1, 1, 1], 'OP: right, rotate', c('OP'))
  const shiftIn = gate(ALU, 'shiftIn', 'and', 'a rotate takes the carry in', [`${ops}.Y1`, FC])
  const shl = merger(ALU, 'shl', 8, [1, 7], 'A shifted left', [shiftIn, `${as}.Y0`])
  const shr = merger(ALU, 'shr', 8, [7, 1], 'A shifted right', [`${as2}.Y1`, shiftIn])
  tag = ''
  const result = mux(ALU, 'result', 8, 'R: the ALU’s result', [`${adder}.S`, ...logic, shl, shr, shl, shr], c('OP'))
  named(result, R, 8)

  // The flags: N and Z from the result, C from the adder, V from the signs of the operands and the result.
  const rs = splitter(ALU, 'rs', 8, [7, 1], 'R: its sign', result)
  const R7 = `${rs}.Y1`
  const zeroCmp = part(ALU, 'zeroCmp', 'buscmp', { params: { bits: 8 }, label: 'R is zero' }, 20)
  wire(result, `${zeroCmp}.A`)
  wire(zero8, `${zeroCmp}.B`)
  noteIn(ALU, "FLAGS. N is bit 7 of R, Z says R is 0, C is the adder's carry (or the shifted-out bit, or 0 or 1 for CLC and SEC), V is signed overflow. A flag changes only when its control bit is on (NZ, UPD_C, V): each one has a hold-or-new multiplexer. BIT takes N and V from bits 7 and 6 of the operand. I and D are set and cleared by their own instructions.", 'yellow', 'f')
  tag = 'f'
  const bs = splitter(ALU, 'bs', 8, [6, 1, 1], 'B input: bits 6 and 7', bx)
  const overflow = gate(ALU, 'overflow', 'and', 'overflow: operands agree, result not', [
    gate(ALU, 'ovA', 'xor', 'A sign ≠ result sign', [`${as}.Y1`, R7]),
    gate(ALU, 'ovB', 'xor', 'B sign ≠ result sign', [`${bs}.Y2`, R7]),
  ])
  let fixed = 0
  const cSrc = splitter(ALU, 'cSrc', 2, [1, 1], 'C_SRC', c('C_SRC'))
  const cNew = part(ALU, 'cNew', 'mux', { params: { n: 4 }, label: 'the carry: adder, 0, 1, shifted' }, 20)
  const cOne = bit(ALU, 'cOne', 1)
  wire(`${adder}.Co`, `${cNew}.I0`)
  wire(bit(ALU, 'cZero', 0), `${cNew}.I1`)
  wire(cOne, `${cNew}.I2`)
  tag = 'e'
  const shifted = part(ALU, 'shifted', 'mux', { params: { n: 2 }, label: 'the bit a shift moves out' }, 20)
  wire(`${as}.Y1`, `${shifted}.I0`)
  wire(`${as2}.Y0`, `${shifted}.I1`)
  wire(`${ops}.Y0`, `${shifted}.S0`)
  wire(`${shifted}.Y`, `${cNew}.I3`)
  tag = ''
  wire(`${cSrc}.Y0`, `${cNew}.S0`)
  wire(`${cSrc}.Y1`, `${cNew}.S1`)
  const choose = (key: string, label: string, old: string, fresh: string, when: string) => {
    const m = part(ALU, key, 'mux', { params: { n: 2 }, label }, 20)
    wire(old, `${m}.I0`)
    wire(fresh, `${m}.I1`)
    wire(when, `${m}.S0`)
    return `${m}.Y`
  }
  const bit0 = () => bit(ALU, `bit0_${++fixed}`, 0)
  const bit1 = () => bit(ALU, `bit1_${++fixed}`, 1)
  // BIT takes N and V from bits 7 and 6 of the operand, and Z from A AND the operand.
  const isBit = c('BIT')
  const nzOrBit = gate(ALU, 'nzOrBit', 'or', 'N and Z change', [unlessSkipped('NZ'), isBit])
  const nVal = choose('nVal', 'N: the sign of R, or BIT’s bit 7', R7, `${bs}.Y2`, isBit)
  const vVal = choose('vVal', 'V: the overflow, or BIT’s bit 6', overflow, `${bs}.Y1`, isBit)
  const nNext = choose('nNext', 'N: hold, or the new N', FN, nVal, nzOrBit)
  const zNext = choose('zNext', 'Z: hold, or R = 0', FZ, `${zeroCmp}.EQ`, nzOrBit)
  const cNext = choose('cNext', 'C: hold, or the new carry', FC, `${cNew}.Y`, unlessSkipped('UPD_C'))
  const vChange = choose('vChange', 'V: hold, or the new V', FV, vVal, gate(ALU, 'vOrBit', 'or', 'V changes', [unlessSkipped('V'), isBit]))
  const vNext = gate(ALU, 'vNext', 'and', 'V, and CLV clears it', [vChange, gate(ALU, 'nClv', 'not', 'not CLV', [c('CLV')])])
  // I and D are set or cleared by their own instructions (the reset sets I).
  const iNext = gate(ALU, 'iNext', 'and', 'I: set by SEI and reset, cleared by CLI', [gate(ALU, 'iSet', 'or', 'I set', [FI, c('SETI')]), gate(ALU, 'nClri', 'not', 'not CLI', [c('CLRI')])])
  const dNext = gate(ALU, 'dNext', 'and', 'D: set by SED, cleared by CLD', [gate(ALU, 'dSet', 'or', 'D set', [FD, c('SETD')]), gate(ALU, 'nClrd', 'not', 'not CLD', [c('CLRD')])])
  const pNext = merger(ALU, 'pNext', 8, [1, 1, 1, 1, 1, 1, 1, 1], 'P: C Z I D – 1 V N', [cNext, zNext, iNext, dNext, bit0(), bit1(), vNext, nNext])
  tag = ''
  // PLP and RTI load the flags from the result (the break flag is not kept, and bit 5 is always 1).
  const rp = splitter(ALU, 'rp', 8, [4, 2, 2], 'R: the flags it holds', result)
  const pData = merger(ALU, 'pData', 8, [4, 1, 1, 2], 'P from R: D I Z C, –, 1, V N', [`${rp}.Y0`, bit0(), bit1(), `${rp}.Y2`])
  tag = 'd'
  wire(mux(ALU, 'pLoad', 8, 'P: next flags, or R (PLP, RTI)', [pNext, pData], c('LD_P')), `${p}.D`)
  tag = ''


  // Every register loads R (the program counter's low byte may load TL instead).
  for (const d of rFrom) wire(R, d)
  const pclD = mux(REGS, 'pclD', 8, 'PCL loads R, TL or the data bus', [R, regs.TL, 'DI', 'DI'], c('PCL_FROM'))
  // The crs flag keeps the carry out of the adder when an index is added.
  tag = 'a'
  wire(choose('crsNext', 'CRS: hold, or the adder’s carry', CRS, `${adder}.Co`, c('LD_CRS')), `${crs}.D`)
  tag = ''
  wire(pclD, `${pcl}.D`)
  wire(R, `${pch}.D`)

  // ---- The address bus ---------------------------------------------------------------------------------------------------
  noteIn(ADDR, 'ADDRESS BUS. One multiplexer chooses the address of the cycle (ASEL): PC (fetching), TH:TL (an address being built), page 1 with SP (the stack), page 0 with TL (zero page), or one of the vectors at $FFFC–$FFFF.', 'pink')
  const pc = merger(ADDR, 'pc', 16, [8, 8], 'PC', [regs.PCL, regs.PCH])
  const addr = merger(ADDR, 'addrReg', 16, [8, 8], 'the address built in TL and TH', [regs.TL, regs.TH])
  const stack = merger(ADDR, 'stack', 16, [8, 8], 'stack: page 1 and SP', [regs.SP, busconst(ADDR, 'page1', 8, 1)])
  const zp = merger(ADDR, 'zp', 16, [8, 8], 'zero page: TL', [regs.TL, busconst(ADDR, 'page0', 8, 0)])
  const vec = [0xfffc, 0xfffd, 0xfffe, 0xffff].map((v) => busconst(ADDR, `vec${v}`, 16, v))
  const A = mux(ADDR, 'abus', 16, 'ADDRESS BUS', [pc, addr, stack, zp, ...vec], c('ASEL'))
  named(A, 'ADDRESS', 16)

  // ---- Memory: RAM and ROM, and the LED register or the terminal -----------------------------------------------------------------
  const basic = o.board === 'basic'
  noteIn(
    MEM,
    basic
      ? 'MEMORY AND TERMINAL, Ben Eater’s map. Address lines A14 and A15 pick the part: RAM $0000–$3FFF (both 0), the 6551 terminal $5000 (A14 = 1, A15 = 0; A0 and A1 pick one of its four registers), ROM $8000–$FFFF (A15 = 1, seen twice). What the CPU reads comes back through DI; a write puts R on the data bus, and RAM or the terminal takes it at the rising clock edge. The ROM holds Microsoft BASIC.'
      : 'MEMORY. Address lines A14 and A15 pick the part: RAM $0000 (both 0), the LED register $4000 (A14 = 1, A15 = 0, a write), ROM $F000 (A15 = 1, seen from $8000). What the CPU reads comes back through DI; a write puts R on the data bus, and RAM or the LED register takes it at the rising clock edge.',
    'green',
  )
  const split = splitter(MEM, 'split', 16, basic ? [14, 1, 1] : [11, 1, 1, 1, 1, 1], basic ? 'address: A0–A13, A14, A15' : 'address: A0–A10, A11, A12, A13, A14, A15', A)
  const A14 = `${split}.Y${basic ? 1 : 4}`
  const A15 = `${split}.Y${basic ? 2 : 5}`
  const rom = part(MEM, 'rom', 'rom', {
    params: { ...BUS, abits: basic ? 14 : 12, dbits: 8, data: basic ? hexBytes(basicRomBytes()) : romText(o) },
    label: basic ? 'ROM $8000 (16 KB, seen twice)' : 'ROM $F000 (4 KB, seen from $8000)',
  })
  if (basic) wire(`${split}.Y0`, `${rom}.A`)
  else wire(merger(MEM, 'romA', 12, [11, 1], 'A0–A11', [`${split}.Y0`, `${split}.Y1`]), `${rom}.A`)
  const nA15 = gate(MEM, 'nA15', 'not', 'A15 = 0', [A15])
  const nA14 = gate(MEM, 'nA14', 'not', 'A14 = 0', [A14])
  const ramWe = gate(MEM, 'ramWe', 'and', 'write RAM', [c('WRITE'), nA15, nA14])
  const ram = part(MEM, 'ram', 'ram', { params: { ...BUS, dbits: 8, abits: basic ? 14 : 11 }, label: basic ? 'RAM $0000–$3FFF (16 KB)' : 'RAM $0000–$07FF' })
  wire(`${split}.Y0`, `${ram}.A`)
  wire(R, `${ram}.D`)
  wire(ramWe, `${ram}.WE`)
  wire(CLK, `${ram}.CLK`)
  let DI: string
  if (basic) {
    // The terminal is a 6551: A14 and A15 are its chip selects, A0 and A1 pick a register. What is read: the RAM, the ROM (A15 = 1,
    // whatever A14 says) or the terminal (A15 = 0, A14 = 1).
    const low = splitter(MEM, 'low', 16, [1, 1, 14], 'address: A0, A1, the rest', A)
    const term = part(MEM, 'terminal', 'acia6551', { params: BUS, label: 'Terminal (6551) $5000–$5003' })
    wire(CLK, `${term}.PHI2`)
    wire(nButton, `${term}.RESB`)
    wire(A14, `${term}.CS0`)
    wire(A15, `${term}.CS1B`)
    wire(`${low}.Y0`, `${term}.RS0`)
    wire(`${low}.Y1`, `${term}.RS1`)
    wire(gate(MEM, 'nWrite', 'not', 'read (R/W high)', [c('WRITE')]), `${term}.RWB`)
    wire(R, `${term}.DI`)
    const dsr = part(MEM, 'dsrSwitch', 'switch', { label: 'Ask the start-up questions (at Reset)' })
    wire(`${dsr}.Q`, `${term}.DSRB`)
    const sel = merger(MEM, 'sel', 2, [1, 1], 'A15, A14', [A15, A14])
    DI = mux(MEM, 'di', 8, 'what is read: RAM, ROM or terminal', [`${ram}.Q`, `${rom}.D`, `${term}.D`, `${rom}.D`], sel)
  } else {
    DI = mux(MEM, 'di', 8, 'what is read: RAM, or ROM if A15 = 1', [`${ram}.Q`, `${rom}.D`], A15)
    const ledWe = gate(MEM, 'ledWe', 'and', 'write the LEDs', [c('WRITE'), nA15, A14])
    const leds = reg(MEM, 'ledReg', 'LED register $4000', R, ledWe, CLK)
    const bar = part(MEM, 'bar', 'bar', { params: { bus: true, n: 8 }, label: 'LEDs' })
    wire(leds, `${bar}.I`)
  }
  named(DI, 'DI', 8)
  // `DI` is the ALU's B input and the instruction register's input.
  wire('DI', `${ir}.D`)
  wire(c('FETCH'), `${ir}.LD`)
  const sync = part(MEM, 'sync', 'led', { label: 'SYNC (the opcode is being read)' })
  wire(c('FETCH'), `${sync}.A`)
  const writing = part(MEM, 'writing', 'led', { label: 'writing', params: { color: 'red' } })
  wire(c('WRITE'), `${writing}.A`)
  show(MEM, 'showAddr', 'address', A, 16)

  // ---- The sequencer's decisions: when the instruction ends -------------------------------------------------------------
  noteIn(CTL, 'WHEN AN INSTRUCTION ENDS. END ends it. A branch that is not taken (BRANCH, and the flag the opcode asks for is not the value it wants) ends after 2 cycles; one that does not cross a page ends after 3 (NOCROSS); an indexed read that did not carry into the high byte ends a cycle early (XEND). The reset button also holds T at 0.', 'blue')
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
  const noIndexCarry = gate(CTL, 'noIndexCarry', 'not', 'no index carried', [CRS])
  const endNoIndexCarry = gate(CTL, 'endNoIndexCarry', 'and', 'an index did not carry: it ends', [c('XEND'), noIndexCarry])
  const end = gate(CTL, 'end', 'or', 'the instruction ends', [c('END'), endBranch, endNoCross, endNoIndexCarry])
  named(end, 'END_NOW')
  wire(end, `${t}.LD`)
  wire(gate(CTL, 'readyNext', 'and', 'ready, or the sequence ends; not held', [gate(CTL, 'endsReset', 'or', 'ready, or the reset ends', [`${ready}.Q`, c('END_RESET')]), nButton]), `${ready}.D`)

  // ---- Put the sections side by side ------------------------------------------------------------------------------------------
  let left = 0
  const sectionLeft = new Map<number, number>()
  for (const section of [...sections.keys()].sort((a, b) => a - b)) {
    const { col, ids } = sections.get(section)!
    sectionLeft.set(section, left)
    for (const { id, x } of ids) b.c.comps[id].x = x + left
    left += (col + 1) * COLUMN + 120
  }
  // The notes of a section stand in the band above its frame, side by side in the section's columns and stacked upwards.
  const stackTop = new Map<string, number>()
  const used = new Map<number, number>()
  let highest = -100
  for (const n of pendingNotes) {
    const columns = sections.get(n.section)!.col + 1
    const k = used.get(n.section) ?? 0
    used.set(n.section, k + 1)
    const key = `${n.section}.${k % columns}`
    const id = b.add('note', sectionLeft.get(n.section)! + (k % columns) * COLUMN, 0, { params: { text: n.text, cols: 44, color: n.color } })
    const y = Math.floor(((stackTop.get(key) ?? -110) - boundsRect(b.c.comps[id]).h) / 10) * 10
    b.c.comps[id].y = y
    stackTop.set(key, y - 20)
    highest = Math.min(highest, y)
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
  frame(MEM, o.board === 'basic' ? 'MEMORY and the TERMINAL' : 'MEMORY and the LEDs', 'green')
  const intro = note(
    b,
    0,
    0,
    o.board === 'basic'
      ? 'The BASIC computer with a 6502 built from registers, counters, multiplexers, an adder and a microcode ROM, instead of the 6502 part: Ben Eater’s memory map, Microsoft BASIC in the ROM and a serial terminal at $5000. It resets itself when it starts and then says OK; click the terminal’s screen and type. This CPU is very slow (the clock is as fast as the page can go, a few thousand cycles a second): give BASIC a minute to start, and expect a short program to take a while. Hold the Reset button for a clock to start over. Each part below is explained by the notes next to it.'
      : 'A 6502 built from registers, counters, multiplexers, an adder and a microcode ROM. One clock is one bus cycle, as on the real chip: the microcode names, for every cycle of every opcode, which register goes on the ALU, what it does, and where the result goes. It resets itself when it starts; hold the Reset button for a clock to start over. To watch it work, press Pause and then Clock step: two steps are one cycle, one bus access. Each part below is explained by the notes next to it.',
    48,
  )
  b.c.comps[intro].y = Math.floor((highest - 40 - boundsRect(b.c.comps[intro]).h) / 10) * 10
  return { b, keys }
}

/** The microcoded 6502 running the demo program. */
export function micro6502(o: Micro6502Options = {}): Circuit {
  return micro6502Builder(o).b.build(0)
}

/** The BASIC computer with this CPU in place of the 6502 part: Ben Eater's memory map, a terminal, Microsoft BASIC. */
export function micro6502Basic(): Circuit {
  const c = micro6502Builder({ hz: 1_000_000, board: 'basic' }).b.build(0)
  c.history = false // stepping back over a BASIC interpreter teaches nothing, and the circuit runs faster without
  return c
}
