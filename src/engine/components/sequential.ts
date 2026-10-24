import { box, names, type PinSpec } from '../layouts'
import { X, inv, toNum, writeNum, type ComponentDef, type Instance, type Params, type V } from '../types'
import { tableBox } from './memory'

const CLK: PinSpec = { name: 'CLK', clock: true }
const SET: PinSpec = { name: 'S', def: 0 }
const RESET: PinSpec = { name: 'R', def: 0 }
const Q_OUTS: PinSpec[] = ['Q', { name: 'NQ', label: '~Q' }]

/** Detects a 0 -> 1 transition on the clock input; state.pc holds the previous clock level. */
export function rising(state: { pc: V }, clk: V): boolean {
  const r = state.pc === 0 && clk === 1
  state.pc = clk
  return r
}

function writeQ(inst: Instance, q: V) {
  inst.outs[0] = q
  inst.outs[1] = inv(q)
}

// Convention: X on a control input (enable, load, reset) leaves stored state alone, so the brief
// power-up moment when every net is still unknown doesn't poison memories. X on a *data* input
// that gets stored (D, J/K, T) stores X.

/** Applies active-high async set/reset; returns true if one of them took over. */
function asyncSR(st: { q: V }, s: V, r: V): boolean {
  if (r === 1) st.q = 0
  else if (s === 1) st.q = 1
  else return false
  return true
}

const flipFlopInit = () => ({ q: 0 as V, pc: X as V })

export const sequential: ComponentDef[] = [
  {
    type: 'srlatch',
    name: 'SR latch',
    category: 'sequential',
    description: 'Set/reset latch. S=1 sets Q, R=1 resets it, both 0 holds the stored bit.',
    title: () => 'SR',
    init: () => ({ q: 0 as V }),
    layout: () => box({ left: ['S', 'R'], right: Q_OUTS }),
    evaluate(inst) {
      const [s, r] = inst.ins
      const st = inst.state
      if (s === 1 && r === 1) {
        // Forbidden state: like a NOR latch, both outputs go low.
        inst.outs[0] = 0
        inst.outs[1] = 0
        return
      }
      if (s === 1 && r === 0) st.q = 1
      else if (r === 1 && s === 0) st.q = 0
      writeQ(inst, st.q)
    },
  },
  {
    type: 'dlatch',
    name: 'D latch',
    category: 'sequential',
    description: 'Gated D latch. While EN=1 the output follows D; when EN=0 it holds.',
    title: () => 'D',
    init: () => ({ q: 0 as V }),
    layout: () => box({ left: ['D', { name: 'E', label: 'EN' }], right: Q_OUTS }),
    evaluate(inst) {
      const [d, e] = inst.ins
      if (e === 1) inst.state.q = d
      writeQ(inst, inst.state.q)
    },
  },
  {
    type: 'dff',
    name: 'D flip-flop',
    category: 'sequential',
    description: 'Stores D on the rising clock edge. S and R asynchronously set/reset Q.',
    title: () => 'D',
    init: flipFlopInit,
    layout: () => box({ left: ['D', CLK], top: [SET], bottom: [RESET], right: Q_OUTS }),
    evaluate(inst) {
      const [d, clk, s, r] = inst.ins
      const st = inst.state
      const edge = rising(st, clk)
      if (!asyncSR(st, s, r) && edge) st.q = d
      writeQ(inst, st.q)
    },
  },
  {
    type: 'jkff',
    name: 'JK flip-flop',
    category: 'sequential',
    description: 'On the rising edge: J=1 sets, K=1 resets, both 1 toggles, both 0 holds.',
    title: () => 'JK',
    init: flipFlopInit,
    layout: () => box({ left: ['J', CLK, 'K'], top: [SET], bottom: [RESET], right: Q_OUTS }),
    evaluate(inst) {
      const [j, clk, k, s, r] = inst.ins
      const st = inst.state
      const edge = rising(st, clk)
      if (!asyncSR(st, s, r) && edge) {
        if (j === X || k === X) st.q = X
        else if (j && k) st.q = inv(st.q)
        else if (j) st.q = 1
        else if (k) st.q = 0
      }
      writeQ(inst, st.q)
    },
  },
  {
    type: 'tff',
    name: 'T flip-flop',
    category: 'sequential',
    description: 'Toggles Q on the rising clock edge while T=1.',
    title: () => 'T',
    init: flipFlopInit,
    layout: () => box({ left: [{ name: 'T', def: 1 }, CLK], top: [SET], bottom: [RESET], right: Q_OUTS }),
    evaluate(inst) {
      const [t, clk, s, r] = inst.ins
      const st = inst.state
      const edge = rising(st, clk)
      if (!asyncSR(st, s, r) && edge) {
        if (t === X) st.q = X
        else if (t) st.q = inv(st.q)
      }
      writeQ(inst, st.q)
    },
  },
  {
    type: 'counter',
    name: 'Counter',
    category: 'sequential',
    description:
      '4-bit synchronous counter (A = least significant bit). Counts on rising CLK while EN=1, ' +
      'up when U/D=1, down when U/D=0. R resets to 0. CO is high at the last count while EN=1, ' +
      'so chaining CO into the next counter\'s EN builds multi-digit counters.',
    params: [
      {
        key: 'mod',
        label: 'Counts',
        kind: 'select',
        default: 10,
        options: Array.from({ length: 15 }, (_, i) => {
          const m = i + 2
          const note = m === 10 ? ' (decade / BCD)' : m === 16 ? ' (binary)' : ''
          return { value: m, label: `0–${m - 1}${note}` }
        }),
      },
    ],
    title: (p) => {
      const m = Number(p.mod)
      return m === 10 ? 'BCD\nCNTR' : m === 16 ? 'CNTR' : `CNTR\n0–${m - 1}`
    },
    init: () => ({ n: 0, pc: X as V }),
    layout: () =>
      box({
        left: [CLK, { name: 'EN', def: 1 }, { name: 'UD', label: 'U/D', def: 1 }],
        bottom: [RESET],
        right: ['A', 'B', 'C', 'D', 'CO'],
      }),
    evaluate(inst) {
      const [clk, en, ud, r] = inst.ins
      const st = inst.state
      const mod = Number(inst.params.mod)
      const edge = rising(st, clk)
      if (r === 1) st.n = 0
      else if (edge && en === 1 && ud !== X) st.n = ud ? (st.n + 1) % mod : (st.n + mod - 1) % mod
      st.n %= mod
      writeNum(inst.outs, 0, 4, st.n)
      inst.outs[4] = en === X || ud === X ? X : st.n === (ud ? mod - 1 : 0) && en === 1 ? 1 : 0
    },
  },
  {
    type: 'counterld',
    name: 'Counter with load',
    category: 'sequential',
    description:
      '4-bit binary counter with parallel load (like a 74161), counting 0–15. On a rising CLK: LD=1 loads D0–D3, ' +
      'otherwise it counts up while EN=1. R resets it to 0 at once. CO is high at 15 while EN=1. ' +
      'A program counter: load a jump target, or just count.',
    title: () => 'CNTR\nLOAD',
    init: () => ({ n: 0, pc: X as V }),
    layout: () =>
      box({
        left: [...names('D', 4), { name: 'LD', def: 0 }, { name: 'EN', def: 1 }, CLK],
        bottom: [RESET],
        right: [...names('Q', 4), 'CO'],
      }),
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state
      const [ld, en, clk, r] = ins.slice(4)
      const edge = rising(st, clk)
      if (r === 1) st.n = 0
      else if (edge) {
        if (ld === 1) {
          const d = toNum(ins, 0, 4)
          if (d >= 0) st.n = d
        } else if (ld === 0 && en === 1) st.n = (st.n + 1) & 15
      }
      writeNum(outs, 0, 4, st.n)
      outs[4] = en === X ? X : st.n === 15 && en === 1 ? 1 : 0
    },
  },
  {
    type: 'register',
    name: '4-bit register',
    category: 'sequential',
    description: 'Loads inputs A–D on the rising clock edge while LD=1. CLR clears it to 0.',
    title: () => 'REG',
    init: () => ({ n: 0, pc: X as V }),
    layout: () =>
      box({
        left: ['A', 'B', 'C', 'D', { name: 'LD', def: 1 }, CLK],
        bottom: [{ name: 'CLR', def: 0 }],
        right: ['QA', 'QB', 'QC', 'QD'],
      }),
    evaluate(inst) {
      const ins = inst.ins
      const st = inst.state
      const edge = rising(st, ins[5])
      if (ins[6] === 1) st.n = 0
      else if (edge && ins[4] === 1) st.n = toNum(ins, 0, 4)
      writeNum(inst.outs, 0, 4, st.n)
    },
  },
  {
    type: 'shiftreg',
    name: 'Shift register',
    category: 'sequential',
    description:
      '4-bit shift register. On each rising edge it shifts SI into QA (QA→QB→QC→QD), ' +
      'or loads A–D in parallel when LD=1. Works as serial-in/parallel-out or parallel-in/serial-out (QD).',
    title: () => 'SHIFT\nREG',
    init: () => ({ bits: [0, 0, 0, 0] as V[], pc: X as V }),
    layout: () =>
      box({
        left: [{ name: 'SI', def: 0 }, 'A', 'B', 'C', 'D', { name: 'LD', def: 0 }, CLK],
        bottom: [{ name: 'CLR', def: 0 }],
        right: ['QA', 'QB', 'QC', 'QD'],
      }),
    evaluate(inst) {
      const ins = inst.ins
      const st = inst.state as { bits: V[]; pc: V }
      const edge = rising(st, ins[6])
      if (ins[7] === 1) st.bits = [0, 0, 0, 0]
      else if (edge) {
        if (ins[5] === 1) st.bits = [ins[1], ins[2], ins[3], ins[4]]
        else if (ins[5] === 0) st.bits = [ins[0], st.bits[0], st.bits[1], st.bits[2]]
      }
      for (let i = 0; i < 4; i++) inst.outs[i] = st.bits[i]
    },
  },
  {
    type: 'ringcounter',
    name: 'Ring counter',
    category: 'sequential',
    description:
      'Ring counter circulates a single 1 (1000→0100→…); Johnson counter fills with 1s then 0s ' +
      '(0000→1000→1100→…). R resets it.',
    params: [
      {
        key: 'kind',
        label: 'Type',
        kind: 'select',
        default: 'ring',
        options: [
          { value: 'ring', label: 'Ring' },
          { value: 'johnson', label: 'Johnson' },
        ],
      },
    ],
    title: (p) => (p.kind === 'johnson' ? 'JOHN\nSON' : 'RING'),
    init: (p) => ({ bits: resetBits(String(p.kind)), pc: X as V }),
    layout: () => box({ left: [CLK], bottom: [RESET], right: ['Q0', 'Q1', 'Q2', 'Q3'] }),
    evaluate(inst) {
      const [clk, r] = inst.ins
      const st = inst.state as { bits: V[]; pc: V }
      const edge = rising(st, clk)
      if (r === 1) st.bits = resetBits(String(inst.params.kind))
      else if (edge) {
        const last = st.bits[3]
        st.bits = [inst.params.kind === 'johnson' ? inv(last) : last, st.bits[0], st.bits[1], st.bits[2]]
      }
      for (let i = 0; i < 4; i++) inst.outs[i] = st.bits[i]
    },
  },
]

function resetBits(kind: string): V[] {
  return kind === 'johnson' ? [0, 0, 0, 0] : [1, 0, 0, 0]
}


/** Address bits of a RAM (an older saved part has no such parameter: 4). */
export const ramBits = (p: Params) => Number(p.abits) || 4

export const memoryRam: ComponentDef[] = [
  {
    type: 'ram',
    name: 'RAM',
    category: 'memory',
    description:
      'Read/write memory of 4 or 8 bit words (16 words, or up to 256 with more address bits). The word addressed by ' +
      'A is always on Q. On a rising CLK ' +
      'with WE=1 the data inputs D are written to that address (not when the address or data is unknown). ' +
      'Contents are cleared by Reset. While the simulation is paused you can edit the words in the inspector.',
    params: [
      {
        key: 'dbits',
        label: 'Data bits',
        kind: 'select',
        default: 4,
        structural: true,
        options: [4, 8].map((v) => ({ value: v, label: `${v} (${v / 4} hex digit${v > 4 ? 's' : ''})` })),
      },
      {
        key: 'abits',
        label: 'Address bits',
        kind: 'select',
        default: 4,
        structural: true,
        options: [4, 5, 6, 7, 8].map((v) => ({ value: v, label: `${v} (${2 ** v} words)` })),
      },
    ],
    title: (p) => `RAM ${2 ** ramBits(p)}×${p.dbits}`,
    live: true,
    init: (p) => ({ mem: new Array<number>(2 ** ramBits(p)).fill(0), pc: X as V }),
    memory: {
      size: (inst) => (inst.state as { mem: number[] }).mem.length,
      read: (inst, i) => (inst.state as { mem: number[] }).mem[i],
      write: (inst, i, value) => {
        ;(inst.state as { mem: number[] }).mem[i] = value & (2 ** Number(inst.params.dbits) - 1)
      },
    },
    layout: (p) => {
      const n = Number(p.dbits)
      const a = ramBits(p)
      const { w, minRows } = tableBox(2 ** a, n / 4)
      return box({
        w,
        minRows,
        left: [...names('D', n), { name: 'WE', def: 0 }, CLK],
        top: names('A', a),
        right: names('Q', n),
      })
    },
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state as { mem: number[]; pc: V }
      // The words kept from before the address size was changed are cut or padded with zeros.
      const words = 2 ** ramBits(inst.params)
      if (st.mem.length !== words) st.mem = Array.from({ length: words }, (_, i) => st.mem[i] ?? 0)
      // Pin order: left D0…, WE, CLK, then top A0–A3.
      const n = Number(inst.params.dbits)
      const addr = toNum(ins, n + 2, ramBits(inst.params))
      if (rising(st, ins[n + 1]) && ins[n] === 1) {
        const data = toNum(ins, 0, n)
        if (addr >= 0 && data >= 0) st.mem[addr] = data
      }
      if (addr < 0) outs.fill(X)
      else writeNum(outs, 0, n, st.mem[addr])
    },
  },
]
