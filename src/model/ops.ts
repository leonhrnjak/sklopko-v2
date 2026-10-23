import { routeWires, wireEndpoints } from '../routing/router'
import { adjustEnds } from '../routing/path'
import { pinWidth } from '../engine/bus'
import { bodyRect, findPin, isAnnotation, newId, worldPins, type Circuit, type PinRef, type Point, type Rect, type Wire } from './circuit'

/** True if any segment of the path passes through the interior of the rectangle. */
export function pathHitsRect(path: Point[], r: Rect): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const y2 = Math.max(a.y, b.y)
    if (x2 > r.x && x1 < r.x + r.w && y2 > r.y && y1 < r.y + r.h) return true
  }
  return false
}

/** Wires touching any of the given components. */
export function attachedWires(c: Circuit, ids: Set<string>): Wire[] {
  return Object.values(c.wires).filter((w) => ids.has(w.from.comp) || ids.has(w.to.comp))
}

/** Re-route wires in place (mutates; use inside an immer producer). */
export function reroute(c: Circuit, ids: string[], improve = true) {
  if (!ids.length) return
  const paths = routeWires(c, ids, improve)
  for (const [id, p] of Object.entries(paths)) {
    c.wires[id].path = p
    delete c.wires[id].manual
  }
}

/**
 * Update wires after components moved by `d` (positions already updated).
 * Wires moving with both ends are translated, hand-shaped wires stretch, the rest are re-routed.
 * When `final`, auto-routed wires that now pass through a moved component are re-routed too.
 */
export function updateWiresAfterMove(c: Circuit, moved: Set<string>, d: Point, final: boolean) {
  const todo: string[] = []
  for (const w of attachedWires(c, moved)) {
    const both = moved.has(w.from.comp) && moved.has(w.to.comp)
    if (both) {
      w.path = w.path.map((p) => ({ x: p.x + d.x, y: p.y + d.y }))
      continue
    }
    if (w.manual) {
      const e = wireEndpoints(c, w)
      const adjusted = e && adjustEnds(w.path, e.from, e.fromDir, e.to, e.toDir)
      if (adjusted) {
        w.path = adjusted
        continue
      }
    }
    todo.push(w.id)
  }
  if (final) {
    const rects = [...moved].map((id) => c.comps[id]).filter((k) => k && !isAnnotation(k)).map(bodyRect)
    for (const w of Object.values(c.wires)) {
      if (todo.includes(w.id) || moved.has(w.from.comp) || moved.has(w.to.comp)) continue
      if (rects.some((r) => pathHitsRect(w.path, r))) todo.push(w.id)
    }
  }
  // While dragging, skip the crossing clean-up pass to keep it snappy.
  reroute(c, todo, final)
}

/** After components changed shape or orientation: re-route their wires and any wire now running through them. */
export function rerouteAround(c: Circuit, ids: string[]) {
  const set = new Set(ids)
  const rects = ids.map((id) => c.comps[id]).filter((k) => k && !isAnnotation(k)).map(bodyRect)
  const todo = Object.values(c.wires)
    .filter(
      (w) => set.has(w.from.comp) || set.has(w.to.comp) || rects.some((r) => pathHitsRect(w.path, r)),
    )
    .map((w) => w.id)
  reroute(c, todo)
}

/** Drop wires whose pins no longer exist, or no longer have the same width (after a param change or deletion). */
export function pruneWires(c: Circuit) {
  for (const w of Object.values(c.wires)) {
    const fc = c.comps[w.from.comp]
    const tc = c.comps[w.to.comp]
    const fp = fc && findPin(fc, w.from.pin)
    const tp = tc && findPin(tc, w.to.pin)
    if (!fp || !tp || fp.def.dir !== 'out' || tp.def.dir !== 'in' || pinWidth(fp.def) !== pinWidth(tp.def)) delete c.wires[w.id]
  }
}

/**
 * Connect pins of the given components that sit exactly on another part's pin of the opposite direction
 * (an output tip touching an input tip). The wire starts with zero length; moving a part away routes it
 * like any other wire. Inputs that already have a wire are left alone. Returns true if wires were added.
 */
export function autoConnect(c: Circuit, ids: string[]): boolean {
  const at = new Map<string, (PinRef & { dir: 'in' | 'out'; width: number })[]>()
  const key = (p: Point) => `${p.x},${p.y}`
  for (const k of Object.values(c.comps))
    for (const p of worldPins(k)) {
      const list = at.get(key(p.pos)) ?? []
      list.push({ comp: k.id, pin: p.def.name, dir: p.def.dir, width: pinWidth(p.def) })
      at.set(key(p.pos), list)
    }
  const fed = new Set(Object.values(c.wires).map((w) => `${w.to.comp}:${w.to.pin}`))
  let added = false
  for (const id of ids) {
    const k = c.comps[id]
    if (!k) continue
    for (const p of worldPins(k)) {
      for (const o of at.get(key(p.pos)) ?? []) {
        if (o.comp === id || o.dir === p.def.dir || o.width !== pinWidth(p.def)) continue
        const mine = { comp: id, pin: p.def.name }
        const other = { comp: o.comp, pin: o.pin }
        const [from, to] = p.def.dir === 'out' ? [mine, other] : [other, mine]
        if (fed.has(`${to.comp}:${to.pin}`)) continue
        const wid = newId('w')
        c.wires[wid] = { id: wid, from, to, path: [{ ...p.pos }, { ...p.pos }] }
        fed.add(`${to.comp}:${to.pin}`)
        added = true
      }
    }
  }
  return added
}
