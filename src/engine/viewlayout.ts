import { groupsOf, isBusLabel } from './bus'
import { getDef, hasDef } from './registry'
import { layoutOf } from './simulator'
import type { Layout, Params, PinDef, PinGroup, Side } from './types'

/** Is this part never simulated: a splitter, a merger, or a label that carries a bus? */
export function isWiringPart(type: string, params: Params): boolean {
  return hasDef(type) && (!!getDef(type).wiring || isBusLabel(type, params))
}

const PITCH = 20

const viewCache = new Map<string, Layout>()

/**
 * The layout the user sees: the scalar layout with every group collapsed into one bus pin, and each side packed again
 * with the spacing `box` uses, so the body gets shorter when a side has fewer pins. Parts without bus mode are unchanged.
 */
export function viewLayoutOf(type: string, params: Params): Layout {
  const def = getDef(type)
  if (!def.groups) return layoutOf(type, params)
  const key = type + JSON.stringify(params)
  let v = viewCache.get(key)
  if (!v) {
    if (viewCache.size > 500) viewCache.clear()
    v = collapse(layoutOf(type, params), groupsOf(def, params))
    viewCache.set(key, v)
  }
  return v
}

function collapse(l: Layout, groups: PinGroup[]): Layout {
  if (!groups.length) return l
  const groupOf = new Map<string, PinGroup>()
  for (const g of groups) for (const n of g.pins) groupOf.set(n, g)
  const sides: Record<Side, PinDef[]> = { l: [], t: [], b: [], r: [] }
  const emitted = new Set<PinGroup>()
  const horizontal = (s: Side) => s === 't' || s === 'b'
  for (const side of ['l', 't', 'b', 'r'] as Side[]) {
    const here = l.pins.filter((p) => p.side === side).sort((a, b) => (horizontal(side) ? a.x - b.x : a.y - b.y))
    for (const p of here) {
      const g = groupOf.get(p.name)
      if (!g) sides[side].push(p)
      else if (!emitted.has(g)) {
        emitted.add(g)
        sides[side].push({ name: g.name, label: g.name, dir: g.dir, side, x: p.x, y: p.y, bus: g.pins.length })
      }
    }
  }
  const rows = Math.max(sides.l.length, sides.r.length, 2)
  const h = Math.min(l.h, PITCH * (rows + 1))
  const pins: PinDef[] = []
  for (const side of ['l', 't', 'b', 'r'] as Side[]) {
    const list = sides[side]
    list.forEach((p, i) => {
      if (horizontal(side)) {
        const start = Math.round((l.w - PITCH * (list.length - 1)) / 2 / 10) * 10
        pins.push({ ...p, x: start + PITCH * i, y: side === 'b' ? p.y + (h - l.h) : p.y })
      } else {
        const r = Math.round(h / PITCH) - 1
        pins.push({ ...p, y: 10 * (r - list.length + 2) + PITCH * i })
      }
    })
  }
  return { w: l.w, h, pins }
}

