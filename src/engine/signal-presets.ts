import { SKASM_OPS } from './isa'

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

export const SIGNAL_PRESETS: SignalPreset[] = [
  { id: 'skasm-1', name: 'SKASM computer, Control', abits: 8, dbits: 16, signals: SKASM_SIGNALS_1, rows: SKASM_ROWS },
  { id: 'skasm-2', name: 'SKASM computer, Control 2', abits: 8, dbits: 8, signals: SKASM_SIGNALS_2, rows: SKASM_ROWS },
  { id: 'skasm-3', name: 'SKASM computer, Control 3', abits: 8, dbits: 8, signals: SKASM_SIGNALS_3, rows: SKASM_ROWS },
  { id: 'beginner', name: 'Beginner computer, Control ROM', abits: 4, dbits: 8, signals: BEGINNER_SIGNALS, rows: BEGINNER_ROWS },
]
