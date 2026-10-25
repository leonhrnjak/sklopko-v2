import LZString from 'lz-string'
import { currentIsaId } from '../engine/isalist'
import { getDef, hasDef } from '../engine/registry'
import { MAX_DELAY } from '../engine/simulator'
import { legacyDefaults, type ParamDef, type ParamValue, type Params } from '../engine/types'
import { emptyCircuit, type Circuit, type ICDef, type Point, type Rot } from './circuit'
import { documentOf, findCycle, settleCircuit } from './ic'

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
interface SavedBody {
  comps: SavedComp[]
  wires: SavedWire[]
}
interface SavedIC extends SavedBody {
  id: string
  name: string
}
export interface SavedCircuit extends SavedBody {
  app: 'sklopko'
  /** 1: before custom ICs. 2: adds `ics`. 3: adds `tests`. 4: adds `history`. */
  version: number
  /** The custom ICs of the document (version 2). */
  ics?: SavedIC[]
  /** The testbench text (version 3). */
  tests?: string
  /** Written, as `false`, only when the document runs without the history for stepping back (version 4). */
  history?: false
}

/** The version `serialize` writes. */
export const FORMAT_VERSION = 4

const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // 1 → 2: custom ICs came in; an older file has none.
  1: (d) => ({ ...d, version: 2, ics: Array.isArray(d.ics) ? d.ics : [] }),
  // 2 → 3: the testbench came in; an older file has none.
  2: (d) => ({ ...d, version: 3 }),
  // 3 → 4: the history setting came in; an older file runs with it on.
  3: (d) => ({ ...d, version: 4 }),
}

/** The longest testbench text a file may hold. */
export const MAX_TESTS = 4000

/** Bring saved data from an older version up to the current one, one step at a time. Anything else is returned as it is. */
export function migrate(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  let d = data as Record<string, unknown>
  let v = typeof d.version === 'number' ? d.version : 1
  while (v < FORMAT_VERSION && MIGRATIONS[v]) {
    d = MIGRATIONS[v](d)
    v = d.version as number
  }
  return d
}

function serializeBody(c: Circuit): SavedBody {
  return {
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

export function serialize(circuit: Circuit): SavedCircuit {
  // While the body of an IC is being edited, what is saved is the whole document.
  const c = documentOf(circuit)
  const ics = Object.values(c.ics ?? {})
  return {
    app: 'sklopko',
    version: FORMAT_VERSION,
    ...serializeBody(c),
    ...(ics.length ? { ics: ics.map((def) => ({ id: def.id, name: def.name, ...serializeBody(def.circuit) })) } : {}),
    ...(c.tests ? { tests: c.tests } : {}),
    ...(c.history === false ? { history: false as const } : {}),
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

/** The parts and wires of saved data, checked one by one. Nothing is pruned or routed yet: see `finish`. */
function readBody(d: Partial<SavedBody>): Circuit {
  const c = emptyCircuit()
  for (const s of d.comps ?? []) {
    if (!s || typeof s.id !== 'string' || !hasDef(s.type) || !isNum(s.x) || !isNum(s.y)) continue
    const def = getDef(s.type)
    // A param the file lacks means what it meant before the param existed (`legacy`), not what a part placed now gets.
    const params = { ...legacyDefaults(def) }
    for (const p of def.params ?? []) {
      let v = s.params?.[p.key]
      // The instruction sets that SKASM replaced (sk8, sk82) are SKASM now.
      if (s.type === 'rom' && p.key === 'isa' && typeof v === 'string') v = currentIsaId(v)
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
  for (const s of d.wires ?? []) {
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
  return c
}

/**
 * Parse and validate saved data. Unknown parts and broken wires are dropped; missing routes are recomputed. Files of an older
 * version are brought up to date first (`migrate`). Throws when the data is not a circuit, or when a custom IC in it contains
 * itself.
 */
export function deserialize(data: unknown): Circuit {
  const d = migrate(data) as Partial<SavedCircuit>
  if (!d || d.app !== 'sklopko' || !Array.isArray(d.comps) || !Array.isArray(d.wires)) {
    throw new Error('Not a Sklopko circuit file')
  }
  const c = readBody(d)
  const ics: Record<string, ICDef> = {}
  for (const s of Array.isArray(d.ics) ? d.ics : []) {
    if (!s || typeof s.id !== 'string' || !s.id || ics[s.id] || !Array.isArray(s.comps) || !Array.isArray(s.wires)) continue
    ics[s.id] = { id: s.id, name: typeof s.name === 'string' && s.name ? s.name.slice(0, 40) : 'IC', circuit: readBody(s) }
  }
  if (findCycle(ics)) throw new Error('A custom IC in this file contains itself.')
  if (Object.keys(ics).length) c.ics = ics
  if (typeof d.tests === 'string' && d.tests.trim()) c.tests = d.tests.slice(0, MAX_TESTS)
  if (d.history === false) c.history = false
  for (const circuit of [c, ...Object.values(ics).map((def) => def.circuit)]) settleCircuit(circuit, ics)
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
