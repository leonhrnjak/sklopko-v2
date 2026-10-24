import { viewLayoutOf } from './viewlayout'
import type { ComponentDef, Params, PinDef } from './types'

export interface PinRow {
  dir: 'in' | 'out'
  /** The pin, or the run of pins (`A0–A3`). */
  names: string
  /** What it does; empty when the part does not say. */
  text: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `A#` → /^A(\d+)$/, `I#_#` → /^I(\d+)_(\d+)$/, a plain name → itself. */
const matcher = (key: string) => new RegExp('^' + key.split('#').map(escape).join('(\\d+)') + '$')

/** The key of `def.pins` that documents `pin`, and the numbers `#` stood for. */
export function pinKey(def: ComponentDef, pin: string): { key: string; nums: number[] } | undefined {
  for (const entry of Object.keys(def.pins ?? {})) {
    for (const key of entry.split('|')) {
      const m = matcher(key.trim()).exec(pin)
      if (m) return { key: entry, nums: m.slice(1).map(Number) }
    }
  }
  return undefined
}

/**
 * The rows of the pin table for a part: inputs first, then outputs, in the order the pins sit on the part. Numbered pins that
 * follow each other and share a text are one row (`D0–D7`). A pin the part does not document gets an empty text.
 */
export function pinRows(def: ComponentDef, params: Params): PinRow[] {
  const pins: PinDef[] = viewLayoutOf(def.type, params).pins
  const rows: PinRow[] = []
  let last: { key?: string; first: string; prev: string; dir: PinDef['dir']; at: number } | undefined
  for (const pin of pins) {
    const found = pinKey(def, pin.name)
    const numbered = found !== undefined && found.nums.length > 0
    if (last && numbered && last.key === found.key && last.dir === pin.dir) {
      rows[last.at].names = `${last.first}–${pin.name}`
      last.prev = pin.name
      continue
    }
    rows.push({ dir: pin.dir, names: pin.name, text: found ? def.pins![found.key] : '' })
    last = { key: numbered ? found.key : undefined, first: pin.name, prev: pin.name, dir: pin.dir, at: rows.length - 1 }
  }
  return [...rows.filter((r) => r.dir === 'in'), ...rows.filter((r) => r.dir === 'out')]
}
