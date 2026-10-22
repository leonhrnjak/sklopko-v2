import { MAX_INPUTS } from './expr'
import { rowBits, type Cell, type TruthTable } from './table'

export interface Mismatch {
  /** The row of the combined inputs (see `Comparison.inputs`). */
  row: number
  inputs: Record<string, 0 | 1>
  output: string
  a: Cell
  b: Cell
}

export interface Comparison {
  /** Reasons the two can't be compared at all. */
  problems: string[]
  /** Same value for every output they share and every combination of inputs. */
  equal: boolean
  /** The inputs of both, which the comparison runs over. An input only one side has doesn't matter to the other. */
  inputs: string[]
  /** The outputs that both have, which are compared. */
  outputs: string[]
  onlyInA: string[]
  onlyInB: string[]
  /** How many rows × outputs differ. */
  mismatchCount: number
  /** The first few. */
  mismatches: Mismatch[]
}

const MAX_SHOWN = 20

/**
 * Do two truth tables say the same? Outputs are matched by name, inputs by name; the comparison runs over every
 * combination of all the inputs of both (one that ignores an input is simply the same for both of its values). An
 * unknown value only equals another unknown one.
 */
export function compareTables(a: TruthTable, b: TruthTable): Comparison {
  const inputs = [...a.inputs, ...b.inputs.filter((x) => !a.inputs.includes(x))]
  const outputs = a.outputs.filter((o) => b.outputs.includes(o))
  const result: Comparison = {
    problems: [],
    equal: false,
    inputs,
    outputs,
    onlyInA: a.outputs.filter((o) => !b.outputs.includes(o)),
    onlyInB: b.outputs.filter((o) => !a.outputs.includes(o)),
    mismatchCount: 0,
    mismatches: [],
  }
  if (!outputs.length) result.problems.push('No output has the same name in both, so there is nothing to compare. Name the outputs alike (for example Y).')
  if (inputs.length > MAX_INPUTS) result.problems.push(`Together they have ${inputs.length} inputs; at most ${MAX_INPUTS} can be compared.`)
  if (result.problems.length) return result

  /** The row of `t` for the combined row `bits`. */
  const rowIn = (t: TruthTable, bits: (0 | 1)[]) => t.inputs.reduce((row, name) => (row << 1) | bits[inputs.indexOf(name)], 0)
  for (let row = 0; row < 2 ** inputs.length; row++) {
    const bits = rowBits(row, inputs.length)
    const ra = rowIn(a, bits)
    const rb = rowIn(b, bits)
    for (const o of outputs) {
      const va = a.values[a.outputs.indexOf(o)][ra]
      const vb = b.values[b.outputs.indexOf(o)][rb]
      if (va === vb) continue
      result.mismatchCount++
      if (result.mismatches.length < MAX_SHOWN)
        result.mismatches.push({ row, inputs: Object.fromEntries(inputs.map((n, i) => [n, bits[i]])), output: o, a: va, b: vb })
    }
  }
  result.equal = result.mismatchCount === 0
  return result
}
