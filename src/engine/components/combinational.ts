import { box, names } from '../layouts'
import { X, toNum, type ComponentDef, type Params, type V } from '../types'
import { SEG_HEX } from './io'

/**
 * Wraps a pure boolean function. If any input is X every output is X,
 * otherwise `fn` gets plain 0/1 inputs and returns 0/1 (or boolean) outputs.
 */
function comb(fn: (ins: number[], p: Params) => (number | boolean)[]): ComponentDef['evaluate'] {
  return (inst) => {
    if (inst.ins.includes(X)) {
      inst.outs.fill(X)
      return
    }
    const r = fn(inst.ins, inst.params)
    for (let i = 0; i < inst.outs.length; i++) inst.outs[i] = (r[i] ? 1 : 0) as V
  }
}

const bitsOf = (n: number, count: number) => Array.from({ length: count }, (_, i) => (n >> i) & 1)
const num = (ins: number[], start: number, n: number) => toNum(ins as V[], start, n)
const AB = [...names('A', 4), ...names('B', 4)]

export const arithmetic: ComponentDef[] = [
  {
    type: 'halfadd',
    name: 'Half adder',
    category: 'arithmetic',
    description: 'Adds two bits: S = A xor B, C = A and B.',
    title: () => 'HA',
    layout: () => box({ left: ['A', 'B'], right: ['S', 'C'] }),
    evaluate: comb(([a, b]) => [a ^ b, a & b]),
  },
  {
    type: 'fulladd',
    name: 'Full adder',
    category: 'arithmetic',
    description: 'Adds A + B + carry-in, giving sum S and carry-out.',
    title: () => 'FA',
    layout: () => box({ left: ['A', 'B', { name: 'Ci', def: 0 }], right: ['S', 'Co'] }),
    evaluate: comb(([a, b, c]) => bitsOf(a + b + c, 2)),
  },
  {
    type: 'add4',
    name: '4-bit adder',
    category: 'arithmetic',
    description: 'Adds two 4-bit numbers A and B (bit 0 = least significant) plus carry-in.',
    title: () => 'Σ\n4-bit',
    layout: () => box({ left: [...AB, { name: 'Ci', def: 0 }], right: [...names('S', 4), 'Co'] }),
    evaluate: comb((ins) => bitsOf(num(ins, 0, 4) + num(ins, 4, 4) + ins[8], 5)),
  },
  {
    type: 'halfsub',
    name: 'Half subtractor',
    category: 'arithmetic',
    description: 'Computes A − B: difference D = A xor B, borrow Bo = (not A) and B.',
    title: () => 'HS',
    layout: () => box({ left: ['A', 'B'], right: ['D', 'Bo'] }),
    evaluate: comb(([a, b]) => [a ^ b, !a && b]),
  },
  {
    type: 'fullsub',
    name: 'Full subtractor',
    category: 'arithmetic',
    description: 'Computes A − B − borrow-in, giving difference D and borrow-out.',
    title: () => 'FS',
    layout: () => box({ left: ['A', 'B', { name: 'Bi', def: 0 }], right: ['D', 'Bo'] }),
    evaluate: comb(([a, b, bi]) => {
      const d = a - b - bi
      return [d & 1, d < 0]
    }),
  },
  {
    type: 'sub4',
    name: '4-bit subtractor',
    category: 'arithmetic',
    description: 'Computes A − B − borrow-in on 4-bit numbers. Bo=1 means the result went below zero.',
    title: () => '−\n4-bit',
    layout: () => box({ left: [...AB, { name: 'Bi', def: 0 }], right: [...names('D', 4), 'Bo'] }),
    evaluate: comb((ins) => {
      const d = num(ins, 0, 4) - num(ins, 4, 4) - ins[8]
      return [...bitsOf(d & 15, 4), d < 0]
    }),
  },
  {
    type: 'addsub4',
    name: 'Adder/subtractor',
    category: 'arithmetic',
    description:
      'M=0: S = A + B. M=1: S = A − B (two’s complement). Co is the carry out, V signals signed overflow.',
    title: () => '±\n4-bit',
    layout: () => box({ left: [...AB, { name: 'M', def: 0 }], right: [...names('S', 4), 'Co', 'V'] }),
    evaluate: comb((ins) => {
      const a = num(ins, 0, 4)
      const m = ins[8]
      const b = m ? ~num(ins, 4, 4) & 15 : num(ins, 4, 4)
      const r = a + b + m
      const signed = (n: number) => (n & 8 ? n - 16 : n)
      const exact = m ? signed(a) - signed(num(ins, 4, 4)) : signed(a) + signed(b)
      return [...bitsOf(r, 5), exact < -8 || exact > 7]
    }),
  },
  {
    type: 'cmp4',
    name: 'Comparator',
    category: 'arithmetic',
    description: 'Compares two 4-bit numbers A and B.',
    title: () => 'COMP',
    layout: () => box({ left: AB, right: [{ name: 'GT', label: 'A>B' }, { name: 'EQ', label: 'A=B' }, { name: 'LT', label: 'A<B' }] }),
    evaluate: comb((ins) => {
      const a = num(ins, 0, 4)
      const b = num(ins, 4, 4)
      return [a > b, a === b, a < b]
    }),
  },
]

const sizeParam = (label: string, values: number[], def: number) => ({
  key: 'n',
  label,
  kind: 'select' as const,
  default: def,
  structural: true,
  options: values.map((v) => ({ value: v, label: String(v) })),
})

const log2 = (n: number) => Math.round(Math.log2(n))

export const routing: ComponentDef[] = [
  {
    type: 'mux',
    name: 'Multiplexer',
    category: 'routing',
    description: 'Selects one of the inputs I0..In and passes it to Y. Select lines S pick which one.',
    params: [sizeParam('Inputs', [2, 4, 8], 4)],
    title: (p) => `MUX\n${p.n}:1`,
    layout: (p) => {
      const n = Number(p.n)
      return box({ w: 100, left: names('I', n), bottom: names('S', log2(n)).reverse(), right: ['Y'], minRows: n + 1 })
    },
    evaluate(inst) {
      const n = Number(inst.params.n)
      const s = selectIndex(inst.ins, n, log2(n))
      inst.outs[0] = s < 0 ? X : inst.ins[s]
    },
  },
  {
    type: 'demux',
    name: 'Demultiplexer',
    category: 'routing',
    description: 'Sends input I to the output chosen by the select lines; the other outputs are 0.',
    params: [sizeParam('Outputs', [2, 4, 8], 4)],
    title: (p) => `DEMUX\n1:${p.n}`,
    layout: (p) => {
      const n = Number(p.n)
      return box({ w: 100, left: ['I'], bottom: names('S', log2(n)).reverse(), right: names('Y', n), minRows: n + 1 })
    },
    evaluate(inst) {
      const n = Number(inst.params.n)
      const s = selectIndex(inst.ins, 1, log2(n))
      for (let i = 0; i < n; i++) inst.outs[i] = s < 0 ? X : i === s ? inst.ins[0] : 0
    },
  },
]

/** Select lines are laid out MSB first (S1 S0) after `offset` data inputs; returns the index or -1 on X. */
function selectIndex(ins: V[], offset: number, k: number): number {
  let s = 0
  for (let i = 0; i < k; i++) {
    const v = ins[offset + k - 1 - i]
    if (v === X) return -1
    s |= v << i
  }
  return s
}

export const coding: ComponentDef[] = [
  {
    type: 'decoder',
    name: 'Decoder',
    category: 'coding',
    description: 'Binary decoder: raises the one output Yn whose number is on inputs A (A0 = LSB), while EN=1.',
    params: [sizeParam('Input bits', [2, 3, 4], 2)],
    title: (p) => `DEC\n${p.n}:${1 << Number(p.n)}`,
    layout: (p) => {
      const k = Number(p.n)
      return box({ left: names('A', k), bottom: [{ name: 'EN', def: 1 }], right: names('Y', 1 << k) })
    },
    evaluate: comb((ins, p) => {
      const k = Number(p.n)
      const a = num(ins, 0, k)
      return Array.from({ length: 1 << k }, (_, i) => ins[k] === 1 && i === a)
    }),
  },
  {
    type: 'encoder',
    name: 'Priority encoder',
    category: 'coding',
    description: 'Outputs the number of the highest input that is 1. V=1 when any input is active.',
    params: [sizeParam('Inputs', [4, 8], 4)],
    title: (p) => `ENC\n${p.n}:${log2(Number(p.n))}`,
    layout: (p) => {
      const n = Number(p.n)
      return box({ left: names('I', n), right: [...names('A', log2(n)), 'V'] })
    },
    evaluate: comb((ins, p) => {
      const n = Number(p.n)
      const hi = ins.lastIndexOf(1)
      return [...bitsOf(Math.max(hi, 0), log2(n)), hi >= 0]
    }),
  },
  {
    type: 'bcd7',
    name: 'BCD → 7-segment',
    category: 'coding',
    description:
      'Drives a 7-segment display from a 4-bit number (A = LSB). In BCD mode values above 9 are blank; ' +
      'hex mode shows A–F.',
    params: [
      {
        key: 'mode',
        label: 'Mode',
        kind: 'select',
        default: 'bcd',
        options: [
          { value: 'bcd', label: 'BCD (0–9)' },
          { value: 'hex', label: 'Hex (0–F)' },
        ],
      },
    ],
    title: (p) => (p.mode === 'hex' ? 'HEX\nto\n7seg' : 'BCD\nto\n7seg'),
    layout: () => box({ left: ['A', 'B', 'C', 'D'], right: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    evaluate: comb((ins, p) => {
      const n = num(ins, 0, 4)
      return bitsOf(p.mode === 'hex' || n < 10 ? SEG_HEX[n] : 0, 7)
    }),
  },
  {
    type: 'bcddec',
    name: 'BCD → decimal',
    category: 'coding',
    description: 'Raises the output 0–9 matching the BCD input (A = LSB). Invalid codes raise nothing.',
    title: () => 'BCD\nto\nDEC',
    layout: () => box({ left: ['A', 'B', 'C', 'D'], right: names('Y', 10) }),
    evaluate: comb((ins) => {
      const n = num(ins, 0, 4)
      return Array.from({ length: 10 }, (_, i) => i === n)
    }),
  },
  {
    type: 'bin2bcd',
    name: 'Binary → BCD',
    category: 'coding',
    description: 'Converts a 4-bit binary number (0–15) into two BCD digits: ones O0–O3 and tens T0.',
    title: () => 'BIN\nto\nBCD',
    layout: () => box({ left: names('B', 4), right: [...names('O', 4), 'T0'] }),
    evaluate: comb((ins) => {
      const n = num(ins, 0, 4)
      return [...bitsOf(n % 10, 4), n >= 10]
    }),
  },
  {
    type: 'gray',
    name: 'Gray code converter',
    category: 'coding',
    description: 'Converts 4-bit binary to Gray code, or back.',
    params: [
      {
        key: 'dir',
        label: 'Direction',
        kind: 'select',
        default: 'b2g',
        structural: true,
        options: [
          { value: 'b2g', label: 'Binary → Gray' },
          { value: 'g2b', label: 'Gray → binary' },
        ],
      },
    ],
    title: (p) => (p.dir === 'g2b' ? 'GRAY\nto\nBIN' : 'BIN\nto\nGRAY'),
    layout: (p) =>
      p.dir === 'g2b'
        ? box({ left: names('G', 4), right: names('B', 4) })
        : box({ left: names('B', 4), right: names('G', 4) }),
    evaluate: comb((ins, p) => {
      let n = num(ins, 0, 4)
      if (p.dir === 'g2b') {
        for (let s = n >> 1; s; s >>= 1) n ^= s
        return bitsOf(n, 4)
      }
      return bitsOf(n ^ (n >> 1), 4)
    }),
  },
  {
    type: 'parity',
    name: 'Parity',
    category: 'coding',
    description: 'Parity generator/checker. ODD=1 when an odd number of inputs are 1, EVEN is its inverse.',
    params: [sizeParam('Inputs', [4, 8], 4)],
    title: () => 'PAR',
    layout: (p) => box({ left: names('I', Number(p.n)), right: ['ODD', 'EVEN'] }),
    evaluate: comb((ins) => {
      const odd = ins.reduce((a, b) => a ^ b, 0)
      return [odd, !odd]
    }),
  },
]
