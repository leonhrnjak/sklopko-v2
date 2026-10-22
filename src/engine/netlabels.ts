import type { PinRef, SimCircuit } from './simulator'

export const SEND = 'netsend'
export const RECV = 'netrecv'

/**
 * Net labels: a Send label publishes whatever drives it under a name, and every Receive label with that name
 * carries the same signal. Returns, for each Receive label that has one, the output pin that drives it.
 *
 * The simulator gives such a label the driver's own net, so a labelled connection behaves exactly like a wire: it
 * adds no gate delay (a clock sent through a label would otherwise race the data it clocks).
 *
 * - The first Send label (in circuit order) of a name that has a driver publishes it.
 * - A Receive label can drive a Send label of another name; the chain is followed to the real driver, and a loop
 *   resolves to nothing.
 * - Receive labels with no match (or an empty name) are left out: they read X.
 */
export function resolveLabels(c: SimCircuit): Map<string, PinRef> {
  const recvName = new Map<string, string>()
  const sendName = new Map<string, string>()
  for (const k of c.comps) {
    const name = String(k.params.name ?? '')
    if (!name) continue
    if (k.type === RECV) recvName.set(k.id, name)
    else if (k.type === SEND) sendName.set(k.id, name)
  }
  const resolved = new Map<string, PinRef>()
  if (!recvName.size) return resolved

  const feed = new Map<string, PinRef>()
  for (const w of c.wires) if (w.to.pin === 'A' && sendName.has(w.to.comp)) feed.set(w.to.comp, w.from)
  const published = new Map<string, PinRef>()
  for (const k of c.comps) {
    const name = sendName.get(k.id)
    const src = feed.get(k.id)
    if (name !== undefined && src && !published.has(name)) published.set(name, src)
  }

  for (const [id, name] of recvName) {
    const seen = new Set([id])
    let src = published.get(name)
    while (src && recvName.has(src.comp)) {
      if (seen.has(src.comp)) src = undefined
      else {
        seen.add(src.comp)
        src = published.get(recvName.get(src.comp)!)
      }
    }
    if (src) resolved.set(id, src)
  }
  return resolved
}
