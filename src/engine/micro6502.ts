import { parseSignals, type Signal } from './signals'

/**
 * The microcode of a 6502 built from our own parts (`model/micro6502.ts`): what every clock cycle of every instruction switches on.
 *
 * One clock is one bus cycle, as on the real chip, so a row is addressed by the opcode in the instruction register (8 bits), the
 * cycle of the instruction (`T`, 3 bits) and a flag that says the reset sequence is running (1 bit): a ROM of 4096 words. The word is
 * 40 bits, in three ROMs. Their bits are named below (the syntax is that of `signals.ts`, so the ROM inspector shows the names).
 *
 * The datapath, in short: the ALU takes its A input from a register (`AIN`) and its B input from the data bus or a constant
 * (`BIN`), adds or does logic, and its result `R` is what every register loads and what a write puts on the data bus. So a load is
 * "0 + data", a store "register + 0", INX "X + 1", a branch "PCL + offset".
 */

export const MICRO_SIGNALS_1 = `FETCH          ; the opcode is read (SYNC): the instruction register loads it
WRITE          ; this cycle writes (R/W is low)
ASEL 3 = PC ADDR STACK ZEROPAGE VEC_LO VEC_HI VEC_IRQ_LO VEC_IRQ_HI   ; the address bus
AIN 3 = A X Y SP PCL PCH TL ZERO   ; the ALU's A input
BIN 3 = DATA TL ONE MINUS1 ZERO    ; the ALU's B input
INVB           ; B is inverted (SBC, CMP)
CIN 2 = ZERO ONE FLAG ; the carry into the adder
OP 2 = ADD AND OR EOR  ; what the ALU does
`

export const MICRO_SIGNALS_2 = `LD_A           ; load the register from the ALU's result
LD_X
LD_Y
LD_SP
LD_TL          ; the low byte of the address being built
LD_TH          ; and its high byte
LD_PCL
PCL_TL         ; PCL loads TL, not the result
LD_PCH
INC_PC
NZ             ; the flags N and Z from the result
UPD_C          ; the carry flag changes
V              ; the overflow flag from the adder
C_SRC 2 = ADDER CLEAR SET if UPD_C   ; ... to the adder's carry, 0 or 1
`

export const MICRO_SIGNALS_3 = `END            ; the instruction ends: the next cycle is an opcode fetch
BRANCH         ; ... if the branch is not taken
NOCROSS        ; ... if the branch does not cross a page
PAGEFIX        ; B is +1, or -1 when the offset is negative
END_RESET      ; the reset sequence is over
SETI           ; the interrupt-disable flag is set
`

export const MICRO_ROM_BITS = [16, 16, 8]
export const MICRO_ABITS = 12

const layouts = [MICRO_SIGNALS_1, MICRO_SIGNALS_2, MICRO_SIGNALS_3].map((t) => {
  const { layout, errors } = parseSignals(t)
  if (errors.length) throw new Error(`The micro6502 signals do not parse: ${errors[0].message}`)
  return layout
})

const where = new Map<string, { rom: number; signal: Signal }>()
layouts.forEach((l, rom) => l.signals.forEach((signal) => where.set(signal.name, { rom, signal })))

/** What a row sets: a signal on (true), or a field to a value (a number or the name of the value). */
export type Row = Record<string, number | string | boolean>

/** The three words of a row. */
export function word(row: Row): number[] {
  const words = [0, 0, 0]
  for (const [name, value] of Object.entries(row)) {
    const w = where.get(name)
    if (!w) throw new Error(`No control signal ${name}`)
    const v = typeof value === 'string' ? w.signal.values.indexOf(value) : Number(value)
    if (v < 0 || v >= 2 ** w.signal.width) throw new Error(`${name} cannot be ${value}`)
    words[w.rom] |= v << w.signal.from
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

/** Opcodes by mode: immediate, zero page, absolute (0 if the instruction has none). */
const OPCODES: Record<string, [number, number, number]> = {
  LDA: [0xa9, 0xa5, 0xad],
  LDX: [0xa2, 0xa6, 0xae],
  LDY: [0xa0, 0xa4, 0xac],
  AND: [0x29, 0x25, 0x2d],
  ORA: [0x09, 0x05, 0x0d],
  EOR: [0x49, 0x45, 0x4d],
  ADC: [0x69, 0x65, 0x6d],
  SBC: [0xe9, 0xe5, 0xed],
  CMP: [0xc9, 0xc5, 0xcd],
  CPX: [0xe0, 0xe4, 0xec],
  CPY: [0xc0, 0xc4, 0xcc],
  STA: [0, 0x85, 0x8d],
  STX: [0, 0x86, 0x8e],
  STY: [0, 0x84, 0x8c],
}

/** The cycle that reads a byte at PC into TL or TH (and moves PC on). */
const fetchTo = (reg: 'LD_TL' | 'LD_TH'): Row => ({ ASEL: 'PC', INC_PC: true, AIN: 'ZERO', BIN: 'DATA', [reg]: true })

/** Implied instructions: the cycle after the opcode reads the byte at PC again (and throws it away) while the work is done. */
const IMPLIED: Record<number, Row> = {
  0xea: {}, // NOP
  0xe8: { AIN: 'X', BIN: 'ONE', LD_X: true, NZ: true }, // INX
  0xc8: { AIN: 'Y', BIN: 'ONE', LD_Y: true, NZ: true }, // INY
  0xca: { AIN: 'X', BIN: 'MINUS1', LD_X: true, NZ: true }, // DEX
  0x88: { AIN: 'Y', BIN: 'MINUS1', LD_Y: true, NZ: true }, // DEY
  0xaa: { AIN: 'A', BIN: 'ZERO', LD_X: true, NZ: true }, // TAX
  0x8a: { AIN: 'X', BIN: 'ZERO', LD_A: true, NZ: true }, // TXA
  0xa8: { AIN: 'A', BIN: 'ZERO', LD_Y: true, NZ: true }, // TAY
  0x98: { AIN: 'Y', BIN: 'ZERO', LD_A: true, NZ: true }, // TYA
  0x18: { UPD_C: true, C_SRC: 'CLEAR' }, // CLC
  0x38: { UPD_C: true, C_SRC: 'SET' }, // SEC
}

/** The conditional branches: BPL BMI BVC BVS BCC BCS BNE BEQ (the flag is picked by bits 7–6 and the value by bit 5). */
const BRANCHES = [0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0]

/** The cycles of an opcode after the fetch (cycle 0 is the same for all). */
function program(op: number): Cycles | null {
  for (const [name, modes] of Object.entries(OPCODES)) {
    const mode = modes.indexOf(op)
    if (op === 0 || mode < 0) continue // (0 stands for a mode an instruction does not have)
    const act = READ_OPS[name] ?? STORE_OPS[name]
    const end = { ...act, END: true }
    if (mode === 0) return [{ ASEL: 'PC', INC_PC: true, ...end }]
    if (mode === 1) return [fetchTo('LD_TL'), { ASEL: 'ZEROPAGE', ...end }]
    return [fetchTo('LD_TL'), fetchTo('LD_TH'), { ASEL: 'ADDR', ...end }]
  }
  if (op in IMPLIED) return [{ ASEL: 'PC', ...IMPLIED[op], END: true }]
  if (BRANCHES.includes(op))
    return [
      // The offset into TL; the cycle ends the instruction if the branch is not taken.
      { ...fetchTo('LD_TL'), BRANCH: true },
      // The offset is added to the low byte of PC; the instruction ends here unless that crossed into another page.
      { ASEL: 'PC', AIN: 'PCL', BIN: 'TL', LD_PCL: true, NOCROSS: true },
      // The high byte is fixed.
      { ASEL: 'PC', AIN: 'PCH', BIN: 'ONE', PAGEFIX: true, LD_PCH: true, END: true },
    ]
  if (op === 0x4c)
    return [fetchTo('LD_TL'), { ASEL: 'PC', AIN: 'ZERO', BIN: 'DATA', LD_PCH: true, LD_PCL: true, PCL_TL: true, END: true }]
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
  { ASEL: 'VEC_HI', AIN: 'ZERO', BIN: 'DATA', LD_PCH: true, LD_PCL: true, PCL_TL: true, END: true, END_RESET: true },
]

/** The opcode fetch: the same for every instruction. */
const FETCH_ROW: Row = { FETCH: true, ASEL: 'PC', INC_PC: true }
/** An opcode the part does not have: it reads the next byte and goes on (a two-cycle NOP). */
const UNKNOWN_ROW: Row = { ASEL: 'PC', END: true }

export const rowAddress = (reset: boolean, op: number, t: number) => (reset ? 2048 : 0) | (op << 3) | t

/** The opcodes the part has (every other one is a two-cycle NOP). */
export const MICRO_OPCODES: number[] = [
  ...Object.values(OPCODES).flat().filter((op) => op),
  ...Object.keys(IMPLIED).map(Number),
  ...BRANCHES,
  0x4c,
].sort((a, b) => a - b)

/** The three ROMs' words (4096 each), indexed by `rowAddress`. */
export function microcodeWords(): number[][] {
  const roms = [0, 1, 2].map(() => new Array<number>(1 << MICRO_ABITS).fill(0))
  const put = (addr: number, row: Row) => word(row).forEach((w, i) => (roms[i][addr] = w))
  for (let op = 0; op < 256; op++) {
    put(rowAddress(false, op, 0), FETCH_ROW)
    const cycles = program(op)
    if (!cycles) put(rowAddress(false, op, 1), UNKNOWN_ROW)
    else cycles.forEach((row, i) => put(rowAddress(false, op, i + 1), row))
    // The rows after the end of an instruction are never reached (END sends the sequencer back to 0).
  }
  RESET.forEach((row, t) => {
    for (let op = 0; op < 256; op++) put(rowAddress(true, op, t), row)
  })
  return roms
}

/** A ROM's words as hex text, `digits` per word. */
export const hexRom = (words: number[], digits: number) => words.map((w) => w.toString(16).toUpperCase().padStart(digits, '0')).join(' ')
