import { boundsRect, type Circuit, type Rect } from './circuit'

/** The room a part's label takes above it. */
const LABEL_ROOM = 20

/**
 * The rectangle that holds the whole circuit: every part (with the label above it), every wire, plus `pad` all
 * round. An empty circuit gets a small empty rectangle at the origin.
 */
export function circuitRect(c: Circuit, pad = 24): Rect {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  const grow = (x: number, y: number) => {
    x1 = Math.min(x1, x)
    y1 = Math.min(y1, y)
    x2 = Math.max(x2, x)
    y2 = Math.max(y2, y)
  }
  for (const k of Object.values(c.comps)) {
    const b = boundsRect(k)
    grow(b.x, b.y - (k.label ? LABEL_ROOM : 0))
    grow(b.x + b.w, b.y + b.h)
  }
  for (const w of Object.values(c.wires)) for (const p of w.path) grow(p.x, p.y)
  if (x1 === Infinity) return { x: -pad, y: -pad, w: 2 * pad, h: 2 * pad }
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + 2 * pad, h: y2 - y1 + 2 * pad }
}
