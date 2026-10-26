import type { IcSymbol } from '../engine/components/ic'
import { analyzeCircuit } from './analyze'
import type { Circuit } from './circuit'
import { deriveInterface } from './ic'

/** The outputs of each gate, for the first input as the most significant bit of the row (they do not depend on the order). */
const ones = (n: number, f: (bits: number) => boolean) => Array.from({ length: 2 ** n }, (_, row) => (f(row) ? 1 : 0))
const popcount = (v: number) => v.toString(2).replace(/0/g, '').length

/** The most inputs a chip is checked for being a gate (the gates themselves go to 8; a chip that wide is rarely one). */
const MAX_INPUTS = 4

/**
 * The gate a circuit behaves as, if it is one: switches in, one LED out, nothing but the switches deciding the answer, and the
 * answer of AND, OR, NAND, NOR, XOR or XNOR (two to four inputs), NOT or a plain buffer (one). `c` carries the table of ICs its
 * parts are made of. Used when a chip is made, so that it is drawn as the gate it is.
 */
export function detectSymbol(c: Circuit): IcSymbol | undefined {
  const { inputs, outputs } = deriveInterface(c)
  const n = inputs.length
  if (outputs.length !== 1 || n < 1 || n > MAX_INPUTS || [...inputs, ...outputs].some((p) => p.bits !== 1)) return undefined
  if (![...inputs, ...outputs].every((p) => c.comps[p.comp].type === 'switch' || c.comps[p.comp].type === 'led')) return undefined
  let result
  try {
    result = analyzeCircuit(c, inputs.map((p) => p.comp), [outputs[0].comp])
  } catch {
    return undefined
  }
  if (result.warnings.length) return undefined
  const got = result.table.values[0]
  const is = (f: (bits: number) => boolean) => got.every((v, row) => v === ones(n, f)[row])
  if (n === 1) return is((b) => b === 0) ? 'not' : is((b) => b === 1) ? 'buf' : undefined
  const all = 2 ** n - 1
  if (is((b) => b === all)) return 'and'
  if (!is((b) => b === all) && is((b) => b !== all)) return 'nand'
  if (is((b) => b !== 0)) return 'or'
  if (is((b) => b === 0)) return 'nor'
  if (is((b) => popcount(b) % 2 === 1)) return 'xor'
  if (is((b) => popcount(b) % 2 === 0)) return 'xnor'
  return undefined
}
