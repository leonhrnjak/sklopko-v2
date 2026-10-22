import { describe, expect, it } from 'vitest'
import { compareTables } from './compare'
import { MAX_INPUTS, parseProgram, resolveProgram } from './expr'
import { tableOfProgram, type TruthTable } from './table'

const table = (text: string): TruthTable => tableOfProgram(resolveProgram(parseProgram(text).statements).program!)

describe('comparing truth tables', () => {
  it('equal functions written differently are equal (De Morgan, distribution, absorption)', () => {
    for (const [a, b] of [
      ['Y = ¬(A·B)', 'Y = ¬A + ¬B'],
      ['Y = ¬(A + B)', 'Y = ¬A·¬B'],
      ['Y = A·(B + C)', 'Y = A·B + A·C'],
      ['Y = A + A·B', 'Y = A'],
      ['Y = A ⊕ B', 'Y = A·¬B + ¬A·B'],
      ['Y = (A + B)·(¬A + C)', 'Y = A·C + ¬A·B'],
    ]) {
      const r = compareTables(table(a), table(b))
      expect(r.equal, `${a}  vs  ${b}`).toBe(true)
      expect(r.problems).toEqual([])
    }
  })

  it('different functions differ, and the first differing rows are listed with their inputs', () => {
    const r = compareTables(table('Y = A·B'), table('Y = A + B'))
    expect(r.equal).toBe(false)
    expect(r.mismatchCount).toBe(2)
    expect(r.mismatches).toEqual([
      { row: 1, inputs: { A: 0, B: 1 }, output: 'Y', a: 0, b: 1 },
      { row: 2, inputs: { A: 1, B: 0 }, output: 'Y', a: 0, b: 1 },
    ])
  })

  it('counts every difference but lists only the first few', () => {
    const r = compareTables(table('Y = 0 ·A·B·C·D·E'), table('Y = 1 + A·B·C·D·E'))
    expect(r.mismatchCount).toBe(2 ** 5)
    expect(r.mismatches).toHaveLength(20)
  })

  it('an input that only one side has does not matter to the other', () => {
    expect(compareTables(table('Y = A·B + A·¬B'), table('Y = A')).equal).toBe(true) // B is irrelevant
    const r = compareTables(table('Y = A'), table('Y = A·B'))
    expect(r.inputs).toEqual(['A', 'B'])
    expect(r.mismatches).toEqual([{ row: 3 - 1, inputs: { A: 1, B: 0 }, output: 'Y', a: 1, b: 0 }])
  })

  it('matches inputs by name, not by position', () => {
    const a = table('Y = A·¬B') // inputs A, B
    const b = table('Y = ¬B·A') // inputs B, A
    expect(a.inputs).toEqual(['A', 'B'])
    expect(b.inputs).toEqual(['B', 'A'])
    expect(compareTables(a, b).equal).toBe(true)
    expect(compareTables(a, table('Y = B·¬A')).equal).toBe(false)
  })

  it('compares the outputs both have, by name, and reports the rest', () => {
    const r = compareTables(table('S = A ⊕ B\nC = A·B'), table('S = A ⊕ B\nX = A'))
    expect(r.outputs).toEqual(['S'])
    expect(r.onlyInA).toEqual(['C'])
    expect(r.onlyInB).toEqual(['X'])
    expect(r.equal).toBe(true)
  })

  it('has nothing to compare without a shared output, or with too many inputs', () => {
    const none = compareTables(table('P = A'), table('Q = A'))
    expect(none.problems[0]).toContain('No output has the same name')
    expect(none.equal).toBe(false)
    const names = Array.from({ length: MAX_INPUTS }, (_, i) => `X${i}`)
    const wide = compareTables(table(`Y = ${names.join('+')}`), table('Y = Z'))
    expect(wide.problems[0]).toContain(`at most ${MAX_INPUTS}`)
  })

  it('an unknown value is only equal to another unknown one', () => {
    const a: TruthTable = { inputs: ['A'], outputs: ['Y'], values: [[0, 2]] }
    expect(compareTables(a, { ...a, values: [[0, 2]] }).equal).toBe(true)
    const r = compareTables(a, { ...a, values: [[0, 1]] })
    expect(r.equal).toBe(false)
    expect(r.mismatches[0]).toMatchObject({ a: 2, b: 1, inputs: { A: 1 } })
  })

  it('a table with no inputs is one row', () => {
    expect(compareTables(table('Y = 1'), table('Y = 1')).equal).toBe(true)
    expect(compareTables(table('Y = 1'), table('Y = 0')).equal).toBe(false)
  })
})
