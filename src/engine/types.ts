// Logic values: 0, 1, X (unknown) and Z (high impedance: a tri-state output that drives nothing).
// Z only exists on the nets of tri-state outputs; every part except those with `acceptsZ` reads it as X.
export type V = 0 | 1 | 2 | 3
export const X: V = 2
export const Z: V = 3

export const inv = (v: V): V => (v > 1 ? X : ((1 - v) as V))
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
  /** A bus pin: the number of bits it carries (2 or more). Only in the view layout and in parts that are pure wiring. */
  bus?: number
}

/** The scalar pins of a part that its bus mode draws as one bus pin (see `ComponentDef.groups`). */
export interface PinGroup {
  /** The bus pin's name. Never the name of a scalar pin of the same part. */
  name: string
  dir: 'in' | 'out'
  /** Scalar pin names, least significant bit first. They sit next to each other on one side. */
  pins: string[]
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
  /** For a single-line 'text': take the keyboard focus while it is empty (a new part asks for its name at once). */
  focus?: boolean
  default: ParamValue
  /** What a saved file that lacks this param means (when it differs from `default`, which a part placed now gets). */
  legacy?: ParamValue
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

/** `ic` is not in the palette's list: custom ICs are placed from their own section. */
export type Category = 'io' | 'gates' | 'sequential' | 'arithmetic' | 'memory' | 'routing' | 'buses' | 'coding' | 'display' | 'annotation' | 'ic'

export interface ComponentDef {
  type: string
  name: string
  category: Category
  description: string
  /**
   * What each pin does, shown in the inspector as a table of inputs and outputs. The key is a pin name (`CLK`), or a name with `#` for
   * a number (`A#` is A0, A1, A2...; a run of such pins is shown as one row, `A0–A3`), and `|` joins keys that share a text
   * (`D#|D`: the scalar pins and the bus pin). Say what the pin does, not what it is called; give the value that triggers it
   * ("1 loads", "rising edge"). `pins.test.ts` checks that every pin of every part has one.
   */
  pins?: Record<string, string>
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
   * (waveform probes, dot-matrix persistence). Keep the result in `state`. Returning true asks the simulation to
   * stop right here (a breakpoint): see `Simulator.takeBreak`.
   */
  sample?(inst: Instance, time: number): void | boolean
  /**
   * Called after the simulation was stepped back to `time`, for parts that have a `sample`: forget what was
   * recorded after it. (Parts with a `sample` are not snapshotted, since a trace can be long.)
   */
  rewind?(inst: Instance, time: number): void
  /** The symbol shows live values, so it redraws whenever one of its pins changes. */
  live?: boolean
  /** How the user interacts with it on the canvas. */
  interactive?: 'toggle' | 'momentary' | 'cycle'
  /** Half-period in ms for clock sources, or undefined for everything else. */
  clockHalfPeriod?(p: Params): number
  /** Reads Z as Z. Every other part sees a Z input as X. */
  acceptsZ?: boolean
  /**
   * Bus mode: which scalar pins are shown as one bus pin each. The part has a `bus` param (see `withBus`) that switches it
   * on, or, without one, it is always on. The simulator never sees groups: `flatten` turns a bus wire into one wire per bit.
   */
  groups?(p: Params): PinGroup[]
  /** In bus mode the body keeps its height (it draws something that needs the room: a table, a screen, a digit). */
  keepsHeight?(p: Params): boolean
  /** An `interactive: 'cycle'` part with a value of its own: the params after a click (or an Alt-click, `back`). */
  cycle?(p: Params, back: boolean): Params
  /**
   * Words of memory that can be changed from outside while the circuit exists (the memory editor): how many there are, what is
   * in one, and writing one (the value is cut to the word size). Only parts with a RAM-like state have it.
   */
  memory?: {
    size(inst: Instance): number
    read(inst: Instance, index: number): number
    write(inst: Instance, index: number, value: number): void
  }
  /**
   * A number that changes whenever the part changes in a way its pins do not show (a console that was written to, a screen that
   * was drawn on), so that its symbol is drawn again. Parts with a screen of their own have it.
   */
  revision?(inst: Instance): number
  /** Pure wiring (splitter, merger): never simulated, `flatten` follows it back to the parts that drive its outputs. */
  wiring?: boolean
}

export function paramDefaults(def: ComponentDef): Params {
  const p: Params = {}
  for (const d of def.params ?? []) p[d.key] = d.default
  return p
}

/** The params of a part as old files (and the example builders) mean them: `legacy` where a param has one. */
export function legacyDefaults(def: ComponentDef): Params {
  const p: Params = {}
  for (const d of def.params ?? []) p[d.key] = d.legacy ?? d.default
  return p
}

/** Little-endian bits of `ins[start..start+n)` as a number, or -1 if any bit is X. */
export function toNum(vals: V[], start: number, n: number): number {
  let r = 0
  for (let i = 0; i < n; i++) {
    const v = vals[start + i]
    if (v > 1) return -1
    r |= v << i
  }
  return r
}

/** Write `n` little-endian bits of `value` into `outs` from `start`; a negative value writes X. */
export function writeNum(outs: V[], start: number, n: number, value: number) {
  for (let i = 0; i < n; i++) outs[start + i] = value < 0 ? X : (((value >> i) & 1) as V)
}
