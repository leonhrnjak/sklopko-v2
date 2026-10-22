import { evaluate, type Program } from './expr'

/** 0, 1, or 2 for a value that is unknown (an output nothing drives) or that doesn't matter (a "don't care"). */
export type Cell = 0 | 1 | 2

export interface TruthTable {
  inputs: string[]
  outputs: string[]
  /** `values[o][row]` is output `o` for input row `row`. */
  values: Cell[][]
}

export const rowCount = (t: Pick<TruthTable, 'inputs'>) => 2 ** t.inputs.length

/** The inputs' values in a row. The first input is the most significant bit, so the rows read like counting in binary. */
export function rowBits(row: number, n: number): (0 | 1)[] {
  return Array.from({ length: n }, (_, i) => ((row >> (n - 1 - i)) & 1) as 0 | 1)
}

/** The truth table of a program's outputs over its inputs. */
export function tableOfProgram(p: Program): TruthTable {
  const n = p.inputs.length
  const rows = 2 ** n
  const values = p.outputs.map((o) =>
    Array.from({ length: rows }, (_, row) => {
      const bits = rowBits(row, n)
      return evaluate(o.expr, (v) => bits[p.inputs.indexOf(v)] === 1) ? 1 : (0 as Cell)
    }),
  )
  return { inputs: p.inputs, outputs: p.outputs.map((o) => o.name), values }
}

/** The table as tab-separated text (pastes into a spreadsheet), with ? for an unknown value. */
export function tableToText(t: TruthTable): string {
  const cell = (c: Cell) => (c === 2 ? '?' : String(c))
  const lines = [[...t.inputs, ...t.outputs].join('\t')]
  for (let row = 0; row < rowCount(t); row++) lines.push([...rowBits(row, t.inputs.length), ...t.values.map((v) => cell(v[row]))].join('\t'))
  return lines.join('\n') + '\n'
}
