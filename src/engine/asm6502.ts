/**
 * An assembler for the MOS 6502, in the syntax the chip's own manuals and today's assemblers use:
 *
 *     LDA #$01        a constant                  LDA ($20),Y   the address stored at $20 and $21, plus Y
 *     LDA $10         zero page, or LDA $1234     LDA ($20,X)   the address stored at $20+X
 *     LDA $10,X       plus X (or ,Y)              JMP ($FFFC)   jump to the address stored there
 *
 * The opcodes come from the table in `opcodes6502.ts`, the same one the CPU core runs. Like `assemble` in `isa.ts` it collects
 * every error instead of stopping at the first, and shares the reading of numbers, names and comments with it (`asmlex.ts`).
 *
 * Directives: `.org` (or `*=`) sets the address the next byte is for, `.byte` and `.word` place data, `.res` leaves a gap of
 * zeros. Operands are an expression: numbers, names, `*` (this address) and `+` / `-`, with `<` or `>` in front for the low or
 * high byte of the result.
 *
 * A ROM image starts at the first `.org`: that is the address of the ROM's first byte, so a ROM that sits at `$F000` begins with
 * `.org $F000`. Without one the program starts at 0.
 */

import { IDENT, matchConstant, matchLabel, stripComment, type AsmError } from './asmlex'
import { disassemble6502 } from './disasm6502'
import { DOCUMENTED_65C02, ENCODINGS_65C02 } from './opcodes65c02'
import { BY_OPCODE_6502, ENCODINGS, MODE_BYTES, type Mode6502 } from './opcodes6502'

/** Opcode of a mnemonic in an addressing mode, or undefined if the instruction does not have that mode. */
export const opcodeOf6502 = (mnemonic: string, mode: Mode6502, cmos = false): number | undefined => (cmos ? ENCODINGS_65C02 : ENCODINGS)[mnemonic.toUpperCase()]?.[mode]

/** The addressing modes a mnemonic has. */
export const modesOf6502 = (mnemonic: string, cmos = false): Mode6502[] => Object.keys((cmos ? ENCODINGS_65C02 : ENCODINGS)[mnemonic.toUpperCase()] ?? {}) as Mode6502[]

/** One thing the assembler placed: an instruction, some data bytes or a gap. */
export interface Item6502 {
  /** The address (in the CPU's address space) of its first byte. */
  addr: number
  /** The bytes it holds (empty for a gap). */
  bytes: number[]
  /** For a gap, how many zero bytes. */
  gap?: number
  /** 1-based source line. */
  line: number
  kind: 'code' | 'data' | 'gap'
}

export interface Asm6502Result {
  /** The ROM image: `capacity` bytes, 0 where nothing was placed. */
  bytes: number[]
  /** The address of the image's first byte (the program's first `.org`). */
  base: number
  items: Item6502[]
  errors: AsmError[]
  /** Label addresses and named constants. */
  symbols: Record<string, number>
}

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0')

/** How each addressing mode is written, for error messages. */
const SYNTAX: Record<Mode6502, string> = {
  imp: '',
  acc: 'A',
  imm: '#value',
  zp: 'address (0 to 255)',
  zpx: 'address,X (0 to 255)',
  zpy: 'address,Y (0 to 255)',
  abs: 'address',
  abx: 'address,X',
  aby: 'address,Y',
  ind: '(address)',
  izx: '(address,X)',
  izy: '(address),Y',
  rel: 'label',
  izp: '(address)',
  iax: '(address,X)',
  zpr: 'address,label',
}

/** What the operand looks like, before the mnemonic decides which of the modes it is. */
type Shape = 'none' | 'acc' | 'imm' | 'direct' | 'x' | 'y' | 'ind' | 'izx' | 'izy'

/** The operand text without its decoration, and the shape the decoration says. */
function shapeOf(operand: string): { shape: Shape; expr: string } {
  if (operand === '') return { shape: 'none', expr: '' }
  if (/^a$/i.test(operand)) return { shape: 'acc', expr: '' }
  if (operand.startsWith('#')) return { shape: 'imm', expr: operand.slice(1).trim() }
  let m = /^\(\s*(.*?)\s*,\s*x\s*\)$/i.exec(operand)
  if (m) return { shape: 'izx', expr: m[1] }
  m = /^\(\s*(.*?)\s*\)\s*,\s*y$/i.exec(operand)
  if (m) return { shape: 'izy', expr: m[1] }
  m = /^\(\s*(.*?)\s*\)$/.exec(operand)
  if (m) return { shape: 'ind', expr: m[1] }
  m = /^(.*?)\s*,\s*x$/i.exec(operand)
  if (m) return { shape: 'x', expr: m[1] }
  m = /^(.*?)\s*,\s*y$/i.exec(operand)
  if (m) return { shape: 'y', expr: m[1] }
  return { shape: 'direct', expr: operand }
}

/** The ways an instruction can be written, for the message when the operand is of a form it does not have. */
function formsOf(mnemonic: string, cmos: boolean): string {
  return modesOf6502(mnemonic, cmos)
    .map((mode) => `${mnemonic}${SYNTAX[mode] ? ` ${SYNTAX[mode]}` : ''}`)
    .join(', ')
}

/** The mode an operand of this shape means for this mnemonic, or an error message. `known` is the operand's value if it is already known (it decides between zero page and absolute). */
function pickMode(mnemonic: string, shape: Shape, known: number | undefined, cmos: boolean): Mode6502 | string {
  const modes = modesOf6502(mnemonic, cmos)
  const has = (m: Mode6502) => modes.includes(m)
  const wrong = (what: string) => `${mnemonic} can't be written ${what}. It can be written: ${formsOf(mnemonic, cmos)}.`
  /** Zero page if the address is known to fit in a byte, otherwise absolute; whichever the instruction has. */
  const width = (zp: Mode6502, abs: Mode6502): Mode6502 | string => {
    if (has(zp) && has(abs)) return known !== undefined && known >= 0 && known <= 255 ? zp : abs
    return has(abs) ? abs : has(zp) ? zp : wrong(shape === 'x' ? 'with ,X' : shape === 'y' ? 'with ,Y' : 'with an address')
  }
  switch (shape) {
    case 'none':
      return has('imp') ? 'imp' : has('acc') ? 'acc' : `${mnemonic} needs an operand. It can be written: ${formsOf(mnemonic, cmos)}.`
    case 'acc':
      return has('acc') ? 'acc' : wrong('on A')
    case 'imm':
      return has('imm') ? 'imm' : wrong('with a constant (#)')
    case 'direct':
      return has('rel') ? 'rel' : width('zp', 'abs')
    case 'x':
      return width('zpx', 'abx')
    case 'y':
      return width('zpy', 'aby')
    case 'ind':
      return has('ind') ? 'ind' : has('izp') ? 'izp' : wrong('with the address in brackets')
    case 'izx':
      return has('izx') ? 'izx' : has('iax') ? 'iax' : wrong('as (address,X)')
    case 'izy':
      return has('izy') ? 'izy' : wrong('as (address),Y')
  }
}

type Value = { ok: true; value: number; known: boolean } | { ok: false; message: string }

const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39, '"': 34 }

/** The characters of a quoted string or character, as codes, or an error message. */
function unquote(text: string): number[] | string {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let c = text[i]
    if (c === '\\') {
      const e = text[++i]
      if (e === undefined || !(e in ESCAPES)) return `“\\${e ?? ''}” is not a known escape (use \\n, \\r, \\t, \\0, \\\\, \\' or \\").`
      out.push(ESCAPES[e])
      continue
    }
    c = text[i]
    const code = c.charCodeAt(0)
    if (code > 255) return `“${c}” is not a character a byte can hold (0 to 255).`
    out.push(code)
  }
  return out
}

const TERM = /\s*([+-]?)\s*('(?:\\.|[^\\'])'|\*|0x[0-9a-f]+|\$[0-9a-f]+|0b[01]+|[0-9]+|[A-Za-z_][A-Za-z0-9_]*)/iy

/**
 * An expression: terms joined by `+` and `-`, optionally with `<` (low byte) or `>` (high byte) in front of all of it.
 * `symbols` are the names known so far; with `strict` an unknown name is an error, otherwise the value is "not known yet".
 */
function evaluate(text: string, symbols: Record<string, number>, pc: number, strict: boolean): Value {
  let rest = text.trim()
  let part: '<' | '>' | '' = ''
  if (rest.startsWith('<') || rest.startsWith('>')) {
    part = rest[0] as '<' | '>'
    rest = rest.slice(1)
  }
  if (rest.trim() === '') return { ok: false, message: 'A value is missing.' }
  let total = 0
  let known = true
  let at = 0
  TERM.lastIndex = 0
  while (at < rest.length && rest.slice(at).trim() !== '') {
    TERM.lastIndex = at
    const m = TERM.exec(rest)
    if (!m || (at > 0 && m[1] === '')) return { ok: false, message: `“${text.trim()}” is not a number or a name.` }
    at = TERM.lastIndex
    const [, sign, term] = m
    let v: number
    if (term === '*') v = pc
    else if (term.startsWith("'")) {
      const chars = unquote(term.slice(1, -1))
      if (typeof chars === 'string') return { ok: false, message: chars }
      v = chars[0]
    } else if (/^[A-Za-z_]/.test(term) && !/^0[xb]/i.test(term)) {
      if (Object.hasOwn(symbols, term)) v = symbols[term]
      else if (strict) return { ok: false, message: `Unknown name “${term}”.` }
      else {
        known = false
        v = 0
      }
    } else v = term.startsWith('$') ? parseInt(term.slice(1), 16) : /^0x/i.test(term) ? parseInt(term.slice(2), 16) : /^0b/i.test(term) ? parseInt(term.slice(2), 2) : parseInt(term, 10)
    total += sign === '-' ? -v : v
  }
  if (part === '<') total &= 255
  else if (part === '>') total = (total >> 8) & 255
  return { ok: true, value: total, known }
}

/** A comma-separated list, without splitting inside quotes. */
function splitList(text: string): string[] {
  const out: string[] = []
  let quote = ''
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += text[++i] ?? ''
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      cur += c
    } else if (c === ',') {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim())
  return out
}

interface Stmt {
  line: number
  /** Where it goes, from pass 1. */
  addr: number
  kind: 'instruction' | 'byte' | 'word' | 'res'
  mnemonic?: string
  mode?: Mode6502
  /** The operand expression (instruction), or the list of values (byte, word). */
  args: string[]
  size: number
}

const DIRECTIVES: Record<string, 'org' | 'byte' | 'word' | 'res'> = { '.org': 'org', '.byte': 'byte', '.db': 'byte', '.word': 'word', '.dw': 'word', '.res': 'res', '.ds': 'res' }

/** Assemble `source` into a ROM image of `capacity` bytes, for the NMOS 6502 or (`cmos`) the 65C02. */
export function assemble6502(source: string, capacity: number, cmos = false): Asm6502Result {
  const errors: AsmError[] = []
  const err = (line: number, message: string) => errors.push({ line, message })
  const symbols: Record<string, number> = {}
  const stmts: Stmt[] = []
  let pc = 0
  let base: number | null = null
  let placed = false

  const isMnemonic = (name: string) => modesOf6502(name, cmos).length > 0
  const define = (name: string, value: number, line: number, kind: 'label' | 'constant') => {
    if (!IDENT.test(name)) return err(line, `“${name}” is not a valid name (letters, digits and underscores, not starting with a digit).`)
    if (isMnemonic(name)) return err(line, `“${name}” is an instruction name and can't be used as a ${kind}.`)
    if (/^[axy]$/i.test(name)) return err(line, `“${name}” is the name of a register and can't be used as a ${kind}.`)
    if (Object.hasOwn(symbols, name)) return err(line, `“${name}” is already defined.`)
    symbols[name] = value
  }
  /** A value that must be known right away (it decides where things go). */
  const now = (text: string, line: number): number | null => {
    const v = evaluate(text, symbols, pc, true)
    if (!v.ok) {
      err(line, v.message)
      return null
    }
    return v.value
  }
  const setOrg = (text: string, line: number) => {
    const v = now(text, line)
    if (v === null) return
    if (v < 0 || v > 0xffff) return err(line, `.org: the address ${v} is out of range, it must be from 0 to 65535.`)
    if (!placed) base = v
    pc = v
  }

  // Pass 1: strip comments, collect labels and constants, and place every statement (its size decides where the next goes).
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    let text = stripComment(raw)
    if (!text) return
    const star = /^\*\s*=\s*(.*)$/.exec(text)
    if (star) return setOrg(star[1], line)
    const constant = matchConstant(text)
    if (constant) {
      const v = now(constant.value, line)
      return v === null ? undefined : define(constant.name, v, line, 'constant')
    }
    const label = matchLabel(text)
    if (label) {
      define(label.name, pc, line, 'label')
      text = label.rest
      if (!text) return
    }
    const m = /^(\S+)\s*(.*)$/.exec(text)!
    const word = m[1]
    const rest = m[2].trim()
    if (word.startsWith('.')) {
      const kind = DIRECTIVES[word.toLowerCase()]
      if (!kind) return err(line, `Unknown directive “${word}”. The directives are .org, .byte, .word and .res.`)
      if (kind === 'org') return rest ? setOrg(rest, line) : err(line, '.org needs an address.')
      if (kind === 'res') {
        const n = rest ? now(rest, line) : (err(line, '.res needs a number of bytes.'), null)
        if (n === null) return
        if (n < 0 || n > 0xffff) return err(line, `.res: ${n} bytes is out of range, it must be from 0 to 65535.`)
        stmts.push({ line, addr: pc, kind: 'res', args: [], size: n })
        pc += n
        placed = true
        return
      }
      const args = splitList(rest)
      if (!args.length || args.some((a) => a === '')) return err(line, `${word} needs a list of values, separated by commas.`)
      let size = 0
      for (const a of args) {
        if (kind === 'byte' && a.startsWith('"')) {
          if (a.length < 2 || !a.endsWith('"')) return err(line, 'A string must end with a closing quote.')
          const chars = unquote(a.slice(1, -1))
          if (typeof chars === 'string') return err(line, chars)
          size += chars.length
        } else size += kind === 'byte' ? 1 : 2
      }
      stmts.push({ line, addr: pc, kind, args, size })
      pc += size
      placed = true
      return
    }
    const mnemonic = word.toUpperCase()
    if (!isMnemonic(mnemonic))
      return err(line, !cmos && modesOf6502(mnemonic, true).length ? `“${word}” is an instruction of the 65C02, not of the NMOS 6502.` : `Unknown instruction “${word}”.`)
    if (modesOf6502(mnemonic, cmos).includes('zpr')) {
      // BBR and BBS: a zero-page address to test, and a label to branch to.
      const parts = splitList(rest)
      if (parts.length !== 2 || !parts[0] || !parts[1]) return err(line, `${mnemonic} needs a zero-page address and a label to branch to, like ${mnemonic} $10,label.`)
      for (const part of parts) {
        const check = evaluate(part, symbols, pc, false)
        if (!check.ok) return err(line, check.message)
      }
      stmts.push({ line, addr: pc, kind: 'instruction', mnemonic, mode: 'zpr', args: parts, size: 3 })
      pc += 3
      placed = true
      return
    }
    const { shape, expr } = shapeOf(rest)
    // A name defined further down is not known yet: such an address is taken to be absolute (3 bytes).
    const v = expr === '' ? null : evaluate(expr, symbols, pc, false)
    const mode = pickMode(mnemonic, shape, v && v.ok && v.known ? v.value : undefined, cmos)
    if (!(mode in MODE_BYTES)) return err(line, mode)
    if (v && !v.ok) return err(line, v.message)
    const size = MODE_BYTES[mode as Mode6502]
    stmts.push({ line, addr: pc, kind: 'instruction', mnemonic, mode: mode as Mode6502, args: [expr], size })
    pc += size
    placed = true
  })
  if (pc > 0x10000) err(source.split(/\r?\n/).length, `The program runs past $FFFF, the end of the address space.`)
  // A line that failed here placed nothing, so every address after it is off: report these first, the rest once they are fixed.
  if (errors.length) return { bytes: new Array<number>(capacity).fill(0), base: base ?? 0, items: [], errors: errors.sort((a, b) => a.line - b.line), symbols }

  // Pass 2: encode, now that every name is known.
  const start = base ?? 0
  const bytes = new Array<number>(capacity).fill(0)
  const owner = new Array<number>(capacity).fill(0)
  const items: Item6502[] = []
  const outside = `holds ${capacity} bytes, $${hex(start, 4)} to $${hex(start + capacity - 1, 4)}`

  const place = (s: Stmt, data: number[], kind: Item6502['kind'], gap?: number) => {
    const count = gap ?? data.length
    for (let i = 0; i < count; i++) {
      const off = s.addr + i - start
      if (off < 0 || off >= capacity) return err(s.line, `This goes outside the ROM, which ${outside}.`)
      if (owner[off]) return err(s.line, `This overlaps the bytes at $${hex(s.addr + i, 4)} that line ${owner[off]} placed.`)
    }
    for (let i = 0; i < count; i++) {
      const off = s.addr + i - start
      owner[off] = s.line
      bytes[off] = data[i] ?? 0
    }
    items.push({ addr: s.addr, bytes: data, gap, line: s.line, kind })
  }

  for (const s of stmts) {
    const at = (text: string) => evaluate(text, symbols, s.addr, true)
    if (s.kind === 'res') {
      place(s, [], 'gap', s.size)
      continue
    }
    if (s.kind === 'byte' || s.kind === 'word') {
      const data: number[] = []
      let bad = false
      for (const a of s.args) {
        if (a.startsWith('"')) {
          data.push(...(unquote(a.slice(1, -1)) as number[]))
          continue
        }
        const v = at(a)
        if (!v.ok) {
          err(s.line, v.message)
          bad = true
          continue
        }
        const [min, max] = s.kind === 'byte' ? [-128, 255] : [-32768, 65535]
        if (v.value < min || v.value > max) {
          err(s.line, `.${s.kind}: the value ${v.value} doesn't fit, it must be from ${min} to ${max}.`)
          bad = true
          continue
        }
        const n = v.value < 0 ? v.value + (s.kind === 'byte' ? 256 : 65536) : v.value
        data.push(n & 255)
        if (s.kind === 'word') data.push(n >> 8)
      }
      if (!bad) place(s, data, 'data')
      continue
    }
    const mnemonic = s.mnemonic!
    const mode = s.mode!
    const opcode = opcodeOf6502(mnemonic, mode, cmos)!
    if (mode === 'imp' || mode === 'acc') {
      place(s, [opcode], 'code')
      continue
    }
    if (mode === 'zpr') {
      const zp = at(s.args[0])
      const target = at(s.args[1])
      if (!zp.ok || !target.ok) {
        err(s.line, (!zp.ok ? zp : (target as { message: string })).message)
        continue
      }
      if (zp.value < 0 || zp.value > 255) {
        err(s.line, `${mnemonic}: the value ${zp.value} is too big for a zero-page address, it must be from 0 to 255.`)
        continue
      }
      const offset = target.value - (s.addr + 3)
      if (offset < -128 || offset > 127) {
        err(s.line, `${mnemonic}: the branch is out of range. $${hex(target.value, 4)} is ${Math.abs(offset)} bytes ${offset < 0 ? 'back' : 'ahead'}, and a branch reaches 128 back or 127 ahead.`)
        continue
      }
      place(s, [opcode, zp.value, offset & 255], 'code')
      continue
    }
    const v = at(s.args[0])
    if (!v.ok) {
      err(s.line, v.message)
      continue
    }
    let n = v.value
    if (mode === 'rel') {
      if (n < 0 || n > 0xffff) {
        err(s.line, `${mnemonic}: the address ${n} is out of range, it must be from 0 to 65535.`)
        continue
      }
      const offset = n - (s.addr + 2)
      if (offset < -128 || offset > 127) {
        err(s.line, `${mnemonic}: the branch is out of range. $${hex(n, 4)} is ${Math.abs(offset)} bytes ${offset < 0 ? 'back' : 'ahead'}, and a branch reaches 128 back or 127 ahead. Jump there with JMP instead.`)
        continue
      }
      place(s, [opcode, offset & 255], 'code')
      continue
    }
    const [min, max] = mode === 'imm' ? [-128, 255] : MODE_BYTES[mode] === 2 ? [0, 255] : [0, 65535]
    if (n < min || n > max) {
      const where = mode === 'imm' ? 'a constant' : MODE_BYTES[mode] === 2 ? 'a zero-page address' : 'an address'
      err(s.line, `${mnemonic}: the value ${n} is too big for ${where}, it must be from ${min} to ${max}.`)
      continue
    }
    if (n < 0) n += 256
    place(s, MODE_BYTES[mode] === 2 ? [opcode, n] : [opcode, n & 255, n >> 8], 'code')
  }
  errors.sort((a, b) => a.line - b.line)
  return { bytes, base: start, items, errors, symbols }
}

// ---- Listings ---------------------------------------------------------------------------------

/** One row of a ROM's listing: where it is, its bytes, and what they are. */
export interface ListRow6502 {
  addr: number
  bytes: number[]
  /** How many addresses it covers (more than its bytes for a `.res` gap). */
  size: number
  text: string
  /** The source line it came from, when the listing is of an assembled program. */
  line?: number
}

const hexByte = (b: number) => `$${hex(b, 2)}`

/** A run of zero bytes this long is left out of a listing built from bytes alone (an empty ROM is mostly this). */
const GAP = 4

/**
 * The rows of a listing. With the assembler's `items` they are exactly what the program placed (data as data); without them,
 * the bytes are read as instructions from the start, skipping runs of zeros, and an opcode that is not documented is a `.byte`.
 */
export function listing6502(bytes: number[], base: number, items?: Item6502[], cmos = false): ListRow6502[] {
  const rows: ListRow6502[] = []
  if (items) {
    for (const it of [...items].sort((a, b) => a.addr - b.addr)) {
      if (it.kind === 'code') rows.push({ addr: it.addr, bytes: it.bytes, size: it.bytes.length, text: disassemble6502(it.bytes, it.addr, cmos).text, line: it.line })
      else if (it.kind === 'gap') rows.push({ addr: it.addr, bytes: [], size: it.gap ?? 0, text: `.res ${it.gap}`, line: it.line })
      else for (let i = 0; i < it.bytes.length; i += 4) rows.push({ addr: it.addr + i, bytes: it.bytes.slice(i, i + 4), size: Math.min(4, it.bytes.length - i), text: `.byte ${it.bytes.slice(i, i + 4).map(hexByte).join(', ')}`, line: it.line })
    }
    return rows
  }
  for (let i = 0; i < bytes.length; ) {
    if (bytes[i] === 0) {
      let j = i
      while (j < bytes.length && bytes[j] === 0) j++
      if (j - i >= GAP || j === bytes.length) {
        i = j
        continue
      }
    }
    const o = (cmos ? DOCUMENTED_65C02 : BY_OPCODE_6502)[bytes[i]]
    const length = o ? Math.min(o.bytes, bytes.length - i) : 1
    const slice = bytes.slice(i, i + length)
    rows.push({ addr: base + i, bytes: slice, size: length, text: o && length === o.bytes ? disassemble6502(slice, base + i, cmos).text : `.byte ${slice.map(hexByte).join(', ')}` })
    i += length
  }
  return rows
}

/** Source text for bytes that were typed as hex: the listing, one instruction per line, with a `.org` where a gap was left. */
export function sourceFromBytes(bytes: number[], base = 0, cmos = false): string {
  const lines = [`.org $${hex(base, 4)}`]
  let next = base
  for (const r of listing6502(bytes, base, undefined, cmos)) {
    if (r.addr !== next) lines.push(`.org $${hex(r.addr, 4)}`)
    lines.push(r.text)
    next = r.addr + r.size
  }
  return lines.join('\n')
}

/** Which row of a listing holds `addr` (an address in the CPU's space), or -1. */
export const rowAt = (rows: ListRow6502[], addr: number): number => rows.findIndex((r) => addr >= r.addr && addr < r.addr + r.size)
