import { and, constant, not, or, variable, type Expr } from './expr'
import type { Cell } from './table'

/**
 * A product term over n inputs, in the numbering of truth-table rows (the first input is the most significant bit).
 * A bit set in `mask` is a free input (a dash: the term doesn't care about it); `value` holds the other inputs.
 */
export interface Implicant {
  value: number
  mask: number
}

export const covers = (i: Implicant, row: number) => (row & ~i.mask) === i.value

const popcount = (n: number) => {
  let c = 0
  for (; n; n &= n - 1) c++
  return c
}

/** How many inputs the term names. */
export const literalCount = (i: Implicant, n: number) => n - popcount(i.mask & (2 ** n - 1))

const key = (i: Implicant) => `${i.mask}:${i.value}`

/**
 * Terms in the order people write them: the term that names the first input comes first (A·B before B·C), and a term
 * with an input as itself before one with it inverted.
 */
function reading(a: Implicant, b: Implicant, n: number): number {
  const rank = (t: Implicant, bit: number) => (t.mask & bit ? 2 : t.value & bit ? 0 : 1)
  for (let k = n - 1; k >= 0; k--) {
    const d = rank(a, 1 << k) - rank(b, 1 << k)
    if (d) return d
  }
  return 0
}

/** Quine–McCluskey: every term that covers only rows in `rows` and can't be widened. */
export function primeImplicants(rows: number[]): Implicant[] {
  let current = new Map<string, Implicant>(rows.map((r) => [key({ value: r, mask: 0 }), { value: r, mask: 0 }]))
  const primes: Implicant[] = []
  while (current.size) {
    const used = new Set<string>()
    const next = new Map<string, Implicant>()
    // Two terms with the same dashes merge if they differ in exactly one input: group by dashes, then by number of ones.
    const groups = new Map<number, Map<number, Implicant[]>>()
    for (const t of current.values()) {
      const byOnes = groups.get(t.mask) ?? new Map<number, Implicant[]>()
      const ones = popcount(t.value)
      byOnes.set(ones, [...(byOnes.get(ones) ?? []), t])
      groups.set(t.mask, byOnes)
    }
    for (const [mask, byOnes] of groups)
      for (const [ones, low] of byOnes) {
        for (const a of low)
          for (const b of byOnes.get(ones + 1) ?? []) {
            const diff = a.value ^ b.value
            if (popcount(diff) !== 1) continue
            const merged = { value: a.value & ~diff, mask: mask | diff }
            used.add(key(a))
            used.add(key(b))
            next.set(key(merged), merged)
          }
      }
    for (const t of current.values()) if (!used.has(key(t))) primes.push(t)
    current = next
  }
  return primes
}

const better = (a: Implicant[], b: Implicant[], n: number) =>
  a.length < b.length || (a.length === b.length && a.reduce((s, i) => s + literalCount(i, n), 0) < b.reduce((s, i) => s + literalCount(i, n), 0))

/** Past this many candidate terms the cover is found greedily (small, but not always the smallest). */
const EXACT_LIMIT = 22

/**
 * Fewest terms (then fewest inputs named) from `primes` that cover every row of `onset`: the essential terms first,
 * then an exact search for what is left, or a greedy choice if there is too much to search.
 */
export function minimalCover(onset: number[], primes: Implicant[], n: number): Implicant[] {
  if (!onset.length) return []
  const chosen: Implicant[] = []
  for (const row of onset) {
    const only = primes.filter((p) => covers(p, row))
    if (only.length === 1 && !chosen.includes(only[0])) chosen.push(only[0])
  }
  const left = onset.filter((row) => !chosen.some((c) => covers(c, row)))
  if (left.length) {
    const candidates = primes.filter((p) => !chosen.includes(p) && left.some((row) => covers(p, row)))
    if (candidates.length <= EXACT_LIMIT) {
      let best: Implicant[] | null = null
      const search = (rem: number[], picked: Implicant[]) => {
        if (best && picked.length + (rem.length ? 1 : 0) > best.length) return
        if (!rem.length) {
          if (!best || better(picked, best, n)) best = [...picked]
          return
        }
        // Branch on the row that fewest candidates can cover.
        let options: Implicant[] = []
        for (const row of rem) {
          const cs = candidates.filter((p) => covers(p, row))
          if (!options.length || cs.length < options.length) options = cs
        }
        for (const p of options) search(rem.filter((row) => !covers(p, row)), [...picked, p])
      }
      search(left, [])
      chosen.push(...best!)
    } else {
      let rem = left
      while (rem.length) {
        const gain = (p: Implicant) => rem.filter((row) => covers(p, row)).length
        const pick = candidates.reduce((a, b) => (gain(b) > gain(a) || (gain(b) === gain(a) && literalCount(b, n) < literalCount(a, n)) ? b : a))
        chosen.push(pick)
        rem = rem.filter((row) => !covers(pick, row))
      }
    }
  }
  return chosen.sort((a, b) => reading(a, b, n))
}

/** A smallest sum of products for the 1 rows, using the 2 rows (don't cares) wherever that helps. */
export function minimize(values: Cell[], n: number): Implicant[] {
  const onset: number[] = []
  const free: number[] = []
  values.forEach((v, row) => (v === 1 ? onset : v === 2 ? free : []).push(row))
  if (!onset.length) return []
  return minimalCover(onset, primeImplicants([...onset, ...free]), n)
}

/** One term as an expression: the inputs it names, each as itself or inverted. No inputs named is the constant 1. */
export function implicantExpr(i: Implicant, names: string[]): Expr {
  const n = names.length
  const literals = names.flatMap((name, k) => {
    const bit = 1 << (n - 1 - k)
    return i.mask & bit ? [] : [i.value & bit ? variable(name) : not(variable(name))]
  })
  return literals.length ? and(...literals) : constant(true)
}

/** The smallest sum of products as an expression (0 if the output is never 1, 1 if it is never 0). */
export function minimizeExpr(values: Cell[], names: string[]): Expr {
  const terms = minimize(values, names.length)
  return terms.length ? or(...terms.map((t) => implicantExpr(t, names))) : constant(false)
}
