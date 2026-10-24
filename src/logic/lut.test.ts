import { describe, expect, it } from 'vitest'
import { fillLut, lutInputNames, lutOutputNames } from './lut'

const words = (text: string, n: number, m: number, current: number[] = []) => {
  const r = fillLut(text, n, m, current)
  if (!r.ok) throw new Error(r.error)
  return r.words
}

describe('filling a lookup table from an expression', () => {
  it('names the inputs and outputs the way the part does', () => {
    expect(lutInputNames(3)).toEqual(['A', 'B', 'C'])
    expect(lutOutputNames(1)).toEqual(['Y'])
    expect(lutOutputNames(2)).toEqual(['Y0', 'Y1'])
  })

  it('a bare expression fills Y: A is the most significant input, so rows count in binary', () => {
    // A·B on two inputs: only row 3 (A=1, B=1).
    expect(words('A·B', 2, 1)).toEqual([0, 0, 0, 1])
    // A or C on three inputs: rows 4–7 (A=1) and rows 1, 3 (C=1).
    expect(words('A + C', 3, 1)).toEqual([0, 1, 0, 1, 1, 1, 1, 1])
    // The ascii spellings of the Logic panel work.
    expect(words('!A & B', 2, 1)).toEqual([0, 1, 0, 0])
    expect(words('A ^ B', 2, 1)).toEqual([0, 1, 1, 0])
  })

  it('several outputs: named lines, or bare lines in order, one bit each', () => {
    // A sum and a carry: a half adder as a two-output table.
    expect(words('Y0 = A ^ B\nY1 = A & B', 2, 2)).toEqual([0, 1, 1, 2])
    expect(words('A ^ B\nA & B', 2, 2)).toEqual([0, 1, 1, 2])
    expect(words('Y1 = A\nY0 = B', 2, 2)).toEqual([0, 1, 2, 3])
  })

  it('other names are defined by their own lines', () => {
    expect(words('T = A·B\nY = T + C', 3, 1)).toEqual([0, 1, 0, 1, 0, 1, 1, 1])
  })

  it('an output the text leaves out keeps what it had; the filled one is replaced', () => {
    const before = [3, 3, 3, 3]
    expect(words('Y0 = 0', 2, 2, before)).toEqual([2, 2, 2, 2])
    expect(words('Y1 = A', 2, 2, before)).toEqual([1, 1, 3, 3])
  })

  it('says what is wrong: a syntax error with its place, an input the table lacks, a line for nothing', () => {
    const err = (text: string, n = 2, m = 1) => {
      const r = fillLut(text, n, m, [])
      return r.ok ? '' : r.error
    }
    expect(err('A ·')).toMatch(/line 1, column/)
    expect(err('')).toContain('Type an expression')
    expect(err('A·C', 2)).toBe('C is not an input of this table, which has A, B.')
    expect(err('X = A', 2)).toContain('No line is for an output')
    expect(err('Y = Y')).toContain('depends on itself')
  })
})
