import { X } from './types'

/**
 * Glitches: a net that changes more often during one settle than it needs to. A net that goes 1 → 0 → 1 and ends where it
 * began has a *static* glitch (static-1 if it was 1, static-0 if it was 0): it should have stayed put. One that ends the
 * other way but changes three times (or more) has a *dynamic* glitch. A net that starts unknown (X, as at power-up) or
 * becomes unknown on the way is skipped, because a change from X is not a glitch.
 */
export type GlitchKind = 'static-0' | 'static-1' | 'dynamic'

export interface Glitch {
  /** The net's index (see `Simulator.netNames`). */
  net: number
  kind: GlitchKind
  /** The value it began and ended with. */
  first: number
  last: number
  /** How many times it changed. */
  changes: number
  /** The ticks of its first and last change (1 is the first tick of the settle). */
  from: number
  to: number
}

/** Look for glitches in every net of a capture (`frames[0]` is before the first tick, `frames[k]` after tick k). */
export function findGlitches(frames: Uint8Array[]): Glitch[] {
  const found: Glitch[] = []
  if (frames.length < 3) return found // two changes need at least two ticks
  const nets = frames[0].length
  for (let net = 0; net < nets; net++) {
    const first = frames[0][net]
    if (first === X) continue
    let changes = 0
    let from = 0
    let to = 0
    let known = true
    for (let k = 1; k < frames.length; k++) {
      const v = frames[k][net]
      if (v === X) {
        known = false
        break
      }
      if (v !== frames[k - 1][net]) {
        changes++
        if (!from) from = k
        to = k
      }
    }
    if (!known) continue
    const last = frames[frames.length - 1][net]
    const needed = first === last ? 0 : 1
    if (changes <= needed) continue
    found.push({ net, kind: first === last ? (first ? 'static-1' : 'static-0') : 'dynamic', first, last, changes, from, to })
  }
  return found
}

/** The value of one net at each tick of a capture, starting with the value before the first tick. */
export const traceOf = (frames: Uint8Array[], net: number): Uint8Array => Uint8Array.from(frames, (f) => f[net])
