import { BY_OPCODE_6502, OPCODES_6502, type Mode6502, type Opcode6502 } from './opcodes6502'
import { parseSignals, type Signal } from './signals'

/**
 * The microcode of a 6502 built from our own parts (`model/micro6502.ts`): what every clock cycle of every instruction switches on.
 *
 * One clock is one bus cycle, as on the real chip, so a row is addressed by the opcode in the instruction register (8 bits), the
 * cycle of the instruction (`T`, 3 bits) and a flag that says the reset sequence is running (1 bit): a ROM of 4096 words. The word is
 * 45 bits, in three ROMs. Their bits are named below (the syntax is that of `signals.ts`, so the ROM inspector shows the names).
 *
 * The datapath, in short: the ALU takes its A input from a register (`AIN`) and its B input from the data bus or a register or a
 * constant (`BIN`), adds or does logic or shifts, and its result `R` is what every register loads and what a write puts on the
 * data bus. So a load is "0 + data", a store "register + 0", INX "X + 1", a branch "PCL + offset", ASL "shift the value".
 * The address of an operand is built in TL and TH, a byte at a time; an index is added to TL in the ALU and its carry is kept
 * (`LD_CRS`), and the cycle that follows reads at the address before the high byte is fixed, as the chip does.
 */

export const MICRO_SIGNALS_1 = `FETCH          ; the opcode is read (SYNC): the instruction register loads it
WRITE          ; this cycle writes (R/W is low)
ASEL 3 = PC ADDR STACK ZEROPAGE VEC_LO VEC_HI VEC_IRQ_LO VEC_IRQ_HI   ; the address bus
AIN 4 = A X Y SP PCL PCH TL ZERO DL TH   ; the ALU's A input
BIN 3 = DATA TL ONE MINUS1 ZERO TH DL    ; the ALU's B input
INVB           ; B is inverted (SBC, CMP)
CIN 2 = ZERO ONE FLAG ; the carry into the adder
_ 1
`

export const MICRO_SIGNALS_2 = `OP 3 = ADD AND OR EOR ASL LSR ROL ROR   ; what the ALU does
LD_A           ; load the register from the ALU's result
LD_X
LD_Y
LD_SP
LD_TL          ; the low byte of the address being built
LD_TH          ; and its high byte
THSRC 2 = R DATA INC if LD_TH   ; ... from the result, the data bus, or itself plus the carry
LD_DL          ; the value an instruction changes in memory
LD_PCL
PCL_FROM 2 = R TL DATA if LD_PCL   ; PCL loads the result, TL or the data bus
LD_PCH
`

export const MICRO_SIGNALS_3 = `INC_PC
LD_CRS         ; the carry out of the adder is kept (an index was added)
NZ             ; the flags N and Z from the result
UPD_C          ; the carry flag changes
C_SRC 2 = ADDER CLEAR SET SHIFTED if UPD_C   ; ... to the adder's carry, 0, 1, or the bit a shift moved out
V              ; the overflow flag from the adder
END            ; the instruction ends: the next cycle is an opcode fetch
BRANCH         ; ... if the branch is not taken
NOCROSS        ; ... if the branch does not cross a page
PAGEFIX        ; B is +1, or -1 when the offset is negative
XOP            ; the operation of this cycle is skipped if an index crossed a page
XEND           ; ... and the instruction ends if it did not
END_RESET      ; the reset sequence is over
SETI           ; the interrupt-disable flag is set
_ 1
`

export const MICRO_SIGNALS = [MICRO_SIGNALS_1, MICRO_SIGNALS_2, MICRO_SIGNALS_3]
export const MICRO_ROM_BITS = [16, 16, 16]
export const MICRO_ABITS = 12

const layouts = MICRO_SIGNALS.map((t) => {
  const { layout, errors } = parseSignals(t)
  if (errors.length) throw new Error(`The micro6502 signals do not parse: ${errors[0].message}`)
  return layout
})

const where = new Map<string, { rom: number; signal: Signal }>()
layouts.forEach((l, rom) => l.signals.forEach((signal) => where.set(signal.name, { rom, signal })))

/** The ROM and the signal a control bit lives in. */
export const microSignal = (name: string) => {
  const w = where.get(name)
  if (!w) throw new Error(`No control signal ${name}`)
  return w
}

/** What a row sets: a signal on (true), or a field to a value (a number or the name of the value). */
export type Row = Record<string, number | string | boolean>

/** The words of a row, one for each ROM. */
export function word(row: Row): number[] {
  const words = MICRO_SIGNALS.map(() => 0)
  for (const [name, value] of Object.entries(row)) {
    const { rom, signal } = microSignal(name)
    const v = typeof value === 'string' ? signal.values.indexOf(value) : Number(value)
    if (v < 0 || v >= 2 ** signal.width) throw new Error(`${name} cannot be ${value}`)
    words[rom] |= v << signal.from
  }
  return words
}

type Cycles = Row[]

// ---- Instructions ------------------------------------------------------------------------------

/** What an operation that reads its operand off the data bus does in the cycle that reads it. */
const READ_OPS: Record<string, Row> = {
  LDA: { AIN: 'ZERO', BIN: 'DATA', LD_A: true, NZ: true },
  LDX: { AIN: 'ZERO', BIN: 'DATA', LD_X: true, NZ: true },
  LDY: { AIN: 'ZERO', BIN: 'DATA', LD_Y: true, NZ: true },
  AND: { AIN: 'A', BIN: 'DATA', OP: 'AND', LD_A: true, NZ: true },
  ORA: { AIN: 'A', BIN: 'DATA', OP: 'OR', LD_A: true, NZ: true },
  EOR: { AIN: 'A', BIN: 'DATA', OP: 'EOR', LD_A: true, NZ: true },
  ADC: { AIN: 'A', BIN: 'DATA', CIN: 'FLAG', LD_A: true, NZ: true, UPD_C: true, C_SRC: 'ADDER', V: true },
  SBC: { AIN: 'A', BIN: 'DATA', INVB: true, CIN: 'FLAG', LD_A: true, NZ: true, UPD_C: true, C_SRC: 'ADDER', V: true },
  CMP: { AIN: 'A', BIN: 'DATA', INVB: true, CIN: 'ONE', NZ: true, UPD_C: true, C_SRC: 'ADDER' },
  CPX: { AIN: 'X', BIN: 'DATA', INVB: true, CIN: 'ONE', NZ: true, UPD_C: true, C_SRC: 'ADDER' },
  CPY: { AIN: 'Y', BIN: 'DATA', INVB: true, CIN: 'ONE', NZ: true, UPD_C: true, C_SRC: 'ADDER' },
}

/** Operations that write a register to memory: the ALU passes the register through (register + 0). */
const STORE_OPS: Record<string, Row> = {
  STA: { AIN: 'A', BIN: 'ZERO', WRITE: true },
  STX: { AIN: 'X', BIN: 'ZERO', WRITE: true },
  STY: { AIN: 'Y', BIN: 'ZERO', WRITE: true },
}

/** What the ALU does to the value of an instruction that changes it in place; `from` is where the value is. */
const changeOps = (from: 'A' | 'DL'): Record<string, Row> => ({
  ASL: { AIN: from, OP: 'ASL', NZ: true, UPD_C: true, C_SRC: 'SHIFTED' },
  LSR: { AIN: from, OP: 'LSR', NZ: true, UPD_C: true, C_SRC: 'SHIFTED' },
  ROL: { AIN: from, OP: 'ROL', NZ: true, UPD_C: true, C_SRC: 'SHIFTED' },
  ROR: { AIN: from, OP: 'ROR', NZ: true, UPD_C: true, C_SRC: 'SHIFTED' },
  INC: { AIN: from, BIN: 'ONE', NZ: true },
  DEC: { AIN: from, BIN: 'MINUS1', NZ: true },
})

/** Implied instructions: the cycle after the opcode reads the byte at PC again (and throws it away) while the work is done. */
const IMPLIED: Record<string, Row> = {
  NOP: {},
  INX: { AIN: 'X', BIN: 'ONE', LD_X: true, NZ: true },
  INY: { AIN: 'Y', BIN: 'ONE', LD_Y: true, NZ: true },
  DEX: { AIN: 'X', BIN: 'MINUS1', LD_X: true, NZ: true },
  DEY: { AIN: 'Y', BIN: 'MINUS1', LD_Y: true, NZ: true },
  TAX: { AIN: 'A', BIN: 'ZERO', LD_X: true, NZ: true },
  TXA: { AIN: 'X', BIN: 'ZERO', LD_A: true, NZ: true },
  TAY: { AIN: 'A', BIN: 'ZERO', LD_Y: true, NZ: true },
  TYA: { AIN: 'Y', BIN: 'ZERO', LD_A: true, NZ: true },
  CLC: { UPD_C: true, C_SRC: 'CLEAR' },
  SEC: { UPD_C: true, C_SRC: 'SET' },
}

/** The cycle that reads a byte at PC into TL or TH (and moves PC on). */
const fetchTo = (reg: 'LD_TL' | 'LD_TH'): Row => ({ ASEL: 'PC', INC_PC: true, AIN: 'ZERO', BIN: 'DATA', [reg]: true })

/** Where an operand is once its address is known, and the cycles that find it (after the opcode fetch). */
interface Address {
  cycles: Cycles
  /** The address bus selection of the access: zero page (TL) or TH:TL. */
  at: 'ZEROPAGE' | 'ADDR'
  /** An index was added to the low byte: its carry is kept, and the next cycle reads at the address before the high byte is fixed. */
  indexed: boolean
}

function address(mode: Mode6502): Address | null {
  const index = mode.endsWith('x') ? 'X' : 'Y'
  switch (mode) {
    case 'zp':
      return { cycles: [fetchTo('LD_TL')], at: 'ZEROPAGE', indexed: false }
    case 'zpx':
    case 'zpy':
      // A dummy read at the zero-page address, while the index is added (the sum wraps inside page 0).
      return { cycles: [fetchTo('LD_TL'), { ASEL: 'ZEROPAGE', AIN: index, BIN: 'TL', LD_TL: true }], at: 'ZEROPAGE', indexed: false }
    case 'abs':
      return { cycles: [fetchTo('LD_TL'), fetchTo('LD_TH')], at: 'ADDR', indexed: false }
    case 'abx':
    case 'aby':
      // The high byte goes straight into TH while the index is added to the low byte in TL.
      return {
        cycles: [fetchTo('LD_TL'), { ASEL: 'PC', INC_PC: true, THSRC: 'DATA', LD_TH: true, AIN: index, BIN: 'TL', LD_TL: true, LD_CRS: true }],
        at: 'ADDR',
        indexed: true,
      }
    case 'izx':
      return {
        cycles: [
          fetchTo('LD_TL'),
          { ASEL: 'ZEROPAGE', AIN: 'X', BIN: 'TL', LD_TL: true }, // a dummy read; TL = pointer + X
          { ASEL: 'ZEROPAGE', THSRC: 'DATA', LD_TH: true, AIN: 'TL', BIN: 'ONE', LD_TL: true }, // the low byte of the address, into TH; TL + 1
          { ASEL: 'ZEROPAGE', THSRC: 'DATA', LD_TH: true, AIN: 'ZERO', BIN: 'TH', LD_TL: true }, // the high byte into TH, and the low byte from TH into TL
        ],
        at: 'ADDR',
        indexed: false,
      }
    case 'izy':
      return {
        cycles: [
          fetchTo('LD_TL'),
          { ASEL: 'ZEROPAGE', THSRC: 'DATA', LD_TH: true, AIN: 'TL', BIN: 'ONE', LD_TL: true }, // the low byte of the address, into TH; TL + 1
          { ASEL: 'ZEROPAGE', THSRC: 'DATA', LD_TH: true, AIN: 'Y', BIN: 'TH', LD_TL: true, LD_CRS: true }, // the high byte into TH; Y + low byte into TL
        ],
        at: 'ADDR',
        indexed: true,
      }
    default:
      return null
  }
}

/** The branch instructions have the opcode pattern xxy10000. */
const isBranch = (o: Opcode6502) => o.mode === 'rel'

/** The cycles of an opcode after the fetch (cycle 0 is the same for all), or null if the part does not have it. */
function program(o: Opcode6502 | undefined): Cycles | null {
  if (!o) return null
  const { mnemonic: m, mode } = o
  if (isBranch(o))
    return [
      // The offset into TL; the cycle ends the instruction if the branch is not taken.
      { ...fetchTo('LD_TL'), BRANCH: true },
      // The offset is added to the low byte of PC; the instruction ends here unless that crossed into another page.
      { ASEL: 'PC', AIN: 'PCL', BIN: 'TL', LD_PCL: true, NOCROSS: true },
      // The high byte is fixed.
      { ASEL: 'PC', AIN: 'PCH', BIN: 'ONE', PAGEFIX: true, LD_PCH: true, END: true },
    ]
  if (m === 'JMP' && mode === 'abs')
    return [fetchTo('LD_TL'), { ASEL: 'PC', AIN: 'ZERO', BIN: 'DATA', LD_PCH: true, LD_PCL: true, PCL_FROM: 'TL', END: true }]
  if (m === 'JMP' && mode === 'ind')
    // The pointer's low byte is read, and TL goes up by one without carrying into TH: the NMOS chip's JMP ($12FF) reads $12FF and $1200.
    return [
      fetchTo('LD_TL'),
      { ASEL: 'PC', INC_PC: true, THSRC: 'DATA', LD_TH: true },
      { ASEL: 'ADDR', AIN: 'TL', BIN: 'ONE', LD_TL: true, LD_PCL: true, PCL_FROM: 'DATA' },
      { ASEL: 'ADDR', AIN: 'ZERO', BIN: 'DATA', LD_PCH: true, END: true },
    ]
  if (mode === 'imp') return m in IMPLIED ? [{ ASEL: 'PC', ...IMPLIED[m], END: true }] : null
  if (mode === 'acc') {
    const op = changeOps('A')[m]
    return op ? [{ ASEL: 'PC', ...op, LD_A: true, END: true }] : null
  }
  if (mode === 'imm') {
    const act = READ_OPS[m]
    return act ? [{ ASEL: 'PC', INC_PC: true, ...act, END: true }] : null
  }
  const a = address(mode)
  if (!a) return null
  const { at } = a
  // An indexed access starts with a read at the address before the high byte is fixed; TH takes its carry in that cycle.
  const fix: Row = { ASEL: 'ADDR', THSRC: 'INC', LD_TH: true }
  if (o.kind === 'read') {
    const act = READ_OPS[m]
    if (!act) return null
    // The first read is the operand itself if the index did not cross a page: then the cycle does the work and the instruction ends.
    if (a.indexed) return [...a.cycles, { ...fix, ...act, XOP: true, XEND: true }, { ASEL: 'ADDR', ...act, END: true }]
    return [...a.cycles, { ASEL: at, ...act, END: true }]
  }
  if (o.kind === 'write') {
    const act = STORE_OPS[m]
    if (!act) return null
    return [...a.cycles, ...(a.indexed ? [fix] : []), { ASEL: at, ...act, END: true }]
  }
  if (o.kind === 'rmw') {
    const act = changeOps('DL')[m]
    if (!act) return null
    return [
      ...a.cycles,
      ...(a.indexed ? [fix] : []),
      { ASEL: at, AIN: 'ZERO', BIN: 'DATA', LD_DL: true }, // read the value
      { ASEL: at, WRITE: true, AIN: 'DL', BIN: 'ZERO' }, // write it back, as the 6502 does
      { ASEL: at, WRITE: true, ...act, END: true }, // write the new one
    ]
  }
  return null
}

/** The reset sequence: two dummy reads, three reads of the stack that count the stack pointer down, then the vector at $FFFC. */
const RESET: Cycles = [
  { ASEL: 'PC' },
  { ASEL: 'PC' },
  { ASEL: 'STACK', AIN: 'SP', BIN: 'MINUS1', LD_SP: true },
  { ASEL: 'STACK', AIN: 'SP', BIN: 'MINUS1', LD_SP: true },
  { ASEL: 'STACK', AIN: 'SP', BIN: 'MINUS1', LD_SP: true, SETI: true },
  { ASEL: 'VEC_LO', AIN: 'ZERO', BIN: 'DATA', LD_TL: true },
  { ASEL: 'VEC_HI', AIN: 'ZERO', BIN: 'DATA', LD_PCH: true, LD_PCL: true, PCL_FROM: 'TL', END: true, END_RESET: true },
]

/** The opcode fetch: the same for every instruction. */
const FETCH_ROW: Row = { FETCH: true, ASEL: 'PC', INC_PC: true }
/** An opcode the part does not have: it reads the next byte and goes on (a two-cycle NOP). */
const UNKNOWN_ROW: Row = { ASEL: 'PC', END: true }

export const rowAddress = (reset: boolean, op: number, t: number) => (reset ? 2048 : 0) | (op << 3) | t

const programs: (Cycles | null)[] = Array.from({ length: 256 }, (_, op) => program(BY_OPCODE_6502[op]))

/** The opcodes the part has (every other one is a two-cycle NOP). */
export const MICRO_OPCODES: number[] = OPCODES_6502.map((o) => o.opcode)
  .filter((op) => programs[op])
  .sort((a, b) => a - b)

/** The words of every ROM (4096 each), indexed by `rowAddress`. */
export function microcodeWords(): number[][] {
  const roms = MICRO_SIGNALS.map(() => new Array<number>(1 << MICRO_ABITS).fill(0))
  const put = (addr: number, row: Row) => word(row).forEach((w, i) => (roms[i][addr] = w))
  for (let op = 0; op < 256; op++) {
    put(rowAddress(false, op, 0), FETCH_ROW)
    const cycles = programs[op]
    if (!cycles) put(rowAddress(false, op, 1), UNKNOWN_ROW)
    else {
      if (cycles.length > 7) throw new Error(`Opcode ${op.toString(16)} has more than 7 cycles`)
      cycles.forEach((row, i) => put(rowAddress(false, op, i + 1), row))
    }
    // The rows after the end of an instruction are never reached (END sends the sequencer back to 0).
  }
  RESET.forEach((row, t) => {
    for (let op = 0; op < 256; op++) put(rowAddress(true, op, t), row)
  })
  return roms
}

/** A ROM's words as hex text, `digits` per word. */
export const hexRom = (words: number[], digits: number) => words.map((w) => w.toString(16).toUpperCase().padStart(digits, '0')).join(' ')
