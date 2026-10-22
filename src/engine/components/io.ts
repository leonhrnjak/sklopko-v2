import { box, names } from '../layouts'
import { writeNum, X, type ComponentDef, type ParamDef, type Params, type V } from '../types'

/** Names of net labels: short, no spaces. An empty name is allowed and connects to nothing. */
const labelName: ParamDef = {
  key: 'name',
  label: 'Name',
  kind: 'text',
  default: '',
  pattern: '[A-Za-z0-9_]{0,12}',
  maxLength: 12,
  multiline: false,
  hint: 'Letters, digits and underscores, up to 12 characters.',
  structural: true, // the flag's width, and so a Receive label's pin, depends on the name
}

/** Width of a label flag: wide enough for its name (or the "name" placeholder shown while it is empty), on the 10px grid. */
const flagWidth = (p: Params) => Math.ceil((Math.max(String(p.name).length, 4) * 8 + 22) / 10) * 10

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
        options: [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256].map((v) => ({ value: v, label: `${v} Hz` })),
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
    params: [labelName],
    layout: (p) => ({ w: flagWidth(p), h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }),
    evaluate() {},
  },
  {
    type: 'netrecv',
    name: 'Receive label',
    category: 'io',
    description:
      'Carries the signal that the Send label with the same name publishes. Unknown (grey) when no driven Send ' +
      'label has that name.',
    params: [labelName],
    layout: (p) => {
      const w = flagWidth(p)
      return { w, h: 20, pins: [{ name: 'Y', dir: 'out', side: 'r', x: w + 10, y: 10 }] }
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

export const probe: ComponentDef = {
  type: 'probe',
  name: 'Probe',
  category: 'io',
  description:
    'Records the signal at its input and draws it in the waveform panel. Give it a label: that is the name of ' +
    'its trace. Place several to compare signals over time.',
  init: (): Trace => ({ t: [], v: [] }),
  layout: () => ({ w: 30, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }),
  sample(inst, time) {
    const st = inst.state as Trace
    const v = inst.ins[0]
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
    layout: (p) => box({ w: 40, left: Array.from({ length: Number(p.n) }, (_, i) => `I${i}`) }),
    evaluate() {},
  },
]
