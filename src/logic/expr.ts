/**
 * Boolean expressions: a parser for the ways people write them (¬A·B + C, !A&B | C, A' ^ B…), a printer, an evaluator,
 * and programs of several named expressions (`Y = A·B`, `Z = Y + C`).
 */

export type Expr =
  | { k: 'const'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'not'; a: Expr }
  | { k: 'and' | 'or' | 'xor'; args: Expr[] }

type NaryKind = 'and' | 'or' | 'xor'

export const constant = (v: boolean): Expr => ({ k: 'const', v })
export const variable = (name: string): Expr => ({ k: 'var', name })
export const not = (a: Expr): Expr => ({ k: 'not', a })

/** An n-ary gate; arguments of the same kind are merged in, and one argument is just itself. */
function nary(k: NaryKind, args: Expr[]): Expr {
  const flat = args.flatMap((a) => (a.k === k ? a.args : [a]))
  return flat.length === 1 ? flat[0] : { k, args: flat }
}
export const and = (...args: Expr[]) => nary('and', args)
export const or = (...args: Expr[]) => nary('or', args)
export const xor = (...args: Expr[]) => nary('xor', args)

export function equal(a: Expr, b: Expr): boolean {
  if (a.k !== b.k) return false
  switch (a.k) {
    case 'const':
      return a.v === (b as typeof a).v
    case 'var':
      return a.name === (b as typeof a).name
    case 'not':
      return equal(a.a, (b as typeof a).a)
    default: {
      const bb = b as typeof a
      return a.args.length === bb.args.length && a.args.every((x, i) => equal(x, bb.args[i]))
    }
  }
}

/** The variables of an expression, in order of first appearance, added to `into`. */
export function variables(e: Expr, into: string[] = []): string[] {
  if (e.k === 'var') {
    if (!into.includes(e.name)) into.push(e.name)
  } else if (e.k === 'not') variables(e.a, into)
  else if (e.k !== 'const') for (const a of e.args) variables(a, into)
  return into
}

export function evaluate(e: Expr, env: (name: string) => boolean): boolean {
  switch (e.k) {
    case 'const':
      return e.v
    case 'var':
      return env(e.name)
    case 'not':
      return !evaluate(e.a, env)
    case 'and':
      return e.args.every((a) => evaluate(a, env))
    case 'or':
      return e.args.some((a) => evaluate(a, env))
    default:
      return e.args.reduce((acc, a) => acc !== evaluate(a, env), false)
  }
}

// ---- Printing ----------------------------------------------------------------------------------

export type Style = 'math' | 'ascii'
const SYMBOLS = {
  math: { not: '¬', and: '·', or: ' + ', xor: ' ⊕ ' },
  ascii: { not: '!', and: '*', or: ' + ', xor: ' ^ ' },
}
/** Binding strength: a child binds looser than its parent when it needs brackets. */
const PREC: Record<Expr['k'], number> = { or: 1, xor: 2, and: 3, not: 4, var: 5, const: 5 }

/** An expression as text: `¬A·B + C` (or `!A*B + C` in the ASCII style), with brackets only where they are needed. */
export function print(e: Expr, style: Style = 'math'): string {
  const sym = SYMBOLS[style]
  const wrap = (child: Expr, parent: Expr['k']) => (PREC[child.k] < PREC[parent] ? `(${print(child, style)})` : print(child, style))
  switch (e.k) {
    case 'const':
      return e.v ? '1' : '0'
    case 'var':
      return e.name
    case 'not':
      return sym.not + wrap(e.a, 'not')
    default:
      return e.args.map((a) => wrap(a, e.k)).join(sym[e.k])
  }
}

// ---- Parsing -----------------------------------------------------------------------------------

export class ParseError extends Error {
  /** 1-based column in the text that was parsed. */
  column: number
  constructor(message: string, column: number) {
    super(message)
    this.column = column
  }
}

interface Token {
  t: 'id' | 'num' | 'not' | 'post' | 'and' | 'or' | 'xor' | '(' | ')' | '=' | 'end'
  s: string
  col: number
}

const OPERATORS: Record<string, Token['t']> = {
  '¬': 'not', '!': 'not', '~': 'not',
  "'": 'post', '’': 'post',
  '·': 'and', '⋅': 'and', '*': 'and', '&': 'and', '∧': 'and',
  '+': 'or', '|': 'or', '∨': 'or',
  '⊕': 'xor', '^': 'xor',
  '(': '(', ')': ')',
}

function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (let i = 0; i < text.length; ) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === ':' && text[i + 1] === '=') {
      out.push({ t: '=', s: ':=', col: i + 1 })
      i += 2
    } else if (c === '=') {
      out.push({ t: '=', s: '=', col: i + 1 })
      i++
    } else if (OPERATORS[c]) {
      out.push({ t: OPERATORS[c], s: c, col: i + 1 })
      i++
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++
      out.push({ t: 'id', s: text.slice(i, j), col: i + 1 })
      i = j
    } else if (/[0-9]/.test(c)) {
      let j = i + 1
      while (j < text.length && /[0-9A-Za-z_]/.test(text[j])) j++
      const s = text.slice(i, j)
      if (s !== '0' && s !== '1') throw new ParseError(`“${s}” is not a name or a constant: the only numbers are 0 and 1.`, i + 1)
      out.push({ t: 'num', s, col: i + 1 })
      i = j
    } else throw new ParseError(`Unexpected “${c}”.`, i + 1)
  }
  out.push({ t: 'end', s: '', col: text.length + 1 })
  return out
}

/** Recursive descent: or → xor → and → not → postfix → atom. */
class Parser {
  private i = 0
  private toks: Token[]
  constructor(toks: Token[]) {
    this.toks = toks
  }
  private get tok() {
    return this.toks[this.i]
  }
  private eat() {
    return this.toks[this.i++]
  }

  parse(): Expr {
    const e = this.or()
    if (this.tok.t !== 'end') this.unexpected()
    return e
  }

  private unexpected(): never {
    const t = this.tok
    if (t.t === ')') throw new ParseError('This “)” has no matching “(”.', t.col)
    if (t.t === 'id' || t.t === 'num' || t.t === '(' || t.t === 'not')
      throw new ParseError(`Missing operator before “${t.s}”: write A·B, A*B or A&B for AND, and A+B for OR.`, t.col)
    if (t.t === '=') throw new ParseError('Only one “=” is allowed, after the name of the output.', t.col)
    throw new ParseError(`Unexpected “${t.s}”.`, t.col)
  }

  private list(kind: NaryKind, next: () => Expr): Expr {
    const args = [next()]
    while (this.tok.t === kind) {
      this.eat()
      args.push(next())
    }
    return nary(kind, args)
  }
  private or = () => this.list('or', () => this.xor())
  private xor = () => this.list('xor', () => this.and())
  private and = () => this.list('and', () => this.unary())

  private unary(): Expr {
    if (this.tok.t === 'not') {
      this.eat()
      return not(this.unary())
    }
    let e = this.atom()
    while (this.tok.t === 'post') {
      this.eat()
      e = not(e)
    }
    return e
  }

  private atom(): Expr {
    const t = this.tok
    if (t.t === 'id') {
      this.eat()
      return variable(t.s)
    }
    if (t.t === 'num') {
      this.eat()
      return constant(t.s === '1')
    }
    if (t.t === '(') {
      this.eat()
      const e = this.or()
      if (this.tok.t !== ')') throw new ParseError('Missing “)”.', this.tok.col)
      this.eat()
      return e
    }
    if (t.t === 'end') throw new ParseError('The expression ends too early: something is missing after the last operator.', t.col)
    throw new ParseError(`Expected a name, 0, 1 or “(” here, not “${t.s}”.`, t.col)
  }
}

/** Parse one expression. Throws a `ParseError` that says what is wrong and where. */
export function parseExpr(text: string): Expr {
  if (!text.trim()) throw new ParseError('Type an expression, for example A·B + ¬C.', 1)
  return new Parser(tokenize(text)).parse()
}

// ---- Programs: several named expressions -------------------------------------------------------

export interface Statement {
  name: string
  expr: Expr
  /** 1-based line of the text. */
  line: number
}

export interface ProgramError {
  line: number
  column: number
  message: string
}

/**
 * Parse text with one `Name = expression` per line (or separated by `;`). A line that is only an expression is an
 * output called Y (Y2, Y3… if there are several). Errors are collected per line, so one bad line doesn't hide the rest.
 */
export function parseProgram(text: string): { statements: Statement[]; errors: ProgramError[] } {
  const statements: Statement[] = []
  const errors: ProgramError[] = []
  const bare: Statement[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    // Statements separated by ; share the line; columns are counted from the start of the line.
    let offset = 0
    for (const part of raw.split(';')) {
      const start = offset
      offset += part.length + 1
      const body = part.replace(/(?:\/\/|#).*$/, '')
      if (!body.trim()) continue
      try {
        const toks = tokenize(body)
        const eq = toks.findIndex((t) => t.t === '=')
        let name = ''
        let exprText = body
        if (eq >= 0) {
          if (eq !== 1 || toks[0].t !== 'id') throw new ParseError('Write the output’s name, then “=”, then the expression: Y = A·B.', toks[Math.min(eq, 1)].col)
          name = toks[0].s
          exprText = body.slice(toks[eq].col - 1 + toks[eq].s.length)
        }
        const shift = body.length - exprText.length
        let expr: Expr
        try {
          expr = parseExpr(exprText)
        } catch (e) {
          if (e instanceof ParseError) throw new ParseError(e.message, e.column + shift)
          throw e
        }
        const st = { name, expr, line }
        ;(name ? statements : bare).push(st)
      } catch (e) {
        if (!(e instanceof ParseError)) throw e
        errors.push({ line, column: e.column + start, message: e.message })
      }
    }
  })
  // Bare expressions are outputs too: Y, then Y2, Y3… that no line has used.
  const used = new Set(statements.map((s) => s.name))
  let n = 0
  for (const s of bare) {
    let name: string
    do name = n++ === 0 ? 'Y' : `Y${n}`
    while (used.has(name))
    used.add(name)
    s.name = name
    statements.push(s)
  }
  statements.sort((a, b) => a.line - b.line)
  return { statements, errors }
}

export interface Program {
  /** The variables that no line defines: the inputs, in order of first appearance. */
  inputs: string[]
  outputs: {
    name: string
    /** As written: may use other lines' names. */
    written: Expr
    /** With every other line's name replaced by what it stands for: uses only inputs. */
    expr: Expr
  }[]
}

/** The most inputs a program may have (a truth table has 2ⁿ rows). */
export const MAX_INPUTS = 10

/** Work out which names are inputs and which are defined by other lines; reject repeats and loops. */
export function resolveProgram(statements: Statement[]): { program?: Program; errors: ProgramError[] } {
  const errors: ProgramError[] = []
  const defs = new Map<string, Statement>()
  for (const s of statements) {
    if (defs.has(s.name)) errors.push({ line: s.line, column: 1, message: `“${s.name}” is defined twice (first on line ${defs.get(s.name)!.line}).` })
    else defs.set(s.name, s)
  }
  if (errors.length) return { errors }

  const inputs: string[] = []
  for (const s of statements) for (const v of variables(s.expr)) if (!defs.has(v) && !inputs.includes(v)) inputs.push(v)

  const inlined = new Map<string, Expr>()
  const visiting: string[] = []
  const inLoop = new Set<string>() // names of loops already reported
  const inline = (name: string): Expr | null => {
    const known = inlined.get(name)
    if (known) return known
    if (inLoop.has(name)) return null
    if (visiting.includes(name)) {
      const s = defs.get(name)!
      const loop = visiting.slice(visiting.indexOf(name))
      for (const n of loop) inLoop.add(n)
      errors.push({ line: s.line, column: 1, message: `“${name}” depends on itself (${[...loop, name].join(' → ')}).` })
      return null
    }
    visiting.push(name)
    const sub = (e: Expr): Expr | null => {
      if (e.k === 'var') return defs.has(e.name) ? inline(e.name) : e
      if (e.k === 'const') return e
      if (e.k === 'not') {
        const a = sub(e.a)
        return a && not(a)
      }
      const args = e.args.map(sub)
      return args.every(Boolean) ? nary(e.k, args as Expr[]) : null
    }
    const result = sub(defs.get(name)!.expr)
    visiting.pop()
    if (result) inlined.set(name, result)
    return result
  }
  const outputs: Program['outputs'] = []
  for (const s of statements) {
    const expr = inline(s.name)
    if (expr) outputs.push({ name: s.name, written: s.expr, expr })
  }
  if (errors.length) return { errors }
  if (inputs.length > MAX_INPUTS) {
    return { errors: [{ line: 1, column: 1, message: `There are ${inputs.length} inputs (${inputs.join(', ')}); at most ${MAX_INPUTS} are supported.` }] }
  }
  return { program: { inputs, outputs }, errors }
}
