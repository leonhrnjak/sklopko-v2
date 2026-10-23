import { numbered } from '../bus'
import { box, names } from '../layouts'
import { toNum, writeNum, X, type ComponentDef, type ParamDef, type Params, type V } from '../types'

/** Names of net labels: short, no spaces. An empty name is allowed and connects to nothing. */
const labelName: ParamDef = {
  key: 'name',
  label: 'Name',
  kind: 'text',
  default: '',
  pattern: '[A-Za-z0-9_]{0,12}',
  maxLength: 12,
  multiline: false,
  focus: true,
  hint: 'Letters, digits and underscores, up to 12 characters.',
  structural: true, // the flag's width, and so a Receive label's pin, depends on the name
}

/** More than one bit makes a label carry a bus (see `isBusLabel`). */
const labelBits: ParamDef = { key: 'bits', label: 'Bits', kind: 'number', min: 1, max: 16, default: 1, structural: true }

/** Width of a label flag: wide enough for its name (or the "name" placeholder shown while it is empty), on the 10px grid. */
const flagWidth = (p: Params) => {
  const bits = Number(p.bits ?? 1)
  const chars = Math.max(String(p.name).length, 4) + (bits > 1 ? String(bits).length + 2 : 0)
  return Math.ceil((chars * 8 + 22) / 10) * 10
}

export const io: ComponentDef[] = [
  {
    type: 'switch',
    name: 'Switch',
    category: 'io',
    description: 'Toggle switch. Click it to flip between 0 and 1.',
    params: [{ key: 'on', label: 'On', kind: 'bool', default: false }],
    interactive: 'toggle',
    layout: () => ({ w: 30, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 40, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.params.on ? 1 : 0
    },
  },
  {
    type: 'button',
    name: 'Push button',
    category: 'io',
    description: 'Momentary button: outputs 1 only while held down.',
    interactive: 'momentary',
    init: () => ({ pressed: false }),
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 30, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.state.pressed ? 1 : 0
    },
  },
  {
    type: 'clock',
    name: 'Clock',
    category: 'io',
    description: 'Square wave source. Ticks in real time while the simulation runs.',
    params: [
      {
        key: 'hz',
        label: 'Frequency (Hz)',
        kind: 'select',
        default: 1,
        options: [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024].map((v) => ({ value: v, label: `${v} Hz` })),
      },
    ],
    init: () => ({ phase: 0 as V, elapsed: 0 }),
    clockHalfPeriod: (p) => 500 / Number(p.hz),
    layout: () => ({ w: 40, h: 40, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 50, y: 20 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.state.phase
    },
  },
  {
    type: 'const',
    name: 'Constant',
    category: 'io',
    description: 'Fixed logic level, 0 or 1.',
    params: [
      {
        key: 'value',
        label: 'Value',
        kind: 'select',
        default: 1,
        options: [
          { value: 1, label: '1 (high)' },
          { value: 0, label: '0 (low)' },
        ],
      },
    ],
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 30, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = Number(inst.params.value) ? 1 : 0
    },
  },
  {
    type: 'netsend',
    name: 'Send label',
    category: 'io',
    description:
      'Publishes its input under a name. Every Receive label with the same name carries this signal, with no wire ' +
      'in between and no delay. If several Send labels share a name, the first one that is driven wins.',
    params: [labelName, labelBits],
    layout: (p) => ({ w: flagWidth(p), h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10, ...(Number(p.bits) > 1 ? { bus: Number(p.bits) } : {}) }] }),
    evaluate() {},
  },
  {
    type: 'netrecv',
    name: 'Receive label',
    category: 'io',
    description:
      'Carries the signal that the Send label with the same name publishes. Unknown (grey) when no driven Send ' +
      'label has that name.',
    params: [labelName, labelBits],
    layout: (p) => {
      const w = flagWidth(p)
      return { w, h: 20, pins: [{ name: 'Y', dir: 'out', side: 'r', x: w + 10, y: 10, ...(Number(p.bits) > 1 ? { bus: Number(p.bits) } : {}) }] }
    },
    evaluate(inst) {
      // Only reached when nothing publishes this name; a matched label shares the sender's net instead.
      inst.outs[0] = X
    },
  },
  {
    type: 'hexin',
    name: '4-bit input',
    category: 'io',
    description: 'Outputs a 4-bit number (A = least significant bit). Click to count up, Alt/Option-click to count down.',
    params: [{ key: 'value', label: 'Value', kind: 'number', min: 0, max: 15, default: 0 }],
    interactive: 'cycle',
    layout: () => box({ w: 40, right: ['A', 'B', 'C', 'D'] }),
    evaluate(inst) {
      writeNum(inst.outs, 0, 4, Number(inst.params.value) & 15)
    },
  },
  {
    type: 'led',
    name: 'LED',
    category: 'io',
    description: 'Lights up when its input is 1.',
    params: [
      {
        key: 'color',
        label: 'Color',
        kind: 'select',
        default: 'green',
        options: ['green', 'red', 'yellow', 'blue', 'white'].map((c) => ({ value: c, label: c })),
      },
    ],
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }),
    evaluate() {},
  },
]

/** How much history a probe keeps, in simulated ms. */
export const TRACE_KEEP_MS = 60_000

/** A probe's recorded signal: value `v[i]` holds from time `t[i]` (ms) until the next transition. */
export interface Trace {
  t: number[]
  v: V[]
}

/** What a probe of several bits records: the number it reads (-1 while some bit is unknown) instead of a logic value. */
export interface NumberTrace {
  t: number[]
  v: number[]
}

/** Bits a probe watches (1 for an ordinary probe, and for one saved before there was a choice). */
export const probeBits = (p: Params) => Number(p.bits) || 1

export const probe: ComponentDef = {
  type: 'probe',
  name: 'Probe',
  category: 'io',
  description:
    'Records the signal at its input and draws it in the waveform panel. Give it a label: that is the name of ' +
    'its trace. Place several to compare signals over time. Probes with the same group name are drawn as one trace ' +
    'that shows the number they form (select several probes to group them). Give it more bits to record a whole bus ' +
    'as one trace.',
  params: [
    {
      key: 'group',
      label: 'Group (optional)',
      kind: 'text',
      default: '',
      pattern: '[A-Za-z0-9_]{0,12}',
      maxLength: 12,
      multiline: false,
      hint: 'Letters, digits and underscores, up to 12 characters.',
    },
    { key: 'bit', label: 'Bit in the group (0 = least significant)', kind: 'number', min: 0, max: 15, default: 0 },
    {
      key: 'bits',
      label: 'Bits (a bus)',
      kind: 'number',
      min: 1,
      max: 16,
      default: 1,
      structural: true,
    },
  ],
  init: (): Trace => ({ t: [], v: [] }),
  layout: (p) => {
    const n = probeBits(p)
    return n === 1 ? { w: 30, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] } : box({ w: 60, left: names('A', n) })
  },
  groups: (p) => (probeBits(p) > 1 ? [numbered('A', 'in', 'A', probeBits(p))] : []),
  sample(inst, time) {
    const st = inst.state as { t: number[]; v: number[] }
    // A probe of several bits records the number, so a bus is one row in the waveform panel.
    const v = inst.ins.length > 1 ? toNum(inst.ins, 0, inst.ins.length) : inst.ins[0]
    if (st.v.length && st.v[st.v.length - 1] === v) return
    st.t.push(time)
    st.v.push(v)
    // Forget old history in batches, but keep the value that was in effect at the start of the window.
    const cutoff = time - TRACE_KEEP_MS
    if (st.t.length > 2 && st.t[1] < cutoff - 5000) {
      let k = 1
      while (k + 1 < st.t.length && st.t[k + 1] < cutoff) k++
      st.t.splice(0, k)
      st.v.splice(0, k)
    }
  },
  rewind(inst, time) {
    const st = inst.state as Trace
    while (st.t.length && st.t[st.t.length - 1] > time) {
      st.t.pop()
      st.v.pop()
    }
  },
  evaluate() {},
}

/** Remembers what a breakpoint saw last. `prev` is undefined until the first look, which only sets the baseline. */
interface BreakState {
  prev?: number
  met?: boolean
}

export const breakpoint: ComponentDef = {
  type: 'breakpoint',
  name: 'Breakpoint',
  category: 'io',
  description:
    'Pauses the simulation when the signal at its input becomes equal to a value, or when it changes. Give it ' +
    'more bits to watch a whole number (A0 is the least significant). It stops right at the clock edge that did it, ' +
    'and fires only when the condition starts to hold, so you can press Run again and carry on. Unknown (grey) ' +
    'inputs never trigger it.',
  params: [
    {
      key: 'width',
      label: 'Bits to watch',
      kind: 'select',
      default: 1,
      structural: true,
      options: [1, 4, 8, 16].map((v) => ({ value: v, label: v === 1 ? '1 (a single signal)' : `${v} (a number)` })),
    },
    {
      key: 'when',
      label: 'Pause when it',
      kind: 'select',
      default: 'equals',
      options: [
        { value: 'equals', label: 'becomes equal to the value' },
        { value: 'changes', label: 'changes' },
      ],
    },
    { key: 'value', label: 'Value (decimal)', kind: 'number', min: 0, max: 65535, default: 1 },
  ],
  init: (): BreakState => ({}),
  layout: (p) => {
    const n = Number(p.width)
    return n === 1
      ? { w: 50, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }
      : box({ w: 60, left: names('A', n) })
  },
  title: (p) => `STOP\n${p.when === 'changes' ? 'changes' : `= ${p.value}`}`,
  rewind(inst) {
    // Stepped back in time: what it saw last is no longer what came before, so look afresh (without firing).
    delete (inst.state as BreakState).prev
  },
  sample(inst) {
    const st = inst.state as BreakState
    const v = toNum(inst.ins, 0, inst.ins.length)
    const equals = inst.params.when !== 'changes'
    const now = equals ? (v >= 0 && v === Number(inst.params.value) ? 1 : 0) : v
    const before = st.prev
    if (equals) {
      st.prev = now
      // Fires when the condition starts to hold. The first look only sets the baseline.
      return before === 0 && now === 1
    }
    if (v < 0) return false // unknown: neither a change nor a new baseline
    st.prev = v
    return before !== undefined && before !== v
  },
  evaluate() {},
}

/** Segment patterns a..g for hex digits 0-F (bit 0 = a). */
export const SEG_HEX = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71]

export const display: ComponentDef[] = [
  {
    type: 'seg7',
    name: '7-segment display',
    category: 'display',
    description: 'Seven-segment display. Each input a–g (and dp) drives one segment.',
    layout: () => box({ w: 80, left: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] }),
    evaluate() {},
  },
  {
    type: 'hexdisp',
    name: 'Hex display',
    category: 'display',
    description: 'Shows the 4-bit input (A = least significant bit) as a hex digit 0–F.',
    layout: () => box({ w: 60, left: ['A', 'B', 'C', 'D'] }),
    evaluate() {},
  },
  {
    type: 'dicedisp',
    name: 'Dice display',
    category: 'display',
    description:
      'A die face with seven pips, one input each: top-left, top-right, middle-left, centre, middle-right, ' +
      'bottom-left, bottom-right.',
    layout: () => box({ w: 160, left: ['TL', 'TR', 'ML', 'C', 'MR', 'BL', 'BR'] }),
    evaluate() {},
  },
  {
    type: 'matrix',
    name: 'Dot matrix 8×8',
    category: 'display',
    description:
      'An 8×8 grid of LEDs. Pixel (row, column) lights while its row input R and its column input C are both 1. ' +
      'Pixels glow for a moment after they go dark, so an image drawn one row at a time by a fast scan looks steady.',
    layout: () => box({ w: 200, left: names('R', 8), top: names('C', 8) }),
    // Simulated time each pixel was last lit (row-major), for the glow.
    init: () => ({ lit: new Float64Array(64).fill(-Infinity) }),
    sample(inst, time) {
      const { ins } = inst
      const lit = inst.state.lit as Float64Array
      for (let r = 0; r < 8; r++) {
        if (ins[r] !== 1) continue
        for (let c = 0; c < 8; c++) if (ins[8 + c] === 1) lit[r * 8 + c] = time
      }
    },
    evaluate() {},
  },
  {
    type: 'bar',
    name: 'LED bar',
    category: 'display',
    description: 'A row of LEDs, one per input.',
    params: [
      {
        key: 'n',
        label: 'LEDs',
        kind: 'select',
        default: 8,
        structural: true,
        options: [4, 8].map((v) => ({ value: v, label: String(v) })),
      },
    ],
    // In bus mode the LEDs sit side by side, so the body is as wide as the row.
    layout: (p) => box({ w: p.bus ? 20 + 10 * Number(p.n) : 40, left: Array.from({ length: Number(p.n) }, (_, i) => `I${i}`) }),
    evaluate() {},
  },
]
