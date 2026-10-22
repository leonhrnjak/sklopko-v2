import { create } from 'zustand'
import { sim } from './sim'

interface WaveState {
  open: boolean
  /** Width of the visible time window, in simulated ms. */
  windowMs: number
  /** End of the window when scrolled back in time while paused; null follows the present. */
  viewEnd: number | null
}

export const WAVE_WINDOWS = [2000, 5000, 10000, 30000]

export const useWave = create<WaveState>(() => ({ open: false, windowMs: 10000, viewEnd: null }))

export const setWaveOpen = (open: boolean) => useWave.setState({ open })
export const setWindowMs = (windowMs: number) => useWave.setState({ windowMs })
export const setViewEnd = (viewEnd: number | null) => useWave.setState({ viewEnd })

/** Forget everything the probes have recorded; they start again from the current values. */
export function clearTraces() {
  for (const id of sim.idsOfType('probe')) sim.setState(id, { t: [], v: [] })
  setViewEnd(null)
  sim.publish()
}
