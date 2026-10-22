import { and, constant, not, or, variable, xor, type Expr } from './expr'

/** A small seeded random number generator (mulberry32), so property tests are the same on every run. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random expression over `names`, at most `depth` levels deep. */
export function randomExpr(next: () => number, names: string[], depth: number): Expr {
  if (depth <= 0 || next() < 0.2) return next() < 0.08 ? constant(next() < 0.5) : variable(names[Math.floor(next() * names.length)])
  const pick = next()
  if (pick < 0.25) return not(randomExpr(next, names, depth - 1))
  const n = 2 + (next() < 0.3 ? 1 : 0)
  const args = Array.from({ length: n }, () => randomExpr(next, names, depth - 1))
  return pick < 0.5 ? and(...args) : pick < 0.8 ? or(...args) : xor(...args)
}
