import { box, names } from '../layouts'
import { X, toNum, writeNum, type ComponentDef, type Params, type V } from '../types'
import { SEG_HEX } from './io'
import { ISAS } from '../isa'
import { pinLabels } from '../pinlabels'
import { HEX_WORDS, parseWords, tableBox } from './memory'

/**
 * Wraps a pure boolean function. If any input is X every output is X,
 * otherwise `fn` gets plain 0/1 inputs and returns 0/1 (or boolean) outputs.
 */
export function comb(fn: (ins: number[], p: Params) => (number | boolean)[]): ComponentDef['evaluate'] {
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

/** Operations of the 4-bit ALU, indexed by the select code S2 S1 S0. */
export const ALU_OPS = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT A', 'A+1', 'A−1']

export const arithmetic: ComponentDef[] = [
  {
    type: 'halfadd',
    name: 'Half adder',
    category: 'arithmetic',
    description: 'Adds two bits: S = A xor B, C = A and B.',
    pins: {
      A: 'First bit to add.',
      B: 'Second bit to add.',
      S: 'Sum bit: 1 when exactly one of A and B is 1 (A xor B).',
      C: 'Carry out: 1 when both A and B are 1.',
    },
    title: () => 'HA',
    layout: () => box({ left: ['A', 'B'], right: ['S', 'C'] }),
    evaluate: comb(([a, b]) => [a ^ b, a & b]),
  },
  {
    type: 'fulladd',
    name: 'Full adder',
    category: 'arithmetic',
    description: 'Adds A + B + carry-in, giving sum S and carry-out.',
    pins: {
      A: 'First bit to add.',
      B: 'Second bit to add.',
      Ci: 'Carry in from the stage below. Reads 0 when unconnected.',
      S: 'Sum bit of A + B + Ci (the lowest bit of the total).',
      Co: 'Carry out: 1 when A + B + Ci is 2 or 3. Wire it to the next stage’s Ci.',
    },
    title: () => 'FA',
    layout: () => box({ left: ['A', 'B', { name: 'Ci', def: 0 }], right: ['S', 'Co'] }),
    evaluate: comb(([a, b, c]) => bitsOf(a + b + c, 2)),
  },
  {
    type: 'add4',
    name: '4-bit adder',
    category: 'arithmetic',
    description: 'Adds two 4-bit numbers A and B (bit 0 = least significant) plus carry-in.',
    pins: {
      "A#|A": 'First number, 4 bits. A0 is the least significant bit. The bus pin A carries all four.',
      "B#|B": 'Second number, 4 bits. B0 is the least significant bit.',
      Ci: 'Carry in, added to A + B. Reads 0 when unconnected; chain from the Co of a lower adder.',
      "S#|S": 'Sum A + B + Ci, 4 bits (S0 least significant), cut to 4 bits.',
      Co: 'Carry out: 1 when the sum went over 15.',
    },
    title: () => 'Σ\n4-bit',
    layout: () => box({ left: [...AB, { name: 'Ci', def: 0 }], right: [...names('S', 4), 'Co'] }),
    evaluate: comb((ins) => bitsOf(num(ins, 0, 4) + num(ins, 4, 4) + ins[8], 5)),
  },
  {
    type: 'halfsub',
    name: 'Half subtractor',
    category: 'arithmetic',
    description: 'Computes A − B: difference D = A xor B, borrow Bo = (not A) and B.',
    pins: {
      A: 'Bit to subtract from.',
      B: 'Bit to subtract.',
      D: 'Difference bit: 1 when A and B differ (A xor B).',
      Bo: 'Borrow out: 1 when A is 0 and B is 1, so the result went below zero.',
    },
    title: () => 'HS',
    layout: () => box({ left: ['A', 'B'], right: ['D', 'Bo'] }),
    evaluate: comb(([a, b]) => [a ^ b, !a && b]),
  },
  {
    type: 'fullsub',
    name: 'Full subtractor',
    category: 'arithmetic',
    description: 'Computes A − B − borrow-in, giving difference D and borrow-out.',
    pins: {
      A: 'Bit to subtract from.',
      B: 'Bit to subtract.',
      Bi: 'Borrow in from the stage below. Reads 0 when unconnected.',
      D: 'Difference bit of A − B − Bi.',
      Bo: 'Borrow out: 1 when A − B − Bi is below 0. Wire it to the next stage’s Bi.',
    },
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
    pins: {
      "A#|A": 'Number to subtract from, 4 bits (A0 least significant).',
      "B#|B": 'Number to subtract, 4 bits (B0 least significant).',
      Bi: 'Borrow in, subtracted as well. Reads 0 when unconnected.',
      "D#|D": 'Difference A − B − Bi, 4 bits (D0 least significant); wraps round when negative.',
      Bo: 'Borrow out: 1 when the result went below 0 (B + Bi is larger than A).',
    },
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
    description: 'M=0: S = A + B. M=1: S = A − B (two’s complement). Co is the carry out; V is 1 when the signed result does not fit in 4 bits.',
    pins: {
      "A#|A": 'First number, 4 bits (A0 least significant).',
      "B#|B": 'Second number, 4 bits (B0 least significant).',
      M: 'Mode. 0 adds (A + B), 1 subtracts (A − B, in two’s complement). Reads 0 when unconnected.',
      "S#|S": 'Result, 4 bits (S0 least significant).',
      Co: 'Carry out of the adder. When subtracting, 1 means no borrow (A ≥ B unsigned).',
      V: 'Signed overflow: 1 when the true result does not fit in 4-bit two’s complement (−8 to 7).',
    },
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
    description: 'Compares two 4-bit numbers A and B. Exactly one of the outputs A>B, A=B, A<B is 1.',
    pins: {
      "A#|A": 'First number, 4 bits (A0 least significant).',
      "B#|B": 'Second number, 4 bits (B0 least significant).',
      GT: '1 when A is greater than B.',
      EQ: '1 when A equals B.',
      LT: '1 when A is less than B.',
    },
    title: () => 'COMP',
    layout: () => box({ left: AB, right: [{ name: 'GT', label: 'A>B' }, { name: 'EQ', label: 'A=B' }, { name: 'LT', label: 'A<B' }] }),
    evaluate: comb((ins) => {
      const a = num(ins, 0, 4)
      const b = num(ins, 4, 4)
      return [a > b, a === b, a < b]
    }),
  },
  {
    type: 'alu',
    name: 'ALU',
    category: 'arithmetic',
    description:
      '4-bit arithmetic logic unit. Select lines S2 S1 S0 pick the operation on A and B: ' +
      '0 ADD, 1 SUB, 2 AND, 3 OR, 4 XOR, 5 NOT A, 6 A+1, 7 A−1. Co is the carry (ADD, A+1) or borrow ' +
      '(SUB, A−1) out, Z is 1 when the result F is zero. B is ignored by NOT A, A+1 and A−1.',
    pins: {
      "A#|A": 'First operand, 4 bits (A0 least significant).',
      "B#|B": 'Second operand, 4 bits. Not used by NOT A, A+1 and A−1.',
      "S#|S": 'Operation select. S2 is the most significant bit: 000 ADD, 001 SUB, 010 AND, 011 OR, 100 XOR, 101 NOT A, 110 A+1, 111 A−1. Reads 0 when unconnected.',
      "F#|F": 'Result, 4 bits (F0 least significant).',
      Co: 'Carry out for ADD and A+1 (result went over 15); borrow out for SUB and A−1 (result went below 0). 0 for the logic operations.',
      Z: 'Zero flag: 1 when the result F is 0.',
    },
    title: () => 'ALU',
    live: true,
    layout: () =>
      box({
        left: AB,
        bottom: [
          { name: 'S2', def: 0 },
          { name: 'S1', def: 0 },
          { name: 'S0', def: 0 },
        ],
        right: [...names('F', 4), 'Co', 'Z'],
      }),
    evaluate(inst) {
      const { ins, outs } = inst
      const a = num(ins, 0, 4)
      const b = num(ins, 4, 4)
      const op = num(ins, 8, 3)
      // S2 is the most significant select bit: it sits first on the bottom row.
      const code = op < 0 ? -1 : ((op & 1) << 2) | (op & 2) | (op >> 2)
      if (code < 0 || a < 0 || (code < 5 && b < 0)) {
        outs.fill(X)
        return
      }
      let r = 0
      let co = 0
      switch (code) {
        case 0:
          r = a + b
          co = r > 15 ? 1 : 0
          break
        case 1:
          r = a - b
          co = r < 0 ? 1 : 0
          break
        case 2:
          r = a & b
          break
        case 3:
          r = a | b
          break
        case 4:
          r = a ^ b
          break
        case 5:
          r = ~a
          break
        case 6:
          r = a + 1
          co = r > 15 ? 1 : 0
          break
        case 7:
          r = a - 1
          co = r < 0 ? 1 : 0
          break
      }
      r &= 15
      writeNum(outs, 0, 4, r)
      outs[4] = co as V
      outs[5] = r === 0 ? 1 : 0
    },
  },
  {
    type: 'mul',
    name: 'Multiplier',
    category: 'arithmetic',
    description: 'Multiplies A by B (bit 0 = least significant). 2×2 gives a 4-bit product, 4×4 an 8-bit one.',
    params: [sizeParam('Size', [2, 4], 4, (v) => `${v}×${v} bits`)],
    pins: {
      "A#": 'First factor (A0 least significant bit).',
      "B#": 'Second factor (B0 least significant bit).',
      "P#": 'Product A × B (P0 least significant bit). Twice as many bits as one factor, so it never overflows.',
    },
    title: (p) => `×\n${p.n}×${p.n}`,
    layout: (p) => {
      const n = Number(p.n)
      return box({ left: [...names('A', n), ...names('B', n)], right: names('P', 2 * n) })
    },
    evaluate: comb((ins, p) => {
      const n = Number(p.n)
      return bitsOf(num(ins, 0, n) * num(ins, n, n), 2 * n)
    }),
  },
  {
    type: 'bcdadd',
    name: 'BCD adder',
    category: 'arithmetic',
    description:
      'Adds two BCD digits A and B plus carry-in, giving a BCD digit S and a carry-out Co (adds 6 when the sum ' +
      'goes past 9). Inputs above 9 are not valid BCD.',
    pins: {
      "A#|A": 'First BCD digit, 4 bits (A0 least significant). Should be 0–9.',
      "B#|B": 'Second BCD digit, 4 bits. Should be 0–9.',
      Ci: 'Carry in from the digit below. Reads 0 when unconnected.',
      "S#|S": 'Sum digit, 4 bits, as BCD (0–9).',
      Co: 'Carry out: 1 when the sum went past 9. Wire it to the Ci of the next digit.',
    },
    title: () => 'BCD\nΣ',
    layout: () => box({ left: [...AB, { name: 'Ci', def: 0 }], right: [...names('S', 4), 'Co'] }),
    evaluate: comb((ins) => {
      let z = num(ins, 0, 4) + num(ins, 4, 4) + ins[8]
      if (z > 9) z += 6
      return [...bitsOf(z & 15, 4), z > 15]
    }),
  },
]

function sizeParam(label: string, values: number[], def: number, fmt: (v: number) => string = String) {
  return {
    key: 'n',
    label,
    kind: 'select' as const,
    default: def,
    structural: true,
    options: values.map((v) => ({ value: v, label: fmt(v) })),
  }
}

const log2 = (n: number) => Math.round(Math.log2(n))

export const routing: ComponentDef[] = [
  {
    type: 'mux',
    name: 'Multiplexer',
    category: 'routing',
    description: 'Selects one of the inputs I0..In and passes it to Y. Select lines S pick which one.',
    params: [sizeParam('Inputs', [2, 4, 8], 4)],
    pins: {
      "I#": 'Data input number n. The one picked by the select lines is passed to Y.',
      "S#|S": 'Select lines, as a binary number (S0 least significant): the value says which input I goes to Y. The number of lines depends on the Inputs setting.',
      Y: 'Output: a copy of the selected input. Unknown if the select lines are unknown.',
    },
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
    pins: {
      I: 'The signal to send on.',
      "S#|S": 'Select lines, as a binary number (S0 least significant): the value says which output Y receives I.',
      "Y#": 'Output number n: follows I when selected, 0 otherwise.',
    },
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
    pins: {
      "A#": 'Binary number to decode (A0 least significant bit).',
      EN: 'Enable. While 0 every output is 0. Reads 1 when unconnected.',
      "Y#": 'Output number n: 1 only when the number on A is n (and EN is 1); all others are 0.',
    },
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
    pins: {
      "I#": 'Request inputs. If several are 1, the highest-numbered one wins.',
      "A#": 'Number of the highest input that is 1, in binary (A0 least significant). 0 when no input is 1.',
      V: 'Valid: 1 when at least one input is 1. Tells “input 0” from “no input”.',
    },
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
    pins: {
      A: 'Digit bit 0 (least significant).',
      B: 'Digit bit 1.',
      C: 'Digit bit 2.',
      D: 'Digit bit 3 (most significant).',
      a: 'Segment a (top), lit for digits that use it.',
      b: 'Segment b (top right).',
      c: 'Segment c (bottom right).',
      d: 'Segment d (bottom).',
      e: 'Segment e (bottom left).',
      f: 'Segment f (top left).',
      g: 'Segment g (middle).',
    },
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
    pins: {
      A: 'Digit bit 0 (least significant).',
      B: 'Digit bit 1.',
      C: 'Digit bit 2.',
      D: 'Digit bit 3 (most significant).',
      "Y#": 'Output n is 1 when the input digit is n. Inputs above 9 raise none.',
    },
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
    pins: {
      "B#|B": 'Binary number 0–15 (B0 least significant).',
      "O#|O": 'Ones digit as BCD, 4 bits (O0 least significant).',
      T0: 'Tens digit: 1 when the input is 10 or more (the tens digit is 0 or 1).',
    },
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
    pins: {
      "B#": 'Binary number, 4 bits (B0 least significant). Input when converting to Gray, output when converting back.',
      "G#": 'Gray code, 4 bits (G0 least significant): neighbouring numbers differ in one bit. Output when converting to Gray, input when converting back.',
    },
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
    pins: {
      "I#": 'Bits to check.',
      ODD: '1 when an odd number of the inputs are 1.',
      EVEN: '1 when an even number (including none) of the inputs are 1. Always the opposite of ODD.',
    },
    title: () => 'PAR',
    layout: (p) => box({ left: names('I', Number(p.n)), right: ['ODD', 'EVEN'] }),
    evaluate: comb((ins) => {
      const odd = ins.reduce((a, b) => a ^ b, 0)
      return [odd, !odd]
    }),
  },
]

const selectParam = (key: string, label: string, values: number[], def: number, fmt: (v: number) => string) => ({
  key,
  label,
  kind: 'select' as const,
  default: def,
  structural: true,
  options: values.map((v) => ({ value: v, label: fmt(v) })),
})

/**
 * The words (and the table) of a ROM, parsed once for each set of params: a ROM is evaluated at every clock edge, and its text can
 * be kilobytes long. (The params of a part are replaced, never changed, when it is edited.)
 */
const parsed = new WeakMap<Params, { data: unknown; tdata: unknown; words: number[]; table: number[] }>()
function romWords(p: Params) {
  let r = parsed.get(p)
  if (!r || r.data !== p.data || r.tdata !== p.tdata) {
    r = {
      data: p.data,
      tdata: p.tdata,
      words: parseWords(String(p.data), 2 ** Number(p.abits), Number(p.dbits)),
      table: p.table === 'on' ? parseWords(String(p.tdata), 256, 8) : [],
    }
    parsed.set(p, r)
  }
  return r
}

export const memoryRom: ComponentDef[] = [
  {
    type: 'rom',
    name: 'ROM',
    category: 'memory',
    description:
      'Read-only memory. The address inputs A select a word, which appears on the data outputs D right away. ' +
      'Enter the contents as hexadecimal words separated by spaces, one per address; missing words are 0. ' +
      'For a program, pick an instruction set and write it as assembly instead.',
    params: [
      selectParam('abits', 'Address bits', [2, 3, 4, 5, 6, 7, 8], 4, (v) => `${v} (${2 ** v} words)`),
      selectParam('dbits', 'Data bits', [4, 8, 16], 4, (v) => `${v} (${v / 4} hex digit${v > 4 ? 's' : ''})`),
      {
        key: 'data',
        label: 'Contents (hex words)',
        kind: 'text',
        default: '0 1 2 3 4 5 6 7 8 9 A B C D E F',
        pattern: HEX_WORDS.source,
        maxLength: 1400,
        hint: 'Only hexadecimal digits (0–9, A–F), spaces and commas.',
      },
      {
        key: 'isa',
        label: 'Contents are',
        kind: 'select',
        default: 'none',
        options: [{ value: 'none', label: 'Hex words' }, ...ISAS.map((i) => ({ value: i.id, label: `A program in ${i.name}` }))],
      },
      // The assembly text of a program. `data` is always what the circuit runs; it is assembled from this.
      { key: 'source', label: 'Program', kind: 'text', default: '', maxLength: 9000 },
      {
        key: 'table',
        label: 'Table of 256 bytes',
        kind: 'select',
        default: 'off',
        structural: true,
        options: [
          { value: 'off', label: 'None' },
          { value: 'on', label: 'A second output: a byte for each of 256 addresses' },
        ],
      },
      // What a program's `.byte` lines hold, as hex bytes. Read through the extra pins TA (address) and TD (byte).
      {
        key: 'tdata',
        label: 'Table contents (hex bytes)',
        kind: 'text',
        default: '',
        pattern: HEX_WORDS.source,
        maxLength: 800,
        hint: 'Only hexadecimal digits (0–9, A–F), spaces and commas.',
      },
      // Names for a control ROM, for reading it (see `engine/signals.ts`): what each bit switches on, and what each address is.
      // Nothing in the simulation looks at them.
      { key: 'signals', label: 'Signals', kind: 'text', default: '', maxLength: 1600 },
      { key: 'rows', label: 'Row names', kind: 'text', default: '', maxLength: 1200 },
    ],
    pins: {
      "A#|A": 'Address: which word to read (A0 least significant bit).',
      "D#|D": 'Data: the word stored at the address, shown right away (D0 least significant bit). Unknown while the address is.',
      "TA#|TA": 'Table address (8 bits): which byte of the table to read.',
      "TD#|TD": 'Table data: the byte stored at the table address (8 bits).',
    },
    title: (p) => `ROM ${2 ** Number(p.abits)}×${p.dbits}`,
    live: true,
    layout: (p) => {
      const { w, minRows } = tableBox(2 ** Number(p.abits), Number(p.dbits) / 4)
      const table = p.table === 'on'
      // A control ROM shows what each output switches on (the pins keep their names, D0…, in wires and saved files).
      const labels = typeof p.signals === 'string' && p.signals.trim() ? pinLabels(p.signals, Number(p.dbits)) : []
      const outputs = names('D', Number(p.dbits)).map((name, i) => (labels[i] ? { name, label: labels[i] } : name))
      const longest = Math.max(0, ...outputs.map((o) => (typeof o === 'string' ? o : o.label!).length))
      return box({
        // Room for the longest output name, the address names and the title between.
        w: Math.max(w, Math.ceil((longest * 6 + 5 + 40 + 36) / 20) * 20),
        minRows,
        left: [...names('A', Number(p.abits)), ...(table ? names('TA', 8) : [])],
        right: [...outputs, ...(table ? names('TD', 8) : [])],
      })
    },
    evaluate(inst) {
      const abits = Number(inst.params.abits)
      const dbits = Number(inst.params.dbits)
      const { words, table } = romWords(inst.params)
      const addr = toNum(inst.ins, 0, abits)
      if (addr < 0) inst.outs.fill(X, 0, dbits)
      else writeNum(inst.outs, 0, dbits, words[addr])
      if (inst.params.table === 'on') {
        const t = toNum(inst.ins, abits, 8)
        if (t < 0) inst.outs.fill(X, dbits, dbits + 8)
        else writeNum(inst.outs, dbits, 8, table[t])
      }
    },
  },
]
