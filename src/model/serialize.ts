import LZString from 'lz-string'
import { getDef, hasDef } from '../engine/registry'
import { MAX_DELAY } from '../engine/simulator'
import { paramDefaults, type ParamDef, type ParamValue, type Params } from '../engine/types'
import { validPath } from '../routing/path'
import { wireEndpoints } from '../routing/router'
import { emptyCircuit, type Circuit, type Point, type Rot } from './circuit'
import { pruneWires, reroute } from './ops'

interface SavedComp {
  id: string
  type: string
  x: number
  y: number
  rot?: number
  flip?: boolean
  params?: Params
  label?: string
  delay?: number
}
interface SavedWire {
  id: string
  from: string
  to: string
  path?: [number, number][]
  manual?: boolean
}
export interface SavedCircuit {
  app: 'sklopko'
  version: 1
  comps: SavedComp[]
  wires: SavedWire[]
}

export function serialize(c: Circuit): SavedCircuit {
  return {
    app: 'sklopko',
    version: 1,
    comps: Object.values(c.comps).map((k) => ({
      id: k.id,
      type: k.type,
      x: k.x,
      y: k.y,
      ...(k.rot ? { rot: k.rot } : {}),
      ...(k.flip ? { flip: true } : {}),
      params: k.params,
      ...(k.label ? { label: k.label } : {}),
      ...(k.delay && k.delay > 1 ? { delay: k.delay } : {}),
    })),
    wires: Object.values(c.wires).map((w) => ({
      id: w.id,
      from: `${w.from.comp}.${w.from.pin}`,
      to: `${w.to.comp}.${w.to.pin}`,
      path: w.path.map((p) => [p.x, p.y] as [number, number]),
      ...(w.manual ? { manual: true } : {}),
    })),
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Does a saved value fit the parameter (type, allowed option, range, text pattern and length)? */
function validParam(p: ParamDef, v: unknown): v is ParamValue {
  if (typeof v !== typeof p.default) return false
  if (p.kind === 'select') return !!p.options?.some((o) => o.value === v)
  if (p.kind === 'number') return isNum(v) && (p.min === undefined || v >= p.min) && (p.max === undefined || v <= p.max)
  if (p.kind === 'text')
    return typeof v === 'string' && v.length <= (p.maxLength ?? 1000) && (!p.pattern || new RegExp(`^(?:${p.pattern})$`).test(v))
  return true
}

/** Parse and validate saved data. Unknown parts and broken wires are dropped; missing routes are recomputed. */
export function deserialize(data: unknown): Circuit {
  const d = data as Partial<SavedCircuit>
  if (!d || d.app !== 'sklopko' || !Array.isArray(d.comps) || !Array.isArray(d.wires)) {
    throw new Error('Not a Sklopko circuit file')
  }
  const c = emptyCircuit()
  for (const s of d.comps) {
    if (!s || typeof s.id !== 'string' || !hasDef(s.type) || !isNum(s.x) || !isNum(s.y)) continue
    const def = getDef(s.type)
    const params = { ...paramDefaults(def) }
    for (const p of def.params ?? []) {
      const v = s.params?.[p.key]
      if (validParam(p, v)) params[p.key] = v
    }
    c.comps[s.id] = {
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      rot: (((s.rot ?? 0) % 4) + 4) % 4 as Rot,
      flip: !!s.flip,
      params,
      ...(typeof s.label === 'string' && s.label ? { label: s.label.slice(0, 40) } : {}),
      ...(Number.isInteger(s.delay) && s.delay! > 1 ? { delay: Math.min(MAX_DELAY, s.delay!) } : {}),
    }
  }
  const taken = new Set<string>()
  const todo: string[] = []
  for (const s of d.wires) {
    if (!s || typeof s.id !== 'string' || typeof s.from !== 'string' || typeof s.to !== 'string') continue
    const [fc, fp] = s.from.split('.')
    const [tc, tp] = s.to.split('.')
    if (taken.has(s.to)) continue // an input takes one wire
    taken.add(s.to)
    const path: Point[] = Array.isArray(s.path)
      ? s.path.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).map(([x, y]) => ({ x, y }))
      : []
    c.wires[s.id] = { id: s.id, from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp }, path, ...(s.manual ? { manual: true } : {}) }
  }
  pruneWires(c)
  for (const w of Object.values(c.wires)) {
    const e = wireEndpoints(c, w)
    if (!e || !validPath(w.path, e.from, e.fromDir, e.to, e.toDir)) {
      w.path = []
      delete w.manual
      todo.push(w.id)
    }
  }
  reroute(c, todo)
  return c
}

export const toJSON = (c: Circuit) => JSON.stringify(serialize(c))

export function toShareHash(c: Circuit) {
  return 'c=' + LZString.compressToEncodedURIComponent(toJSON(c))
}

export function fromShareHash(hash: string): Circuit | null {
  const m = /(?:^#?|&)c=([^&]+)/.exec(hash)
  if (!m) return null
  const json = LZString.decompressFromEncodedURIComponent(m[1])
  if (!json) return null
  return deserialize(JSON.parse(json))
}
