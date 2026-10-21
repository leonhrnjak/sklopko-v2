import { GRID, netKey, type Point, type Wire } from '../model/circuit'

export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

/** Drop duplicate points and the middle point of collinear runs. */
export function normalize(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    if (out.length && same(out[out.length - 1], p)) continue
    if (out.length >= 2) {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) {
        // Collinear. Only merge when it doesn't reverse direction (a reversal is a real U-turn).
        const forward = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0
        if (forward) {
          out[out.length - 1] = p
          continue
        }
      }
    }
    out.push({ x: p.x, y: p.y })
  }
  return out
}

export const isOrthogonal = (points: Point[]) =>
  points.every((p, i) => i === 0 || p.x === points[i - 1].x || p.y === points[i - 1].y)

export const isHorizontal = (a: Point, b: Point) => a.y === b.y

/** Direction of travel from a to b as a unit vector (assumes an axis-aligned segment). */
export const dirOf = (a: Point, b: Point): Point => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) })

/**
 * A path is valid for a wire if it is orthogonal, leaves the source pin outward
 * and enters the target pin from outside.
 */
export function validPath(path: Point[], from: Point, fromDir: Point, to: Point, toDir: Point): boolean {
  // Touching pins: a zero-length wire.
  if (same(from, to)) return path.length === 2 && same(path[0], from) && same(path[1], to)
  if (path.length < 2 || !same(path[0], from) || !same(path[path.length - 1], to)) return false
  if (!isOrthogonal(path)) return false
  const first = dirOf(path[0], path[1])
  const n = path.length
  const last = dirOf(path[n - 2], path[n - 1])
  return same(first, fromDir) && last.x === -toDir.x && last.y === -toDir.y
}

/**
 * Keep the interior of a hand-shaped path when its end points move: the first and last segments
 * stretch to stay orthogonal. Returns null if the result no longer makes sense.
 */
export function adjustEnds(path: Point[], from: Point, fromDir: Point, to: Point, toDir: Point): Point[] | null {
  if (path.length < 4) return null
  const p = path.map((q) => ({ ...q }))
  const n = p.length
  // Start: move point 0, drag point 1 along so segment 0 keeps its orientation.
  if (isHorizontal(path[0], path[1])) p[1].y = from.y
  else p[1].x = from.x
  p[0] = { ...from }
  if (isHorizontal(path[n - 2], path[n - 1])) p[n - 2].y = to.y
  else p[n - 2].x = to.x
  p[n - 1] = { ...to }
  const r = normalize(p)
  return validPath(r, from, fromDir, to, toDir) ? r : null
}

export interface Junction {
  net: string
  p: Point
}

/** Points where three or more wire segments of the same net meet. */
export function junctions(wires: Wire[]): Junction[] {
  const byNet = new Map<string, Map<string, number>>()
  const DIR = { r: 1, l: 2, d: 4, u: 8 }
  for (const w of wires) {
    const net = netKey(w.from)
    let m = byNet.get(net)
    if (!m) byNet.set(net, (m = new Map()))
    const add = (x: number, y: number, bit: number) => {
      const k = `${x},${y}`
      m!.set(k, (m!.get(k) ?? 0) | bit)
    }
    for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1]
      const b = w.path[i]
      const d = dirOf(a, b)
      const steps = Math.round((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / GRID)
      for (let s = 0; s < steps; s++) {
        const x = a.x + d.x * s * GRID
        const y = a.y + d.y * s * GRID
        const nx = x + d.x * GRID
        const ny = y + d.y * GRID
        if (d.x) {
          add(Math.min(x, nx), y, DIR.r)
          add(Math.max(x, nx), y, DIR.l)
        } else {
          add(x, Math.min(y, ny), DIR.d)
          add(x, Math.max(y, ny), DIR.u)
        }
      }
    }
  }
  const out: Junction[] = []
  for (const [net, m] of byNet)
    for (const [k, bits] of m) {
      let c = 0
      for (let b = bits; b; b >>= 1) c += b & 1
      if (c >= 3) {
        const [x, y] = k.split(',').map(Number)
        out.push({ net, p: { x, y } })
      }
    }
  return out
}

export interface SegmentDrag {
  /** Working copy of the path with helper points inserted. */
  path: Point[]
  /** Indices of the two points that move together. */
  a: number
  b: number
  horizontal: boolean
  /** Allowed range for the dragged coordinate, so the stubs at the pins keep pointing the right way. */
  min: number
  max: number
}

/**
 * Prepare to drag segment `i` of a path sideways. The pin ends can't move, so if the segment touches
 * a pin we keep a 10px stub there and insert a connector; interior segments just move with their neighbours.
 * Returns null when the segment is too short to grab.
 */
export function beginSegmentDrag(path: Point[], i: number): SegmentDrag | null {
  const n = path.length
  if (i < 0 || i >= n - 1) return null
  const horizontal = isHorizontal(path[i], path[i + 1])
  const p = path.map((q) => ({ ...q }))
  let a = i
  let b = i + 1
  if (i === n - 2) {
    // Touches the input pin: keep a stub at the end.
    const d = dirOf(p[b], p[a])
    const len = Math.abs(p[a].x - p[b].x) + Math.abs(p[a].y - p[b].y)
    if (len <= GRID) return null
    const stub = { x: p[b].x + d.x * GRID, y: p[b].y + d.y * GRID }
    p.splice(b, 0, { ...stub }, { ...stub })
  }
  if (i === 0) {
    const d = dirOf(p[0], p[1])
    const len = Math.abs(p[0].x - p[1].x) + Math.abs(p[0].y - p[1].y)
    if (len <= GRID) return null
    const stub = { x: p[0].x + d.x * GRID, y: p[0].y + d.y * GRID }
    p.splice(1, 0, { ...stub }, { ...stub })
    a = 2
    b = 3
  }
  let min = -Infinity
  let max = Infinity
  const key = horizontal ? 'y' : 'x'
  const limit = (fixed: Point, moving: Point, sign: number) => {
    // `moving` must stay at least one grid step beyond `fixed` in direction `sign`.
    if (sign > 0) min = Math.max(min, Math.min(fixed[key] + GRID, moving[key]))
    if (sign < 0) max = Math.min(max, Math.max(fixed[key] - GRID, moving[key]))
  }
  if (a === 1) limit(p[0], p[1], Math.sign(p[1][key] - p[0][key]))
  if (b === p.length - 2) limit(p[p.length - 1], p[b], Math.sign(p[b][key] - p[p.length - 1][key]))
  return { path: p, a, b, horizontal, min, max }
}

/** Move the dragged segment to coordinate `c` (y for horizontal segments, x for vertical). */
export function applySegmentDrag(d: SegmentDrag, c: number): Point[] {
  c = Math.min(d.max, Math.max(d.min, c))
  const p = d.path.map((q) => ({ ...q }))
  if (d.horizontal) {
    p[d.a].y = c
    p[d.b].y = c
  } else {
    p[d.a].x = c
    p[d.b].x = c
  }
  return p
}
