import { CircuitBuilder } from '../../builder'
import { comb, type CombChallenge } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId } from '../chips'
import type { Step } from '../types'
import { withChips } from './ch02'

/** Chapter 5: Adding numbers. Palette: NAND, switches, LEDs and the learner's kit; the rule is still NAND only. */

const PALETTE = ['nand', 'switch', 'led']

const bits = (name: string) => [3, 2, 1, 0].map((i) => `${name}${i}`)

/**
 * The goal of a 4-bit adder in the expression language: sum bit i is `a_i ⊕ b_i ⊕ carry_i`, and the carry out of bit i is
 * `a_i·b_i + (a_i ⊕ b_i)·carry_i`. `b` is what the second number's bit is (the plain input, or XORed with SUB), `cin` the carry in.
 */
function adderGoal(b: (i: number) => string, cin: string): string {
  const carry = (i: number): string => (i === 0 ? cin : `(A${i - 1}·${b(i - 1)} + (A${i - 1} ⊕ ${b(i - 1)})·${carry(i - 1)})`)
  return [...[3, 2, 1, 0].map((i) => `S${i} = (A${i} ⊕ ${b(i)}) ⊕ ${carry(i)}`), `Cout = ${carry(4)}`].join('\n')
}

/** HA: Sum is the XOR, Carry the AND. */
function halfAdderSolution(): Circuit {
  const { b, ins, outs } = withChips(['A', 'B'], ['Sum', 'Carry'], ['xor-from-kit', 'and-from-nand'])
  const sum = b.ic(chipId('xor-from-kit'), 200, -10)
  const carry = b.ic(chipId('and-from-nand'), 200, 90)
  b.wire(`${ins.A}.Q`, `${sum}.A`)
  b.wire(`${ins.B}.Q`, `${sum}.B`)
  b.wire(`${ins.A}.Q`, `${carry}.A`)
  b.wire(`${ins.B}.Q`, `${carry}.B`)
  b.wire(`${sum}.Y`, `${outs.Sum}.A`)
  b.wire(`${carry}.Y`, `${outs.Carry}.A`)
  return b.build()
}

/** FA: a half adder for A + B, a second for that sum + Cin, and an OR for the two carries. */
function fullAdderSolution(): Circuit {
  const { b, ins, outs } = withChips(['A', 'B', 'Cin'], ['Sum', 'Cout'], ['half-adder', 'or-from-nand'])
  const first = b.ic(chipId('half-adder'), 110, 0)
  const second = b.ic(chipId('half-adder'), 250, 90)
  const either = b.ic(chipId('or-from-nand'), 370, 150)
  b.wire(`${ins.A}.Q`, `${first}.A`)
  b.wire(`${ins.B}.Q`, `${first}.B`)
  b.wire(`${first}.Sum`, `${second}.A`)
  b.wire(`${ins.Cin}.Q`, `${second}.B`)
  b.wire(`${second}.Sum`, `${outs.Sum}.A`)
  b.wire(`${first}.Carry`, `${either}.A`)
  b.wire(`${second}.Carry`, `${either}.B`)
  b.wire(`${either}.Y`, `${outs.Cout}.A`)
  return b.build()
}

/** ADD4: four full adders in a row, each carry into the next. */
function adder4Solution(): Circuit {
  const { b, ins, outs } = withChips([...bits('A'), ...bits('B'), 'Cin'], [...bits('S'), 'Cout'], ['full-adder'])
  let carry = `${ins.Cin}.Q`
  for (const i of [0, 1, 2, 3]) {
    const fa = b.ic(chipId('full-adder'), 160 + i * 20, 640 - i * 160)
    b.wire(`${ins[`A${i}`]}.Q`, `${fa}.A`)
    b.wire(`${ins[`B${i}`]}.Q`, `${fa}.B`)
    b.wire(carry, `${fa}.Cin`)
    b.wire(`${fa}.Sum`, `${outs[`S${i}`]}.A`)
    carry = `${fa}.Cout`
  }
  b.wire(carry, `${outs.Cout}.A`)
  return b.build()
}

/** ADDSUB: B goes through an XOR with SUB on the way into the adder, and SUB is also the carry in. */
function addSubSolution(): Circuit {
  const { b, ins, outs } = withChips([...bits('A'), ...bits('B'), 'SUB'], [...bits('S'), 'Cout'], ['adder4', 'xor-from-kit'])
  const add = b.ic(chipId('adder4'), 330, 120)
  for (const i of [0, 1, 2, 3]) {
    const x = b.ic(chipId('xor-from-kit'), 150, 400 - i * 50)
    b.wire(`${ins[`B${i}`]}.Q`, `${x}.A`)
    b.wire(`${ins.SUB}.Q`, `${x}.B`)
    b.wire(`${x}.Y`, `${add}.B${i}`)
    b.wire(`${ins[`A${i}`]}.Q`, `${add}.A${i}`)
    b.wire(`${add}.S${i}`, `${outs[`S${i}`]}.A`)
  }
  b.wire(`${ins.SUB}.Q`, `${add}.Cin`)
  b.wire(`${add}.Cout`, `${outs.Cout}.A`)
  return b.build()
}

/** Two 4-bit inputs and four full adders with real delays: the carry takes its time. A is 15, B is 0; B to 1 makes 16. */
function rippleToPlay(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('hexin', 0, 0, { label: 'A', params: { value: 15 } })
  const bb = b.add('hexin', 0, 160, { label: 'B', params: { value: 0 } })
  const pins = ['A', 'B', 'C', 'D']
  const disp = b.add('hexdisp', 720, 20, { label: 'Sum' })
  let prev = ''
  pins.forEach((p, i) => {
    const f = b.add('fulladd', 200 + i * 130, 40, { label: `Bit ${i}` })
    b.c.comps[f].delay = 6
    b.wire(`${a}.${p}`, `${f}.A`)
    b.wire(`${bb}.${p}`, `${f}.B`)
    if (prev) b.wire(`${prev}.Co`, `${f}.Ci`)
    b.wire(`${f}.S`, `${disp}.${p}`)
    prev = f
  })
  b.wire(`${prev}.Co`, `${b.add('led', 720, 160, { label: 'Cout' })}.A`)
  return b.build()
}

const adder4Challenge: CombChallenge = comb({
  id: 'path-adder4',
  group: 'Learn: Adding',
  title: '4-bit adder',
  lesson: [],
  task: 'Make S3 to S0 the four bits of A + B + Cin, where A is A3 A2 A1 A0 and B is B3 B2 B1 B0, and Cout the carry out of the top bit.',
  hint: 'Four full adders in a row: the Cout of each one goes to the Cin of the next, from bit 0 (the right-most) upwards.',
  inputs: [...bits('A'), ...bits('B'), 'Cin'],
  outputs: [...bits('S'), 'Cout'],
  goal: adderGoal((i) => `B${i}`, 'Cin'),
  rules: { only: ['nand'] },
})

const addSubChallenge: CombChallenge = comb({
  id: 'path-addsub',
  group: 'Learn: Adding',
  title: '4-bit adder/subtractor',
  lesson: [],
  task: 'With SUB off, S is A + B. With SUB on, S is A − B (in two’s complement). Cout is the carry out of the top bit.',
  hint: 'A − B is A + (B with every bit flipped) + 1. An XOR with SUB flips a bit only when SUB is on, and SUB itself is the “+ 1”: send it into Cin.',
  inputs: [...bits('A'), ...bits('B'), 'SUB'],
  outputs: [...bits('S'), 'Cout'],
  goal: adderGoal((i) => `(B${i} ⊕ SUB)`, 'SUB'),
  rules: { only: ['nand'] },
})

export const CH05: Step[] = [
  {
    id: 'binary-add',
    chapter: 'adding',
    title: 'Adding in binary',
    kind: 'read',
    summary: 'Column by column, with a carry: the way you add on paper.',
    lesson: [
      { p: 'You add on paper one column at a time, from the right, and when a column comes to more than a digit can hold you write the rest and carry 1 to the next column. Binary is the same, only a column is full sooner: 1 + 1 is 2, which in binary is 10, so you write 0 and carry 1.' },
      {
        table: {
          head: ['', '8s', '4s', '2s', '1s'],
          rows: [
            ['carry', '0', '1', '1', '0'],
            ['0110', '0', '1', '1', '0'],
            ['+ 0011', '0', '0', '1', '1'],
            ['= 1001', '1', '0', '0', '1'],
          ],
        },
      },
      { p: 'Read it from the right. 0 + 1 = 1. In the 2s column 1 + 1 = 10: write 0, carry 1. In the 4s column there are three bits: the 1 of the first number, the 0 of the second and the carry: 1 + 0 + 1 = 10 again, write 0 and carry 1. In the 8s column only the carry is left. 6 + 3 = 9, and 1001 is 9.' },
      { p: 'So every column adds up to three bits, two numbers’ and a carry in, and makes two: a sum bit for this column and a carry out for the next. That one small circuit, repeated, adds numbers of any size. You build it in the next three steps.' },
      {
        quiz: [
          { q: 'What is 0110 + 0011?', options: ['1001', '1010', '0101'], answer: 0, why: '6 + 3 = 9, and 9 is 1001.' },
          { q: 'What is 1 + 1 in binary?', options: ['2', '10', '11'], answer: 1, why: 'Two is written 10: a 0 in this column and a 1 carried to the next.' },
          { q: 'A column holds 1, 1 and a carry of 1. What is written, and what is carried?', options: ['write 0, carry 1', 'write 1, carry 1', 'write 1, carry 0'], answer: 1, why: '1 + 1 + 1 = 3, which is 11: write 1 and carry 1.' },
        ],
      },
    ],
  },
  {
    id: 'half-adder',
    chapter: 'adding',
    title: 'Add two bits',
    kind: 'build',
    summary: 'A half adder: the Sum and the Carry of two bits.',
    palette: PALETTE,
    chip: 'HA',
    uses: ['xor-from-kit', 'and-from-nand'],
    challenge: 'half-adder',
    rules: { only: ['nand'] },
    solution: halfAdderSolution,
    lesson: [
      { p: 'Start with the first column, where there is no carry coming in: two bits, A and B. There are four cases, 0 + 0 = 00, 0 + 1 = 01, 1 + 0 = 01 and 1 + 1 = 10. Write each answer as two bits: the right bit is the Sum and the left one is the Carry.' },
      {
        table: {
          head: ['A', 'B', 'Carry', 'Sum'],
          rows: [
            ['0', '0', '0', '0'],
            ['0', '1', '0', '1'],
            ['1', '0', '0', '1'],
            ['1', '1', '1', '0'],
          ],
          highlight: [3],
        },
      },
      { p: 'Look at the columns. The Sum is 1 when A and B are different: that is the XOR you built. The Carry is 1 only when both are 1: that is an AND. Two gates make a half adder. It is “half” because it cannot take a carry in.' },
    ],
  },
  {
    id: 'full-adder',
    chapter: 'adding',
    title: 'Add with a carry in',
    kind: 'build',
    summary: 'A full adder, made of two of your half adders and an OR.',
    palette: PALETTE,
    chip: 'FA',
    uses: ['half-adder', 'or-from-nand'],
    challenge: 'full-adder',
    rules: { only: ['nand'] },
    solution: fullAdderSolution,
    lesson: [
      { p: 'Every column but the first has a third bit to add: the carry from the column on its right. A full adder adds three bits, A, B and Cin, and makes a Sum and a Carry out, Cout. The biggest answer is 1 + 1 + 1 = 11, so two bits are still enough.' },
      { p: 'You do not need new ideas. Add A and B with one half adder. Add its Sum and Cin with a second half adder: that is the Sum of the whole. Either half adder may have made a carry, so the Cout is 1 when the first carried or the second did. That is an OR. (Both can never carry at once, so an OR is all you need.)' },
    ],
  },
  {
    id: 'adder4',
    chapter: 'adding',
    title: 'A 4-bit adder',
    kind: 'build',
    summary: 'Four full adders in a row make a 4-bit adder.',
    palette: PALETTE,
    chip: 'ADD4',
    uses: ['full-adder'],
    challenge: adder4Challenge,
    solution: adder4Solution,
    lesson: [
      { p: 'Now chain them. The right-most full adder adds bit 0 of A and B, and its Cout goes into the Cin of the next one, which adds bit 1, and so on up to bit 3. The Cin of the first is the carry in of the whole sum, which you can leave off (at 0) or use to chain two 4-bit adders into an 8-bit one. The Cout of the last is the carry out: 1 when the answer is too big for four bits.' },
      { p: 'The check tries all 512 combinations of the nine inputs (2⁹), so passing means the adder is right for every sum. If it fails it shows the first row that is wrong; look at which bit is off and follow the carry to that column.' },
    ],
  },
  {
    id: 'ripple-tour',
    chapter: 'adding',
    title: 'The carry ripples',
    kind: 'explore',
    summary: 'Add 15 + 1 and watch the carry travel through the adders.',
    open: { build: rippleToPlay },
    palette: ['hexin', 'hexdisp', 'fulladd', 'led'],
    task: 'A is 15 and B is 0. Click B to make it 1, so that the sum is 16, which does not fit in four bits.',
    goals: [
      { led: 'Cout', is: 1, text: 'Cout is lit: the sum is too big for four bits' },
      { display: 'Sum', is: 0, text: 'Sum shows 0, the low four bits of 16' },
    ],
    ordered: true,
    lesson: [
      { p: 'These are four full adders in a row, like your 4-bit adder, only slowed down: each one takes a moment, so that you can see what a real chain does. [[A]] is 15, which is 1111, and [[B]] is 0, so the sum [[Sum]] shows 15.' },
      { p: 'Click B once. 15 + 1 is 16, or 10000: a 1 and four 0s. The carry starts in bit 0 and passes through every adder in turn, because each adder must wait for the carry of the one before it. That is why this design is called a ripple-carry adder, and why a long one is slow. The last carry comes out as [[Cout]].' },
      { p: 'Open Timing from the Tools menu, start the simulation and click B to see the sum bits flicker before they settle. There is a longer version in Examples, under Timing and glitches.' },
    ],
  },
  {
    id: 'negative',
    chapter: 'adding',
    title: 'Negative numbers',
    kind: 'read',
    summary: 'Two’s complement: −n is “flip the bits and add 1”.',
    lesson: [
      { p: 'How can an adder subtract? Four bits go round like a clock: 15 + 1 wraps to 0. So adding 15 is the same as subtracting 1, just as on a clock adding 11 hours is the same as going back one. If we agree that 1111 means −1, then 1110 is −2, 1101 is −3, and so on: half of the sixteen patterns are the negative numbers. The top bit tells which: 1 is negative. This is called two’s complement.' },
      { p: 'You do not have to count back to find a pattern. To make −n, flip every bit of n and add 1:' },
      {
        table: {
          head: ['Step', 'Bits', 'Value'],
          rows: [
            ['3', '0011', '3'],
            ['flip every bit', '1100', ''],
            ['add 1', '1101', '−3'],
          ],
        },
      },
      { p: 'Check it: 3 + (−3) should be 0. 0011 + 1101 = 10000, and four bits keep only 0000 (the carry out is dropped). To compute 5 − 3, add 5 and −3: 0101 + 1101 = 10010, which in four bits is 0010, or 2. The adder needed nothing new: only a way to flip B and to add 1. You build exactly that in the next step.' },
      {
        quiz: [
          { q: 'How is −3 written in four bits?', options: ['1101', '1011', '0011'], answer: 0, why: '3 is 0011; flipped it is 1100; adding 1 gives 1101.' },
          { q: 'What number is 1111 in four bits (two’s complement)?', options: ['15', '−1', '−7'], answer: 1, why: 'Flip to 0000, add 1 to get 0001: so 1111 is −1. Adding it to anything is the same as taking 1 away.' },
          { q: 'Which top bit means a number is negative?', options: ['0', '1'], answer: 1, why: 'The patterns from 1000 to 1111 are the negative numbers, −8 to −1.' },
        ],
      },
    ],
  },
  {
    id: 'addsub',
    chapter: 'adding',
    title: 'Add or subtract',
    kind: 'build',
    summary: 'Your 4-bit adder and four XORs: adds, or subtracts when SUB is on.',
    palette: PALETTE,
    chip: 'ADDSUB',
    uses: ['adder4', 'xor-from-kit'],
    challenge: addSubChallenge,
    solution: addSubSolution,
    lesson: [
      { p: 'A − B is A + (−B), and −B is B with its bits flipped, plus 1. So a subtractor is your adder with two additions. An XOR with a SUB switch flips a bit when SUB is 1 and leaves it alone when SUB is 0: put one on each bit of B. And the “plus 1” is the carry in: send SUB there too.' },
      { p: 'With SUB at 0 nothing changes, so S is A + B. With SUB at 1 it is A + ¬B + 1, which is A − B. This is the heart of every ALU: one adder, and a switch that makes it subtract. Cout is the carry out of the adder; when you subtract it is 1 if the answer is not negative (A ≥ B), and 0 if it is (a borrow).' },
    ],
  },
]

