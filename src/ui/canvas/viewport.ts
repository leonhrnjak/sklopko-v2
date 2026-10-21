import { setView, useStore } from '../../app/store'
import { boundsRect } from '../../model/circuit'

let svgEl: SVGSVGElement | null = null

/** The canvas registers its element so toolbar actions can measure it. */
export function registerCanvas(el: SVGSVGElement | null) {
  svgEl = el
  return () => {
    if (svgEl === el) svgEl = null
  }
}

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
  const zoom = Math.min(1.6, Math.max(0.25, Math.min((width - 2 * pad) / (x2 - x1), (height - 2 * pad) / (y2 - y1))))
  setView({ zoom, x: (width - (x2 - x1) * zoom) / 2 - x1 * zoom, y: (height - (y2 - y1) * zoom) / 2 - y1 * zoom })
}

