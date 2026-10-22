// Three-valued logic: 0, 1 and X (unknown / undriven).
export type V = 0 | 1 | 2
export const X: V = 2

export const inv = (v: V): V => (v === X ? X : ((1 - v) as V))
export const bit = (b: boolean): V => (b ? 1 : 0)

export type Side = 'l' | 'r' | 't' | 'b'

export interface PinDef {
  /** Unique within the component; used in wires and saved files. */
  name: string
  /** Text drawn next to the pin inside box symbols. */
  label?: string
  dir: 'in' | 'out'
  /** Wire attachment point (pin tip), in local component coordinates. Always on the 10px grid. */
  x: number
  y: number
  /** Side of the body the pin sticks out of. */
  side: Side
  /** Draw a clock triangle (edge-triggered input). */
  clock?: boolean
  /** Draw an inversion bubble. */
  invert?: boolean
  /** Value an input reads when nothing is connected. Defaults to X. */
  def?: V
}

export interface Layout {
  /** Body size; the body spans (0,0)-(w,h). Pin tips sit outside it. */
  w: number
  h: number
  pins: PinDef[]
}

export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

export interface ParamDef {
  key: string
  label: string
  kind: 'select' | 'number' | 'bool' | 'text'
  options?: { value: ParamValue; label: string }[]
  min?: number
  max?: number
  step?: number
  /** For 'text': regular expression (source) the whole value must match, and the maximum length. */
  pattern?: string
  maxLength?: number
  /** For 'text': a multi-line box (default) or a single-line field. */
  multiline?: boolean
  /** For 'text': what to tell the user when the value doesn't match the pattern. */
  hint?: string
  default: ParamValue
  /** Changing it alters pins or behavior that needs a recompile (false for e.g. LED color). */
  structural?: boolean
}

/** Runtime instance handed to `evaluate`. `ins`/`outs` follow the order of input/output pins in the layout. */
export interface Instance {
  ins: V[]
  outs: V[]
  state: any
  params: Params
}

export type Category = 'io' | 'gates' | 'sequential' | 'arithmetic' | 'memory' | 'routing' | 'coding' | 'display'

export interface ComponentDef {
  type: string
  name: string
  category: Category
  description: string
  params?: ParamDef[]
  layout(p: Params): Layout
  init?(p: Params): any
  /** Compute outputs from inputs (and state). Called once per tick. */
  evaluate(inst: Instance): void
  /** Text drawn inside generic box symbols. */
  title?: (p: Params) => string
  /**
   * Called after every settled step (each clock edge and each frame) with the simulated time in ms, and
   * with `ins` refreshed to the settled values. For parts that record or smooth what they see over time
   * (waveform probes, dot-matrix persistence). Keep the result in `state`.
   */
  sample?(inst: Instance, time: number): void
  /** The symbol shows live values, so it redraws whenever one of its pins changes. */
  live?: boolean
  /** How the user interacts with it on the canvas. */
  interactive?: 'toggle' | 'momentary' | 'cycle'
  /** Half-period in ms for clock sources, or undefined for everything else. */
  clockHalfPeriod?(p: Params): number
}

export function paramDefaults(def: ComponentDef): Params {
  const p: Params = {}
  for (const d of def.params ?? []) p[d.key] = d.default
  return p
}

/** Little-endian bits of `ins[start..start+n)` as a number, or -1 if any bit is X. */
export function toNum(vals: V[], start: number, n: number): number {
  let r = 0
  for (let i = 0; i < n; i++) {
    const v = vals[start + i]
    if (v === X) return -1
    r |= v << i
  }
  return r
}

/** Write `n` little-endian bits of `value` into `outs` from `start`; a negative value writes X. */
export function writeNum(outs: V[], start: number, n: number, value: number) {
  for (let i = 0; i < n; i++) outs[start + i] = value < 0 ? X : (((value >> i) & 1) as V)
}
