import { print } from './expr'
import { covers, implicantExpr, minimize, type Implicant } from './minimize'
import type { Cell } from './table'

export interface KGroup {
  /** The product term, as text: ¬A·B. */
  term: string
  implicant: Implicant
  /** The [row, column] of every cell the term covers (also across the edges of the map). */
  cells: [number, number][]
}

export interface KMap {
  rowVars: string[]
  colVars: string[]
  /** The values of the row and column variables, in Gray-code order: neighbours differ in one variable. */
  rowLabels: string[]
  colLabels: string[]
  cells: { row: number; value: Cell }[][]
  groups: KGroup[]
}

/** Gray code for 0, 1 or 2 bits. */
const gray = (bits: number) => (bits === 0 ? [0] : bits === 1 ? [0, 1] : [0, 1, 3, 2])

/**
 * The Karnaugh map of one output over 1 to 4 inputs, with the groups of the smallest sum of products. (`cells[r][c].row`
 * is the truth-table row of the cell.) Null for more inputs than a map can show.
 */
export function kmapOf(values: Cell[], names: string[]): KMap | null {
  const n = names.length
  if (n < 1 || n > 4) return null
  const rowBits = n === 4 ? 2 : n === 1 ? 0 : 1
  const colBits = n - rowBits
  const rows = gray(rowBits)
  const cols = gray(colBits)
  const label = (code: number, bits: number) => (bits ? code.toString(2).padStart(bits, '0') : '')
  const cells = rows.map((r) => cols.map((c) => ({ row: (r << colBits) | c, value: values[(r << colBits) | c] })))
  const groups = minimize(values, n).map((imp) => ({
    term: print(implicantExpr(imp, names)),
    implicant: imp,
    cells: rows.flatMap((_, r) => cols.flatMap((__, c): [number, number][] => (covers(imp, cells[r][c].row) ? [[r, c]] : []))),
  }))
  return {
    rowVars: names.slice(0, rowBits),
    colVars: names.slice(rowBits),
    rowLabels: rows.map((r) => label(r, rowBits)),
    colLabels: cols.map((c) => label(c, colBits)),
    cells,
    groups,
  }
}
