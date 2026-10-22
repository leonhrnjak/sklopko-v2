import type { CircuitBuilder } from './builder'
import { boundsRect, snap } from './circuit'

/** A note on the canvas, to explain an example. */
export function note(b: CircuitBuilder, x: number, y: number, text: string, cols = 32, color = 'yellow') {
  return b.add('note', x, y, { params: { text, cols, color } })
}

/** A frame round some of a circuit's parts, with room for its title above them. */
export function frameAround(b: CircuitBuilder, title: string, ids: string[], color = 'blue', pad = 24) {
  const rects = ids.map((id) => boundsRect(b.c.comps[id]))
  const x1 = Math.min(...rects.map((r) => r.x)) - pad
  const y1 = Math.min(...rects.map((r) => r.y)) - pad - 24
  const x2 = Math.max(...rects.map((r) => r.x + r.w)) + pad
  const y2 = Math.max(...rects.map((r) => r.y + r.h)) + pad
  return b.add('frame', snap(x1), snap(y1), { params: { title, w: snap(x2 - x1) + 10, h: snap(y2 - y1) + 10, color } })
}
