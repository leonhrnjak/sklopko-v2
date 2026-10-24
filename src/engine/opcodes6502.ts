/**
 * The documented instructions of the MOS 6502 (151 opcodes), as data. The CPU core, the assembler, the disassembler and the
 * reference page are generated from this table, the way `isa.ts` is for SKASM.
 *
 * An opcode is a mnemonic plus an addressing mode:
 *
 *   imp   nothing                       INX
 *   acc   the accumulator               ASL A
 *   imm   a constant                    LDA #$10
 *   zp    a zero-page address           LDA $10
 *   zpx   zero page + X (wraps)         LDA $10,X
 *   zpy   zero page + Y (wraps)         LDX $10,Y
 *   abs   a 16-bit address              LDA $1234
 *   abx   address + X                   LDA $1234,X
 *   aby   address + Y                   LDA $1234,Y
 *   ind   the address stored at...      JMP ($1234)
 *   izx   (zero page + X) is the address   LDA ($10,X)
 *   izy   (zero page) is the address, + Y  LDA ($10),Y
 *   rel   a signed offset from the next instruction    BNE label
 */

export type Mode6502 = 'imp' | 'acc' | 'imm' | 'zp' | 'zpx' | 'zpy' | 'abs' | 'abx' | 'aby' | 'ind' | 'izx' | 'izy' | 'rel'

/** Bytes of an instruction (opcode and operand) by addressing mode. */
export const MODE_BYTES: Record<Mode6502, number> = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, abs: 3, abx: 3, aby: 3, ind: 3, izx: 2, izy: 2, rel: 2 }

/** How an instruction touches memory, which decides its cycles: it reads, writes, reads then writes, or does neither. */
export type Kind6502 = 'read' | 'write' | 'rmw' | 'other'

export type Category6502 = 'Load and store' | 'Arithmetic' | 'Logic' | 'Shifts' | 'Compare' | 'Increment and decrement' | 'Transfers' | 'Stack' | 'Flags' | 'Jumps and branches' | 'Control'

export interface Opcode6502 {
  opcode: number
  mnemonic: string
  mode: Mode6502
  bytes: number
  /** Clock cycles, without the extra ones (+1 for a page crossing on an indexed read, +1 for a taken branch, +1 more if that crosses a page). */
  cycles: number
  /** The extra cycle when an indexed read crosses a page boundary. */
  pageCross: boolean
  kind: Kind6502
}

export interface Mnemonic6502 {
  category: Category6502
  summary: string
  /** Flags it sets, as letters of NV-BDIZC. */
  flags: string
}

const R = ['LDA', 'LDX', 'LDY', 'ADC', 'SBC', 'AND', 'ORA', 'EOR', 'CMP', 'CPX', 'CPY', 'BIT']
const W = ['STA', 'STX', 'STY']
const M = ['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC']

/** What each mnemonic does, for the reference page. */
export const MNEMONICS_6502: Record<string, Mnemonic6502> = {
  LDA: { category: 'Load and store', summary: 'A = memory', flags: 'N Z' },
  LDX: { category: 'Load and store', summary: 'X = memory', flags: 'N Z' },
  LDY: { category: 'Load and store', summary: 'Y = memory', flags: 'N Z' },
  STA: { category: 'Load and store', summary: 'memory = A', flags: '' },
  STX: { category: 'Load and store', summary: 'memory = X', flags: '' },
  STY: { category: 'Load and store', summary: 'memory = Y', flags: '' },
  ADC: { category: 'Arithmetic', summary: 'A = A + memory + carry (in decimal mode, as two BCD digits)', flags: 'N V Z C' },
  SBC: { category: 'Arithmetic', summary: 'A = A − memory − (1 − carry) (carry set means no borrow)', flags: 'N V Z C' },
  AND: { category: 'Logic', summary: 'A = A AND memory', flags: 'N Z' },
  ORA: { category: 'Logic', summary: 'A = A OR memory', flags: 'N Z' },
  EOR: { category: 'Logic', summary: 'A = A XOR memory', flags: 'N Z' },
  BIT: { category: 'Logic', summary: 'test bits: Z = (A AND memory) is 0; N and V are bits 7 and 6 of memory', flags: 'N V Z' },
  ASL: { category: 'Shifts', summary: 'shift left one bit (a 0 comes in, bit 7 goes to carry)', flags: 'N Z C' },
  LSR: { category: 'Shifts', summary: 'shift right one bit (a 0 comes in, bit 0 goes to carry)', flags: 'N Z C' },
  ROL: { category: 'Shifts', summary: 'rotate left through carry', flags: 'N Z C' },
  ROR: { category: 'Shifts', summary: 'rotate right through carry', flags: 'N Z C' },
  CMP: { category: 'Compare', summary: 'compare A with memory (flags as A − memory would set them)', flags: 'N Z C' },
  CPX: { category: 'Compare', summary: 'compare X with memory', flags: 'N Z C' },
  CPY: { category: 'Compare', summary: 'compare Y with memory', flags: 'N Z C' },
  INC: { category: 'Increment and decrement', summary: 'memory = memory + 1', flags: 'N Z' },
  DEC: { category: 'Increment and decrement', summary: 'memory = memory − 1', flags: 'N Z' },
  INX: { category: 'Increment and decrement', summary: 'X = X + 1', flags: 'N Z' },
  INY: { category: 'Increment and decrement', summary: 'Y = Y + 1', flags: 'N Z' },
  DEX: { category: 'Increment and decrement', summary: 'X = X − 1', flags: 'N Z' },
  DEY: { category: 'Increment and decrement', summary: 'Y = Y − 1', flags: 'N Z' },
  TAX: { category: 'Transfers', summary: 'X = A', flags: 'N Z' },
  TAY: { category: 'Transfers', summary: 'Y = A', flags: 'N Z' },
  TXA: { category: 'Transfers', summary: 'A = X', flags: 'N Z' },
  TYA: { category: 'Transfers', summary: 'A = Y', flags: 'N Z' },
  TSX: { category: 'Transfers', summary: 'X = stack pointer', flags: 'N Z' },
  TXS: { category: 'Transfers', summary: 'stack pointer = X', flags: '' },
  PHA: { category: 'Stack', summary: 'push A', flags: '' },
  PHP: { category: 'Stack', summary: 'push the flags', flags: '' },
  PLA: { category: 'Stack', summary: 'pull A', flags: 'N Z' },
  PLP: { category: 'Stack', summary: 'pull the flags', flags: 'all' },
  CLC: { category: 'Flags', summary: 'carry = 0', flags: 'C' },
  SEC: { category: 'Flags', summary: 'carry = 1', flags: 'C' },
  CLI: { category: 'Flags', summary: 'interrupt disable = 0 (interrupts allowed)', flags: 'I' },
  SEI: { category: 'Flags', summary: 'interrupt disable = 1', flags: 'I' },
  CLV: { category: 'Flags', summary: 'overflow = 0', flags: 'V' },
  CLD: { category: 'Flags', summary: 'decimal mode off', flags: 'D' },
  SED: { category: 'Flags', summary: 'decimal mode on', flags: 'D' },
  JMP: { category: 'Jumps and branches', summary: 'jump', flags: '' },
  JSR: { category: 'Jumps and branches', summary: 'call a subroutine: push the return address, jump', flags: '' },
  RTS: { category: 'Jumps and branches', summary: 'return from a subroutine', flags: '' },
  RTI: { category: 'Jumps and branches', summary: 'return from an interrupt: pull the flags and the address', flags: 'all' },
  BCC: { category: 'Jumps and branches', summary: 'branch if carry is 0', flags: '' },
  BCS: { category: 'Jumps and branches', summary: 'branch if carry is 1', flags: '' },
  BEQ: { category: 'Jumps and branches', summary: 'branch if zero is 1', flags: '' },
  BNE: { category: 'Jumps and branches', summary: 'branch if zero is 0', flags: '' },
  BMI: { category: 'Jumps and branches', summary: 'branch if negative is 1', flags: '' },
  BPL: { category: 'Jumps and branches', summary: 'branch if negative is 0', flags: '' },
  BVC: { category: 'Jumps and branches', summary: 'branch if overflow is 0', flags: '' },
  BVS: { category: 'Jumps and branches', summary: 'branch if overflow is 1', flags: '' },
  BRK: { category: 'Control', summary: 'software interrupt: push PC + 2 and the flags, jump through the vector at $FFFE', flags: 'I' },
  NOP: { category: 'Control', summary: 'do nothing', flags: '' },
}

/** Each mnemonic with the opcode of each addressing mode it has. */
const ENCODINGS: Record<string, Partial<Record<Mode6502, number>>> = {
  LDA: { imm: 0xa9, zp: 0xa5, zpx: 0xb5, abs: 0xad, abx: 0xbd, aby: 0xb9, izx: 0xa1, izy: 0xb1 },
  LDX: { imm: 0xa2, zp: 0xa6, zpy: 0xb6, abs: 0xae, aby: 0xbe },
  LDY: { imm: 0xa0, zp: 0xa4, zpx: 0xb4, abs: 0xac, abx: 0xbc },
  STA: { zp: 0x85, zpx: 0x95, abs: 0x8d, abx: 0x9d, aby: 0x99, izx: 0x81, izy: 0x91 },
  STX: { zp: 0x86, zpy: 0x96, abs: 0x8e },
  STY: { zp: 0x84, zpx: 0x94, abs: 0x8c },
  ADC: { imm: 0x69, zp: 0x65, zpx: 0x75, abs: 0x6d, abx: 0x7d, aby: 0x79, izx: 0x61, izy: 0x71 },
  SBC: { imm: 0xe9, zp: 0xe5, zpx: 0xf5, abs: 0xed, abx: 0xfd, aby: 0xf9, izx: 0xe1, izy: 0xf1 },
  AND: { imm: 0x29, zp: 0x25, zpx: 0x35, abs: 0x2d, abx: 0x3d, aby: 0x39, izx: 0x21, izy: 0x31 },
  ORA: { imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0d, abx: 0x1d, aby: 0x19, izx: 0x01, izy: 0x11 },
  EOR: { imm: 0x49, zp: 0x45, zpx: 0x55, abs: 0x4d, abx: 0x5d, aby: 0x59, izx: 0x41, izy: 0x51 },
  CMP: { imm: 0xc9, zp: 0xc5, zpx: 0xd5, abs: 0xcd, abx: 0xdd, aby: 0xd9, izx: 0xc1, izy: 0xd1 },
  CPX: { imm: 0xe0, zp: 0xe4, abs: 0xec },
  CPY: { imm: 0xc0, zp: 0xc4, abs: 0xcc },
  BIT: { zp: 0x24, abs: 0x2c },
  ASL: { acc: 0x0a, zp: 0x06, zpx: 0x16, abs: 0x0e, abx: 0x1e },
  LSR: { acc: 0x4a, zp: 0x46, zpx: 0x56, abs: 0x4e, abx: 0x5e },
  ROL: { acc: 0x2a, zp: 0x26, zpx: 0x36, abs: 0x2e, abx: 0x3e },
  ROR: { acc: 0x6a, zp: 0x66, zpx: 0x76, abs: 0x6e, abx: 0x7e },
  INC: { zp: 0xe6, zpx: 0xf6, abs: 0xee, abx: 0xfe },
  DEC: { zp: 0xc6, zpx: 0xd6, abs: 0xce, abx: 0xde },
  INX: { imp: 0xe8 },
  INY: { imp: 0xc8 },
  DEX: { imp: 0xca },
  DEY: { imp: 0x88 },
  TAX: { imp: 0xaa },
  TXA: { imp: 0x8a },
  TAY: { imp: 0xa8 },
  TYA: { imp: 0x98 },
  TSX: { imp: 0xba },
  TXS: { imp: 0x9a },
  PHA: { imp: 0x48 },
  PLA: { imp: 0x68 },
  PHP: { imp: 0x08 },
  PLP: { imp: 0x28 },
  CLC: { imp: 0x18 },
  SEC: { imp: 0x38 },
  CLI: { imp: 0x58 },
  SEI: { imp: 0x78 },
  CLV: { imp: 0xb8 },
  CLD: { imp: 0xd8 },
  SED: { imp: 0xf8 },
  NOP: { imp: 0xea },
  JMP: { abs: 0x4c, ind: 0x6c },
  JSR: { abs: 0x20 },
  RTS: { imp: 0x60 },
  RTI: { imp: 0x40 },
  BRK: { imp: 0x00 },
  BCC: { rel: 0x90 },
  BCS: { rel: 0xb0 },
  BEQ: { rel: 0xf0 },
  BNE: { rel: 0xd0 },
  BMI: { rel: 0x30 },
  BPL: { rel: 0x10 },
  BVC: { rel: 0x50 },
  BVS: { rel: 0x70 },
}

const kindOf = (mnemonic: string, mode: Mode6502): Kind6502 =>
  R.includes(mnemonic) ? 'read' : W.includes(mnemonic) ? 'write' : M.includes(mnemonic) && mode !== 'acc' ? 'rmw' : 'other'

/** Base cycles of an instruction: how many clocks it takes when nothing extra happens. */
function baseCycles(mnemonic: string, mode: Mode6502, kind: Kind6502): number {
  const special: Record<string, number> = { PHA: 3, PHP: 3, PLA: 4, PLP: 4, RTS: 6, RTI: 6, BRK: 7, JSR: 6 }
  if (mnemonic in special) return special[mnemonic]
  if (mnemonic === 'JMP') return mode === 'abs' ? 3 : 5
  const rmw = kind === 'rmw'
  switch (mode) {
    case 'imp':
    case 'acc':
    case 'imm':
    case 'rel':
      return 2
    case 'zp':
      return rmw ? 5 : 3
    case 'zpx':
    case 'zpy':
      return rmw ? 6 : 4
    case 'abs':
      return rmw ? 6 : 4
    case 'abx':
    case 'aby':
      return rmw ? 7 : kind === 'write' ? 5 : 4
    case 'izx':
      return 6
    case 'izy':
      return kind === 'write' ? 6 : 5
    case 'ind':
      return 5
  }
}

/** All 151 documented opcodes, by mnemonic then by mode. */
export const OPCODES_6502: Opcode6502[] = Object.entries(ENCODINGS).flatMap(([mnemonic, modes]) =>
  (Object.entries(modes) as [Mode6502, number][]).map(([mode, opcode]) => {
    const kind = kindOf(mnemonic, mode)
    return {
      opcode,
      mnemonic,
      mode,
      bytes: MODE_BYTES[mode],
      cycles: baseCycles(mnemonic, mode, kind),
      pageCross: kind === 'read' && (mode === 'abx' || mode === 'aby' || mode === 'izy'),
      kind,
    }
  }),
)

/** The opcode table indexed by opcode; undefined for the opcodes that are not documented. */
export const BY_OPCODE_6502: (Opcode6502 | undefined)[] = (() => {
  const t = new Array<Opcode6502 | undefined>(256).fill(undefined)
  for (const o of OPCODES_6502) t[o.opcode] = o
  return t
})()

/** Opcode of a mnemonic in an addressing mode, or undefined if the instruction does not have that mode. */
export const opcodeOf6502 = (mnemonic: string, mode: Mode6502): number | undefined => ENCODINGS[mnemonic.toUpperCase()]?.[mode]

/** The addressing modes a mnemonic has. */
export const modesOf6502 = (mnemonic: string): Mode6502[] => Object.keys(ENCODINGS[mnemonic.toUpperCase()] ?? {}) as Mode6502[]

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
