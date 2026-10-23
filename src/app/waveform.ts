import { create } from 'zustand'
import { probeBits, type Trace } from '../engine/components/io'
import { groupTrace, type NumberFormat } from '../engine/groups'
import { toVcd, type VcdSignal } from '../engine/vcd'
import type { Comp } from '../model/circuit'
import { downloadText } from './files'
import { sim } from './sim'
import { showToast, useStore } from './store'

interface WaveState {
  open: boolean
  /** Width of the visible time window, in simulated ms. */
  windowMs: number
  /** End of the window when scrolled back in time while paused; null follows the present. */
  viewEnd: number | null
  /** How grouped probes write their number. */
  format: NumberFormat
  /** What the drawer shows: the traces of the probes, or the timing of the circuit. */
  view: 'waves' | 'timing'
}

export const WAVE_WINDOWS = [2000, 5000, 10000, 30000]

export const useWave = create<WaveState>(() => ({ open: false, windowMs: 10000, viewEnd: null, format: 'hex', view: 'waves' }))

export const setWaveOpen = (open: boolean) => useWave.setState({ open })
export const setWaveView = (view: WaveState['view']) => useWave.setState({ view })
/** Open the drawer on the timing view, or close it if that is what it is showing. */
export const toggleTiming = () => useWave.setState((s) => (s.open && s.view === 'timing' ? { open: false } : { open: true, view: 'timing' }))
export const setWindowMs = (windowMs: number) => useWave.setState({ windowMs })
export const setFormat = (format: NumberFormat) => useWave.setState({ format })
export const setViewEnd = (viewEnd: number | null) => useWave.setState({ viewEnd })

/** Forget everything the probes have recorded; they start again from the current values. */
export function clearTraces() {
  for (const id of sim.idsOfType('probe')) sim.setState(id, { t: [], v: [] })
  setViewEnd(null)
  sim.publish()
}

/** One line of the panel: a single probe, or a group of probes drawn as the number they form. */
export interface Row {
  key: string
  name: string
  probes: { id: string; bit: number }[]
  group: boolean
  /** Bits in a group (the highest bit position + 1), or in a probe that watches a bus. */
  width: number
  /** One probe of several bits: it records the number itself. */
  bus?: boolean
}

/** The rows for a circuit's probes, in circuit order. A group takes the place of its first probe. */
export function buildRows(comps: Record<string, Comp>): Row[] {
  const rows: Row[] = []
  const groups = new Map<string, Row>()
  let n = 0
  for (const c of Object.values(comps)) {
    if (c.type !== 'probe') continue
    n++
    const name = String(c.params.group ?? '')
    if (probeBits(c.params) > 1) {
      rows.push({ key: c.id, name: c.label || `Probe ${n}`, probes: [{ id: c.id, bit: 0 }], group: false, width: probeBits(c.params), bus: true })
      continue
    }
    if (!name) {
      rows.push({ key: c.id, name: c.label || `Probe ${n}`, probes: [{ id: c.id, bit: 0 }], group: false, width: 1 })
      continue
    }
    let row = groups.get(name)
    if (!row) {
      row = { key: `group:${name}`, name, probes: [], group: true, width: 1 }
      groups.set(name, row)
      rows.push(row)
    }
    row.probes.push({ id: c.id, bit: Number(c.params.bit) })
    row.width = Math.max(row.width, Number(c.params.bit) + 1)
  }
  return rows
}

/** What the probes have recorded, one signal per row (a group as one bus), ready for a waveform file. */
export function recordedSignals(rows: Row[]): VcdSignal[] {
  return rows.map((row) => {
    const traces = row.probes.map((p) => (sim.state(p.id) as Trace | undefined) ?? { t: [], v: [] })
    if (row.bus) return { name: row.name, width: row.width, t: traces[0].t, v: traces[0].v }
    if (row.group) {
      const bus = groupTrace(traces, row.probes.map((p) => p.bit))
      return { name: row.name, width: row.width, t: bus.t, v: bus.v }
    }
    return { name: row.name, width: 1, t: traces[0].t, v: traces[0].v }
  })
}

/** Download everything the probes have recorded (the last minute of simulated time) as a VCD file. */
export function exportVcd() {
  const signals = recordedSignals(buildRows(useStore.getState().circuit.comps))
  if (!signals.some((s) => s.t.length)) return showToast('Nothing has been recorded yet.')
  downloadText('waveforms.vcd', toVcd(signals, sim.time), 'text/plain')
}
