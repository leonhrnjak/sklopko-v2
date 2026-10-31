import type { ComponentDef } from './types'

/**
 * Planning for the fast engine (docs/spec-sim-speed-tier2.md): from the compiled parts, an order in which the combinational parts can
 * each be evaluated once, or the reason a circuit has to stay on the exact unit-delay engine.
 */

/** What the planner needs to know of a compiled part. */
export interface PlanPart {
  timing: ComponentDef['timing']
  /** Net feeding each input, or -1. */
  inNets: ArrayLike<number>
  /** Net each output drives. */
  outNets: ArrayLike<number>
  /** Which inputs are clock pins. */
  clockIns: readonly number[]
  /** The part has a propagation delay of more than one tick. */
  slow: boolean
  /** The part changes its own outputs with time (a clock). */
  ticking?: boolean
}

export interface Plan {
  /** The parts that are not registered (combinational, mixed, sources, sinks), each after every part that feeds it. */
  order: Int32Array
  /** Position of each part in `order`, or -1 for a registered part. */
  rank: Int32Array
}

export type Rejected = 'delay' | 'untimed' | 'loop' | 'race'
/** For finding out why (tests and measuring). */
export const why: { detail: string } = { detail: '' }

/** A part that keeps its state until a clock input changes: its inputs are read at the clock, not as a signal that travels. */
const registered = (p: PlanPart) => p.timing === 'registered'

export function buildPlan(parts: PlanPart[], nets: number, raceCheck = true): Plan | Rejected {
  const n = parts.length
  for (const p of parts) {
    if (p.slow) return 'delay'
    if (p.timing === undefined) return 'untimed'
  }
  const driver = new Int32Array(nets).fill(-1)
  for (let i = 0; i < n; i++) for (let k = 0; k < parts[i].outNets.length; k++) driver[parts[i].outNets[k]] = i

  // Edges between parts that are not registered: from the part that drives a net to each part that reads it.
  const succ: number[][] = Array.from({ length: n }, () => [])
  const indeg = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    if (registered(parts[i])) continue
    const seen = new Set<number>()
    for (let k = 0; k < parts[i].inNets.length; k++) {
      const net = parts[i].inNets[k]
      const d = net >= 0 ? driver[net] : -1
      if (d < 0 || d === i || registered(parts[d]) || seen.has(d)) {
        if (d === i) return 'loop'
        continue
      }
      seen.add(d)
      succ[d].push(i)
      indeg[i]++
    }
  }
  // Kahn's algorithm; a part left over is on a loop.
  const order: number[] = []
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (!registered(parts[i]) && indeg[i] === 0) ready.push(i)
  for (let h = 0; h < ready.length; h++) {
    const i = ready[h]
    order.push(i)
    for (const s of succ[i]) if (--indeg[s] === 0) ready.push(s)
  }
  if (order.length !== parts.filter((p) => !registered(p)).length) {
    const inOrder = new Set(order)
    why.detail = parts.map((p, i) => ({ p, i })).filter(({ p, i }) => !registered(p) && !inOrder.has(i)).slice(0, 12).map(({ p, i }) => `${i}:${p.timing}`).join(' ')
    return 'loop'
  }

  if (raceCheck) {
    // A part that is clocked reads its data as it was before the edge. That holds only if the data does not change at the same moment
    // as the clock: no signal (a clock, a register's output) may reach both its clock pin and one of its data pins.
    const origins = new Map<number, Set<number>>()
    const originsOf = (i: number): Set<number> => {
      if (registered(parts[i]) || parts[i].timing === 'source') return new Set([i])
      let s = origins.get(i)
      if (!s) {
        s = new Set()
        origins.set(i, s) // (no loops here: they were rejected above)
        for (let k = 0; k < parts[i].inNets.length; k++) {
          const net = parts[i].inNets[k]
          const d = net >= 0 ? driver[net] : -1
          if (d >= 0) for (const o of originsOf(d)) s.add(o)
        }
      }
      return s
    }
    for (let i = 0; i < n; i++) {
      const p = parts[i]
      if (p.clockIns.length === 0 || (!registered(p) && p.timing !== 'mixed')) continue
      const clockPins = new Set(p.clockIns)
      const clk = new Set<number>()
      const data = new Set<number>()
      for (let k = 0; k < p.inNets.length; k++) {
        const net = p.inNets[k]
        const d = net >= 0 ? driver[net] : -1
        if (d >= 0) for (const o of originsOf(d)) (clockPins.has(k) ? clk : data).add(o)
      }
      // Two clocks are not ordered by the unit delay of the logic after them: if one reaches the clock pin and another a data pin,
      // which comes first depends on the depth of the gates in between (and was decided by those depths in the exact engine).
      const tickers = (set: Set<number>) => [...set].filter((o) => parts[o].ticking)
      const ct = tickers(clk)
      const dt = tickers(data)
      if (ct.length > 0 && dt.some((o) => !ct.includes(o))) {
        why.detail = `part ${i} (${p.timing}) clocked by clock ${ct[0]} with data from clock ${dt[0]}`
        return 'race'
      }
      for (const o of clk) if (data.has(o)) {
        why.detail = `part ${i} (${p.timing}) clock and data both from part ${o} (${parts[o].timing})`
        return 'race'
      }
    }
  }

  const rank = new Int32Array(n).fill(-1)
  order.forEach((i, r) => (rank[i] = r))
  return { order: Int32Array.from(order), rank }
}
