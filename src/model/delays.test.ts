import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { flatten } from './buses'
import type { Circuit } from './circuit'
import { realisticDelay, hasDelay } from './delays'
import { EXAMPLES } from './examples'

const load = (c: Circuit, delays: boolean): Simulator => {
  const s = new Simulator()
  const flat = flatten(c)
  const comps = flat.comps.map((k) => {
    const comp = c.comps[k.id]
    return delays && comp && hasDelay(comp) ? { ...k, delay: realisticDelay(comp) } : k
  })
  s.load({ comps, wires: flat.wires })
  s.settle()
  return s
}

/** Every output pin of every part, as one string. */
const snapshot = (s: Simulator, c: Circuit) =>
  Object.keys(c.comps)
    .map((id) => s.signature(id))
    .join('|')

describe('realistic delays change when things happen, not what happens', () => {
  for (const ex of EXAMPLES) {
    it(`"${ex.name}" shows the same values after every clock edge`, () => {
      const c = ex.build()
      const plain = load(c, false)
      const slow = load(c, true)
      if (!plain.hasClocks) {
        expect(snapshot(slow, c)).toBe(snapshot(plain, c))
        return
      }
      for (let edge = 0; edge < 40; edge++) {
        plain.stepClock()
        slow.stepClock()
        // Both are settled after the edge, so the circuits are in the same state (unless they never settle).
        if (plain.unstable || slow.unstable) return
        expect(snapshot(slow, c), `edge ${edge}`).toBe(snapshot(plain, c))
      }
      // The delays were really in use: the slow circuit needed more ticks to settle.
      expect(slow.ticks).toBeGreaterThan(plain.ticks)
    })
  }
})
