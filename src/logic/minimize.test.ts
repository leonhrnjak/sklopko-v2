import { describe, expect, it } from 'vitest'
import { evaluate, parseExpr, parseProgram, print, resolveProgram } from './expr'
import { kmapOf } from './kmap'
import { covers, implicantExpr, literalCount, minimalCover, minimize, minimizeExpr, primeImplicants, type Implicant } from './minimize'
import { rowBits, rowCount, tableOfProgram, tableToText, type Cell, type TruthTable } from './table'
import { rng } from './testing'

const table = (text: string): TruthTable => tableOfProgram(resolveProgram(parseProgram(text).statements).program!)

describe('truth tables of programs', () => {
  it('rows count up in binary with the first input as the most significant bit', () => {
    expect([0, 1, 2, 3].map((r) => rowBits(r, 2))).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]])
    expect(rowBits(5, 3)).toEqual([1, 0, 1])
  })

  it('evaluates every output over the inputs', () => {
    const t = table('S = A ⊕ B\nC = A·B')
    expect(t.inputs).toEqual(['A', 'B'])
    expect(t.outputs).toEqual(['S', 'C'])
    expect(t.values).toEqual([[0, 1, 1, 0], [0, 0, 0, 1]])
    expect(rowCount(t)).toBe(4)
  })

  it('a constant is a table with no inputs and one row', () => {
    expect(table('Y = 1').values).toEqual([[1]])
    expect(table('Y = A + 1').values).toEqual([[1, 1]]) // still has A as an input
  })

  it('can be written as tab-separated text', () => {
    expect(tableToText(table('Y = A·B'))).toBe('A\tB\tY\n0\t0\t0\n0\t1\t0\n1\t0\t0\n1\t1\t1\n')
    expect(tableToText({ inputs: ['A'], outputs: ['Y'], values: [[2, 1]] })).toBe('A\tY\n0\t?\n1\t1\n')
  })
})

/** The smallest number of terms that cover the 1 rows, by trying every subset of the prime implicants. */
function bruteForceMinimum(values: Cell[], n: number) {
  const onset = values.flatMap((v, r) => (v === 1 ? [r] : []))
  const primes = primeImplicants(values.flatMap((v, r) => (v !== 0 ? [r] : [])))
  let best = Infinity
  for (let mask = 0; mask < 2 ** primes.length; mask++) {
    const chosen = primes.filter((_, i) => mask & (1 << i))
    if (chosen.length < best && onset.every((r) => chosen.some((c) => covers(c, r)))) best = chosen.length
  }
  return { best: onset.length ? best : 0, primes, n }
}

describe('minimising', () => {
  it('finds the classics', () => {
    const name = (v: Cell[], names: string[]) => print(minimizeExpr(v, names))
    expect(name([0, 1, 1, 0], ['A', 'B'])).toBe('A·¬B + ¬A·B') // XOR can't be simplified
    expect(name([0, 0, 0, 1, 0, 1, 1, 1], ['A', 'B', 'C'])).toBe('A·B + A·C + B·C') // majority
    expect(name([1, 1, 1, 1], ['A', 'B'])).toBe('1')
    expect(name([0, 0, 0, 0], ['A', 'B'])).toBe('0')
    expect(name([1, 0, 1, 0], ['A', 'B'])).toBe('¬B')
    expect(name([0, 1, 1, 1], ['A', 'B'])).toBe('A + B') // OR reads in the order of the inputs
    expect(name([0, 1], ['A'])).toBe('A')
  })

  it('uses don’t cares where that makes it smaller', () => {
    // f(w,x,y,z) = Σm(1,3,7,11,15) + d(0,2,5)  →  ¬w·z + y·z
    const v: Cell[] = Array(16).fill(0)
    for (const m of [1, 3, 7, 11, 15]) v[m] = 1
    for (const m of [0, 2, 5]) v[m] = 2
    expect(print(minimizeExpr(v, ['w', 'x', 'y', 'z']))).toBe('¬w·z + y·z')
  })

  it('a function that is one term: the four corners of a 4-input map are ¬B·¬D', () => {
    const v: Cell[] = Array.from({ length: 16 }, (_, r) => (!((r >> 2) & 1) && !(r & 1) ? 1 : 0))
    expect(print(minimizeExpr(v, ['A', 'B', 'C', 'D']))).toBe('¬B·¬D')
  })

  it('gives a correct, prime, minimum cover for hundreds of random functions of 1 to 4 inputs', () => {
    const next = rng(99)
    for (let trial = 0; trial < 400; trial++) {
      const n = 1 + Math.floor(next() * 4)
      const values = Array.from({ length: 2 ** n }, () => (next() < 0.45 ? 1 : next() < 0.2 ? 2 : 0)) as Cell[]
      const cover = minimize(values, n)
      values.forEach((v, row) => {
        const covered = cover.some((c) => covers(c, row))
        if (v === 1) expect(covered, `n=${n} ${values.join('')} row ${row} must be covered`).toBe(true)
        if (v === 0) expect(covered, `n=${n} ${values.join('')} row ${row} must not be covered`).toBe(false)
      })
      // Prime: dropping any named input from a term would cover a 0 row.
      for (const t of cover)
        for (let bit = 0; bit < n; bit++) {
          if (t.mask & (1 << bit)) continue
          const wider = { value: t.value & ~(1 << bit), mask: t.mask | (1 << bit) }
          expect(values.some((v, row) => v === 0 && covers(wider, row)), `a term of ${values.join('')} is not prime`).toBe(true)
        }
      expect(cover.length, `${values.join('')} is not the minimum`).toBe(bruteForceMinimum(values, n).best)
    }
  })

  it('still covers correctly for 5 to 8 inputs, where the cover may be found greedily', () => {
    const next = rng(5)
    for (let trial = 0; trial < 40; trial++) {
      const n = 5 + Math.floor(next() * 4)
      const values = Array.from({ length: 2 ** n }, () => (next() < 0.4 ? 1 : 0)) as Cell[]
      const cover = minimize(values, n)
      values.forEach((v, row) => expect(cover.some((c) => covers(c, row)), `n=${n} row ${row}`).toBe(v === 1))
    }
  })

  it('the expression it gives has the same truth table as the function', () => {
    const next = rng(31)
    for (let trial = 0; trial < 150; trial++) {
      const n = 2 + Math.floor(next() * 3)
      const names = ['A', 'B', 'C', 'D'].slice(0, n)
      const values = Array.from({ length: 2 ** n }, () => (next() < 0.5 ? 1 : 0)) as Cell[]
      const e = minimizeExpr(values, names)
      values.forEach((v, row) => {
        const bits = rowBits(row, n)
        expect(evaluate(e, (x) => bits[names.indexOf(x)] === 1) ? 1 : 0).toBe(v)
      })
      // And it reads back.
      expect(print(parseExpr(print(e)))).toBe(print(e))
    }
  })

  it('writes a term from the inputs it names', () => {
    const t: Implicant = { value: 0b101, mask: 0b010 } // A=1, B free, C=1
    expect(print(implicantExpr(t, ['A', 'B', 'C']))).toBe('A·C')
    expect(print(implicantExpr({ value: 0b00, mask: 0b01 }, ['A', 'B']))).toBe('¬A')
    expect(literalCount(t, 3)).toBe(2)
  })

  it('keeps the essential terms and finds a minimum for the rest (a cyclic case with two covers)', () => {
    // f = Σm(0,1,2,5,6,7): the 3-input cyclic prime-implicant example, which needs 3 of its 6 terms.
    const v: Cell[] = [1, 1, 1, 0, 0, 1, 1, 1]
    expect(minimize(v, 3)).toHaveLength(3)
    expect(minimalCover([], [], 3)).toEqual([])
  })
})

describe('Karnaugh maps', () => {
  it('has a Gray-code layout: neighbours differ in one variable, also across the edges', () => {
    const k = kmapOf(Array(16).fill(0), ['A', 'B', 'C', 'D'])!
    expect(k.rowVars).toEqual(['A', 'B'])
    expect(k.colVars).toEqual(['C', 'D'])
    expect(k.rowLabels).toEqual(['00', '01', '11', '10'])
    expect(k.colLabels).toEqual(['00', '01', '11', '10'])
    const bits = (s: string) => parseInt(s, 2)
    const differsInOne = (a: number, b: number) => [1, 2].includes(a ^ b) // for 2-bit codes
    for (let i = 0; i < 4; i++) expect(differsInOne(bits(k.colLabels[i]), bits(k.colLabels[(i + 1) % 4]))).toBe(true)
  })

  it('shows every cell with the value of its truth table row', () => {
    const next = rng(11)
    for (let trial = 0; trial < 60; trial++) {
      const n = 1 + Math.floor(next() * 4)
      const values = Array.from({ length: 2 ** n }, () => (Math.floor(next() * 3) as Cell))
      const k = kmapOf(values, ['A', 'B', 'C', 'D'].slice(0, n))!
      const seen = new Set<number>()
      for (const row of k.cells)
        for (const cell of row) {
          expect(cell.value).toBe(values[cell.row])
          seen.add(cell.row)
        }
      expect(seen.size).toBe(2 ** n) // every row appears exactly once
    }
  })

  it('lays out 1, 2 and 3 inputs too', () => {
    const shape = (n: number) => {
      const k = kmapOf(Array(2 ** n).fill(0), ['A', 'B', 'C'].slice(0, n))!
      return [k.cells.length, k.cells[0].length]
    }
    expect([shape(1), shape(2), shape(3)]).toEqual([[1, 2], [2, 2], [2, 4]])
  })

  it('groups the cells of the smallest sum of products, covering every 1, in powers of two, wrapping round the edges', () => {
    const next = rng(23)
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(next() * 3)
      const values = Array.from({ length: 2 ** n }, () => (next() < 0.5 ? 1 : 0)) as Cell[]
      const k = kmapOf(values, ['A', 'B', 'C', 'D'].slice(0, n))!
      const grouped = new Set(k.groups.flatMap((g) => g.cells.map(([r, c]) => k.cells[r][c].row)))
      values.forEach((v, row) => expect(grouped.has(row), `${values.join('')}: row ${row}`).toBe(v === 1))
      for (const g of k.groups) {
        expect([1, 2, 4, 8, 16]).toContain(g.cells.length)
        for (const [r, c] of g.cells) expect(k.cells[r][c].value).not.toBe(0) // a group never covers a 0
      }
    }
    // The four corners of the 4-input map are one group of four cells: it wraps round both edges.
    const corners = kmapOf(Array.from({ length: 16 }, (_, r) => (!((r >> 2) & 1) && !(r & 1) ? 1 : 0)) as Cell[], ['A', 'B', 'C', 'D'])!
    expect(corners.groups).toHaveLength(1)
    expect(corners.groups[0].term).toBe('¬B·¬D')
    expect(corners.groups[0].cells).toEqual([[0, 0], [0, 3], [3, 0], [3, 3]])
  })

  it('has no map for more than four inputs, or none', () => {
    expect(kmapOf(Array(32).fill(0), ['A', 'B', 'C', 'D', 'E'])).toBeNull()
    expect(kmapOf([0], [])).toBeNull()
  })
})
