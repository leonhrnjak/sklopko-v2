import { evaluate, parseProgram, resolveProgram } from './expr'
import { rowBits } from './table'

/** The input names of a lookup table of `n` inputs: A, B, C… (A is the most significant bit). */
export const lutInputNames = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))

/** The output names of a lookup table of `m` outputs: Y, or Y0, Y1… */
export const lutOutputNames = (m: number) => (m === 1 ? ['Y'] : Array.from({ length: m }, (_, i) => `Y${i}`))

export type LutFill = { ok: true; words: number[] } | { ok: false; error: string }

/**
 * The contents of a lookup table (one word per row, output o in bit o) worked out from boolean expressions, written as in the Logic
 * panel. One expression is Y (or Y0 on a table with several outputs); more are `Y1 = …` and so on, or bare expressions that
 * fill Y0, Y1… in order. An output the text does not mention keeps its bits from `current`. Other names used on the right are
 * defined by their own lines, so `T = A·B; Y = T + C` works. Only the table's inputs (A, B, C…) may be left undefined.
 */
export function fillLut(text: string, n: number, m: number, current: number[]): LutFill {
  const { statements, errors } = parseProgram(text)
  if (errors.length) return { ok: false, error: `${errors[0].message} (line ${errors[0].line}, column ${errors[0].column})` }
  if (!statements.length) return { ok: false, error: 'Type an expression, for example A·B + ¬C.' }
  const { program, errors: problems } = resolveProgram(statements)
  if (!program) return { ok: false, error: problems[0]?.message ?? 'That does not work out.' }
  const inputs = lutInputNames(n)
  const outside = program.inputs.filter((v) => !inputs.includes(v))
  if (outside.length) return { ok: false, error: `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not an input of this table, which has ${inputs.join(', ')}.` }
  const outNames = lutOutputNames(m)
  // Bare expressions come out as Y, Y2, Y3…: they fill the outputs in order.
  const bare = ['Y', ...Array.from({ length: m }, (_, i) => `Y${i + 2}`)]
  const target = (o: number) => program.outputs.find((x) => x.name === outNames[o]) ?? (m > 1 ? program.outputs.find((x) => x.name === bare[o]) : undefined)
  const rows = 2 ** n
  const words = Array.from({ length: rows }, (_, r) => current[r] ?? 0)
  let filled = 0
  for (let o = 0; o < m; o++) {
    const out = target(o)
    if (!out) continue
    filled++
    for (let row = 0; row < rows; row++) {
      const bits = rowBits(row, n)
      const on = evaluate(out.expr, (v) => bits[inputs.indexOf(v)] === 1)
      words[row] = (words[row] & ~(1 << o)) | (on ? 1 << o : 0)
    }
  }
  if (!filled) return { ok: false, error: `No line is for an output of this table (${outNames.join(', ')}).` }
  return { ok: true, words }
}
