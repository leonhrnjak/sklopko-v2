/**
 * Instruction sets and a small assembler for programs held in a ROM.
 *
 * An instruction set describes how mnemonics map to machine words; the assembler and disassembler are table-driven
 * from it, so another computer example only needs another entry in `ISAS`.
 *
 * Source syntax, one instruction per line:
 *
 *     ; comment (also // comment)
 *     OUT = 15            a named constant
 *     loop:  ADD 3        a label (the address of the next instruction), then an instruction
 *            JNC loop     operands: decimal, 0x7F or $7F hex, 0b101 binary, a constant or a label
 *            .word 0x1234 a raw word, for data (this is also how the disassembler shows a word that isn't an instruction)
 */

const WORD = '.WORD'

/** What follows the mnemonic: nothing, a memory address, a jump target (which may reach further than an address), or an immediate value. */
export type ArgKind = 'none' | 'addr' | 'target' | 'imm'

export interface Op {
  code: number
  arg: ArgKind
}

export interface Isa {
  id: string
  name: string
  /** Width of one instruction word in bits (the ROM's data bits). */
  bits: number
  ops: Record<string, Op>
  /** Largest value of an address operand, of a jump target (if the set has any 'target' operands), and of an immediate operand. */
  maxAddr: number
  maxTarget?: number
  maxImm: number
  encode(op: Op, arg: number): number
  /** The opcode and operand of a word, or null if its opcode is not an instruction. */
  decode(word: number): { mnemonic: string; arg: number } | null
}

/**
 * The 8-bit computer. A word is `immediate (bits 8–15) | opcode (bits 4–6) | address (bits 0–3)`.
 * Bit 0 of ADD (4) / SUB (5) is wired straight to the adder's subtract line, which is why they are neighbours.
 */
const SK8_OPS: Record<string, Op> = {
  LDI: { code: 0, arg: 'imm' },
  LDA: { code: 1, arg: 'addr' },
  STA: { code: 2, arg: 'addr' },
  JMP: { code: 3, arg: 'addr' },
  ADD: { code: 4, arg: 'addr' },
  SUB: { code: 5, arg: 'addr' },
  JNC: { code: 6, arg: 'addr' },
  HALT: { code: 7, arg: 'none' },
}

export const SK8: Isa = {
  id: 'sk8',
  name: 'Sklopko 8-bit computer',
  bits: 16,
  ops: SK8_OPS,
  maxAddr: 15,
  maxImm: 255,
  encode: (op, arg) => (op.arg === 'imm' ? arg << 8 : 0) | (op.code << 4) | (op.arg === 'addr' ? arg : 0),
  decode(word) {
    const code = (word >> 4) & 7
    const found = Object.entries(SK8_OPS).find(([, op]) => op.code === code)
    if (!found) return null
    const [mnemonic, op] = found
    return { mnemonic, arg: op.arg === 'imm' ? (word >> 8) & 255 : op.arg === 'addr' ? word & 15 : 0 }
  },
}

/**
 * The second computer: the same word, with a fourth opcode bit (bits 4–7) and more instructions. A jump target has
 * five bits (the fifth is stored in bit 8, which only LDI and the immediate instructions otherwise use), so programs
 * can be 32 instructions long. Addresses 13, 14 and 15 are devices: `STA 15` prints the accumulator as a character,
 * `STA 14` lights the pixel at (low nibble, high nibble) of the accumulator and `STA 13` darkens it, and `LDA 15`
 * reads the keypad (the key in bits 0–3, and bit 4 set while one is held).
 */
const SK82_OPS: Record<string, Op> = {
  LDI: { code: 0, arg: 'imm' },
  LDA: { code: 1, arg: 'addr' },
  STA: { code: 2, arg: 'addr' },
  JMP: { code: 3, arg: 'target' },
  ADD: { code: 4, arg: 'addr' },
  SUB: { code: 5, arg: 'addr' },
  JNC: { code: 6, arg: 'target' },
  HALT: { code: 7, arg: 'none' },
  JZ: { code: 8, arg: 'target' },
  ADDI: { code: 9, arg: 'imm' },
  CMPI: { code: 10, arg: 'imm' },
  SHL: { code: 11, arg: 'none' },
  SHR: { code: 12, arg: 'none' },
  SUBI: { code: 13, arg: 'imm' },
}

export const SK82: Isa = {
  id: 'sk82',
  name: 'Sklopko 8-bit computer 2',
  bits: 16,
  ops: SK82_OPS,
  maxAddr: 15,
  maxTarget: 31,
  maxImm: 255,
  encode: (op, arg) =>
    (op.arg === 'imm' ? arg << 8 : op.arg === 'target' ? ((arg >> 4) & 1) << 8 : 0) | (op.code << 4) | (op.arg === 'addr' ? arg : op.arg === 'target' ? arg & 15 : 0),
  decode(word) {
    const code = (word >> 4) & 15
    const found = Object.entries(SK82_OPS).find(([, op]) => op.code === code)
    if (!found) return null
    const [mnemonic, op] = found
    const arg = op.arg === 'imm' ? (word >> 8) & 255 : op.arg === 'addr' ? word & 15 : op.arg === 'target' ? (word & 15) | (((word >> 8) & 1) << 4) : 0
    return { mnemonic, arg }
  },
}

export const ISAS: Isa[] = [SK8, SK82]

export const getIsa = (id: string): Isa | undefined => ISAS.find((i) => i.id === id)

export interface AsmError {
  /** 1-based source line. */
  line: number
  message: string
}

export interface AsmResult {
  /** The program as machine words, padded with zeros to the ROM's size. */
  words: number[]
  /** Source line (1-based) of the instruction at each address, for the instructions that were assembled. */
  lineOf: number[]
  errors: AsmError[]
  /** Label addresses and named constants. */
  symbols: Record<string, number>
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A number written in decimal, 0x… / $… hex or 0b… binary (with an optional minus sign), or null. */
export function parseNumber(token: string): number | null {
  const m = /^(-?)(?:0x([0-9a-f]+)|\$([0-9a-f]+)|0b([01]+)|([0-9]+))$/i.exec(token)
  if (!m) return null
  const [, sign, hex1, hex2, bin, dec] = m
  const n = hex1 !== undefined ? parseInt(hex1, 16) : hex2 !== undefined ? parseInt(hex2, 16) : bin !== undefined ? parseInt(bin, 2) : parseInt(dec, 10)
  return sign ? -n : n
}

interface Parsed {
  line: number
  mnemonic: string
  operand: string | undefined
}

/** Assemble `source` for `isa` into a ROM of `capacity` words. Collects every error instead of stopping at the first. */
export function assemble(isa: Isa, source: string, capacity: number): AsmResult {
  const errors: AsmError[] = []
  const err = (line: number, message: string) => errors.push({ line, message })
  const symbols: Record<string, number> = {}
  const constants = new Set<string>()
  const program: Parsed[] = []
  const mask = 2 ** isa.bits

  const define = (name: string, value: number, line: number, kind: 'label' | 'constant') => {
    if (!IDENT.test(name)) return err(line, `“${name}” is not a valid name (letters, digits and underscores, not starting with a digit).`)
    if (isa.ops[name.toUpperCase()]) return err(line, `“${name}” is an instruction name and can't be used as a ${kind}.`)
    if (name in symbols) return err(line, `“${name}” is already defined.`)
    symbols[name] = value
    if (kind === 'constant') constants.add(name)
  }

  // Pass 1: strip comments, collect labels, constants and instructions.
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    let text = raw.replace(/(?:;|\/\/).*$/, '').trim()
    if (!text) return
    const constant = /^([^\s=:]+)\s*=\s*(.*)$/.exec(text)
    if (constant) {
      const [, name, rest] = constant
      const n = parseNumber(rest.trim()) ?? (rest.trim() in symbols ? symbols[rest.trim()] : null)
      if (n === null) return err(line, `“${rest.trim()}” is not a number or a defined name.`)
      return define(name, n, line, 'constant')
    }
    const label = /^([^\s:]+)\s*:\s*(.*)$/.exec(text)
    if (label) {
      define(label[1], program.length, line, 'label')
      text = label[2]
      if (!text) return
    }
    const [mnemonic, ...operands] = text.split(/\s+/)
    if (!isa.ops[mnemonic.toUpperCase()] && mnemonic.toUpperCase() !== WORD) return err(line, `Unknown instruction “${mnemonic}”.`)
    if (operands.length > 1) return err(line, `${mnemonic.toUpperCase()} takes at most one operand, but there are ${operands.length}.`)
    program.push({ line, mnemonic: mnemonic.toUpperCase(), operand: operands[0] })
  })

  // Pass 2: encode, now that every label is known.
  const words = new Array<number>(capacity).fill(0)
  const lineOf: number[] = []
  program.forEach(({ line, mnemonic, operand }, address) => {
    const op = isa.ops[mnemonic]
    lineOf[address] = line
    if (address >= capacity) {
      if (address === capacity) err(line, `The program has more than ${capacity} instructions, the size of the ROM.`)
      return
    }
    if (mnemonic === WORD) {
      if (operand === undefined) return err(line, '.word needs a value.')
      const raw = parseNumber(operand) ?? (operand in symbols ? symbols[operand] : null)
      if (raw === null) return err(line, IDENT.test(operand) ? `Unknown name “${operand}”.` : `“${operand}” is not a number or a name.`)
      if (raw < 0 || raw >= mask) return err(line, `.word: the value ${raw} doesn't fit in ${isa.bits} bits.`)
      words[address] = raw
      return
    }
    if (op.arg === 'none') {
      if (operand !== undefined) return err(line, `${mnemonic} takes no operand.`)
      words[address] = isa.encode(op, 0)
      return
    }
    if (operand === undefined) return err(line, `${mnemonic} needs ${op.arg === 'imm' ? 'a value' : op.arg === 'target' ? 'a jump target' : 'an address'}.`)
    const value = parseNumber(operand) ?? (operand in symbols ? symbols[operand] : null)
    if (value === null) return err(line, IDENT.test(operand) ? `Unknown name “${operand}”.` : `“${operand}” is not a number or a name.`)
    // An immediate may be negative, written in two's complement: LDI -1 loads 255.
    const min = op.arg === 'imm' ? -(isa.maxImm + 1) / 2 : 0
    const max = op.arg === 'imm' ? isa.maxImm : op.arg === 'target' ? (isa.maxTarget ?? isa.maxAddr) : isa.maxAddr
    if (value < min || value > max)
      return err(
        line,
        op.arg === 'imm'
          ? `${mnemonic}: the value ${value} doesn't fit, it must be from ${min} to ${max}.`
          : `${mnemonic}: the ${op.arg === 'target' ? 'jump target' : 'address'} ${value} is out of range, it must be from 0 to ${max}.`,
      )
    const arg = value < 0 ? value + isa.maxImm + 1 : value
    words[address] = isa.encode(op, arg) % mask
  })
  errors.sort((a, b) => a.line - b.line)
  return { words, lineOf, errors, symbols }
}

/** One word as text: `LDI 200`, `HALT`, or `.word 0x1A2B` for a word that is not exactly an instruction. */
export function disassemble(isa: Isa, word: number): string {
  const d = isa.decode(word)
  if (d) {
    const op = isa.ops[d.mnemonic]
    if (isa.encode(op, d.arg) === word) return op.arg === 'none' ? d.mnemonic : `${d.mnemonic} ${d.arg}`
  }
  return `.word 0x${word.toString(16).toUpperCase().padStart(Math.ceil(isa.bits / 4), '0')}`
}

/** Machine words as the ROM's hex text: one word per group, zero-padded to the word width. */
export const toHexWords = (words: number[], bits: number): string =>
  words.map((w) => w.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')).join(' ')
