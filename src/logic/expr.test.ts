import { describe, expect, it } from 'vitest'
import { MAX_INPUTS, ParseError, and, constant, equal, evaluate, not, or, parseExpr, parseProgram, print, resolveProgram, variable, variables, xor, type Expr } from './expr'
import { randomExpr, rng } from './testing'

const A = variable('A')
const B = variable('B')
const C = variable('C')
const parse = (s: string) => parseExpr(s)
const fails = (s: string) => {
  try {
    parseExpr(s)
  } catch (e) {
    if (e instanceof ParseError) return { message: e.message, column: e.column }
    throw e
  }
  throw new Error(`“${s}” should not parse`)
}
const truth = (e: Expr, names: string[]) =>
  Array.from({ length: 2 ** names.length }, (_, row) => evaluate(e, (v) => ((row >> (names.length - 1 - names.indexOf(v))) & 1) === 1))

describe('parsing', () => {
  it('reads names, 0 and 1', () => {
    expect(parse('A')).toEqual(A)
    expect(parse('Bit_2')).toEqual(variable('Bit_2'))
    expect(parse('0')).toEqual(constant(false))
    expect(parse('1')).toEqual(constant(true))
  })

  it('reads every way of writing the operators', () => {
    const want = or(and(not(A), B), C)
    for (const s of ['¬A·B + C', '!A*B + C', '~A&B | C', "A'·B + C", "A'*B ∨ C", '¬A∧B∨C', '!A⋅B+C']) expect(equal(parse(s), want), s).toBe(true)
    expect(equal(parse('A ⊕ B'), xor(A, B))).toBe(true)
    expect(equal(parse('A ^ B'), xor(A, B))).toBe(true)
  })

  it('AND binds tighter than XOR, which binds tighter than OR; NOT binds tightest', () => {
    expect(equal(parse('A + B·C'), or(A, and(B, C)))).toBe(true)
    expect(equal(parse('A ⊕ B·C'), xor(A, and(B, C)))).toBe(true)
    expect(equal(parse('A + B ⊕ C'), or(A, xor(B, C)))).toBe(true)
    expect(equal(parse('¬A·B'), and(not(A), B))).toBe(true)
    expect(equal(parse('¬(A·B)'), not(and(A, B)))).toBe(true)
    expect(equal(parse('¬¬A'), not(not(A)))).toBe(true)
    expect(equal(parse("(A+B)'"), not(or(A, B)))).toBe(true)
    expect(equal(parse("A''"), not(not(A)))).toBe(true)
  })

  it('joins a chain of the same operator into one gate with many inputs', () => {
    expect(parse('A+B+C+A')).toEqual(or(A, B, C, A))
    expect((parse('A+B+C') as { args: Expr[] }).args).toHaveLength(3)
    expect((parse('(A+B)+C') as { args: Expr[] }).args).toHaveLength(3) // brackets that don't change anything vanish
    expect(parse('A·(B + C)·D')).toEqual(and(A, or(B, C), variable('D')))
  })

  it('ignores spaces and tabs anywhere', () => {
    expect(equal(parse('  A\t·  B  '), and(A, B))).toBe(true)
  })

  it('says what is wrong, and where', () => {
    expect(fails('')).toMatchObject({ column: 1 })
    expect(fails('A +')).toEqual({ message: 'The expression ends too early: something is missing after the last operator.', column: 4 })
    expect(fails('A B')).toEqual({ message: 'Missing operator before “B”: write A·B, A*B or A&B for AND, and A+B for OR.', column: 3 })
    expect(fails('A(B)')).toMatchObject({ column: 2, message: expect.stringContaining('Missing operator before “(”') })
    expect(fails('(A + B')).toEqual({ message: 'Missing “)”.', column: 7 })
    expect(fails('A + B)')).toEqual({ message: 'This “)” has no matching “(”.', column: 6 })
    expect(fails('A + * B')).toMatchObject({ column: 5, message: expect.stringContaining('Expected a name') })
    expect(fails('A # B')).toEqual({ message: 'Unexpected “#”.', column: 3 })
    expect(fails('A + 2')).toEqual({ message: '“2” is not a name or a constant: the only numbers are 0 and 1.', column: 5 })
    expect(fails('()')).toMatchObject({ column: 2 })
  })
})

describe('printing', () => {
  it('writes the usual notation with brackets only where they are needed', () => {
    expect(print(parse('¬A·B + C'))).toBe('¬A·B + C')
    expect(print(parse('A·(B + C)'))).toBe('A·(B + C)')
    expect(print(parse('(A·B) + C'))).toBe('A·B + C')
    expect(print(parse('¬(A + B)'))).toBe('¬(A + B)')
    expect(print(parse('¬(A·B)'))).toBe('¬(A·B)')
    expect(print(parse('A ⊕ B·C'))).toBe('A ⊕ B·C')
    expect(print(parse('(A + B) ⊕ C'))).toBe('(A + B) ⊕ C')
    expect(print(parse('A ⊕ (B ⊕ C)'))).toBe('A ⊕ B ⊕ C')
    expect(print(parse('¬¬A'))).toBe('¬¬A')
    expect(print(constant(true))).toBe('1')
  })

  it('has a plain-text style that can be typed anywhere', () => {
    expect(print(parse('¬A·B + C ⊕ D'), 'ascii')).toBe('!A*B + C ^ D')
    expect(print(parse('¬(A + B)'), 'ascii')).toBe('!(A + B)')
  })

  it('reading what was printed gives back the same expression, for hundreds of random ones', () => {
    const next = rng(2024)
    const names = ['A', 'B', 'C', 'D']
    for (let i = 0; i < 500; i++) {
      const e = randomExpr(next, names, 4)
      for (const style of ['math', 'ascii'] as const) {
        const text = print(e, style)
        const back = parse(text)
        expect(equal(back, e), `${style}: ${text}`).toBe(true)
      }
    }
  })

  it('and means the same when it is read back, whatever the shape', () => {
    const next = rng(7)
    const names = ['A', 'B', 'C']
    for (let i = 0; i < 200; i++) {
      const e = randomExpr(next, names, 5)
      expect(truth(parse(print(e)), names)).toEqual(truth(e, names))
    }
  })
})

describe('evaluating', () => {
  it('follows the operators', () => {
    const env = (v: string) => ({ A: true, B: false, C: true })[v as 'A']
    expect(evaluate(parse('A·B'), env)).toBe(false)
    expect(evaluate(parse('A + B'), env)).toBe(true)
    expect(evaluate(parse('A ⊕ C'), env)).toBe(false)
    expect(evaluate(parse('A ⊕ B ⊕ C'), env)).toBe(false) // odd number of ones
    expect(evaluate(parse('¬B·C'), env)).toBe(true)
    expect(evaluate(parse('1·0 + 1'), env)).toBe(true)
  })

  it('lists variables in order of first appearance', () => {
    expect(variables(parse('C·A + B·¬C + A'))).toEqual(['C', 'A', 'B'])
    expect(variables(parse('1 + 0'))).toEqual([])
  })
})

describe('programs', () => {
  it('reads one named expression per line, with comments and blank lines', () => {
    const { statements, errors } = parseProgram('# a half adder\nS = A ⊕ B\n\nC = A·B // carry\n')
    expect(errors).toEqual([])
    expect(statements.map((s) => [s.name, print(s.expr), s.line])).toEqual([['S', 'A ⊕ B', 2], ['C', 'A·B', 4]])
  })

  it('also reads := and statements separated by ;', () => {
    const { statements, errors } = parseProgram('X := A + B; Z = X·C')
    expect(errors).toEqual([])
    expect(statements.map((s) => s.name)).toEqual(['X', 'Z'])
  })

  it('a line that is only an expression is an output called Y, then Y2, Y3…', () => {
    expect(parseProgram('A·B').statements.map((s) => s.name)).toEqual(['Y'])
    expect(parseProgram('A·B\nA+B').statements.map((s) => s.name)).toEqual(['Y', 'Y2'])
    expect(parseProgram('Y = A\nA·B').statements.map((s) => s.name)).toEqual(['Y', 'Y2']) // Y is taken
  })

  it('reports errors line by line and keeps the good lines', () => {
    const { statements, errors } = parseProgram('Y = A +\nZ = A·B\nW = (A')
    expect(statements.map((s) => s.name)).toEqual(['Z'])
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [1, 'The expression ends too early: something is missing after the last operator.'],
      [3, 'Missing “)”.'],
    ])
    expect(errors[0].column).toBe(8) // counted from the start of the line, “Y = A +” is 7 characters
  })

  it('wants the name before the = sign', () => {
    expect(parseProgram('A + B = C').errors[0].message).toContain('Write the output’s name')
    expect(parseProgram('Y = Z = A').errors[0].message).toContain('Only one “=”')
    expect(parseProgram('1 = A').errors).toHaveLength(1)
  })

  it('works out the inputs, and lets a line use another line’s name', () => {
    const { program, errors } = resolveProgram(parseProgram('X = A + B\nY = X·C\nZ = ¬X').statements)
    expect(errors).toEqual([])
    expect(program!.inputs).toEqual(['A', 'B', 'C'])
    expect(program!.outputs.map((o) => [o.name, print(o.written), print(o.expr)])).toEqual([
      ['X', 'A + B', 'A + B'],
      ['Y', 'X·C', '(A + B)·C'],
      ['Z', '¬X', '¬(A + B)'],
    ])
  })

  it('rejects a name defined twice and a name that depends on itself', () => {
    expect(resolveProgram(parseProgram('Y = A\nY = B').statements).errors[0].message).toBe('“Y” is defined twice (first on line 1).')
    const loop = resolveProgram(parseProgram('X = Y\nY = X').statements).errors
    expect(loop).toHaveLength(1)
    expect(loop[0].message).toMatch(/depends on itself \(X → Y → X\)/)
    expect(resolveProgram(parseProgram('Y = Y·A').statements).errors[0].message).toContain('depends on itself')
  })

  it('limits the number of inputs', () => {
    const names = Array.from({ length: MAX_INPUTS + 1 }, (_, i) => `V${i}`)
    const r = resolveProgram(parseProgram(`Y = ${names.join(' + ')}`).statements)
    expect(r.program).toBeUndefined()
    expect(r.errors[0].message).toContain(`at most ${MAX_INPUTS}`)
  })
})
