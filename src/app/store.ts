import { produce } from 'immer'
import { create } from 'zustand'
import { pinWidth } from '../engine/bus'
import { naturalOrder } from '../engine/groups'
import { getDef } from '../engine/registry'
import { MAX_DELAY } from '../engine/simulator'
import type { ParamValue, Params } from '../engine/types'
import {
  boundsRect,
  emptyCircuit,
  findPin,
  isAnnotation,
  isFrame,
  newId,
  rectsIntersect,
  snap,
  type Circuit,
  type Comp,
  type ICDef,
  type PinRef,
  type Point,
  type Rect,
  type Rot,
  type Wire,
} from '../model/circuit'
import { circuitRect } from '../model/bounds'
import { hasDelay, realisticDelay } from '../model/delays'
import { isInside } from '../model/frames'
import { placedICs, placementOf } from '../model/ic'
import { autoConnect, pruneWires, reroute, rerouteAround, updateWiresAfterMove } from '../model/ops'
import { normalize } from '../routing/path'
import { isEmbed } from './embed'
import { sim } from './sim'

export interface View {
  /** Screen offset of world origin, in CSS px. */
  x: number
  y: number
  zoom: number
}

interface State {
  circuit: Circuit
  /** Bumped whenever the simulator must recompile (parts, wires or behavioral params changed). */
  structVersion: number
  selection: string[]
  past: Circuit[]
  future: Circuit[]
  running: boolean
  /** Simulated time per real time (scales clock speeds). */
  speed: number
  view: View
  /** Part chosen in the palette and waiting to be dropped on the canvas. */
  placing: string | null
  toast: string | null
  /** A button in the toast (Undo for something deleted). */
  toastAction: { label: string; run: () => void } | null
  /** On small screens the inspector is a bottom sheet that the user opens explicitly. */
  sheetOpen: boolean
}

export const useStore = create<State>(() => ({
  circuit: emptyCircuit(),
  structVersion: 0,
  selection: [],
  past: [],
  future: [],
  running: true,
  speed: 1,
  view: { x: 40, y: 40, zoom: 1 },
  placing: null,
  toast: null,
  toastAction: null,
  sheetOpen: false,
}))

const get = useStore.getState
const set = useStore.setState
const HISTORY = 200

/** Save the current circuit on the undo stack. Call once before each user action. */
export function checkpoint() {
  if (isEmbed()) return
  const { circuit, past } = get()
  set({ past: [...past.slice(-HISTORY + 1), circuit], future: [] })
}

/**
 * Apply a change to the circuit. `structural` triggers a simulator recompile; so does `fn` returning true
 * (for changes that only sometimes alter the netlist, like auto-connecting touching pins).
 */
export function edit(fn: (c: Circuit) => boolean | void, structural = true, operating = false) {
  // Embedded circuits can't be edited. Operating a control (flipping a switch) is not editing.
  if (isEmbed() && !operating) return
  const s = get()
  let changedNets = false
  const circuit = produce(s.circuit, (d) => {
    changedNets = fn(d) === true
  })
  set({ circuit, structVersion: s.structVersion + (structural || changedNets ? 1 : 0) })
}

export function undo() {
  if (isEmbed()) return
  const { past, future, circuit, structVersion } = get()
  if (!past.length) return
  set({
    circuit: past[past.length - 1],
    past: past.slice(0, -1),
    future: [circuit, ...future],
    structVersion: structVersion + 1,
    selection: [],
  })
}

export function redo() {
  if (isEmbed()) return
  const { past, future, circuit, structVersion } = get()
  if (!future.length) return
  set({
    circuit: future[0],
    past: [...past, circuit],
    future: future.slice(1),
    structVersion: structVersion + 1,
    selection: [],
  })
}

export function showToast(msg: string, action?: { label: string; run: () => void }) {
  set({ toast: msg, toastAction: action ?? null })
  window.setTimeout(() => {
    if (get().toast === msg) set({ toast: null, toastAction: null })
  }, action ? 7000 : 2600)
}

// ---- Selection ---------------------------------------------------------------------------------

export const select = (ids: string[]) => set({ selection: ids })
export const isComp = (id: string) => id in get().circuit.comps

export function selectInRect(r: Rect, add: boolean) {
  const c = get().circuit
  // A frame is selected only when the rectangle holds all of it, or dragging across a frame would always pick it up.
  const comps = Object.values(c.comps)
    .filter((k) => (isFrame(k) ? isInside(boundsRect(k), r) : rectsIntersect(boundsRect(k), r)))
    .map((k) => k.id)
  const inSet = new Set(comps)
  const wires = Object.values(c.wires)
    .filter((w) => inSet.has(w.from.comp) && inSet.has(w.to.comp))
    .map((w) => w.id)
  const ids = [...comps, ...wires]
  set({ selection: add ? [...new Set([...get().selection, ...ids])] : ids })
}

export const selectAll = () => {
  const c = get().circuit
  set({ selection: [...Object.keys(c.comps), ...Object.keys(c.wires)] })
}

// ---- Components --------------------------------------------------------------------------------

/** `type` is a part type, or `ic:<id>` for a custom IC of this circuit (see `placementOf`). */
export function addComp(type: string, x: number, y: number): string {
  const placement = placementOf(get().circuit, type)
  if (!placement) return ''
  checkpoint()
  const id = newId('c')
  edit((c) => {
    c.comps[id] = { id, type: placement.type, x: snap(x), y: snap(y), rot: 0, flip: false, params: placement.params }
    // Wires the new part was dropped onto get out of its way.
    rerouteAround(c, [id])
    autoConnect(c, [id])
  })
  set({ selection: [id] })
  return id
}

/** Move components by a grid-snapped delta. Call checkpoint() once at the start of a drag. */
export function moveComps(ids: string[], d: Point, final: boolean) {
  if (!ids.length) return
  const moved = new Set(ids)
  edit((c) => {
    if (d.x || d.y)
      for (const id of ids) {
        const k = c.comps[id]
        if (!k) continue
        k.x += d.x
        k.y += d.y
      }
    updateWiresAfterMove(c, moved, d, final)
    if (final) return autoConnect(c, ids)
  }, false)
}

export function deleteSelection() {
  const sel = get().selection
  if (!sel.length) return
  checkpoint()
  edit((c) => {
    for (const id of sel) {
      delete c.comps[id]
      delete c.wires[id]
    }
    pruneWires(c)
  })
  set({ selection: [] })
}

function transformSelection(fn: (k: Comp) => void) {
  // Notes and frames stay upright.
  const ids = get().selection.filter(isComp).filter((id) => !isAnnotation(get().circuit.comps[id]))
  if (!ids.length) return
  checkpoint()
  edit((c) => {
    for (const id of ids) fn(c.comps[id])
    rerouteAround(c, ids)
    return autoConnect(c, ids)
  }, false)
}

export const rotateSelection = () => transformSelection((k) => (k.rot = ((k.rot + 1) % 4) as Rot))
export const flipSelection = () => transformSelection((k) => (k.flip = !k.flip))

export function setParam(id: string, key: string, value: ParamValue) {
  const k = get().circuit.comps[id]
  if (!k) return
  const def = getDef(k.type)
  const pd = def.params?.find((p) => p.key === key)
  checkpoint()
  edit((c) => {
    c.comps[id].params[key] = value
    if (pd?.structural) {
      pruneWires(c)
      rerouteAround(c, [id])
    }
  })
}

/** Set the propagation delay (in gate delays) of some parts, as a single undo step. 1 is the default and is not stored. */
export function setDelay(ids: string[], delay: number) {
  const d = Math.min(MAX_DELAY, Math.max(1, Math.round(delay)))
  const targets = ids.filter((id) => get().circuit.comps[id] && hasDelay(get().circuit.comps[id]))
  if (!targets.length) return
  checkpoint()
  edit((c) => {
    for (const id of targets) {
      if (d > 1) c.comps[id].delay = d
      else delete c.comps[id].delay
    }
  })
}

/** Give parts the delays of real chips (see `realisticDelay`), or, with `back`, put them all back to 1. One undo step. */
export function applyRealisticDelays(ids: string[], back = false) {
  const targets = ids.filter((id) => get().circuit.comps[id] && hasDelay(get().circuit.comps[id]))
  if (!targets.length) return
  checkpoint()
  edit((c) => {
    for (const id of targets) {
      const d = back ? 1 : realisticDelay(c.comps[id])
      if (d > 1) c.comps[id].delay = d
      else delete c.comps[id].delay
    }
  })
}

/** Change several parameters of one part in a single undo step. */
export function setParams(id: string, patch: Params) {
  const k = get().circuit.comps[id]
  if (!k) return
  const def = getDef(k.type)
  const structural = Object.keys(patch).some((key) => def.params?.find((p) => p.key === key)?.structural)
  checkpoint()
  edit((c) => {
    Object.assign(c.comps[id].params, patch)
    if (structural) {
      pruneWires(c)
      rerouteAround(c, [id])
    }
  })
}

/**
 * Put probes into one group, as a single undo step. Bit positions follow the natural order of their labels (ACC0 is
 * bit 0, the least significant); probes without labels go top to bottom, then left to right.
 */
export function groupProbes(ids: string[], name: string) {
  const c = get().circuit
  const probes = ids.map((id) => c.comps[id]).filter((k) => k?.type === 'probe' && !(Number(k.params.bits) > 1))
  if (!probes.length || probes.length > 16) return
  const ordered = [...probes].sort((a, b) => naturalOrder(a.label ?? '', b.label ?? '') || a.y - b.y || a.x - b.x)
  checkpoint()
  edit((d) => {
    ordered.forEach((p, i) => {
      d.comps[p.id].params.group = name
      d.comps[p.id].params.bit = i
    })
  })
}

/** Take probes out of their groups: each is drawn as a trace of its own again. */
export function ungroupProbes(ids: string[]) {
  checkpoint()
  edit((d) => {
    for (const id of ids) if (d.comps[id]?.type === 'probe') d.comps[id].params.group = ''
  })
}

export function setLabel(id: string, label: string) {
  checkpoint()
  edit((c) => {
    if (label) c.comps[id].label = label
    else delete c.comps[id].label
  }, false)
}

/** Change a frame's size while it is being dragged by its corner. Call checkpoint() once before the first change. */
export function resizeFrame(id: string, w: number, h: number) {
  edit((c) => {
    const k = c.comps[id]
    if (!k || !isFrame(k)) return
    k.params.w = Math.min(4000, Math.max(60, w))
    k.params.h = Math.min(4000, Math.max(40, h))
  }, false)
}

/** Overwrite one word of a RAM in the running simulation (the memory editor). Not an undoable circuit change. */
export function pokeWord(id: string, index: number, value: number) {
  if (!sim.writeWord(id, index, value)) return
  sim.settle()
  sim.publish()
}

/** Click on a switch / 4-bit input: change its value without an undo step, straight into the simulator. */
export function interact(id: string, alt: boolean) {
  const k = get().circuit.comps[id]
  if (!k) return
  const def = getDef(k.type)
  let params = k.params
  if (def.interactive === 'toggle') params = { ...params, on: !params.on }
  else if (def.interactive === 'cycle') params = def.cycle ? def.cycle(params, alt) : { ...params, value: (Number(params.value) + (alt ? 15 : 1)) % 16 }
  else return
  edit((c) => {
    c.comps[id].params = params
  }, false, true)
  sim.setParams(id, get().circuit.comps[id].params)
}

// ---- Wires -------------------------------------------------------------------------------------

/** Connect two pins (in either order). Replaces whatever was connected to the input. */
export function connect(a: PinRef, b: PinRef, replacing?: string): boolean {
  const c = get().circuit
  const pa = c.comps[a.comp] && findPin(c.comps[a.comp], a.pin)
  const pb = c.comps[b.comp] && findPin(c.comps[b.comp], b.pin)
  if (!pa || !pb || pa.def.dir === pb.def.dir) return false
  const [from, to] = pa.def.dir === 'out' ? [a, b] : [b, a]
  const [fw, tw] = (pa.def.dir === 'out' ? [pa, pb] : [pb, pa]).map((p) => pinWidth(p.def))
  if (fw !== tw) {
    const what = (n: number) => (n === 1 ? 'a single wire' : `a ${n}-bit bus`)
    showToast(`Can't connect ${what(fw)} to ${tw === 1 ? 'a single-bit pin' : `a ${tw}-bit pin`}: use a ${fw > tw ? 'splitter' : 'merger'} to change the width.`)
    return false
  }
  checkpoint()
  const id = newId('w')
  edit((d) => {
    if (replacing) delete d.wires[replacing]
    for (const w of Object.values(d.wires)) if (w.to.comp === to.comp && w.to.pin === to.pin) delete d.wires[w.id]
    d.wires[id] = { id, from, to, path: [] }
    reroute(d, [id])
  })
  set({ selection: [id] })
  return true
}

export function deleteWire(id: string) {
  checkpoint()
  edit((c) => {
    delete c.wires[id]
  })
}

/** Store a hand-edited path. Call checkpoint() at drag start. */
export function setWirePath(id: string, path: Wire['path'], final: boolean) {
  edit((c) => {
    const w = c.wires[id]
    if (!w) return
    w.path = final ? normalize(path) : path
    w.manual = true
  }, false)
}

export function resetWireRoute(id: string) {
  checkpoint()
  edit((c) => reroute(c, [id]), false)
}

export function rerouteAll() {
  checkpoint()
  edit((c) => reroute(c, Object.keys(c.wires)), false)
}

export function clearWires() {
  checkpoint()
  edit((c) => {
    c.wires = {}
  })
  set({ selection: [] })
}

export function clearAll() {
  checkpoint()
  edit((c) => {
    c.comps = {}
    c.wires = {}
  })
  set({ selection: [] })
}

/** Replace the whole circuit (load file, example, share link). */
export function loadCircuit(c: Circuit, undoable = true) {
  if (undoable) checkpoint()
  set({ circuit: c, structVersion: get().structVersion + 1, selection: [] })
  sim.reset()
}

/** Show another document: its circuit, with no undo history from the one before (that one is safe in the library). */
export function replaceCircuit(c: Circuit) {
  set({ circuit: c, past: [], future: [], structVersion: get().structVersion + 1, selection: [] })
  sim.reset()
}

// ---- Clipboard ---------------------------------------------------------------------------------

let clipboard: { comps: Comp[]; wires: Wire[]; ics: Record<string, ICDef> } | null = null
let pasteCount = 0

export function copySelection() {
  const { circuit, selection } = get()
  const ids = new Set(selection.filter((id) => id in circuit.comps))
  if (!ids.size) return false
  const comps = [...ids].map((id) => circuit.comps[id])
  // Custom ICs the copied parts place (and those they place in turn), so they can be pasted into another circuit.
  const ics: Record<string, ICDef> = {}
  const need = (list: Comp[]) => {
    for (const id of placedICs({ comps: Object.fromEntries(list.map((k) => [k.id, k])), wires: {} })) {
      const def = circuit.ics?.[id]
      if (def && !ics[id]) {
        ics[id] = def
        need(Object.values(def.circuit.comps))
      }
    }
  }
  need(comps)
  clipboard = {
    comps,
    wires: Object.values(circuit.wires).filter((w) => ids.has(w.from.comp) && ids.has(w.to.comp)),
    ics,
  }
  pasteCount = 0
  return true
}

export function paste() {
  if (!clipboard) return
  pasteCount++
  const off = 40 * pasteCount
  const map = new Map<string, string>()
  checkpoint()
  const newIds: string[] = []
  edit((c) => {
    // ICs the circuit does not have yet come with the parts; one it has under the same id stays as it is.
    for (const [defId, def] of Object.entries(clipboard!.ics)) if (!c.ics?.[defId]) (c.ics ??= {})[defId] = structuredClone(def)
    for (const k of clipboard!.comps) {
      const id = newId('c')
      map.set(k.id, id)
      newIds.push(id)
      c.comps[id] = { ...structuredClone(k), id, x: k.x + off, y: k.y + off }
    }
    for (const w of clipboard!.wires) {
      const id = newId('w')
      newIds.push(id)
      c.wires[id] = {
        ...w,
        id,
        from: { comp: map.get(w.from.comp)!, pin: w.from.pin },
        to: { comp: map.get(w.to.comp)!, pin: w.to.pin },
        path: w.path.map((p) => ({ x: p.x + off, y: p.y + off })),
      }
    }
    autoConnect(c, [...map.values()])
  })
  set({ selection: newIds })
}

/**
 * Add a built circuit (parts and wires) to the canvas as one undo step: below what is already there, lined up with its
 * left edge, or at the top left of an empty canvas. The new parts are selected. Returns their ids.
 */
export function insertCircuit(sub: Circuit): string[] {
  const cur = get().circuit
  const occupied = Object.keys(cur.comps).length > 0
  const mine = circuitRect(sub, 0)
  const there = occupied ? circuitRect(cur, 0) : { x: 40, y: 40 - 60, w: 0, h: 0 }
  const dx = snap(there.x - mine.x)
  const dy = snap(there.y + there.h + 60 - mine.y)
  const ids: string[] = []
  checkpoint()
  edit((c) => {
    const map = new Map<string, string>()
    for (const k of Object.values(sub.comps)) {
      const id = newId('c')
      map.set(k.id, id)
      ids.push(id)
      c.comps[id] = { ...structuredClone(k), id, x: k.x + dx, y: k.y + dy }
    }
    for (const w of Object.values(sub.wires)) {
      const id = newId('w')
      ids.push(id)
      c.wires[id] = {
        ...structuredClone(w),
        id,
        from: { comp: map.get(w.from.comp)!, pin: w.from.pin },
        to: { comp: map.get(w.to.comp)!, pin: w.to.pin },
        path: w.path.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      }
    }
  })
  if (get().circuit !== cur) set({ selection: ids })
  return ids
}

export function duplicateSelection() {
  if (copySelection()) paste()
}

export const setRunning = (running: boolean) => set({ running })
export const setSpeed = (speed: number) => set({ speed })
export const setView = (view: View) => set({ view })
export const setPlacing = (placing: string | null) => set({ placing })
export const setSheetOpen = (sheetOpen: boolean) => set({ sheetOpen })
