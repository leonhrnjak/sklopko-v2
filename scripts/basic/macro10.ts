/**
 * Translates the subset of MACRO-10 (the PDP-10 assembler) that Microsoft's `m6502.asm` is written in into plain 6502 assembly for
 * `assemble6502` (`src/engine/asm6502.ts`). The source uses the macro file `M6502`, which is not in Microsoft's repository; what it
 * defined is rebuilt here from how the source uses it:
 *
 *   - instructions carry their addressing mode in the name: `LDAI` is `LDA #`, `LDADY` is `LDA (zp),Y`, `JMPD` is `JMP (ind)`;
 *   - a bare number or expression on a line is one byte, `EXP n` too, `ADR(x)` is a word, `XWD ^O1000,n` is the single byte n;
 *   - `DT"text"` is the characters, `DC"text"` the characters with the last one's top bit set, `DCI` and `DCE` count first (`Q`);
 *   - `BLOCK n` leaves n bytes, `ORG n` moves the location counter.
 *
 * The translator does the macro expansion, the conditionals, the number bases and the constant arithmetic itself, so the
 * assembler only sees what it already knows: labels, `+`, `-`, `<` and `>`, `*`. Every output line remembers the line of the
 * source it came from (`Translation.lines`), so an error of the assembler points into Microsoft's file.
 *
 * In an expression `* / & !` bind tighter than `+ -`, each group from left to right (the source relies on it: `FUNDSP-2*ONEFUN+256`);
 * `<…>` groups. Names are not case sensitive.
 */

import { modesOf6502 } from '../../src/engine/asm6502'

export interface SourceLine {
  text: string
  /** The line of the original file (1-based). */
  line: number
}

export interface Translation {
  /** Assembly text for `assemble6502`, one statement per line. */
  text: string
  /** `lines[i]` is the source line that output line i + 1 came from. */
  lines: number[]
  /** The names that hold a plain number (switches, token numbers…) and their last values. */
  constants: Record<string, number>
  /** The address of each label as the translator counted it (it needs addresses for a few conditions): the assembler must agree. */
  labels: Record<string, number>
}

export class TranslateError extends Error {
  line: number
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`)
    this.line = line
  }
}

// ---- Reading the text ----------------------------------------------------------------------------------------------

const NAME = '[A-Za-z$%.][A-Za-z0-9$%.]*'

/** The text of a line without its `;` comment (a `;` inside a double-quoted string does not start one). */
function stripComment(text: string): string {
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') inString = !inString
    else if (c === ';' && !inString) return text.slice(0, i)
  }
  return text
}

/** The source without comments, `COMMENT` blocks, and the lines about listings and titles, ready to be taken apart. */
function clean(src: SourceLine[]): SourceLine[] {
  const out: SourceLine[] = []
  let delimiter = ''
  for (let i = 0; i < src.length; i++) {
    let text = src[i].text
    if (delimiter) {
      const end = text.indexOf(delimiter)
      if (end < 0) continue
      text = text.slice(end + 1)
      delimiter = ''
    }
    const block = /^\s*COMMENT\s*(\S)/i.exec(text)
    if (block) {
      const rest = text.slice(block[0].length)
      const end = rest.indexOf(block[1])
      if (end < 0) {
        delimiter = block[1]
        continue
      }
      text = rest.slice(end + 1)
    }
    text = stripComment(text).replace(/\s+$/, '')
    if (/^\s*(SUBTTL|TITLE)\b/i.test(text)) continue
    // `DT` is built in (see `Translator.native`); its definition in the source is written for MACRO-10's `IRPC` and is not read.
    if (/^\s*DEFINE\s+DT\s*\(/i.test(text)) {
      if (!/^\s*IRPC\b/i.test(stripComment(src[i + 1]?.text ?? ''))) throw new TranslateError(src[i].line, 'The definition of DT is not the one that was expected.')
      i++
      continue
    }
    out.push({ text, line: src[i].line })
  }
  return out
}

/** A piece of text and the source line each of its characters came from. */
interface Chunk {
  s: string
  lineOf(i: number): number
}

function chunkOf(lines: SourceLine[]): Chunk {
  const starts: number[] = []
  const nums: number[] = []
  let s = ''
  for (const l of lines) {
    starts.push(s.length)
    nums.push(l.line)
    s += l.text + '\n'
  }
  return {
    s,
    lineOf(i) {
      let lo = 0
      let hi = starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid] <= i) lo = mid
        else hi = mid - 1
      }
      return nums[lo] ?? 0
    },
  }
}

const sub = (c: Chunk, from: number, to: number): Chunk => ({ s: c.s.slice(from, to), lineOf: (i) => c.lineOf(from + i) })

/**
 * Where the statement that starts at `p` ends: at the end of a line, but a `<…>` group may run over several lines. A `>` that
 * closes nothing ends it too (the caller reports it). Double-quoted text is skipped.
 */
function statementEnd(s: string, p: number): number {
  let depth = 0
  let inString = false
  for (let i = p; i < s.length; i++) {
    const c = s[i]
    if (c === '"') inString = !inString
    else if (inString) continue
    else if (c === '<') depth++
    else if (c === '>') {
      if (depth === 0) return i
      depth--
    } else if (c === '\n' && depth === 0) return i
  }
  return s.length
}

/** The index of the `>` that closes the `<` just before `from`, or -1. */
function closing(s: string, from: number): number {
  let depth = 1
  let inString = false
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === '"') inString = !inString
    else if (inString) continue
    else if (c === '<') depth++
    else if (c === '>' && --depth === 0) return i
  }
  return -1
}

// ---- Expressions ---------------------------------------------------------------------------------------------------

type Node =
  | { t: 'n'; v: number }
  | { t: 's'; name: string }
  | { t: 'dot' }
  | { t: 'neg'; a: Node }
  | { t: 'op'; op: string; a: Node; b: Node }

/** An expression that cannot be given to the assembler. */
class Unsupported extends Error {}

class Parser {
  private p = 0
  private s: string
  private radix: number
  constructor(s: string, radix: number) {
    this.s = s
    this.radix = radix
  }

  parse(): Node {
    const n = this.sequence()
    this.skip()
    if (this.p < this.s.length) throw new Unsupported(`“${this.s.slice(this.p).trim()}” is not part of an expression`)
    return n
  }

  private skip() {
    while (this.p < this.s.length && /\s/.test(this.s[this.p])) this.p++
  }

  /** `product (+|- product)*`. */
  private sequence(): Node {
    let a = this.product()
    for (;;) {
      this.skip()
      const op = this.s[this.p]
      if (op !== '+' && op !== '-') return a
      this.p++
      a = { t: 'op', op, a, b: this.product() }
    }
  }

  /** `term (*|/|&|! term)*`: these bind tighter than + and −, as in `FUNDSP-2*ONEFUN+256`. */
  private product(): Node {
    let a = this.term()
    for (;;) {
      this.skip()
      const op = this.s[this.p]
      if (op === undefined || !'*/&!'.includes(op)) return a
      this.p++
      a = { t: 'op', op, a, b: this.term() }
    }
  }

  private term(): Node {
    this.skip()
    const s = this.s
    const c = s[this.p]
    if (c === undefined) throw new Unsupported('an expression ends too soon')
    if (c === '<') {
      this.p++
      const n = this.sequence()
      this.skip()
      if (s[this.p] !== '>') throw new Unsupported('a < has no >')
      this.p++
      return n
    }
    if (c === '-') {
      this.p++
      return { t: 'neg', a: this.term() }
    }
    if (c === '+') {
      this.p++
      return this.term()
    }
    if (c === '"') {
      if (s[this.p + 2] !== '"') throw new Unsupported(`“${s.slice(this.p, this.p + 3)}” is not a character`)
      const v = s.charCodeAt(this.p + 1)
      this.p += 3
      return { t: 'n', v }
    }
    const m = /^(?:\^([ODB])([0-9]+)|([0-9]+)|([A-Za-z$%.][A-Za-z0-9$%.]*))/i.exec(s.slice(this.p))
    if (!m) throw new Unsupported(`“${s.slice(this.p).trim()}” is not a number or a name`)
    this.p += m[0].length
    if (m[4] !== undefined) return m[4] === '.' ? { t: 'dot' } : { t: 's', name: sym(m[4]) }
    let radix = m[1] ? { O: 8, D: 10, B: 2 }[m[1].toUpperCase() as 'O' | 'D' | 'B'] : this.radix
    const digits = m[2] ?? m[3]
    // A number with an 8 or a 9 in it is decimal, even where the base is 8 (`8*ADDPRC+230` is 8 plus octal 230).
    if (!m[1] && radix === 8 && /[89]/.test(digits)) radix = 10
    if ([...digits].some((d) => Number(d) >= radix)) throw new Unsupported(`“${digits}” is not a number in base ${radix}`)
    return { t: 'n', v: parseInt(digits, radix) }
  }
}

/** A comma-separated list, without splitting inside double quotes (`","` is the comma character). */
function splitList(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let inString = false
  for (const c of text) {
    if (c === '"') inString = !inString
    if (c === ',' && !inString) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** MACRO-10 reads only the first six characters of a name: the table says `RESTORE` where the routine is `RESTOR`. */
const sym = (name: string) => name.toUpperCase().slice(0, 6)

const isLabelLike = (name: string) => /^[A-Z_][A-Z0-9_]*$/.test(name)

// ---- The translator ------------------------------------------------------------------------------------------------

interface Macro {
  params: string[]
  body: string
}

/** The instructions of the 6502 as the source writes them, and the forms the macro file added. */
const MNEMONICS = new Set(
  'ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRK BVC BVS CLC CLD CLI CLV CMP CPX CPY DEC DEX DEY EOR INC INX INY JMP JSR LDA LDX LDY LSR NOP ORA PHA PHP PLA PLP ROL ROR RTI RTS SBC SEC SED SEI STA STX STY TAX TAY TSX TXA TXS TYA'.split(' '),
)
const BRANCHES = new Set('BCC BCS BEQ BMI BNE BPL BVC BVS'.split(' '))
const IMMEDIATE = new Set('ADC AND CMP CPX CPY EOR LDA LDX LDY ORA SBC'.split(' '))
const INDIRECT_Y = new Set('ADC AND CMP EOR LDA ORA SBC STA'.split(' '))

/** Words that only set up the listing or the assembler and mean nothing for the output. */
const IGNORED = new Set(['SEARCH', 'SALL', 'PAGE', 'XLIST', 'LIST', '.XCREF', '.CREF', 'PRINTX', 'PURGE', 'TITLE', 'SUBTTL'])

class Translator {
  private out: string[] = []
  private outLines: number[] = []
  private radix = 8
  /** Where the next byte goes, and the address of each label met so far: a few conditions and sizes depend on them. */
  private loc = 0
  private addr = new Map<string, number>()
  private consts = new Map<string, number>()
  /** Names with a value only the assembler can work out: labels, and names equated to one. */
  private symbols = new Set<string>()
  private macros = new Map<string, Macro>()
  private done = false
  private generated = 0
  private depth = 0
  /** Names an operand used before they had a value (or a label): if they turn out to be numbers, they are defined at the top. */
  private early = new Set<string>()

  translate(src: SourceLine[]): Translation {
    this.run(chunkOf(clean(src)))
    const top = [...this.early].filter((n) => this.consts.has(n)).map((n) => `${n} = ${this.consts.get(n)}`)
    return {
      text: [...top, ...this.out].join('\n') + '\n',
      lines: [...top.map(() => 0), ...this.outLines],
      constants: Object.fromEntries(this.consts),
      labels: Object.fromEntries(this.addr),
    }
  }

  /** Add a line of output that takes `size` bytes. */
  private emit(line: number, text: string, size = 0) {
    this.out.push(text)
    this.outLines.push(line)
    this.loc += size
  }

  /** Go through a piece of text, statement by statement. */
  private run(chunk: Chunk) {
    if (++this.depth > 40) throw new TranslateError(chunk.lineOf(0), 'Macros nest too deep.')
    const s = chunk.s
    let p = 0
    while (p < s.length && !this.done) {
      while (p < s.length && /\s/.test(s[p])) p++
      if (p >= s.length) break
      const e = statementEnd(s, p)
      if (s[e] === '>') throw new TranslateError(chunk.lineOf(e), 'A > closes nothing.')
      this.statement(chunk, p, e)
      p = e
    }
    this.depth--
  }

  private fail(chunk: Chunk, at: number, message: string): never {
    throw new TranslateError(chunk.lineOf(at), message)
  }

  /** The value of an expression made of numbers and names that hold numbers; undefined when it needs the assembler. */
  private value(text: string, chunk: Chunk, at: number): number {
    const n = this.fold(this.parse(text, chunk, at), true)
    if (n === undefined) this.fail(chunk, at, `“${text.trim()}” has to be a number here, but a name in it has no value yet.`)
    return n
  }

  private parse(text: string, chunk: Chunk, at: number): Node {
    try {
      return new Parser(text, this.radix).parse()
    } catch (e) {
      if (e instanceof Unsupported) this.fail(chunk, at, e.message)
      throw e
    }
  }

  /** The value of an expression, if it is a number. With `labels`, a label counts as its address (for conditions and sizes). */
  private fold(n: Node, labels = false): number | undefined {
    switch (n.t) {
      case 'n':
        return n.v
      case 'dot':
        return labels ? this.loc : undefined
      case 's':
        return this.consts.get(n.name) ?? (labels ? this.addr.get(n.name) : undefined)
      case 'neg': {
        const a = this.fold(n.a, labels)
        return a === undefined ? undefined : -a
      }
      case 'op': {
        const a = this.fold(n.a, labels)
        const b = this.fold(n.b, labels)
        if (a === undefined || b === undefined) return undefined
        switch (n.op) {
          case '+':
            return a + b
          case '-':
            return a - b
          case '*':
            return a * b
          case '/':
            return Math.trunc(a / b)
          case '&':
            return a & b
          default:
            return a | b // `!` is OR
        }
      }
    }
  }

  /** An expression as the assembler reads it: a sum of numbers and names, or the low (`<`) or high (`>`) byte of one. */
  private render(n: Node, chunk: Chunk, at: number): string {
    const folded = this.fold(n)
    if (folded !== undefined) return String(folded)
    const terms: { sign: 1 | -1; text: string }[] = []
    let constant = 0
    let part = ''
    const add = (m: Node, sign: 1 | -1) => {
      const v = this.fold(m)
      if (v !== undefined) constant += sign * v
      else if (m.t === 's') {
        if (!this.symbols.has(m.name)) this.early.add(m.name)
        terms.push({ sign, text: m.name })
      }
      else if (m.t === 'dot') terms.push({ sign, text: '*' })
      else if (m.t === 'neg') add(m.a, sign === 1 ? -1 : 1)
      else {
        // `x&^O377` and `x-x/^O400*^O400` are the low byte of x, `x/^O400` the high byte: the assembler writes those `<x` and `>x`.
        const byte = this.byteOf(m)
        if (byte && sign === 1 && !terms.length && !constant && !part) {
          part = byte[0]
          add(byte[1], 1)
        } else if (m.t === 'op' && (m.op === '+' || m.op === '-')) {
          add(m.a, sign)
          add(m.b, m.op === '-' ? (sign === 1 ? -1 : 1) : sign)
        } else this.fail(chunk, at, 'An expression with a name whose value is not known yet can only use + and −, &^O377 and /^O400.')
      }
    }
    add(n, 1)
    let text = ''
    for (const t of terms) text += (t.sign === -1 ? '-' : text ? '+' : '') + t.text
    if (constant) text += (constant < 0 ? '-' : text ? '+' : '') + Math.abs(constant)
    return part + text
  }

  /** Is this the low (`<`) or high (`>`) byte of an expression, written the way the source does? */
  private byteOf(n: Node): ['<' | '>', Node] | undefined {
    if (n.t !== 'op') return undefined
    const same = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b)
    if (n.op === '&' && this.fold(n.b) === 255) return ['<', n.a]
    if (n.op === '/' && this.fold(n.b) === 256) return ['>', n.a]
    if (n.op === '-' && n.b.t === 'op' && n.b.op === '*' && this.fold(n.b.b) === 256) {
      const q = n.b.a
      if (q.t === 'op' && q.op === '/' && this.fold(q.b) === 256 && same(q.a, n.a)) return ['<', n.a]
    }
    return undefined
  }

  private expr(text: string, chunk: Chunk, at: number): string {
    return this.render(this.parse(text, chunk, at), chunk, at)
  }

  // ---- One statement -------------------------------------------------------------------------------------------------

  private statement(chunk: Chunk, start: number, end: number) {
    let off = start
    let text = chunk.s.slice(start, end)
    const line = chunk.lineOf(start)
    const eat = (n: number) => {
      off += n
      text = text.slice(n)
    }
    const lead = /^\s*/.exec(text)![0].length
    eat(lead)

    const label = new RegExp(`^(${NAME})::?!?[ \\t]*`).exec(text)
    if (label) {
      const name = sym(label[1])
      eat(label[0].length)
      if (isLabelLike(name)) {
        this.emit(line, `${name}:`)
        this.symbols.add(name)
        this.addr.set(name, this.loc)
      }
      if (!text.trim()) return
    }

    const assign = new RegExp(`^(${NAME})\\s*(==?)\\s*([\\s\\S]*)$`).exec(text)
    if (assign) return this.assign(chunk, off, sym(assign[1]), assign[3])

    const word = new RegExp(`^(${NAME})`).exec(text)
    if (!word) return this.data(chunk, off, text, line)
    const op = word[1].toUpperCase()
    const rest = text.slice(word[0].length)
    const restAt = off + word[0].length

    const macro = this.macros.get(sym(op))
    if (macro) return this.invoke(chunk, restAt, op, macro, rest)
    if (this.native(chunk, op, rest, restAt, line)) return
    if (IGNORED.has(op)) return
    if (this.instruction(chunk, restAt, op, rest, line)) return
    this.data(chunk, off, text, line)
  }

  private assign(chunk: Chunk, at: number, name: string, valueText: string) {
    const node = this.parse(valueText, chunk, at)
    const v = this.fold(node)
    if (v !== undefined) {
      this.consts.set(name, v)
      this.symbols.delete(name)
      return
    }
    // Equated to a label: the assembler knows its value.
    this.consts.delete(name)
    this.symbols.add(name)
    this.emit(chunk.lineOf(at), `${name} = ${this.render(node, chunk, at)}`)
    const address = this.fold(node, true)
    if (address !== undefined) this.addr.set(name, address)
  }

  /** A line that is a value and nothing else: one byte. */
  private data(chunk: Chunk, at: number, text: string, line: number) {
    const items = splitList(text)
    this.emit(line, `.byte ${items.map((t) => this.expr(t, chunk, at)).join(',')}`, items.length)
  }

  /** The words that are the assembler's own. Returns false when `op` is not one of them. */
  private native(chunk: Chunk, op: string, rest: string, restAt: number, line: number): boolean {
    switch (op) {
      case 'IFE':
      case 'IFN':
      case 'IF1':
      case 'IF2':
      case 'IFNDEF':
      case 'REPEAT':
        this.conditional(chunk, restAt, op, rest)
        return true
      case 'DEFINE':
        this.define(chunk, restAt, rest)
        return true
      case 'RADIX':
        // The base itself is always written in decimal.
        this.radix = Number(rest.trim())
        if (!(this.radix === 8 || this.radix === 10)) this.fail(chunk, restAt, 'RADIX is only understood as 8 or 10.')
        return true
      case 'END':
        this.done = true
        return true
      case 'ORG':
        this.loc = this.value(rest, chunk, restAt)
        this.emit(line, `.org ${this.loc}`)
        return true
      case 'BLOCK': {
        const n = this.value(rest, chunk, restAt)
        if (n > 0) this.emit(line, `.res ${n}`, n)
        return true
      }
      case 'ADR':
        this.emit(line, `.word ${this.expr(rest.replace(/^\s*\(([\s\S]*)\)\s*$/, '$1'), chunk, restAt)}`, 2)
        return true
      case 'EXP':
        this.data(chunk, restAt, rest, line)
        return true
      case 'XWD': {
        // `XWD ^O1000,n` is the macro file's way to write the one byte n (the bit-skipping trick: SKIP1, SKIP2, a LDA # opcode).
        const [left, right] = rest.split(',')
        if (this.value(left, chunk, restAt) !== 0o1000 || right === undefined) this.fail(chunk, restAt, 'XWD is only understood as XWD ^O1000,byte.')
        this.emit(line, `.byte ${this.expr(right, chunk, restAt)}`, 1)
        return true
      }
      case 'DT':
      case 'DC':
      case 'DCI':
      case 'DCE': {
        if (op === 'DCI') this.counter(1, chunk, restAt)
        if (op === 'DCE') this.counter(2, chunk, restAt)
        const m = /^\s*\(?\s*"([^"]*)"\s*\)?\s*$/.exec(rest)
        if (!m) this.fail(chunk, restAt, `${op} needs a text in double quotes.`)
        const codes = [...m[1]].map((c) => c.charCodeAt(0))
        if (op !== 'DT' && codes.length) codes[codes.length - 1] |= 0x80
        if (codes.length) this.emit(line, `.byte ${codes.join(',')}`, codes.length)
        return true
      }
      default:
        return false
    }
  }

  /** `DCI` and `DCE` first add to `Q`, the count of tokens or of error-message characters. */
  private counter(by: number, chunk: Chunk, at: number) {
    const q = this.consts.get('Q')
    if (q === undefined) this.fail(chunk, at, 'Q has no value yet.')
    this.consts.set('Q', q + by)
  }

  /** `IFE`, `IFN`, `IF1`, `IF2`, `IFNDEF` and `REPEAT`, with their `<…>` body. */
  private conditional(chunk: Chunk, restAt: number, op: string, rest: string) {
    const open = rest.indexOf(',')
    const lt = rest.indexOf('<', open + 1)
    const head = open < 0 ? '' : rest.slice(0, open)
    if (open < 0 || lt < 0 || rest.slice(open + 1, lt).trim() !== '') this.fail(chunk, restAt, `${op} needs a condition, a comma and a body in < >.`)
    const bodyFrom = restAt + lt + 1
    const bodyTo = closing(chunk.s, bodyFrom)
    if (bodyTo < 0) this.fail(chunk, restAt, 'The < of this body has no >.')
    const body = sub(chunk, bodyFrom, bodyTo)
    let times: number
    switch (op) {
      case 'IF1': // the first pass of MACRO-10 only printed messages
        times = 0
        break
      case 'IF2':
        times = 1
        break
      case 'IFNDEF': {
        const name = sym(head.trim())
        times = this.consts.has(name) || this.symbols.has(name) ? 0 : 1
        break
      }
      case 'REPEAT':
        times = this.value(head, chunk, restAt)
        break
      default: {
        const v = this.value(head, chunk, restAt)
        times = (op === 'IFE') === (v === 0) ? 1 : 0
      }
    }
    for (let i = 0; i < times && !this.done; i++) this.run(body)
  }

  private define(chunk: Chunk, restAt: number, rest: string) {
    const m = new RegExp(`^\\s*(${NAME})\\s*(?:\\(([^)]*)\\))?\\s*,\\s*<`).exec(rest)
    if (!m) this.fail(chunk, restAt, 'DEFINE needs a name, its parameters and a body in < >.')
    const from = restAt + m[0].length
    const to = closing(chunk.s, from)
    if (to < 0) this.fail(chunk, restAt, 'The < of this macro body has no >.')
    const params = (m[2] ?? '')
      .split(',')
      .map((x) => sym(x.trim()))
      .filter(Boolean)
    this.macros.set(sym(m[1]), { params, body: chunk.s.slice(from, to) })
  }

  private invoke(chunk: Chunk, restAt: number, name: string, macro: Macro, rest: string) {
    let arg = rest.trim()
    const wrapped = /^\(([\s\S]*)\)$/.exec(arg) ?? /^<([\s\S]*)>$/.exec(arg)
    if (wrapped) arg = wrapped[1].trim()
    const args = macro.params.length > 1 ? arg.split(',').map((a) => a.trim()) : [arg]
    if (args.length !== macro.params.length && !(macro.params.length === 0 && !arg)) this.fail(chunk, restAt, `${name} takes ${macro.params.length} argument(s).`)
    const id = ++this.generated
    // Parameters are replaced where they stand as a name (outside quotes); `%X` is a label made up for each expansion.
    let inString = false
    let text = ''
    for (let i = 0; i < macro.body.length; ) {
      const c = macro.body[i]
      if (c === '"') inString = !inString
      const m = !inString ? new RegExp(`^${NAME}`).exec(macro.body.slice(i)) : null
      if (m) {
        const word = sym(m[0])
        const at = macro.params.indexOf(word)
        text += at >= 0 ? args[at] : word.startsWith('%') ? `G${id}${word.slice(1)}` : m[0]
        i += m[0].length
      } else {
        text += c
        i++
      }
    }
    const line = chunk.lineOf(restAt)
    this.run({ s: text + '\n', lineOf: () => line })
  }

  /** `LDAI x` and the like: an instruction of the 6502, in the forms the source writes. Returns false when `op` is none. */
  private instruction(chunk: Chunk, restAt: number, op: string, rest: string, line: number): boolean {
    let mnemonic = op
    let form: 'plain' | 'imm' | 'izy' | 'ind' = 'plain'
    if (!MNEMONICS.has(op)) {
      if (op.endsWith('DY') && INDIRECT_Y.has(op.slice(0, -2))) [mnemonic, form] = [op.slice(0, -2), 'izy']
      else if (op === 'JMPD') [mnemonic, form] = ['JMP', 'ind']
      else if (op.endsWith('I') && IMMEDIATE.has(op.slice(0, -1))) [mnemonic, form] = [op.slice(0, -1), 'imm']
      else return false
    }
    let operand = rest.trim().replace(/,\s*$/, '').trim()
    if (!operand || /^A$/i.test(operand)) {
      this.emit(line, operand ? `${mnemonic} A` : mnemonic, 1)
      return true
    }
    let index = ''
    const x = /^([\s\S]*?)\s*,\s*([XY])$/i.exec(operand)
    if (x) {
      operand = x[1]
      index = `,${x[2].toUpperCase()}`
    }
    const node = this.parse(operand, chunk, restAt)
    const e = this.render(node, chunk, restAt)
    if (form === 'imm') this.emit(line, `${mnemonic} #${e}`, 2)
    else if (form === 'izy') this.emit(line, `${mnemonic} (${e}),Y`, 2)
    else if (form === 'ind') this.emit(line, `${mnemonic} (${e})`, 3)
    else {
      // The size is what the assembler will pick (see `pickMode` in asm6502.ts): zero page if the instruction has that form and the address is known to fit.
      const known = this.fold(node, true)
      const modes = modesOf6502(mnemonic)
      const width = (zp: string, abs: string) => {
        const fits = known !== undefined && known >= 0 && known <= 255
        return modes.includes(zp as never) && (!modes.includes(abs as never) || fits) ? 2 : 3
      }
      const size = BRANCHES.has(mnemonic) ? 2 : index === ',X' ? width('zpx', 'abx') : index === ',Y' ? width('zpy', 'aby') : width('zp', 'abs')
      this.emit(line, `${mnemonic} ${e}${index}`, size)
    }
    return true
  }
}

/** Translate `m6502.asm` (or a copy of it with some lines changed, which keep the number of the line they replace). */
export function translate(src: SourceLine[]): Translation {
  return new Translator().translate(src)
}

/** The lines of a text, numbered from 1. */
export const linesOf = (text: string): SourceLine[] => text.split(/\r?\n/).map((t, i) => ({ text: t, line: i + 1 }))
