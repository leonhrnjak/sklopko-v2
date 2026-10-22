import { box, names } from '../layouts'
import { X, toNum, type ComponentDef, type V } from '../types'
import { HEX_WORDS, parseWords } from './memory'

/** Detects a 0 -> 1 transition on a clock input; state.pc holds the previous level. */
function rising(state: { pc: V }, clk: V): boolean {
  const r = state.pc === 0 && clk === 1
  state.pc = clk
  return r
}

// ---- Text console ------------------------------------------------------------------------------

export const CONSOLE_COLS = 28
/** Lines kept; the symbol shows the last `CONSOLE_ROWS`. */
export const CONSOLE_LINES = 100
export const CONSOLE_ROWS = 6

export interface ConsoleState {
  /** The text so far, one string per line; the last one is where the next character goes. */
  lines: string[]
  pc: V
  /** Counts changes, so the symbol knows to redraw. */
  rev: number
}

/**
 * Print one character code: 32–126 are printable (a full line wraps), 10 starts a new line, 8 deletes the last
 * character of the line, 12 clears the screen. Anything else is ignored.
 */
export function consolePut(st: Pick<ConsoleState, 'lines' | 'rev'>, code: number) {
  const last = () => st.lines.length - 1
  const newLine = () => {
    st.lines.push('')
    if (st.lines.length > CONSOLE_LINES) st.lines.shift()
  }
  if (code === 12) st.lines.splice(0, st.lines.length, '')
  else if (code === 10) newLine()
  else if (code === 8) st.lines[last()] = st.lines[last()].slice(0, -1)
  else if (code >= 32 && code <= 126) {
    if (st.lines[last()].length >= CONSOLE_COLS) newLine()
    st.lines[last()] += String.fromCharCode(code)
  } else return
  st.rev++
}

// ---- Pixel framebuffer -------------------------------------------------------------------------

export const FB_SIZE = 16

export interface FramebufferState {
  /** Colour index of each pixel, row by row. */
  px: number[]
  pc: V
  rev: number
}

// ---- Speaker -----------------------------------------------------------------------------------

export interface SpeakerState {
  last: V
  /** Simulated times (ms) of the most recent changes of the input. */
  edges: number[]
  rev: number
}

const SPEAKER_EDGES = 8

/**
 * The pitch the speaker input makes, in simulated Hz: from the time between its last few changes. Zero when the
 * input has been still for longer than a few periods (silence), or has changed fewer than twice.
 */
export function speakerPitch(edges: number[], now: number): number {
  if (edges.length < 3) return 0
  const half = (edges[edges.length - 1] - edges[0]) / (edges.length - 1)
  if (!(half > 0)) return 0
  if (now - edges[edges.length - 1] > half * 2.5 + 20) return 0
  return 1000 / (2 * half)
}

/** The lowest and highest tones that are played: slower is a click, faster is above what a speaker makes of a square wave. */
export const TONE_MIN_HZ = 20
export const TONE_MAX_HZ = 12000

/** The tone to play in real Hz, or 0 for silence: the simulated pitch scaled by the speed setting and the octaves up, if sound is on and the simulation runs. */
export function speakerTone(pitch: number, speed: number, on: boolean, running: boolean, octaves = 0): number {
  const hz = pitch * speed * 2 ** octaves
  return on && running && hz >= TONE_MIN_HZ && hz <= TONE_MAX_HZ ? hz : 0
}

// ---- Keypad ------------------------------------------------------------------------------------

export interface KeypadState {
  pressed: boolean
  /** Was a key down at the last evaluation (a new press is a change from not down to down). */
  prev: boolean
  /** The key pressed last, 0–15. */
  key: number
  /** Set when a key is pressed: counts as a press even if the key is let go again before the next evaluation (a quick tap). */
  tapped?: boolean
  /** A key has been pressed since RST was last high (what P shows when the keypad is sticky). */
  latched: boolean
}

export const devices: ComponentDef[] = [
  {
    type: 'console',
    name: 'Text console',
    category: 'display',
    description:
      'A small text screen. On a rising CLK with WE=1 the character code on D0–D7 (ASCII) is printed: 32–126 are ' +
      'letters, digits and symbols, 10 starts a new line, 8 backspaces and 12 clears the screen. Select it to read ' +
      'the whole text so far. Reset clears it.',
    title: () => 'Console',
    live: true,
    init: (): ConsoleState => ({ lines: [''], pc: X, rev: 0 }),
    layout: () => box({ w: 280, minRows: 10, left: [...names('D', 8), { name: 'WE', def: 0 }, { name: 'CLK', clock: true }] }),
    evaluate(inst) {
      const st = inst.state as ConsoleState
      if (!rising(st, inst.ins[9]) || inst.ins[8] !== 1) return
      const code = toNum(inst.ins, 0, 8)
      if (code >= 0) consolePut(st, code)
    },
  },
  {
    type: 'framebuffer',
    name: 'Pixel screen 16×16',
    category: 'display',
    description:
      'A 16×16 screen with one colour (on/off) or four colours. On a rising CLK with WE=1 the pixel at column X0–X3 ' +
      'and row Y0–Y3 is set to the value on D. CLR=1 blanks the screen. Reset blanks it too.',
    params: [
      {
        key: 'colors',
        label: 'Colours',
        kind: 'select',
        default: 2,
        structural: true,
        options: [
          { value: 2, label: '2 (on/off)' },
          { value: 4, label: '4' },
        ],
      },
    ],
    title: () => '',
    live: true,
    init: (): FramebufferState => ({ px: new Array<number>(FB_SIZE * FB_SIZE).fill(0), pc: X, rev: 0 }),
    layout: (p) =>
      box({
        w: 220,
        minRows: 12,
        left: [...names('X', 4), ...names('Y', 4), ...(Number(p.colors) === 4 ? names('D', 2) : ['D']), { name: 'WE', def: 0 }, { name: 'CLR', def: 0 }, { name: 'CLK', clock: true }],
      }),
    evaluate(inst) {
      const st = inst.state as FramebufferState
      const nd = Number(inst.params.colors) === 4 ? 2 : 1
      const we = inst.ins[8 + nd]
      const clr = inst.ins[9 + nd]
      const edge = rising(st, inst.ins[10 + nd])
      if (clr === 1) {
        if (st.px.some((v) => v)) {
          st.px.fill(0)
          st.rev++
        }
        return
      }
      if (!edge || we !== 1) return
      const x = toNum(inst.ins, 0, 4)
      const y = toNum(inst.ins, 4, 4)
      const d = toNum(inst.ins, 8, nd)
      if (x < 0 || y < 0 || d < 0) return
      if (st.px[y * FB_SIZE + x] !== d) {
        st.px[y * FB_SIZE + x] = d
        st.rev++
      }
    },
  },
  {
    type: 'speaker',
    name: 'Speaker',
    category: 'io',
    description:
      'Plays a tone while its input A keeps changing: the tone is the square wave on A, so drive it from a fast ' +
      'clock (a 256 Hz clock gives a 256 Hz tone) or from a counter bit for a lower note. A slow circuit makes ' +
      'notes too low to hear: "Octaves up" raises the pitch by whole octaves. Click it to mute or unmute. The sound ' +
      'starts after your first click on the page, and follows the speed setting.',
    params: [
      { key: 'on', label: 'Sound on', kind: 'bool', default: true },
      {
        key: 'octaves',
        label: 'Octaves up',
        kind: 'select',
        default: 0,
        options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: v === 0 ? 'None' : `${v} (×${2 ** v})` })),
      },
    ],
    interactive: 'toggle',
    live: true,
    init: (): SpeakerState => ({ last: X, edges: [], rev: 0 }),
    layout: () => ({ w: 40, h: 40, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 20 }] }),
    evaluate() {},
    sample(inst, time) {
      const st = inst.state as SpeakerState
      const v = inst.ins[0]
      if (v === X || v === st.last) return
      if (st.last !== X) {
        st.edges.push(time)
        if (st.edges.length > SPEAKER_EDGES) st.edges.shift()
      }
      st.last = v
    },
    rewind(inst, time) {
      const st = inst.state as SpeakerState
      st.edges = st.edges.filter((t) => t <= time)
      st.last = X
    },
  },
  {
    type: 'keypad',
    name: 'Hex keypad',
    category: 'io',
    description:
      'Sixteen keys, 0–F. K0–K3 hold the code of the key pressed last, and P is 1 while a key is held down. ' +
      'With "Sticky" on, P instead goes to 1 at each new press and stays there until RST goes to 1, so a slow ' +
      'program does not miss a press (and a key held down counts once).',
    params: [{ key: 'sticky', label: 'Sticky', kind: 'bool', default: false }],
    interactive: 'momentary',
    live: true,
    init: (): KeypadState => ({ pressed: false, prev: false, key: 0, latched: false }),
    layout: () => box({ w: 140, minRows: 5, left: [{ name: 'RST', def: 0 }], right: [...names('K', 4), 'P'] }),
    evaluate(inst) {
      const st = inst.state as KeypadState
      if ((st.pressed && !st.prev) || st.tapped) st.latched = true // a new press
      st.tapped = false
      st.prev = st.pressed
      if (inst.ins[0] === 1) st.latched = false
      for (let i = 0; i < 4; i++) inst.outs[i] = ((st.key >> i) & 1) as V
      inst.outs[4] = (inst.params.sticky === true ? st.latched : st.pressed) ? 1 : 0
    },
  },
  {
    type: 'lut',
    name: 'Lookup table',
    category: 'memory',
    description:
      'Any logic function you can write as a truth table. The inputs A, B, C… (A is the most significant) pick a ' +
      'row, and the output Y shows that row\'s value right away. Select it and click the output cells to edit the table.',
    params: [
      {
        key: 'inputs',
        label: 'Inputs',
        kind: 'select',
        default: 3,
        structural: true,
        options: [2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: `${v} (${2 ** v} rows)` })),
      },
      {
        key: 'outputs',
        label: 'Outputs',
        kind: 'select',
        default: 1,
        structural: true,
        options: [1, 2, 4, 8].map((v) => ({ value: v, label: String(v) })),
      },
      {
        key: 'data',
        label: 'Contents (hex words)',
        kind: 'text',
        default: '0 0 0 1 0 1 1 1',
        pattern: HEX_WORDS.source,
        maxLength: 800,
        hint: 'Only hexadecimal digits (0–9, A–F), spaces and commas.',
      },
    ],
    title: (p) => `LUT ${p.inputs}→${p.outputs}`,
    layout: (p) => {
      const n = Number(p.inputs)
      const m = Number(p.outputs)
      return box({
        left: Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)),
        right: m === 1 ? ['Y'] : names('Y', m),
      })
    },
    evaluate(inst) {
      const n = Number(inst.params.inputs)
      const m = Number(inst.params.outputs)
      let addr = 0
      for (let i = 0; i < n; i++) {
        const v = inst.ins[i]
        if (v === X) return inst.outs.fill(X)
        addr = (addr << 1) | v
      }
      const word = parseWords(String(inst.params.data), 2 ** n, m)[addr]
      for (let o = 0; o < m; o++) inst.outs[o] = ((word >> o) & 1) as V
    },
  },
]
