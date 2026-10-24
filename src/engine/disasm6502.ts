/**
 * The 6502 disassembler: bytes to the text of an instruction. It is its own module (the opcode table, which the CPU part needs at
 * startup, is in `opcodes6502.ts`) so that it loads only with the ROM inspector and the tests.
 */

import { BY_OPCODE_6502, type Mode6502 } from './opcodes6502'

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0')

/**
 * One instruction as text, from `bytes` (the opcode and any operand bytes). `pc` is the instruction's address, to show a branch's
 * target. An opcode that is not documented gives `?`.
 */
export function disassemble6502(bytes: number[], pc = 0): { text: string; length: number } {
  const o = BY_OPCODE_6502[bytes[0] ?? 0]
  if (!o) return { text: `? $${hex(bytes[0] ?? 0, 2)}`, length: 1 }
  const b1 = bytes[1] ?? 0
  const w = b1 | ((bytes[2] ?? 0) << 8)
  const m = o.mnemonic
  const operand: Record<Mode6502, string> = {
    imp: '',
    acc: 'A',
    imm: `#$${hex(b1, 2)}`,
    zp: `$${hex(b1, 2)}`,
    zpx: `$${hex(b1, 2)},X`,
    zpy: `$${hex(b1, 2)},Y`,
    abs: `$${hex(w, 4)}`,
    abx: `$${hex(w, 4)},X`,
    aby: `$${hex(w, 4)},Y`,
    ind: `($${hex(w, 4)})`,
    izx: `($${hex(b1, 2)},X)`,
    izy: `($${hex(b1, 2)}),Y`,
    rel: `$${hex((pc + 2 + (b1 < 128 ? b1 : b1 - 256)) & 0xffff, 4)}`,
  }
  return { text: operand[o.mode] ? `${m} ${operand[o.mode]}` : m, length: o.bytes }
}
