import { create } from 'zustand'

export type GateStyle = 'us' | 'iec'
/** Signal colours: red/green (the default) or orange/blue, which people who confuse red and green can tell apart. */
export type WireColors = 'classic' | 'blue-orange'

export interface Settings {
  /** US (curved) or IEC (rectangular) gate symbols. */
  gateStyle: GateStyle
  /** Draw a small hop where wires of different signals cross. */
  hops: boolean
  wireColors: WireColors
  /** The help panel on the right shows when nothing is selected. Open until the visitor hides it. */
  helpOpen: boolean
  /** While the simulation runs, the circuit cannot be changed (switches and memories can still be operated). Off until the visitor asks. */
  lockEdits: boolean
}

const KEY = 'sklopko.settings.v1'

const DEFAULTS: Settings = { gateStyle: 'us', hops: true, wireColors: 'classic', helpOpen: true, lockEdits: false }

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object')
      return {
        gateStyle: raw.gateStyle === 'iec' ? 'iec' : 'us',
        hops: typeof raw.hops === 'boolean' ? raw.hops : DEFAULTS.hops,
        wireColors: raw.wireColors === 'blue-orange' ? 'blue-orange' : 'classic',
        helpOpen: typeof raw.helpOpen === 'boolean' ? raw.helpOpen : DEFAULTS.helpOpen,
        lockEdits: raw.lockEdits === true,
      }
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return DEFAULTS
}

export const useSettings = create<Settings>(() => load())

/** The stylesheet swaps the signal colours on this attribute of the page. */
function applyWireColors(w: WireColors) {
  if (typeof document !== 'undefined') document.documentElement.dataset.wires = w
}
applyWireColors(useSettings.getState().wireColors)

export function updateSettings(patch: Partial<Settings>) {
  useSettings.setState(patch)
  const { gateStyle, hops, wireColors, helpOpen, lockEdits } = useSettings.getState()
  applyWireColors(wireColors)
  try {
    localStorage.setItem(KEY, JSON.stringify({ gateStyle, hops, wireColors, helpOpen, lockEdits }))
  } catch {
    // Not persisted; the setting still applies for this visit.
  }
}
