import { create } from 'zustand'

export type GateStyle = 'us' | 'iec'

export interface Settings {
  /** US (curved) or IEC (rectangular) gate symbols. */
  gateStyle: GateStyle
  /** Draw a small hop where wires of different signals cross. */
  hops: boolean
}

const KEY = 'sklopko.settings.v1'

const DEFAULTS: Settings = { gateStyle: 'us', hops: true }

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object')
      return {
        gateStyle: raw.gateStyle === 'iec' ? 'iec' : 'us',
        hops: typeof raw.hops === 'boolean' ? raw.hops : DEFAULTS.hops,
      }
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return DEFAULTS
}

export const useSettings = create<Settings>(() => load())

export function updateSettings(patch: Partial<Settings>) {
  useSettings.setState(patch)
  const { gateStyle, hops } = useSettings.getState()
  try {
    localStorage.setItem(KEY, JSON.stringify({ gateStyle, hops }))
  } catch {
    // Not persisted; the setting still applies for this visit.
  }
}
