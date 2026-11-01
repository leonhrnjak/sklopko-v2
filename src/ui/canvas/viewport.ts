import { registerFit, registerRefit } from '../../app/view'
import { setView, useStore } from '../../app/store'
import { boundsRect } from '../../model/circuit'

let svgEl: SVGSVGElement | null = null

/** The smallest zoom, for fitting a big circuit (the 8-bit computers are several thousand pixels wide) and for zooming out. */
export const MIN_ZOOM = 0.12

/** The canvas registers its element so toolbar actions can measure it. */
export function registerCanvas(el: SVGSVGElement | null) {
  svgEl = el
  return () => {
    if (svgEl === el) svgEl = null
  }
}

/** The canvas element, if it is on screen. */
export const canvasElement = () => svgEl

/** The largest zoom (the wheel and the buttons stop here). */
export const MAX_ZOOM = 3

/** Set the zoom, keeping the middle of the canvas where it is. */
export function zoomTo(zoom: number) {
  if (!svgEl) return
  const v = useStore.getState().view
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  const { width, height } = svgEl.getBoundingClientRect()
  const mx = width / 2
  const my = height / 2
  setView({ zoom: z, x: mx - ((mx - v.x) / v.zoom) * z, y: my - ((my - v.y) / v.zoom) * z })
}

/** One step of the zoom buttons and the + and - keys: a quarter more or less. */
export const zoomBy = (factor: number) => zoomTo(useStore.getState().view.zoom * factor)
export const ZOOM_STEP = 1.25

/** Zoom and pan so the whole circuit is visible. */
export function fitView() {
  const { circuit } = useStore.getState()
  const comps = Object.values(circuit.comps)
  if (!svgEl) return
  const { width, height } = svgEl.getBoundingClientRect()
  if (!comps.length) {
    setView({ x: 40, y: 40, zoom: 1 })
    return
  }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const c of comps) {
    const b = boundsRect(c)
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y - 20)
    x2 = Math.max(x2, b.x + b.w)
    y2 = Math.max(y2, b.y + b.h)
  }
  for (const w of Object.values(circuit.wires))
    for (const p of w.path) {
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
  const pad = 40
  const zoom = Math.min(1.6, Math.max(MIN_ZOOM, Math.min((width - 2 * pad) / (x2 - x1), (height - 2 * pad) / (y2 - y1))))
  setView({ zoom, x: (width - (x2 - x1) * zoom) / 2 - x1 * zoom, y: (height - (y2 - y1) * zoom) / 2 - y1 * zoom })
}

/** Zoom and pan to the frame whose title starts with `title`; false if the circuit has none. */
export function focusFrame(title: string): boolean {
  const frame = Object.values(useStore.getState().circuit.comps).find((c) => c.type === 'frame' && String(c.params.title).startsWith(title))
  if (!frame || !svgEl) return false
  const { width, height } = svgEl.getBoundingClientRect()
  const b = boundsRect(frame)
  const pad = 30
  const zoom = Math.min(1.6, Math.max(MIN_ZOOM, Math.min((width - 2 * pad) / b.w, (height - 2 * pad) / b.h)))
  setView({ zoom, x: (width - b.w * zoom) / 2 - b.x * zoom, y: (height - b.h * zoom) / 2 - b.y * zoom })
  return true
}

registerFit(fitView)
registerRefit((ms) => {
  if (!svgEl || typeof ResizeObserver === 'undefined') return
  const ro = new ResizeObserver(() => fitView())
  ro.observe(svgEl)
  window.setTimeout(() => ro.disconnect(), ms)
})

