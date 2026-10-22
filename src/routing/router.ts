import {
  GRID,
  bodyRect,
  labelAnchor,
  findPin,
  netKey,
  worldPins,
  type Circuit,
  type Point,
  type Wire,
} from '../model/circuit'
import { normalize } from './path'

// Cost model (in grid steps).
const STEP = 1
const SHARE = 0.5 // walking along a wire of the same net (fan-out trunks)
const BEND = 6
const CROSS = 8 // crossing another net at right angles (worth more than a bend: crossings are harder to read)
const CLASH = 200 // overlapping / touching another net in a way that looks like a connection
const NEAR_BODY = 0.6 // running right next to a component body
const OVER_LABEL = 12 // running through a part's label text (allowed, e.g. to reach a top pin, but avoided)
const MAX_EXPANSIONS = 300_000
const MARGIN = 6 // free grid cells around everything

// Directions: 0 +x, 1 +y, 2 -x, 3 -y
const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

const dirIndex = (v: Point) => (v.x > 0 ? 0 : v.y > 0 ? 1 : v.x < 0 ? 2 : 3)

class Grid {
  x0: number
  y0: number
  w: number
  h: number
  blocked: Uint8Array
  near: Uint8Array
  /** Cells covered by part labels. */
  label: Uint8Array
  tip: Uint8Array
  /** Net id (1-based) on the horizontal edge from cell i to i+1; -1 if several. */
  hOcc: Int32Array
  /** Net id on the vertical edge from cell i to i+w. */
  vOcc: Int32Array
  /** Net id that bends or ends at cell i. */
  pOcc: Int32Array

  /** Same static obstacles, empty wire occupancy. */
  fresh(): Grid {
    const g = Object.create(Grid.prototype) as Grid
    Object.assign(g, this)
    const n = this.w * this.h
    g.hOcc = new Int32Array(n)
    g.vOcc = new Int32Array(n)
    g.pOcc = new Int32Array(n)
    return g
  }

  constructor(minX: number, minY: number, maxX: number, maxY: number) {
    this.x0 = Math.floor(minX / GRID) - MARGIN
    this.y0 = Math.floor(minY / GRID) - MARGIN
    this.w = Math.ceil(maxX / GRID) + MARGIN - this.x0 + 1
    this.h = Math.ceil(maxY / GRID) + MARGIN - this.y0 + 1
    const n = this.w * this.h
    this.blocked = new Uint8Array(n)
    this.near = new Uint8Array(n)
    this.label = new Uint8Array(n)
    this.tip = new Uint8Array(n)
    this.hOcc = new Int32Array(n)
    this.vOcc = new Int32Array(n)
    this.pOcc = new Int32Array(n)
  }

  idx(p: Point) {
    const gx = Math.round(p.x / GRID) - this.x0
    const gy = Math.round(p.y / GRID) - this.y0
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return -1
    return gy * this.w + gx
  }

  point(i: number): Point {
    return { x: ((i % this.w) + this.x0) * GRID, y: (Math.floor(i / this.w) + this.y0) * GRID }
  }

  private static mark(arr: Int32Array, i: number, net: number) {
    if (i < 0) return
    const cur = arr[i]
    arr[i] = cur === 0 || cur === net ? net : -1
  }

  /** Register a routed path as an obstacle for wires of other nets. */
  addPath(path: Point[], net: number) {
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]
      const b = path[k]
      if (a.y === b.y) {
        const y = a.y
        for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x += GRID) Grid.mark(this.hOcc, this.idx({ x, y }), net)
      } else {
        const x = a.x
        for (let y = Math.min(a.y, b.y); y < Math.max(a.y, b.y); y += GRID) Grid.mark(this.vOcc, this.idx({ x, y }), net)
      }
    }
    // Ends and bends: another net passing through here would look connected.
    for (const p of path) Grid.mark(this.pOcc, this.idx(p), net)
  }

  /** Any net on any edge touching cell i, other than `net`. */
  foreignAt(i: number, net: number) {
    const { w } = this
    const other = (v: number) => v !== 0 && v !== net
    return (
      other(this.hOcc[i]) ||
      (i % w > 0 && other(this.hOcc[i - 1])) ||
      other(this.vOcc[i]) ||
      (i >= w && other(this.vOcc[i - w])) ||
      other(this.pOcc[i])
    )
  }
}

/** Min-heap of (priority, value) pairs. */
class Heap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const { k, v } = this
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): number {
    const { k, v } = this
    const top = v[0]
    const lk = k.pop()!
    const lv = v.pop()!
    const n = k.length
    if (n) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lk
      v[i] = lv
    }
    return top
  }
}

interface Endpoints {
  from: Point
  fromDir: Point
  to: Point
  /** Outward direction of the target pin; we must arrive moving the opposite way. */
  toDir: Point
}

export function wireEndpoints(c: Circuit, w: Pick<Wire, 'from' | 'to'>): Endpoints | null {
  const fc = c.comps[w.from.comp]
  const tc = c.comps[w.to.comp]
  if (!fc || !tc) return null
  const fp = findPin(fc, w.from.pin)
  const tp = findPin(tc, w.to.pin)
  if (!fp || !tp) return null
  return { from: fp.pos, fromDir: fp.dir, to: tp.pos, toDir: tp.dir }
}

/** Simple fallback shape when the search fails: stub out, Z-shape, stub in. */
export function fallbackPath(e: Endpoints): Point[] {
  const s = { x: e.from.x + e.fromDir.x * GRID, y: e.from.y + e.fromDir.y * GRID }
  const t = { x: e.to.x + e.toDir.x * GRID, y: e.to.y + e.toDir.y * GRID }
  const mx = Math.round((s.x + t.x) / 2 / GRID) * GRID
  return normalize([e.from, s, { x: mx, y: s.y }, { x: mx, y: t.y }, t, e.to])
}

function buildGrid(c: Circuit, extra: Point[]): Grid {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (p: Point) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (const comp of Object.values(c.comps)) {
    const r = bodyRect(comp)
    grow(r)
    grow({ x: r.x + r.w, y: r.y + r.h })
    for (const p of worldPins(comp)) grow(p.pos)
  }
  for (const w of Object.values(c.wires)) w.path.forEach(grow)
  extra.forEach(grow)
  if (minX === Infinity) {
    minX = minY = 0
    maxX = maxY = 0
  }
  const g = new Grid(minX, minY, maxX, maxY)

  for (const comp of Object.values(c.comps)) {
    if (comp.label) {
      // Label text is centred above or below the part (see labelAnchor): ~6.5px per character, 11px tall.
      const a = labelAnchor(comp)
      const half = (comp.label.length * 6.5) / 2 + 4
      const cx = a.x
      const rows = a.below ? [a.y - 10, a.y] : [a.y, a.y - 10]
      for (const y of rows.map((r) => Math.round(r / GRID) * GRID))
        for (let x = Math.floor((cx - half) / GRID) * GRID; x <= cx + half; x += GRID) {
          const i = g.idx({ x, y })
          if (i >= 0) g.label[i] = 1
        }
    }
    const r = bodyRect(comp)
    for (let y = r.y; y <= r.y + r.h; y += GRID)
      for (let x = r.x; x <= r.x + r.w; x += GRID) {
        const i = g.idx({ x, y })
        if (i >= 0) g.blocked[i] = 1
      }
    for (let y = r.y - GRID; y <= r.y + r.h + GRID; y += GRID)
      for (let x = r.x - GRID; x <= r.x + r.w + GRID; x += GRID) {
        const i = g.idx({ x, y })
        if (i >= 0) g.near[i] = 1
      }
    for (const p of worldPins(comp)) {
      g.tip[g.idx(p.pos)] = 1
      // Points strictly between the tip and the body (long stubs, inversion bubbles).
      for (let k = 1; ; k++) {
        const q = { x: p.pos.x - p.dir.x * GRID * k, y: p.pos.y - p.dir.y * GRID * k }
        const i = g.idx(q)
        if (i < 0 || g.blocked[i]) break
        g.blocked[i] = 1
      }
    }
  }
  return g
}

/**
 * A* over (cell, direction). `passable` holds pin tips the wire may run through: inputs already fed by the
 * same net (electrically the same signal; the crossing point shows a junction dot).
 */
function search(g: Grid, e: Endpoints, net: number, passable?: Set<number>): Point[] | null {
  const s = g.idx(e.from)
  const t = g.idx(e.to)
  if (s < 0 || t < 0) return null
  const sd = dirIndex(e.fromDir)
  const td = (dirIndex(e.toDir) + 2) % 4 // direction of travel when entering the target
  const { w, h } = g
  const n = w * h * 4
  const gs = new Float32Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const tx = t % w
  const ty = Math.floor(t / w)
  const heur = (i: number) => Math.abs((i % w) - tx) + Math.abs(Math.floor(i / w) - ty)

  const heap = new Heap()
  const start = s * 4 + sd
  gs[start] = 0
  heap.push(heur(s), start)
  let goal = -1

  for (let iter = 0; heap.size && iter < MAX_EXPANSIONS; iter++) {
    const st = heap.pop()
    if (closed[st]) continue
    closed[st] = 1
    const cell = st >> 2
    const d0 = st & 3
    if (cell === t) {
      goal = st
      break
    }
    const cx = cell % w
    const cy = Math.floor(cell / w)
    for (let d = 0; d < 4; d++) {
      if (d === (d0 + 2) % 4) continue // no U-turns
      if (cell === s && d !== sd) continue // leave the source pin straight out
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const nb = ny * w + nx
      if (nb === t) {
        if (d !== td) continue
      } else if (g.blocked[nb] || (g.tip[nb] && nb !== s && !passable?.has(nb))) continue

      let cost = STEP
      const edge = d === 0 ? g.hOcc[cell] : d === 2 ? g.hOcc[nb] : d === 1 ? g.vOcc[cell] : g.vOcc[nb]
      if (edge === net) cost = SHARE
      else if (edge !== 0) cost += CLASH
      const po = g.pOcc[nb]
      if (po !== 0 && po !== net && nb !== t) cost += CLASH
      if (d === 0 || d === 2) {
        const v1 = g.vOcc[nb]
        const v2 = nb >= w ? g.vOcc[nb - w] : 0
        if ((v1 !== 0 && v1 !== net) || (v2 !== 0 && v2 !== net)) cost += CROSS
      } else {
        const h1 = g.hOcc[nb]
        const h2 = nb % w > 0 ? g.hOcc[nb - 1] : 0
        if ((h1 !== 0 && h1 !== net) || (h2 !== 0 && h2 !== net)) cost += CROSS
      }
      if (g.near[nb]) cost += NEAR_BODY
      if (g.label[nb]) cost += OVER_LABEL
      if (d !== d0) {
        cost += BEND
        if (cell !== s && g.foreignAt(cell, net)) cost += CLASH
      }
      const ns = nb * 4 + d
      const ng = gs[st] + cost
      if (ng < gs[ns]) {
        gs[ns] = ng
        came[ns] = st
        heap.push(ng + heur(nb), ns)
      }
    }
  }
  if (goal < 0) return null
  const cells: Point[] = []
  for (let st = goal; st >= 0; st = came[st]) cells.push(g.point(st >> 2))
  cells.reverse()
  return normalize(cells)
}

/** Number of right-angle crossings between `path` and wires of other nets. */
function crossings(path: Point[], net: number, others: { path: Point[]; net: number }[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const h = a.y === b.y
    for (const o of others) {
      if (o.net === net) continue
      for (let j = 1; j < o.path.length; j++) {
        const c = o.path[j - 1]
        const d = o.path[j]
        if ((c.y === d.y) === h) continue
        // One horizontal, one vertical: do they cross strictly inside both?
        const [hs, vs] = h ? [[a, b], [c, d]] : [[c, d], [a, b]]
        const y = hs[0].y
        const x = vs[0].x
        if (
          x > Math.min(hs[0].x, hs[1].x) &&
          x < Math.max(hs[0].x, hs[1].x) &&
          y > Math.min(vs[0].y, vs[1].y) &&
          y < Math.max(vs[0].y, vs[1].y)
        )
          n++
      }
    }
  }
  return n
}

/**
 * Route the given wires, avoiding components and every other wire's current path.
 * Wires of one net are routed together (so fan-outs share a trunk), shortest first; each finished wire
 * becomes an obstacle for the next. Then wires that cross others are ripped up and re-routed with
 * everything else fixed, which untangles bundles whose first routing order was unlucky. `improve` is `false` to skip
 * that, a number to cap its passes, or `true` for up to three.
 */
export function routeWires(c: Circuit, ids: string[], improve: boolean | number = true): Record<string, Point[]> {
  const ends = new Map<string, Endpoints>()
  for (const id of ids) {
    const w = c.wires[id]
    const e = w && wireEndpoints(c, w)
    if (e) ends.set(id, e)
  }
  const base = buildGrid(c, [...ends.values()].flatMap((e) => [e.from, e.to]))

  const netIds = new Map<string, number>()
  const netOf = (w: Wire) => {
    const k = netKey(w.from)
    let n = netIds.get(k)
    if (!n) netIds.set(k, (n = netIds.size + 1))
    return n
  }
  // Current path of every wire; the ones being routed start empty.
  const paths = new Map<string, Point[]>()
  for (const w of Object.values(c.wires)) paths.set(w.id, ends.has(w.id) ? [] : w.path)

  // Input tips fed by each net: a wire of that net may pass through them.
  const fedTips = new Map<number, Set<number>>()
  for (const w of Object.values(c.wires)) {
    const tc = c.comps[w.to.comp]
    const tp = tc && findPin(tc, w.to.pin)
    if (!tp) continue
    const n = netOf(w)
    if (!fedTips.has(n)) fedTips.set(n, new Set())
    fedTips.get(n)!.add(base.idx(tp.pos))
  }

  const gridWithout = (skip?: string) => {
    const g = base.fresh()
    for (const [id, p] of paths) if (id !== skip && p.length) g.addPath(p, netOf(c.wires[id]))
    return g
  }

  const order = [...ends.keys()].sort((ia, ib) => {
    const na = netKey(c.wires[ia].from)
    const nb = netKey(c.wires[ib].from)
    if (na !== nb) return na < nb ? -1 : 1
    const a = ends.get(ia)!
    const b = ends.get(ib)!
    return Math.abs(a.to.x - a.from.x) + Math.abs(a.to.y - a.from.y) - (Math.abs(b.to.x - b.from.x) + Math.abs(b.to.y - b.from.y))
  })

  const g = gridWithout()
  for (const id of order) {
    const net = netOf(c.wires[id])
    const e = ends.get(id)!
    const touching = e.from.x === e.to.x && e.from.y === e.to.y
    const path = touching ? [{ ...e.from }, { ...e.to }] : (search(g, e, net, fedTips.get(net)) ?? fallbackPath(e))
    paths.set(id, path)
    g.addPath(path, net)
  }

  if (improve) {
    const all = () => [...paths].map(([id, path]) => ({ id, path, net: netOf(c.wires[id]) }))
    for (let pass = 0; pass < (improve === true ? 3 : improve); pass++) {
      let better = false
      for (const id of order) {
        const net = netOf(c.wires[id])
        const others = all().filter((o) => o.id !== id)
        const before = crossings(paths.get(id)!, net, others)
        if (!before) continue
        const p = search(gridWithout(id), ends.get(id)!, net, fedTips.get(net))
        if (p && crossings(p, net, others) < before) {
          paths.set(id, p)
          better = true
        }
      }
      if (!better) break
    }
  }

  const out: Record<string, Point[]> = {}
  for (const id of order) out[id] = paths.get(id)!
  return out
}
