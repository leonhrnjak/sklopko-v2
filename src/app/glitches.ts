import { useMemo, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { findGlitches, type Glitch } from '../engine/glitch'
import type { Capture } from '../engine/simulator'
import { isLabel } from '../model/labels'
import type { Circuit } from '../model/circuit'
import { partName } from '../model/timing'
import { sim } from './sim'

interface DiagramState {
  /** Signals the user added to the tick diagram, as the `comp:pin` of the output pin that drives them. */
  extra: string[]
  /** Show only the signals that glitch. */
  glitchesOnly: boolean
}

export const useDiagram = create<DiagramState>(() => ({ extra: [], glitchesOnly: false }))
export const addDiagramSignal = (key: string) => useDiagram.setState((s) => (s.extra.includes(key) ? s : { extra: [...s.extra, key] }))
export const clearDiagramSignals = () => useDiagram.setState({ extra: [] })
export const setGlitchesOnly = (glitchesOnly: boolean) => useDiagram.setState({ glitchesOnly })

export interface CaptureView {
  capture: Capture
  glitches: Glitch[]
  /** For each net, the `comp:pin` of the output that drives it. */
  names: string[]
}

/** The simulator's latest capture and its glitches, updated as new ones arrive. Recording is switched on by whoever shows it. */
export function useCapture(): CaptureView | null {
  const version = useSyncExternalStore(sim.subscribe, () => sim.captureVersion)
  return useMemo(() => {
    const capture = sim.getCapture()
    return capture ? { capture, glitches: findGlitches(capture.frames), names: sim.netNames() } : null
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
}

/** The wires whose signal glitched in the latest capture. */
export function glitchingWires(circuit: Circuit, view: CaptureView | null): Set<string> {
  const out = new Set<string>()
  if (!view || !view.glitches.length) return out
  const bad = new Set(view.glitches.map((g) => g.net))
  for (const w of Object.values(circuit.wires)) if (bad.has(sim.netOf(w.from.comp, w.from.pin))) out.add(w.id)
  return out
}

/** The ticks a settle took until the last change (the quiet tick that finds nothing more is not counted). */
export function settleTicks(frames: Uint8Array[]): number {
  for (let k = frames.length - 1; k >= 1; k--) {
    const a = frames[k]
    const b = frames[k - 1]
    for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) return k
  }
  return 0
}

export interface DiagramRow {
  /** Which net (index into the capture's frames). */
  net: number
  name: string
  /** Added by the user, so it can be removed. */
  extra?: string
  glitch?: Glitch
}

/** The most rows the diagram shows. */
export const MAX_ROWS = 24

/**
 * The signals to draw, in order: the probes, the inputs of the LEDs (what the circuit shows), the ones the user added, then
 * every signal that glitched. Each net once.
 */
export function diagramRows(circuit: Circuit, netOf: (comp: string, pin: string) => number, view: CaptureView, extra: string[], glitchesOnly: boolean): DiagramRow[] {
  const nets = view.capture.frames[0].length
  const glitchOf = new Map(view.glitches.map((g) => [g.net, g]))
  const rows: DiagramRow[] = []
  const seen = new Set<number>()
  const add = (net: number, name: string, extraKey?: string) => {
    if (net < 0 || net >= nets || seen.has(net)) return
    seen.add(net)
    rows.push({ net, name, ...(extraKey ? { extra: extraKey } : {}), ...(glitchOf.has(net) ? { glitch: glitchOf.get(net) } : {}) })
  }
  const comps = Object.values(circuit.comps)
  for (const k of comps) if (k.type === 'probe') add(netOf(k.id, 'A'), k.label || 'Probe')
  for (const k of comps) if (k.type === 'led') add(netOf(k.id, 'A'), k.label || 'LED')
  for (const key of extra) {
    const [comp, pin] = key.split(':')
    const k = circuit.comps[comp]
    if (k) add(netOf(comp, pin), `${partName(k)} ${pin}`, key)
  }
  for (const g of view.glitches) {
    const [comp, pin] = (view.names[g.net] || ':').split(':')
    const k = circuit.comps[comp]
    add(g.net, k && !isLabel(k.type) ? `${partName(k)} ${pin}` : view.names[g.net] || `net ${g.net}`)
  }
  const shown = glitchesOnly ? rows.filter((r) => r.glitch) : rows
  return shown.slice(0, MAX_ROWS)
}
