/**
 * SKASM, the assembly language of every Sklopko computer, and a small assembler for programs held in a ROM.
 *
 * The instruction set is a table (`SKASM_OPS`); the assembler, the disassembler, the ROM listing and the language
 * reference page are all generated from it, so an instruction is one row here (plus one row in the computers' control
 * ROM).
 *
 * A 16-bit instruction word is `bits 12–15 | bits 8–11 | opcode (bits 4–7) | bits 0–3`:
 *
 *   - Opcodes 0–13 are the main instructions. Their operand is an immediate (bits 8–15), a RAM address (bits 0–3) or a
 *     jump target (bits 0–3 and bits 8–11).
 *   - Opcode 14 is the extension group for immediates ("EXT-I"): the immediate is in bits 8–15, the sub-opcode in bits 0–3.
 *   - Opcode 15 is the extension group for addresses, ports and jump targets ("EXT-M"): the operand is placed as in the
 *     main group, the sub-opcode is in bits 12–15.
 *
 * Source syntax, one instruction per line:
 *
 *     ; comment (also // comment)
 *     SHOW = 15           a named constant
 *     loop:  ADD 3        a label (the address of the next instruction), then an instruction
 *            JNC loop     operands: decimal, 0x7F or $7F hex, 0b101 binary, a constant, a label or a port name
 *            OUT CHAR     port names are built in (see PORTS)
 *            .word 0x1234 a raw word, for data (this is also how the disassembler shows a word that isn't an instruction)
 *            .byte 1, 2, 3  bytes for the table (up to 256), read with LDT; a label in front of it is the table address of the first
 */

const WORD = '.WORD'
const BYTE = '.BYTE'
/** The size of the table that `.byte` fills. */
export const TABLE_SIZE = 256

/** What follows the mnemonic: nothing, a memory address, a jump target (which reaches further than an address), an immediate value or a port number. */
export type ArgKind = 'none' | 'addr' | 'target' | 'imm' | 'port'

/** Opcodes of the two extension groups: 14 holds instructions with an immediate, 15 those with an address, port or target. */
export const EXT_IMM = 14
export const EXT_MEM = 15

export interface Op {
  /** The opcode, bits 4–7 of the word. */
  code: number
  arg: ArgKind
  /** The sub-opcode of an instruction in an extension group (opcodes 14 and 15). */
  sub?: number
  /** For the language reference. */
  category: OpCategory
  /** What it does, in one line. */
  summary: string
  /** Which flags it sets: carry (C) and zero (Z). */
  flags: string
}

export type OpCategory = 'Load and store' | 'Index register' | 'Arithmetic' | 'Logic' | 'Shifts' | 'Jumps' | 'Input and output' | 'Control'

/** A mnemonic that stands for another instruction with a fixed operand; it needs no hardware of its own. */
export interface Alias {
  op: string
  arg: number
  summary: string
}

export interface Port {
  name: string
  number: number
  /** `OUT` sends the accumulator to the device, `IN` reads from it. */
  dir: 'out' | 'in'
  summary: string
}

export interface Isa {
  id: string
  name: string
  /** Width of one instruction word in bits (the ROM's data bits). */
  bits: number
  ops: Record<string, Op>
  aliases: Record<string, Alias>
  /** Largest value of an address operand, of a jump target, of an immediate operand and of a port number. */
  maxAddr: number
  maxTarget: number
  maxImm: number
  maxPort: number
  encode(op: Op, arg: number): number
  /** The opcode and operand of a word, or null if it is not an instruction. Bits the instruction doesn't use are ignored. */
  decode(word: number): { mnemonic: string; arg: number } | null
}

const op = (code: number, arg: ArgKind, category: OpCategory, summary: string, flags = '', extra: Partial<Op> = {}): Op => ({
  code,
  arg,
  category,
  summary,
  flags,
  ...extra,
})
/** An instruction of the immediate extension group. */
const extImm = (sub: number, category: OpCategory, summary: string, flags = '') => op(EXT_IMM, 'imm', category, summary, flags, { sub })
/** An instruction of the immediate extension group that takes no operand (the bits 8–15 are not used). */
const extImmNone = (sub: number, category: OpCategory, summary: string, flags = '') => op(EXT_IMM, 'none', category, summary, flags, { sub })
/** An instruction of the address / port / target extension group. */
const extMem = (sub: number, arg: ArgKind, category: OpCategory, summary: string, flags = '') =>
  op(EXT_MEM, arg, category, summary, flags, { sub })

/**
 * The instructions. Opcodes 0–13 are the original ones (their encodings never change). Bit 0 of ADD (4) / SUB (5) is wired
 * straight to the adder's subtract line, which is why they are neighbours.
 */
export const SKASM_OPS: Record<string, Op> = {
  LDI: op(0, 'imm', 'Load and store', 'ACC = n'),
  LDA: op(1, 'addr', 'Load and store', 'ACC = RAM[a]'),
  STA: op(2, 'addr', 'Load and store', 'RAM[a] = ACC'),
  JMP: op(3, 'target', 'Jumps', 'jump to t'),
  ADD: op(4, 'addr', 'Arithmetic', 'ACC = ACC + RAM[a]', 'C Z'),
  SUB: op(5, 'addr', 'Arithmetic', 'ACC = ACC − RAM[a]', 'C Z'),
  JNC: op(6, 'target', 'Jumps', 'jump to t if the carry flag is 0'),
  HALT: op(7, 'none', 'Control', 'stop: the program counter stays here'),
  JZ: op(8, 'target', 'Jumps', 'jump to t if the zero flag is 1'),
  ADDI: op(9, 'imm', 'Arithmetic', 'ACC = ACC + n', 'C Z'),
  CMPI: op(10, 'imm', 'Arithmetic', 'compare: set the flags as ACC − n would, ACC stays as it is', 'C Z'),
  SHL: op(11, 'none', 'Shifts', 'ACC = ACC shifted left one bit (a 0 comes in, the top bit is lost)'),
  SHR: op(12, 'none', 'Shifts', 'ACC = ACC shifted right one bit (a 0 comes in, the bottom bit is lost)'),
  SUBI: op(13, 'imm', 'Arithmetic', 'ACC = ACC − n', 'C Z'),
  // Extension group for immediates (opcode 14).
  ANDI: extImm(0, 'Logic', 'ACC = ACC AND n (bit by bit)', 'Z, C = 0'),
  ORI: extImm(1, 'Logic', 'ACC = ACC OR n (bit by bit)', 'Z, C = 0'),
  XORI: extImm(2, 'Logic', 'ACC = ACC XOR n (bit by bit)', 'Z, C = 0'),
  // The index register X, and the 256 bytes of RAM it reaches (the first 16 are also reachable by the address of an instruction).
  LDXI: extImm(3, 'Index register', 'X = n (a constant)'),
  TAX: extImmNone(4, 'Index register', 'X = ACC'),
  TXA: extImmNone(5, 'Index register', 'ACC = X'),
  INX: extImmNone(6, 'Index register', 'X = X + 1 (255 + 1 is 0)', 'Z, C = 0'),
  DEX: extImmNone(7, 'Index register', 'X = X − 1 (0 − 1 is 255)', 'Z, C = 0'),
  LDX: extImmNone(8, 'Index register', 'ACC = RAM[X], any of the 256 bytes'),
  STX: extImmNone(9, 'Index register', 'RAM[X] = ACC, any of the 256 bytes'),
  LDT: extImmNone(10, 'Index register', 'ACC = TABLE[X]: a constant from the table that .byte fills in (read only)'),
  // Extension group for addresses, ports and jump targets (opcode 15).
  OUT: extMem(0, 'port', 'Input and output', 'send ACC to port p'),
  IN: extMem(1, 'port', 'Input and output', 'ACC = the value from port p (0 if nothing is connected there)'),
  JNZ: extMem(2, 'target', 'Jumps', 'jump to t if the zero flag is 0'),
  JC: extMem(3, 'target', 'Jumps', 'jump to t if the carry flag is 1'),
  CMP: extMem(4, 'addr', 'Arithmetic', 'compare: set the flags as ACC − RAM[a] would, ACC stays as it is', 'C Z'),
  AND: extMem(5, 'addr', 'Logic', 'ACC = ACC AND RAM[a] (bit by bit)', 'Z, C = 0'),
  OR: extMem(6, 'addr', 'Logic', 'ACC = ACC OR RAM[a] (bit by bit)', 'Z, C = 0'),
  XOR: extMem(7, 'addr', 'Logic', 'ACC = ACC XOR RAM[a] (bit by bit)', 'Z, C = 0'),
  ADC: extMem(8, 'addr', 'Arithmetic', 'ACC = ACC + RAM[a] + carry', 'C Z'),
  SBC: extMem(9, 'addr', 'Arithmetic', 'ACC = ACC − RAM[a] − carry (the carry flag is the borrow of the last subtraction)', 'C Z'),
  NOP: extMem(10, 'none', 'Control', 'do nothing'),
  CALL: extMem(11, 'target', 'Jumps', 'jump to t, remembering the next instruction so that RET can come back (16 calls deep)'),
  RET: extMem(12, 'none', 'Jumps', 'jump back to the instruction after the last CALL that has not returned yet'),
}

/** Short forms. They are replaced by the instruction they stand for when assembling, so they never need hardware. */
export const SKASM_ALIASES: Record<string, Alias> = {
  INC: { op: 'ADDI', arg: 1, summary: 'ACC = ACC + 1 (same as ADDI 1)' },
  DEC: { op: 'SUBI', arg: 1, summary: 'ACC = ACC − 1 (same as SUBI 1)' },
  CLR: { op: 'LDI', arg: 0, summary: 'ACC = 0 (same as LDI 0)' },
  NOT: { op: 'XORI', arg: 255, summary: 'ACC = every bit of ACC flipped (same as XORI 255)' },
}

/**
 * The ports every computer has, under the same names. A port is a connection to a device: `OUT` sends the accumulator,
 * `IN` reads. A computer that lacks the device ignores `OUT` and reads 0 from `IN`.
 */
export const PORTS: Port[] = [
  { name: 'NUMBER', number: 0, dir: 'out', summary: 'the decimal display: ACC, shown as a number' },
  { name: 'CHAR', number: 1, dir: 'out', summary: 'the text console: ACC as an ASCII character (10 = new line, 8 = backspace, 12 = clear)' },
  { name: 'PIXEL_ON', number: 2, dir: 'out', summary: 'the screen: light the pixel at x = low half of ACC, y = high half' },
  { name: 'PIXEL_OFF', number: 3, dir: 'out', summary: 'the screen: darken that pixel' },
  { name: 'SPEAKER', number: 4, dir: 'out', summary: 'the speaker: flip it (a tone is a quick series of flips)' },
  { name: 'KEY', number: 5, dir: 'in', summary: 'the keypad: the last key in bits 0–3, bit 4 set while a press waits' },
  { name: 'KEY_ACK', number: 5, dir: 'out', summary: 'the keypad: say the key has been read, so bit 4 clears' },
  { name: 'PAD', number: 6, dir: 'in', summary: 'the gamepad: the buttons held right now, one bit each: up 1, down 2, left 4, right 8, A 16, B 32' },
]

const portNumber = (name: string) => PORTS.find((p) => p.name === name)?.number
const portName = (number: number, dir: 'out' | 'in') => PORTS.find((p) => p.number === number && p.dir === dir)?.name

const MAIN_BY_CODE = new Map<number, string>()
const EXT_BY_SUB = new Map<string, string>()
for (const [mnemonic, o] of Object.entries(SKASM_OPS)) {
  if (o.sub === undefined) MAIN_BY_CODE.set(o.code, mnemonic)
  else EXT_BY_SUB.set(`${o.code}:${o.sub}`, mnemonic)
}

export const SKASM: Isa = {
  id: 'skasm',
  name: 'SKASM',
  bits: 16,
  ops: SKASM_OPS,
  aliases: SKASM_ALIASES,
  maxAddr: 15,
  maxTarget: 255,
  maxImm: 255,
  maxPort: 15,
  encode(o, arg) {
    let word = o.code << 4
    if (o.arg === 'imm') word |= arg << 8
    else if (o.arg === 'addr' || o.arg === 'port') word |= arg
    else if (o.arg === 'target') word |= (arg & 15) | (((arg >> 4) & 15) << 8)
    if (o.sub !== undefined) word |= o.code === EXT_IMM ? o.sub : o.sub << 12
    return word
  },
  decode(word) {
    const code = (word >> 4) & 15
    const mnemonic = code === EXT_IMM ? EXT_BY_SUB.get(`${code}:${word & 15}`) : code === EXT_MEM ? EXT_BY_SUB.get(`${code}:${(word >> 12) & 15}`) : MAIN_BY_CODE.get(code)
    if (!mnemonic) return null
    const o = SKASM_OPS[mnemonic]
    const arg =
      o.arg === 'imm' ? (word >> 8) & 255 : o.arg === 'addr' || o.arg === 'port' ? word & 15 : o.arg === 'target' ? (word & 15) | (((word >> 8) & 15) << 4) : 0
    return { mnemonic, arg }
  },
}

export const ISAS: Isa[] = [SKASM]

/** Ids that circuits saved before SKASM used for a ROM's instruction set; they all mean SKASM now. */
const LEGACY_IDS: Record<string, string> = { sk8: SKASM.id, sk82: SKASM.id }

/** The id a saved ROM should have today (an old instruction set's id becomes `skasm`; anything else stays as it is). */
export const currentIsaId = (id: string): string => LEGACY_IDS[id] ?? id

export const getIsa = (id: string): Isa | undefined => ISAS.find((i) => i.id === currentIsaId(id))

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
  /** The bytes of the table (`.byte`), at most 256 of them, in order. */
  table: number[]
  /** Label addresses and named constants (not the built-in port names). */
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

const needs: Record<ArgKind, string> = { none: '', imm: 'a value', addr: 'an address', target: 'a jump target', port: 'a port' }
const rangeName: Record<ArgKind, string> = { none: '', imm: 'value', addr: 'address', target: 'jump target', port: 'port' }

/** Assemble `source` for `isa` into a ROM of `capacity` words. Collects every error instead of stopping at the first. */
export function assemble(isa: Isa, source: string, capacity: number): AsmResult {
  const errors: AsmError[] = []
  const err = (line: number, message: string) => errors.push({ line, message })
  const symbols: Record<string, number> = {}
  const program: Parsed[] = []
  const bytes: { line: number; token: string }[] = []
  const mask = 2 ** isa.bits
  const isInstruction = (name: string) => name.toUpperCase() in isa.ops || name.toUpperCase() in isa.aliases

  /** A number, a label or constant, or a built-in port name. */
  const valueOf = (token: string): number | null => parseNumber(token) ?? (Object.hasOwn(symbols, token) ? symbols[token] : (portNumber(token) ?? null))

  const define = (name: string, value: number, line: number, kind: 'label' | 'constant') => {
    if (!IDENT.test(name)) return err(line, `“${name}” is not a valid name (letters, digits and underscores, not starting with a digit).`)
    if (isInstruction(name)) return err(line, `“${name}” is an instruction name and can't be used as a ${kind}.`)
    if (portNumber(name) !== undefined) return err(line, `“${name}” is the name of a port and can't be used as a ${kind}.`)
    if (Object.hasOwn(symbols, name)) return err(line, `“${name}” is already defined.`)
    symbols[name] = value
  }

  // Pass 1: strip comments, collect labels, constants and instructions.
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    let text = raw.replace(/(?:;|\/\/).*$/, '').trim()
    if (!text) return
    const constant = /^([^\s=:]+)\s*=\s*(.*)$/.exec(text)
    if (constant) {
      const [, name, rest] = constant
      const n = valueOf(rest.trim())
      if (n === null) return err(line, `“${rest.trim()}” is not a number or a defined name.`)
      return define(name, n, line, 'constant')
    }
    const label = /^([^\s:]+)\s*:\s*(.*)$/.exec(text)
    if (label) {
      // A label in front of .byte names a place in the table, in front of anything else a place in the program.
      define(label[1], label[2].toUpperCase().startsWith(BYTE) ? bytes.length : program.length, line, 'label')
      text = label[2]
      if (!text) return
    }
    if (text.toUpperCase().startsWith(BYTE) && /^\.byte(\s|$)/i.test(text)) {
      const list = text.slice(BYTE.length).split(/[\s,]+/).filter(Boolean)
      if (!list.length) return err(line, '.byte needs at least one value.')
      return list.forEach((token) => bytes.push({ line, token }))
    }
    const [mnemonic, ...operands] = text.split(/\s+/)
    const upper = mnemonic.toUpperCase()
    if (!isInstruction(mnemonic) && upper !== WORD) return err(line, `Unknown instruction “${mnemonic}”.`)
    if (upper in isa.aliases) {
      if (operands.length) return err(line, `${upper} takes no operand.`)
      const a = isa.aliases[upper]
      return program.push({ line, mnemonic: a.op, operand: String(a.arg) })
    }
    if (operands.length > 1) return err(line, `${upper} takes at most one operand, but there are ${operands.length}.`)
    program.push({ line, mnemonic: upper, operand: operands[0] })
  })

  // Pass 2: encode, now that every label is known.
  const words = new Array<number>(capacity).fill(0)
  const lineOf: number[] = []
  program.forEach(({ line, mnemonic, operand }, address) => {
    const o = isa.ops[mnemonic]
    lineOf[address] = line
    if (address >= capacity) {
      if (address === capacity) err(line, `The program has more than ${capacity} instructions, the size of the ROM.`)
      return
    }
    if (mnemonic === WORD) {
      if (operand === undefined) return err(line, '.word needs a value.')
      const raw = valueOf(operand)
      if (raw === null) return err(line, IDENT.test(operand) ? `Unknown name “${operand}”.` : `“${operand}” is not a number or a name.`)
      if (raw < 0 || raw >= mask) return err(line, `.word: the value ${raw} doesn't fit in ${isa.bits} bits.`)
      words[address] = raw
      return
    }
    if (o.arg === 'none') {
      if (operand !== undefined) return err(line, `${mnemonic} takes no operand.`)
      words[address] = isa.encode(o, 0)
      return
    }
    if (operand === undefined) return err(line, `${mnemonic} needs ${needs[o.arg]}.`)
    const value = valueOf(operand)
    if (value === null) return err(line, IDENT.test(operand) ? `Unknown name “${operand}”.` : `“${operand}” is not a number or a name.`)
    // An immediate may be negative, written in two's complement: LDI -1 loads 255.
    const min = o.arg === 'imm' ? -(isa.maxImm + 1) / 2 : 0
    const max = o.arg === 'imm' ? isa.maxImm : o.arg === 'target' ? isa.maxTarget : o.arg === 'port' ? isa.maxPort : isa.maxAddr
    if (value < min || value > max)
      return err(
        line,
        o.arg === 'imm'
          ? `${mnemonic}: the value ${value} doesn't fit, it must be from ${min} to ${max}.`
          : `${mnemonic}: the ${rangeName[o.arg]} ${value} is out of range, it must be from 0 to ${max}.`,
      )
    const arg = value < 0 ? value + isa.maxImm + 1 : value
    words[address] = isa.encode(o, arg) % mask
  })
  // The table: the bytes of every .byte, in order.
  const table: number[] = []
  bytes.forEach(({ line, token }, i) => {
    if (i === TABLE_SIZE) err(line, `The table has more than ${TABLE_SIZE} bytes.`)
    if (i >= TABLE_SIZE) return
    const value = valueOf(token)
    if (value === null) return err(line, IDENT.test(token) ? `Unknown name “${token}”.` : `“${token}” is not a number or a name.`)
    if (value < -128 || value > 255) return err(line, `.byte: the value ${value} doesn't fit, it must be from -128 to 255.`)
    table[i] = value < 0 ? value + 256 : value
  })
  errors.sort((a, b) => a.line - b.line)
  return { words, lineOf, errors, table, symbols }
}

/** One word as text: `LDI 200`, `HALT`, `OUT CHAR`, or `.word 0x1A2B` for a word that is not exactly an instruction. */
export function disassemble(isa: Isa, word: number): string {
  const d = isa.decode(word)
  if (d) {
    const o = isa.ops[d.mnemonic]
    if (isa.encode(o, d.arg) === word) {
      if (o.arg === 'none') return d.mnemonic
      if (o.arg === 'port') return `${d.mnemonic} ${portName(d.arg, d.mnemonic === 'IN' ? 'in' : 'out') ?? d.arg}`
      return `${d.mnemonic} ${d.arg}`
    }
  }
  return `.word 0x${word.toString(16).toUpperCase().padStart(Math.ceil(isa.bits / 4), '0')}`
}

/** Machine words as the ROM's hex text: one word per group, zero-padded to the word width. */
export const toHexWords = (words: number[], bits: number): string =>
  words.map((w) => w.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')).join(' ')

/** The table as the ROM's hex text: one byte per group, up to the last one that is not 0 (empty if they are all 0). */
export const toHexBytes = (table: number[]): string => {
  let last = table.length
  while (last > 0 && !table[last - 1]) last--
  return table.slice(0, last).map((b) => (b ?? 0).toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

/** One part of an instruction word: bits `from`..`to` (0 is the lowest bit, which is the ROM's `D0`) and what they hold. */
export interface WordField {
  /** What the bits are: 'opcode', 'sub-opcode', or the operand ('constant', 'RAM address', 'port', 'jump target (low half)'...). */
  name: string
  from: number
  to: number
  value: number
}

/**
 * How an instruction word is made up, field by field: the opcode in bits 4–7, the operand (a constant, an address, a port
 * or a jump target, which is in two halves), and the sub-opcode of an instruction in an extension group. Bits the instruction
 * does not use are in no field. Returns null for a word that is not exactly an instruction (see `disassemble`).
 */
export function wordFields(isa: Isa, word: number): { mnemonic: string; fields: WordField[] } | null {
  const d = isa.decode(word)
  if (!d) return null
  const o = isa.ops[d.mnemonic]
  if (isa.encode(o, d.arg) !== word) return null
  const bits = (from: number, to: number) => (word >> from) & (2 ** (to - from + 1) - 1)
  const field = (name: string, from: number, to: number): WordField => ({ name, from, to, value: bits(from, to) })
  const fields: WordField[] = [field('opcode', 4, 7)]
  if (o.arg === 'imm') fields.push(field('constant', 8, 15))
  else if (o.arg === 'addr') fields.push(field('RAM address', 0, 3))
  else if (o.arg === 'port') fields.push(field('port', 0, 3))
  else if (o.arg === 'target') fields.push(field('jump target, low half', 0, 3), field('jump target, high half', 8, 11))
  if (o.sub !== undefined) fields.push(o.code === EXT_IMM ? field('sub-opcode', 0, 3) : field('sub-opcode', 12, 15))
  return { mnemonic: d.mnemonic, fields: fields.sort((a, b) => b.from - a.from) }
}
