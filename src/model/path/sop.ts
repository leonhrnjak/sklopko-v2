import { startOf } from '../challenges'
import type { Circuit } from '../circuit'
import { chipId, chipTable } from './chips'

/**
 * A circuit for a sum of products in NAND gates only (NAND-NAND form): one NAND for each term and one NAND of the terms. A term is
 * a list of literals, a name or `¬name`. An inverted input is a NAND with its inputs tied, made once and shared. A term with one
 * literal ties its NAND's inputs as well, and so does the last NAND when there is one term. (The library's `synthesize` has no
 * NAND-only mode.)
 */
export function nandNandSolution(inputs: string[], output: string, terms: string[][]): Circuit {
  const { b, ins, outs } = startOf(inputs, [output])
  const inverted = new Map<string, string>()
  const signal = (literal: string): string => {
    if (!literal.startsWith('¬')) return `${ins[literal]}.Q`
    const name = literal.slice(1)
    let gate = inverted.get(name)
    if (!gate) {
      gate = b.add('nand', 110, inverted.size * 70 - 20)
      b.wire(`${ins[name]}.Q`, `${gate}.A`)
      b.wire(`${ins[name]}.Q`, `${gate}.B`)
      inverted.set(name, gate)
    }
    return `${gate}.Y`
  }
  // The inverters first, so that the terms are placed to their right whatever order the literals come in.
  for (const t of terms) for (const l of t) if (l.startsWith('¬')) signal(l)
  const gates = terms.map((t, i) => {
    const gate = b.add('nand', 220, i * 80 - 20, { params: { inputs: Math.max(2, t.length) } })
    const wires = t.length === 1 ? [t[0], t[0]] : t
    wires.forEach((l, k) => b.wire(signal(l), `${gate}.${String.fromCharCode(65 + k)}`))
    return gate
  })
  const last = b.add('nand', 340, 20, { params: { inputs: Math.max(2, gates.length) } })
  const sources = gates.length === 1 ? [gates[0], gates[0]] : gates
  sources.forEach((g, k) => b.wire(`${g}.Y`, `${last}.${String.fromCharCode(65 + k)}`))
  b.wire(`${last}.Y`, `${outs[output]}.A`)
  return b.build()
}

/**
 * A sum of products built from the chips of the kit, term by term as a truth table gives them (step 3.2): a NOT for each inverted
 * input, a chain of ANDs for each term, a chain of ORs for the terms. It is the big circuit that the rest of the chapter makes smaller.
 */
export function sopFromKit(inputs: string[], output: string, terms: string[][]): Circuit {
  const { b, ins, outs } = startOf(inputs, [output])
  b.c.ics = chipTable(['not-from-nand', 'and-from-nand', 'or-from-nand'], {})
  const inverted = new Map<string, string>()
  const signal = (literal: string): string => {
    if (!literal.startsWith('¬')) return `${ins[literal]}.Q`
    const name = literal.slice(1)
    let gate = inverted.get(name)
    if (!gate) {
      gate = b.ic(chipId('not-from-nand'), 100, inverted.size * 70 - 20)
      b.wire(`${ins[name]}.Q`, `${gate}.A`)
      inverted.set(name, gate)
    }
    return `${gate}.Y`
  }
  for (const t of terms) for (const l of t) if (l.startsWith('¬')) signal(l)
  /** Chain `parts` with `chip`, left to right in row `y`; returns the last signal and the x it ended at. */
  const chain = (parts: string[], chip: string, x0: number, y: number): { out: string; x: number } => {
    let out = parts[0]
    let x = x0
    for (const p of parts.slice(1)) {
      const g = b.ic(chipId(chip), x, y)
      b.wire(out, `${g}.A`)
      b.wire(p, `${g}.B`)
      out = `${g}.Y`
      x += 110
    }
    return { out, x }
  }
  const rows = terms.map((t, i) => chain(t.map(signal), 'and-from-nand', 220, i * 90))
  const sum = chain(
    rows.map((r) => r.out),
    'or-from-nand',
    Math.max(...rows.map((r) => r.x), 220) + 20,
    (terms.length * 90) / 2 - 20,
  )
  b.wire(sum.out, `${outs[output]}.A`)
  b.c.comps[outs[output]].x = sum.x + 40
  return b.build()
}
