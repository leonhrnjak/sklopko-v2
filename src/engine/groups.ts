import type { Trace } from './components/io'

/** The recorded value of a group of probes read as a number: `v[i]` holds from `t[i]` ms; -1 means some bit is unknown. */
export interface BusTrace {
  t: number[]
  v: number[]
}

export type NumberFormat = 'hex' | 'dec' | 'bin'

/**
 * Merge the traces of several one-bit probes into the trace of the number they form. `bits[i]` is the bit position
 * (0 = least significant) of `traces[i]`. Before a probe has recorded anything its bit is unknown, and so is the
 * number. Moments where the number does not change are left out.
 */
export function groupTrace(traces: Trace[], bits: number[]): BusTrace {
  const times = [...new Set(traces.flatMap((tr) => tr.t))].sort((a, b) => a - b)
  const at = traces.map(() => -1)
  const out: BusTrace = { t: [], v: [] }
  for (const time of times) {
    let value = 0
    traces.forEach((tr, i) => {
      while (at[i] + 1 < tr.t.length && tr.t[at[i] + 1] <= time) at[i]++
      const bit = at[i] < 0 ? 2 : tr.v[at[i]]
      if (bit === 2 || value < 0) value = -1
      else value |= bit << bits[i]
    })
    if (out.v.length && out.v[out.v.length - 1] === value) continue
    out.t.push(time)
    out.v.push(value)
  }
  return out
}

/** A number the way the waveform panel writes it: `X` when unknown, otherwise padded to the width of the group. */
export function formatValue(value: number, width: number, format: NumberFormat): string {
  if (value < 0) return 'X'
  if (format === 'dec') return String(value)
  if (format === 'bin') return value.toString(2).padStart(width, '0')
  return value.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0')
}

/** Order probe labels the way a person would: ACC2 before ACC10. */
export const naturalOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
