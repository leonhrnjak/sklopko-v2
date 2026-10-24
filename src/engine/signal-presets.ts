import { SKASM_OPS, toHexWords } from './isa'
import { assembleSignals, parseRows, parseSignals } from './signals'

/**
 * The names of the control bits of the computers that ship with the app (see `engine/signals.ts` for the syntax). The
 * computer builders put them on their control ROMs, and the ROM inspector offers them for a circuit saved before the ROMs
 * had names. The bit positions are the ones the builders wire up; `computer2.test.ts` and `beginner.test.ts` check them.
 */

export interface SignalPreset {
  id: string
  name: string
  /** The size of the ROM it describes. */
  abits: number
  dbits: number
  signals: string
  rows: string
  /** What each row switches on, in the text form: the ROM's words. */
  control: string
}

/** Control ROM 1 of the SKASM computers: the accumulator, RAM, the flags, the adder and the jumps. */
export const SKASM_SIGNALS_1 = `LOAD_ACC
SRC 3 = CONST ALU RAM SHL SHR PORT X TABLE if LOAD_ACC   ; where the accumulator loads from
WRITE_RAM
SAVE_FLAGS
JUMP
JNC          ; jump if the carry is 0
JZ           ; jump if the zero flag is 1
HALT
SUBTRACT
B_IS_NUM     ; the second operand is the constant, not RAM
LOGIC        ; the ALU result is logic, not the adder's
LOGIC_OP 2 = AND OR XOR if LOGIC
CARRY_IN     ; the adder takes the carry flag in (ADC, SBC)
`

/** Control ROM 2: more jumps, ports and the index register X. */
export const SKASM_SIGNALS_2 = `JNZ          ; jump if the zero flag is 0
JC           ; jump if the carry is 1
PORT_WRITE
INDIRECT     ; the RAM address is X, not the instruction's address field
X_FROM_ACC
X_FROM_CONST
X_UP
X_DOWN
`

/** Control ROM 3: the return stack. */
export const SKASM_SIGNALS_3 = `CALL         ; push the return address and jump
RET          ; pop it and jump
`

/** The names of the rows of the SKASM control ROMs: the opcode, plus 16 × the sub-opcode. */
export const SKASM_ROWS = Object.entries(SKASM_OPS)
  .map(([name, op]) => ({ name, at: op.code | ((op.sub ?? 0) << 4) }))
  .sort((a, b) => a.at - b.at)
  .map(({ name, at }) => `${at.toString(16).toUpperCase().padStart(2, '0')} ${name}`)
  .join('\n')

/** The Beginner computer's control ROM: 16 rows, one per opcode. */
export const BEGINNER_SIGNALS = `LOAD_ACC
ACC_SRC 2 = NUM ADDER RAM if LOAD_ACC   ; what the accumulator loads: the number in the instruction, the adder's answer or RAM
WRITE_RAM
SUBTRACT
JUMP
HALT
SAVE_CARRY
`

export const BEGINNER_ROWS = `0 LDI
1 LDA
2 STA
3 JMP
4 ADD
5 SUB
7 HALT
`

// ---- What each instruction switches on ------------------------------------------------------------
// The control ROMs' words, written in the text form of `assembleSignals` (rows not listed are 0). The computer builders assemble
// these, so what an instruction does is written once, in words.

/** Control ROM 1 of the SKASM computers. */
export const SKASM_CONTROL_1 = `LDI:  LOAD_ACC SRC=CONST
LDA:  LOAD_ACC SRC=RAM
STA:  WRITE_RAM
JMP:  JUMP
ADD:  LOAD_ACC SRC=ALU SAVE_FLAGS
SUB:  LOAD_ACC SRC=ALU SAVE_FLAGS SUBTRACT
JNC:  JNC
HALT: HALT
JZ:   JZ
ADDI: LOAD_ACC SRC=ALU SAVE_FLAGS B_IS_NUM
CMPI: SAVE_FLAGS SUBTRACT B_IS_NUM
SHL:  LOAD_ACC SRC=SHL
SHR:  LOAD_ACC SRC=SHR
SUBI: LOAD_ACC SRC=ALU SAVE_FLAGS SUBTRACT B_IS_NUM
ANDI: LOAD_ACC SRC=ALU SAVE_FLAGS B_IS_NUM LOGIC LOGIC_OP=AND
ORI:  LOAD_ACC SRC=ALU SAVE_FLAGS B_IS_NUM LOGIC LOGIC_OP=OR
XORI: LOAD_ACC SRC=ALU SAVE_FLAGS B_IS_NUM LOGIC LOGIC_OP=XOR
IN:   LOAD_ACC SRC=PORT
CMP:  SAVE_FLAGS SUBTRACT
AND:  LOAD_ACC SRC=ALU SAVE_FLAGS LOGIC LOGIC_OP=AND
OR:   LOAD_ACC SRC=ALU SAVE_FLAGS LOGIC LOGIC_OP=OR
XOR:  LOAD_ACC SRC=ALU SAVE_FLAGS LOGIC LOGIC_OP=XOR
ADC:  LOAD_ACC SRC=ALU SAVE_FLAGS CARRY_IN
SBC:  LOAD_ACC SRC=ALU SAVE_FLAGS SUBTRACT CARRY_IN
NOP:                       ; switches nothing on
TXA:  LOAD_ACC SRC=X
INX:  SAVE_FLAGS
DEX:  SAVE_FLAGS
LDX:  LOAD_ACC SRC=RAM
STX:  WRITE_RAM
LDT:  LOAD_ACC SRC=TABLE
`

/** Control ROM 2. */
export const SKASM_CONTROL_2 = `OUT:  PORT_WRITE
JNZ:  JNZ
JC:   JC
LDXI: X_FROM_CONST
TAX:  X_FROM_ACC
INX:  X_UP
DEX:  X_DOWN
LDX:  INDIRECT
STX:  INDIRECT
`

/** Control ROM 3. */
export const SKASM_CONTROL_3 = `CALL: CALL
RET:  RET
`

/** The Beginner computer's control ROM. */
export const BEGINNER_CONTROL_TEXT = `LDI:  LOAD_ACC ACC_SRC=NUM
LDA:  LOAD_ACC ACC_SRC=RAM
STA:  WRITE_RAM
JMP:  JUMP
ADD:  LOAD_ACC ACC_SRC=ADDER SAVE_CARRY
SUB:  LOAD_ACC ACC_SRC=ADDER SUBTRACT SAVE_CARRY
HALT: HALT
`

export const SIGNAL_PRESETS: SignalPreset[] = [
  { id: 'skasm-1', name: 'SKASM control ROM 1 (16 bits)', abits: 8, dbits: 16, signals: SKASM_SIGNALS_1, rows: SKASM_ROWS, control: SKASM_CONTROL_1 },
  { id: 'skasm-2', name: 'SKASM control ROM 2 (8 bits)', abits: 8, dbits: 8, signals: SKASM_SIGNALS_2, rows: SKASM_ROWS, control: SKASM_CONTROL_2 },
  { id: 'skasm-3', name: 'SKASM control ROM 3 (8 bits)', abits: 8, dbits: 8, signals: SKASM_SIGNALS_3, rows: SKASM_ROWS, control: SKASM_CONTROL_3 },
  { id: 'beginner', name: 'Beginner computer control ROM (8 bits, 16 rows)', abits: 4, dbits: 8, signals: BEGINNER_SIGNALS, rows: BEGINNER_ROWS, control: BEGINNER_CONTROL_TEXT },
]

/** The ROM params of a ready-made control ROM: its size, its names and its words (an error if the text does not assemble). */
export function presetParams(x: SignalPreset): { abits: number; dbits: number; signals: string; rows: string; data: string } {
  const r = assembleSignals(parseSignals(x.signals).layout, parseRows(x.rows).rows, x.control, 2 ** x.abits, x.dbits)
  if (r.errors.length) throw new Error(`${x.name} does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return { abits: x.abits, dbits: x.dbits, signals: x.signals, rows: x.rows, data: toHexWords(r.words, x.dbits) }
}
