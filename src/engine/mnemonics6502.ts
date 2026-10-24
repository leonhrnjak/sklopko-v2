/**
 * What each 6502 mnemonic does, for the reference page. These texts are their own module so that only the reference page loads
 * them; the opcode table (`opcodes6502.ts`), which the CPU part needs at startup, has none of them.
 */

export type Category6502 = 'Load and store' | 'Arithmetic' | 'Logic' | 'Shifts' | 'Compare' | 'Increment and decrement' | 'Transfers' | 'Stack' | 'Flags' | 'Jumps and branches' | 'Control'

export interface Mnemonic6502 {
  category: Category6502
  summary: string
  /** Flags it sets, as letters of NV-BDIZC. */
  flags: string
}

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

/** The instructions only the 65C02 has. `RMBn`, `SMBn`, `BBRn` and `BBSn` stand for the eight of each (n is the bit, 0 to 7). */
export const MNEMONICS_65C02: Record<string, Mnemonic6502> = {
  BRA: { category: 'Jumps and branches', summary: 'branch always', flags: '' },
  STZ: { category: 'Load and store', summary: 'memory = 0', flags: '' },
  PHX: { category: 'Stack', summary: 'push X', flags: '' },
  PHY: { category: 'Stack', summary: 'push Y', flags: '' },
  PLX: { category: 'Stack', summary: 'pull X', flags: 'N Z' },
  PLY: { category: 'Stack', summary: 'pull Y', flags: 'N Z' },
  TSB: { category: 'Logic', summary: 'test and set bits: Z = (A AND memory) is 0, then memory = memory OR A', flags: 'Z' },
  TRB: { category: 'Logic', summary: 'test and reset bits: Z = (A AND memory) is 0, then memory = memory AND NOT A', flags: 'Z' },
  RMBn: { category: 'Logic', summary: 'clear bit n (0 to 7) of a zero-page byte', flags: '' },
  SMBn: { category: 'Logic', summary: 'set bit n (0 to 7) of a zero-page byte', flags: '' },
  BBRn: { category: 'Jumps and branches', summary: 'branch if bit n (0 to 7) of a zero-page byte is 0', flags: '' },
  BBSn: { category: 'Jumps and branches', summary: 'branch if bit n (0 to 7) of a zero-page byte is 1', flags: '' },
  WAI: { category: 'Control', summary: 'wait for an interrupt: the CPU stops until IRQ or NMI (an IRQ goes on to the next instruction if I is 1)', flags: '' },
  STP: { category: 'Control', summary: 'stop the CPU until it is reset', flags: '' },
}

/** What else is different about an instruction the 65C02 also has. */
export const CHANGES_65C02: Record<string, string> = {
  INC: 'Also INC A.',
  DEC: 'Also DEC A.',
  BIT: 'Also with a constant (changes only Z), and with X.',
  JMP: 'Also JMP (nn,X); JMP (nn) no longer wraps at the end of a page.',
  ADC: 'Also (n). In decimal mode N and Z are right, and it takes one cycle more.',
  SBC: 'Also (n). In decimal mode N and Z are right, and it takes one cycle more.',
  AND: 'Also (n).',
  ORA: 'Also (n).',
  EOR: 'Also (n).',
  CMP: 'Also (n).',
  LDA: 'Also (n).',
  STA: 'Also (n).',
  BRK: 'Also clears D.',
  ASL: 'ASL, LSR, ROL and ROR with X take one cycle less.',
  LSR: 'ASL, LSR, ROL and ROR with X take one cycle less.',
  ROL: 'ASL, LSR, ROL and ROR with X take one cycle less.',
  ROR: 'ASL, LSR, ROL and ROR with X take one cycle less.',
}

