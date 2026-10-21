import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as RPointerEvent } from 'react'
import { getDef } from '../../engine/registry'
import { sim } from '../../app/sim'
import {
  addComp,
  checkpoint,
  connect,
  copySelection,
  deleteSelection,
  deleteWire,
  duplicateSelection,
  flipSelection,
  interact,
  moveComps,
  paste,
  redo,
  resetWireRoute,
  rotateSelection,
  select,
  selectAll,
  selectInRect,
  setPlacing,
  setView,
  setWirePath,
  undo,
  useStore,
} from '../../app/store'
import { layoutOf } from '../../engine/simulator'
import { paramDefaults } from '../../engine/types'
import {
  GRID,
  snap,
  worldPins,
  type Circuit,
  type Comp,
  type PinRef,
  type Point,
  type Rect,
} from '../../model/circuit'
import { applySegmentDrag, beginSegmentDrag, normalize, type SegmentDrag } from '../../routing/path'
import { routeWires } from '../../routing/router'
import { CompSymbol } from '../symbols'
import { ComponentView, GhostWire, Junctions, PinsView, WireView } from './views'
import { paletteDrag } from '../paletteDrag'
import { compTransform } from '../transform'
import { fitView, registerCanvas } from './viewport'

type Op =
  | { k: 'pan'; cx: number; cy: number; vx: number; vy: number }
  | { k: 'marquee'; start: Point; add: boolean }
  | {
      k: 'move'
      ids: string[]
      start: Point
      applied: Point
      moved: boolean
      clickId: string
      shift: boolean
      wasSelected: boolean
      pressed: boolean
      cx: number
      cy: number
    }
  | {
      k: 'wire'
      from: PinRef
      pos: Point
      dir: Point
      want: 'in' | 'out'
      replacing?: string
      cx: number
      cy: number
      moved: boolean
    }
  | { k: 'segment'; id: string; drag: SegmentDrag | null; seg: number; moved: boolean; cx: number; cy: number }

const DRAG_THRESHOLD = 4

function nearestPin(c: Circuit, at: Point, want: 'in' | 'out', exclude: PinRef, radius: number) {
  let best: { ref: PinRef; pos: Point } | null = null
  let bestD = radius
  for (const comp of Object.values(c.comps)) {
    for (const p of worldPins(comp)) {
      if (p.def.dir !== want) continue
      if (comp.id === exclude.comp && p.def.name === exclude.pin) continue
      const d = Math.hypot(p.pos.x - at.x, p.pos.y - at.y)
      if (d <= bestD) {
        bestD = d
        best = { ref: { comp: comp.id, pin: p.def.name }, pos: p.pos }
      }
    }
  }
  return best
}

/** Route preview of a wire being drawn: real routing when over a pin, an elbow otherwise. */
function previewPath(c: Circuit, op: Extract<Op, { k: 'wire' }>, cursor: Point, target: PinRef | null): Point[] {
  if (target) {
    const [from, to] = op.want === 'in' ? [op.from, target] : [target, op.from]
    const wires = { ...c.wires }
    if (op.replacing) delete wires[op.replacing]
    wires.__preview = { id: '__preview', from, to, path: [] }
    const r = routeWires({ comps: c.comps, wires }, ['__preview']).__preview
    if (r) return r
  }
  const s = { x: op.pos.x + op.dir.x * GRID, y: op.pos.y + op.dir.y * GRID }
  const end = { x: snap(cursor.x), y: snap(cursor.y) }
  return normalize(op.dir.x ? [op.pos, s, { x: end.x, y: s.y }, end] : [op.pos, s, { x: s.x, y: end.y }, end])
}

export function Canvas() {
  const ref = useRef<SVGSVGElement>(null)
  const circuit = useStore((s) => s.circuit)
  const selection = useStore((s) => s.selection)
  const view = useStore((s) => s.view)
  const placing = useStore((s) => s.placing)
  const op = useRef<Op | null>(null)
  const [wirePreview, setWirePreview] = useState<{ path: Point[]; target: Point | null; want: 'in' | 'out' } | null>(
    null,
  )
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [ghost, setGhost] = useState<Point | null>(null)
  const [hiddenWire, setHiddenWire] = useState<string | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const selSet = new Set(selection)

  useEffect(() => registerCanvas(ref.current), [])

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = ref.current!.getBoundingClientRect()
    const v = useStore.getState().view
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }
  }

  const ghostOrigin = (type: string, at: Point): Point => {
    const l = layoutOf(type, paramDefaults(getDef(type)))
    return { x: snap(at.x - l.w / 2), y: snap(at.y - l.h / 2) }
  }

  // ---- Palette drag & click-to-place ----------------------------------------------------------

  useEffect(() => {
    if (!placing) return
    const overCanvas = (e: PointerEvent) => {
      const r = ref.current!.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    }
    const move = (e: PointerEvent) => {
      if (paletteDrag.active && Math.hypot(e.clientX - paletteDrag.x, e.clientY - paletteDrag.y) > DRAG_THRESHOLD)
        paletteDrag.moved = true
      setGhost(overCanvas(e) ? ghostOrigin(placing, toWorld(e.clientX, e.clientY)) : null)
    }
    const up = (e: PointerEvent) => {
      if (!paletteDrag.active) return
      paletteDrag.active = false
      if (!paletteDrag.moved) return // a click: stay in click-to-place mode
      if (overCanvas(e)) {
        const o = ghostOrigin(placing, toWorld(e.clientX, e.clientY))
        addComp(placing, o.x, o.y)
      }
      setPlacing(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [placing])

  // ---- Wheel: pan, ctrl/cmd/pinch to zoom -------------------------------------------------------

  useEffect(() => {
    const el = ref.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = useStore.getState().view
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        const zoom = Math.min(3, Math.max(0.25, v.zoom * Math.exp(-e.deltaY * 0.0025)))
        setView({ zoom, x: mx - ((mx - v.x) / v.zoom) * zoom, y: my - ((my - v.y) / v.zoom) * zoom })
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  // ---- Keyboard ---------------------------------------------------------------------------------

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (e.key === ' ') {
        setSpaceDown(true)
        e.preventDefault()
      } else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection()
      else if (e.key === 'Escape') {
        setPlacing(null)
        select([])
      } else if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && k === 'c') copySelection()
      else if (mod && k === 'v') paste()
      else if (mod && k === 'd') {
        e.preventDefault()
        duplicateSelection()
      } else if (mod && k === 'a') {
        e.preventDefault()
        selectAll()
      } else if (!mod && k === 'r') rotateSelection()
      else if (!mod && k === 'f') flipSelection()
      else if (!mod && (k === '0' || k === 'h')) fitView()
      else return
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---- Pointer interactions ---------------------------------------------------------------------

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const svg = ref.current!
    const w = toWorld(e.clientX, e.clientY)
    const s = useStore.getState()

    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      op.current = { k: 'pan', cx: e.clientX, cy: e.clientY, vx: s.view.x, vy: s.view.y }
      setPanning(true)
      svg.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    if (s.placing) {
      const o = ghostOrigin(s.placing, w)
      addComp(s.placing, o.x, o.y)
      if (!e.shiftKey) setPlacing(null)
      return
    }

    const target = (e.target as Element).closest<SVGElement>('[data-kind]')
    const kind = target?.dataset.kind
    svg.setPointerCapture(e.pointerId)

    if (kind === 'pin') {
      const comp = target!.dataset.comp!
      const pin = target!.dataset.pin!
      const dir = target!.dataset.dir as 'in' | 'out'
      const c = s.circuit
      const existing =
        dir === 'in' ? Object.values(c.wires).find((x) => x.to.comp === comp && x.to.pin === pin) : undefined
      // Grabbing a connected input picks up that wire's end so it can be re-plugged.
      const fromRef = existing ? existing.from : { comp, pin }
      const wp = worldPins(c.comps[fromRef.comp]).find((p) => p.def.name === fromRef.pin)!
      op.current = {
        k: 'wire',
        from: fromRef,
        pos: wp.pos,
        dir: wp.dir,
        want: wp.def.dir === 'out' ? 'in' : 'out',
        replacing: existing?.id,
        cx: e.clientX,
        cy: e.clientY,
        moved: false,
      }
      return
    }

    if (kind === 'wire') {
      const id = target!.dataset.id!
      const seg = Number((e.target as SVGElement).dataset.seg ?? -1)
      if (e.shiftKey) select(selSet.has(id) ? selection.filter((x) => x !== id) : [...selection, id])
      else if (!selSet.has(id)) select([id])
      op.current = { k: 'segment', id, seg, drag: null, moved: false, cx: e.clientX, cy: e.clientY }
      return
    }

    if (kind === 'comp') {
      const id = target!.dataset.id!
      const wasSelected = selSet.has(id)
      let sel = selection
      if (!wasSelected) {
        sel = e.shiftKey ? [...selection, id] : [id]
        select(sel)
      }
      const def = getDef(s.circuit.comps[id].type)
      const pressed = def.interactive === 'momentary'
      if (pressed) sim.setState(id, { pressed: true })
      op.current = {
        k: 'move',
        ids: sel.filter((x) => x in s.circuit.comps),
        start: w,
        applied: { x: 0, y: 0 },
        moved: false,
        clickId: id,
        shift: e.shiftKey,
        wasSelected,
        pressed,
        cx: e.clientX,
        cy: e.clientY,
      }
      return
    }

    if (!e.shiftKey) select([])
    op.current = { k: 'marquee', start: w, add: e.shiftKey }
  }

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const o = op.current
    if (!o) return
    const w = toWorld(e.clientX, e.clientY)
    const far = (cx: number, cy: number) => Math.hypot(e.clientX - cx, e.clientY - cy) > DRAG_THRESHOLD

    switch (o.k) {
      case 'pan':
        setView({ ...useStore.getState().view, x: o.vx + e.clientX - o.cx, y: o.vy + e.clientY - o.cy })
        break
      case 'marquee':
        setMarquee({
          x: Math.min(o.start.x, w.x),
          y: Math.min(o.start.y, w.y),
          w: Math.abs(w.x - o.start.x),
          h: Math.abs(w.y - o.start.y),
        })
        break
      case 'move': {
        if (!o.moved && !far(o.cx, o.cy)) return
        const d = { x: snap(w.x - o.start.x), y: snap(w.y - o.start.y) }
        if (!o.moved) {
          o.moved = true
          if (o.pressed) sim.setState(o.clickId, { pressed: false })
          checkpoint()
        }
        if (d.x !== o.applied.x || d.y !== o.applied.y) {
          moveComps(o.ids, { x: d.x - o.applied.x, y: d.y - o.applied.y }, false)
          o.applied = d
        }
        break
      }
      case 'wire': {
        if (!o.moved && !far(o.cx, o.cy)) return
        if (!o.moved) {
          o.moved = true
          if (o.replacing) setHiddenWire(o.replacing)
        }
        const c = useStore.getState().circuit
        const zoom = useStore.getState().view.zoom
        const t = nearestPin(c, w, o.want, o.from, Math.max(12, 16 / zoom))
        setWirePreview({ path: previewPath(c, o, w, t?.ref ?? null), target: t?.pos ?? null, want: o.want })
        break
      }
      case 'segment': {
        if (!o.moved) {
          if (!far(o.cx, o.cy) || o.seg < 0) return
          const wire = useStore.getState().circuit.wires[o.id]
          o.drag = wire ? beginSegmentDrag(wire.path, o.seg) : null
          if (!o.drag) return
          o.moved = true
          checkpoint()
        }
        if (!o.drag) return
        setWirePath(o.id, applySegmentDrag(o.drag, snap(o.drag.horizontal ? w.y : w.x)), false)
        break
      }
    }
  }

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const o = op.current
    op.current = null
    if (!o) return
    const w = toWorld(e.clientX, e.clientY)
    switch (o.k) {
      case 'pan':
        setPanning(false)
        break
      case 'marquee':
        if (marquee && (marquee.w > 3 || marquee.h > 3)) selectInRect(marquee, o.add)
        setMarquee(null)
        break
      case 'move':
        if (o.pressed) sim.setState(o.clickId, { pressed: false })
        if (o.moved) moveComps(o.ids, { x: 0, y: 0 }, true)
        else {
          const def = getDef(useStore.getState().circuit.comps[o.clickId]?.type ?? 'and')
          if (def.interactive === 'toggle' || def.interactive === 'cycle') interact(o.clickId, e.shiftKey)
          else if (o.shift && o.wasSelected) select(selection.filter((x) => x !== o.clickId))
          else if (!o.shift && selection.length > 1) select([o.clickId])
        }
        break
      case 'wire': {
        setWirePreview(null)
        setHiddenWire(null)
        if (!o.moved) break
        const s = useStore.getState()
        const t = nearestPin(s.circuit, w, o.want, o.from, Math.max(12, 16 / s.view.zoom))
        if (t) connect(o.from, t.ref, o.replacing)
        else if (o.replacing) deleteWire(o.replacing)
        break
      }
      case 'segment': {
        if (o.moved && o.drag) {
          const wire = useStore.getState().circuit.wires[o.id]
          if (wire) setWirePath(o.id, wire.path, true)
        }
        break
      }
    }
  }

  const onDoubleClick = (e: MouseEvent) => {
    const target = (e.target as Element).closest<SVGElement>('[data-kind="wire"]')
    if (target) resetWireRoute(target.dataset.id!)
  }

  const comps = Object.values(circuit.comps)
  const wiring = wirePreview ? ` wiring want-${wirePreview.want}` : ''
  const gridSize = GRID * 2 * view.zoom

  return (
    <svg
      ref={ref}
      className={`canvas${wiring}${spaceDown ? ' space' : ''}${panning ? ' panning' : ''}${placing ? ' placing' : ''}`}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="canvas"
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        <g className="layer-wires">
          {Object.values(circuit.wires).map((wire) =>
            wire.id === hiddenWire ? null : <WireView key={wire.id} wire={wire} selected={selSet.has(wire.id)} />,
          )}
        </g>
        <g className="layer-comps">
          {comps.map((c) => (
            <ComponentView key={c.id} comp={c} selected={selSet.has(c.id)} />
          ))}
        </g>
        <Junctions wires={circuit.wires} />
        <g className="layer-pins">
          {comps.map((c) => (
            <PinsView key={c.id} comp={c} />
          ))}
        </g>
        {wirePreview && (
          <>
            <GhostWire path={wirePreview.path} ok={!!wirePreview.target} />
            {wirePreview.target && (
              <circle className="pin-target" cx={wirePreview.target.x} cy={wirePreview.target.y} r={7} />
            )}
          </>
        )}
        {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
        {placing && ghost && <PlacementGhost type={placing} at={ghost} />}
      </g>
    </svg>
  )
}

function PlacementGhost({ type, at }: { type: string; at: Point }) {
  const comp: Comp = { id: '__ghost', type, x: at.x, y: at.y, rot: 0, flip: false, params: paramDefaults(getDef(type)) }
  const l = layoutOf(type, comp.params)
  return (
    <g className="ghost-comp" transform={compTransform(comp, l)}>
      <CompSymbol comp={comp} layout={l} live={false} />
    </g>
  )
}
