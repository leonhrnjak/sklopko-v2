import { STATE_RADIUS } from '../../model/fsm-edit'
import type { Fsm } from '../../model/fsm'

export interface Pt {
  x: number
  y: number
}

/** A transition as drawn: the path, the arrowhead (tip and the direction it points) and where its label goes. */
export interface Arrow {
  d: string
  tip: Pt
  /** Direction of the arrowhead, in radians. */
  angle: number
  label: Pt
  /** Which way the label text hangs from `label`. */
  anchor: 'start' | 'middle' | 'end'
}

const unit = (dx: number, dy: number): Pt => {
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

/** The point on the edge of a circle around `c`, in the direction of `toward`. */
export function edgePoint(c: Pt, toward: Pt, r = STATE_RADIUS): Pt {
  const u = unit(toward.x - c.x, toward.y - c.y)
  return { x: c.x + u.x * r, y: c.y + u.y * r }
}

const fmt = (n: number) => Math.round(n * 10) / 10

/**
 * A curved arrow from one state to another. `bend` is how far the curve bulges to the right of the direction of travel (negative:
 * to the left); 0 is a straight line.
 */
export function arrowBetween(a: Pt, b: Pt, bend: number, r = STATE_RADIUS): Arrow {
  const dir = unit(b.x - a.x, b.y - a.y)
  const normal = { x: -dir.y, y: dir.x } // to the right of travel on a screen where y points down
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const ctrl = { x: mid.x + normal.x * bend * 2, y: mid.y + normal.y * bend * 2 }
  const start = edgePoint(a, ctrl, r)
  const end = edgePoint(b, ctrl, r)
  const peak = { x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y }
  // The label sits on the outside of the bulge; on a straight line, above it.
  let side = bend === 0 ? (normal.y <= 0 ? 1 : -1) : Math.sign(bend)
  if (bend === 0 && Math.abs(normal.y) < 1e-6) side = normal.x >= 0 ? 1 : -1
  const label = { x: peak.x + normal.x * side * 12, y: peak.y + normal.y * side * 12 }
  const d = bend === 0 ? `M${fmt(start.x)} ${fmt(start.y)} L${fmt(end.x)} ${fmt(end.y)}` : `M${fmt(start.x)} ${fmt(start.y)} Q${fmt(ctrl.x)} ${fmt(ctrl.y)} ${fmt(end.x)} ${fmt(end.y)}`
  const heading = bend === 0 ? dir : unit(end.x - ctrl.x, end.y - ctrl.y)
  return { d, tip: end, angle: Math.atan2(heading.y, heading.x), label, anchor: 'middle' }
}

/** A loop above a state that leaves and comes back to it; `index` makes the next loop of the same state bigger. */
export function loopAt(c: Pt, index = 0, r = STATE_RADIUS): Arrow {
  const h = 52 + index * 24
  const dx = 15
  const dy = Math.sqrt(r * r - dx * dx)
  const start = { x: c.x - dx, y: c.y - dy }
  const end = { x: c.x + dx, y: c.y - dy }
  const c1 = { x: c.x - 46 - index * 8, y: c.y - r - h }
  const c2 = { x: c.x + 46 + index * 8, y: c.y - r - h }
  const heading = unit(end.x - c2.x, end.y - c2.y)
  return {
    d: `M${fmt(start.x)} ${fmt(start.y)} C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(end.x)} ${fmt(end.y)}`,
    tip: end,
    angle: Math.atan2(heading.y, heading.x),
    label: { x: c.x, y: c.y - r - h * 0.75 - 8 },
    anchor: 'middle',
  }
}

/** The short arrow that comes into the reset state from the left. */
export function entryArrow(c: Pt, r = STATE_RADIUS): Arrow {
  const start = { x: c.x - r - 44, y: c.y }
  const end = { x: c.x - r, y: c.y }
  return { d: `M${start.x} ${start.y} L${end.x} ${end.y}`, tip: end, angle: 0, label: { x: start.x, y: start.y - 8 }, anchor: 'start' }
}

/** The corners of an arrowhead pointing along `angle` with its tip at `tip`. */
export function arrowHead(tip: Pt, angle: number, size = 11): string {
  const back = (da: number): Pt => ({ x: tip.x - size * Math.cos(angle + da), y: tip.y - size * Math.sin(angle + da) })
  const l = back(0.38)
  const rgt = back(-0.38)
  return `${fmt(tip.x)},${fmt(tip.y)} ${fmt(l.x)},${fmt(l.y)} ${fmt(rgt.x)},${fmt(rgt.y)}`
}

/** Every transition of a machine as an arrow, with the bends worked out: pairs of states that have transitions both ways bulge apart, and several between the same two fan out. */
export function arrowsOf(fsm: Fsm): Map<string, Arrow> {
  const at = new Map(fsm.states.map((s) => [s.id, { x: s.x ?? 0, y: s.y ?? 0 }]))
  const arrows = new Map<string, Arrow>()
  const key = (from: string, to: string) => `${from}\u0000${to}`
  const groups = new Map<string, string[]>()
  for (const t of fsm.transitions) {
    if (!at.has(t.from) || !at.has(t.to)) continue
    const k = key(t.from, t.to)
    groups.set(k, [...(groups.get(k) ?? []), t.id])
  }
  for (const t of fsm.transitions) {
    const a = at.get(t.from)
    const b = at.get(t.to)
    if (!a || !b) continue
    const same = groups.get(key(t.from, t.to))!
    const index = same.indexOf(t.id)
    if (t.from === t.to) {
      arrows.set(t.id, loopAt(a, index))
      continue
    }
    const both = groups.has(key(t.to, t.from))
    arrows.set(t.id, arrowBetween(a, b, both ? 24 + index * 30 : (index - (same.length - 1) / 2) * 30))
  }
  return arrows
}

/** The size the diagram needs: room for every state and its loops, never smaller than the default area. */
export function diagramBounds(fsm: Fsm, min = { w: 900, h: 520 }): { x: number; y: number; w: number; h: number } {
  let minX = 0
  let minY = 0
  let maxX = min.w
  let maxY = min.h
  for (const s of fsm.states) {
    minX = Math.min(minX, (s.x ?? 0) - 110)
    minY = Math.min(minY, (s.y ?? 0) - 150)
    maxX = Math.max(maxX, (s.x ?? 0) + 110)
    maxY = Math.max(maxY, (s.y ?? 0) + 90)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** The state under a point (the topmost, which is the last drawn), if any. */
export function stateAt(fsm: Fsm, p: Pt, slack = 0): string | undefined {
  for (let i = fsm.states.length - 1; i >= 0; i--) {
    const s = fsm.states[i]
    if (Math.hypot((s.x ?? 0) - p.x, (s.y ?? 0) - p.y) <= STATE_RADIUS + slack) return s.id
  }
  return undefined
}

/** Is the point on the rim of a state, where dragging starts a new transition rather than moving the state? */
export const onRim = (c: Pt, p: Pt) => {
  const d = Math.hypot(p.x - c.x, p.y - c.y)
  return d >= STATE_RADIUS - 10 && d <= STATE_RADIUS + 8
}
