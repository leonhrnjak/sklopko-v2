import { getDef } from '../../engine/registry'
import type { V } from '../../engine/types'
import type { Circuit, Comp } from '../circuit'
import type { Goal } from './types'

/** What goals read from a running circuit: the simulator, or a stand-in in a test. */
export interface Reader {
  pinValue(compId: string, pin: string): V
  readonly unstable: boolean
}

/** The part with this label (labels name parts in lessons and goals). */
export const labelled = (c: Circuit, label: string): Comp | undefined => Object.values(c.comps).find((k) => k.label === label)

/** The number a hex display or a bus display shows, or null while one of its bits is unknown. */
export function displayValue(c: Circuit, label: string, r: Reader): number | null {
  const k = labelled(c, label)
  if (!k) return null
  const pins = k.type === 'hexdisp' ? ['A', 'B', 'C', 'D'] : k.type === 'busdisp' ? Array.from({ length: Number(k.params.bits) || 1 }, (_, i) => `A${i}`) : []
  if (!pins.length) return null
  let n = 0
  for (let i = 0; i < pins.length; i++) {
    const v = r.pinValue(k.id, pins[i])
    if (v !== 0 && v !== 1) return null
    n |= v << i
  }
  return n
}

/** Does the goal hold right now? */
export function goalHolds(g: Goal, c: Circuit, r: Reader): boolean {
  if ('oscillating' in g) return r.unstable
  if ('switches' in g)
    return Object.entries(g.switches).every(([label, is]) => {
      const k = labelled(c, label)
      return !!k && k.type === 'switch' && r.pinValue(k.id, 'Q') === is
    })
  if ('led' in g) {
    const k = labelled(c, g.led)
    return !!k && k.type === 'led' && r.pinValue(k.id, 'A') === g.is
  }
  return displayValue(c, g.display, r) === g.is
}

/** Do the parts the goals look at exist? A goal on a part that is not there can never be reached. */
export const goalProblems = (goals: readonly Goal[], c: Circuit): string[] =>
  goals.flatMap((g) => {
    if ('switches' in g) return Object.keys(g.switches).flatMap((l) => (labelled(c, l)?.type === 'switch' ? [] : [`${g.text}: there is no switch labelled “${l}”`]))
    const label = 'led' in g ? g.led : 'display' in g ? g.display : undefined
    if (label === undefined) return []
    const k = labelled(c, label)
    if (!k) return [`${g.text}: there is no part labelled “${label}”`]
    const want = 'led' in g ? 'led' : undefined
    if (want && k.type !== want) return [`${g.text}: “${label}” is a ${getDef(k.type).name}, not an LED`]
    return []
  })

/**
 * The goals ticked after one more look at the circuit. A ticked goal stays ticked; with `ordered`, a goal is only looked at once
 * the one before it is ticked (and one look can tick several in a row).
 */
export function tick(goals: readonly Goal[], ticked: readonly boolean[], ordered: boolean, holds: (g: Goal) => boolean): boolean[] {
  const next = [...ticked]
  for (let i = 0; i < goals.length; i++) {
    if (next[i]) continue
    if (ordered && i > 0 && !next[i - 1]) break
    if (holds(goals[i])) next[i] = true
    else if (ordered) break
  }
  return next
}
