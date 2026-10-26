import { create } from 'zustand'
import { boundsRect } from '../model/circuit'
import { labelled } from '../model/path/goals'
import { canvasElement } from '../ui/canvas/viewport'
import { setView, useStore } from './store'

/**
 * The spotlight: a lesson names a part as [[label]]. Hovering the name outlines the part on the canvas; clicking it brings the part
 * to the middle of the canvas and dims everything else for a moment. Loads with the step panel; the overlay is `ui/path/Spotlight.tsx`.
 */

/** How long a click keeps the rest of the canvas dimmed. */
export const DIM_MS = 1800

interface SpotState {
  /** The label being pointed at. */
  hover: string | null
  /** The label brought forward by a click, while the rest is dimmed. */
  focus: string | null
}

export const useSpot = create<SpotState>(() => ({ hover: null, focus: null }))

export const hoverSpot = (label: string | null) => useSpot.setState({ hover: label })

let timer = 0

export function clearSpot() {
  window.clearTimeout(timer)
  useSpot.setState({ hover: null, focus: null })
}

/** Bring the part with this label to the middle of the canvas and dim the rest. Without such a part, nothing happens. */
export function focusSpot(label: string) {
  const { circuit, view } = useStore.getState()
  const k = labelled(circuit, label)
  const svg = canvasElement()
  if (!k) return
  if (svg) {
    const b = boundsRect(k)
    const { width, height } = svg.getBoundingClientRect()
    setView({ zoom: view.zoom, x: width / 2 - (b.x + b.w / 2) * view.zoom, y: height / 2 - (b.y + b.h / 2) * view.zoom })
  }
  window.clearTimeout(timer)
  useSpot.setState({ focus: label })
  timer = window.setTimeout(() => useSpot.setState({ focus: null }), DIM_MS)
}
