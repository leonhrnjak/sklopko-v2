import { CircuitBuilder } from '../../builder'
import { comb, type CombChallenge } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId } from '../chips'
import type { Step } from '../types'
import { withChips } from './ch02'
import { adderTerms } from './ch05'

/** Chapter 6: The ALU. Palette: NAND, switches, LEDs and the learner's kit; the rule is still NAND only. */

const PALETTE = ['nand', 'switch', 'led']

const bits = (name: string) => [3, 2, 1, 0].map((i) => `${name}${i}`)

/** ZERO: two NORs, each looking at a pair of bits, and an AND of the two. */
function zeroSolution(): Circuit {
  const { b, ins, outs } = withChips(bits('A'), ['Z'], ['nor-from-kit', 'and-from-nand'])
  const hi = b.ic(chipId('nor-from-kit'), 130, -10)
  const lo = b.ic(chipId('nor-from-kit'), 130, 150)
  const both = b.ic(chipId('and-from-nand'), 290, 70)
  b.wire(`${ins.A3}.Q`, `${hi}.A`)
  b.wire(`${ins.A2}.Q`, `${hi}.B`)
  b.wire(`${ins.A1}.Q`, `${lo}.A`)
  b.wire(`${ins.A0}.Q`, `${lo}.B`)
  b.wire(`${hi}.Y`, `${both}.A`)
  b.wire(`${lo}.Y`, `${both}.B`)
  b.wire(`${both}.Y`, `${outs.Z}.A`)
  return b.build()
}

/**
 * Compare: the numbers are equal when both bit pairs are (an XOR of a pair is 0); A is bigger when its high bit beats B's, or the high
 * bits are equal and its low bit beats B's.
 */
function compareSolution(): Circuit {
  const { b, ins, outs } = withChips(['A1', 'A0', 'B1', 'B0'], ['GT', 'EQ'], ['xor-from-kit', 'not-from-nand', 'and-from-nand', 'or-from-nand', 'nor-from-kit'])
  const ic = (step: string, x: number, y: number) => b.ic(chipId(step), x, y)
  const x1 = ic('xor-from-kit', 120, 260)
  const x0 = ic('xor-from-kit', 120, 360)
  const nb1 = ic('not-from-nand', 120, -10)
  const nb0 = ic('not-from-nand', 120, 110)
  const same1 = ic('not-from-nand', 250, 250)
  const high = ic('and-from-nand', 250, 0)
  const low = ic('and-from-nand', 250, 110)
  const lowIfSame = ic('and-from-nand', 380, 150)
  const gt = ic('or-from-nand', 510, 70)
  const eq = ic('nor-from-kit', 250, 370)
  b.wire(`${ins.A1}.Q`, `${x1}.A`)
  b.wire(`${ins.B1}.Q`, `${x1}.B`)
  b.wire(`${ins.A0}.Q`, `${x0}.A`)
  b.wire(`${ins.B0}.Q`, `${x0}.B`)
  b.wire(`${ins.B1}.Q`, `${nb1}.A`)
  b.wire(`${ins.B0}.Q`, `${nb0}.A`)
  b.wire(`${x1}.Y`, `${same1}.A`)
  b.wire(`${ins.A1}.Q`, `${high}.A`)
  b.wire(`${nb1}.Y`, `${high}.B`)
  b.wire(`${ins.A0}.Q`, `${low}.A`)
  b.wire(`${nb0}.Y`, `${low}.B`)
  b.wire(`${same1}.Y`, `${lowIfSame}.A`)
  b.wire(`${low}.Y`, `${lowIfSame}.B`)
  b.wire(`${high}.Y`, `${gt}.A`)
  b.wire(`${lowIfSame}.Y`, `${gt}.B`)
  b.wire(`${x1}.Y`, `${eq}.A`)
  b.wire(`${x0}.Y`, `${eq}.B`)
  b.wire(`${gt}.Y`, `${outs.GT}.A`)
  b.wire(`${eq}.Y`, `${outs.EQ}.A`)
  return b.build()
}

/**
 * ALU: the adder/subtractor gets SUB from S0; an AND and an OR of each pair of bits are chosen between by S0; and S1 chooses between
 * the adder and those. Z looks at the result; C is the adder's carry (the borrow when subtracting) while S1 is off.
 */
function aluSolution(): Circuit {
  const { b, ins, outs } = withChips([...bits('A'), ...bits('B'), 'S1', 'S0'], [...bits('Y'), 'Z', 'C'], [
    'addsub',
    'and-from-nand',
    'or-from-nand',
    'mux',
    'is-zero',
    'not-from-nand',
    'xor-from-kit',
  ])
  const ic = (step: string, x: number, y: number) => b.ic(chipId(step), x, y)
  const add = ic('addsub', 150, 120)
  b.wire(`${ins.S0}.Q`, `${add}.SUB`)
  const zero = ic('is-zero', 780, 200)
  for (const i of [0, 1, 2, 3]) {
    const y = (3 - i) * 130
    const and = ic('and-from-nand', 330, y)
    const or = ic('or-from-nand', 330, y + 60)
    const logic = ic('mux', 460, y + 30)
    const pick = ic('mux', 600, y + 10)
    b.wire(`${ins[`A${i}`]}.Q`, `${add}.A${i}`)
    b.wire(`${ins[`B${i}`]}.Q`, `${add}.B${i}`)
    b.wire(`${ins[`A${i}`]}.Q`, `${and}.A`)
    b.wire(`${ins[`B${i}`]}.Q`, `${and}.B`)
    b.wire(`${ins[`A${i}`]}.Q`, `${or}.A`)
    b.wire(`${ins[`B${i}`]}.Q`, `${or}.B`)
    b.wire(`${ins.S0}.Q`, `${logic}.S`)
    b.wire(`${and}.Y`, `${logic}.A`)
    b.wire(`${or}.Y`, `${logic}.B`)
    b.wire(`${ins.S1}.Q`, `${pick}.S`)
    b.wire(`${add}.S${i}`, `${pick}.A`)
    b.wire(`${logic}.Y`, `${pick}.B`)
    b.wire(`${pick}.Y`, `${outs[`Y${i}`]}.A`)
    b.wire(`${pick}.Y`, `${zero}.A${i}`)
  }
  b.wire(`${zero}.Z`, `${outs.Z}.A`)
  const borrow = ic('xor-from-kit', 330, 560)
  const arith = ic('not-from-nand', 330, 650)
  const carry = ic('and-from-nand', 460, 600)
  b.wire(`${add}.Cout`, `${borrow}.A`)
  b.wire(`${ins.S0}.Q`, `${borrow}.B`)
  b.wire(`${ins.S1}.Q`, `${arith}.A`)
  b.wire(`${arith}.Y`, `${carry}.A`)
  b.wire(`${borrow}.Y`, `${carry}.B`)
  b.wire(`${carry}.Y`, `${outs.C}.A`)
  // Room for the chips between the switches and the LEDs.
  for (const name of [...bits('Y'), 'Z', 'C']) b.c.comps[outs[name]].x = 940
  return b.build()
}

/**
 * The goal of the ALU in the expression language: the adder's terms with B XORed with S0 and S0 as the carry in, an AND or an OR
 * when S1 is on, and C the adder's carry out flipped when subtracting (a borrow), only while S1 is off.
 */
function aluGoal(): string {
  const t = adderTerms((i) => `(B${i} ⊕ S0)`, 'S0')
  return [
    ...[3, 2, 1, 0].map((i) => `Y${i} = (¬S1·(${t.sum(i)})) + (S1·((S0·(A${i} + B${i})) + (¬S0·A${i}·B${i})))`),
    'Z = ¬(Y3 + Y2 + Y1 + Y0)',
    `C = ¬S1·(${t.carry(4)} ⊕ S0)`,
  ].join('\n')
}

const aluChallenge: CombChallenge = comb({
  id: 'path-alu4',
  group: 'Learn: The ALU',
  title: '4-bit ALU',
  lesson: [],
  task: 'S1 S0 choose the operation on A and B: 00 adds, 01 subtracts, 10 is AND, 11 is OR. Y3 to Y0 are the result, Z is 1 when the result is 0, and C is the carry out of the adder (the borrow when subtracting).',
  hint: 'Your ADDSUB with S0 on its SUB input does the first two. For each bit, an AND and an OR, chosen between by S0, are the other two; then S1 chooses between the adder and those. Z is your ZERO on Y. C is the adder’s Cout (flipped when S0 is on), and only while S1 is off.',
  inputs: [...bits('A'), ...bits('B'), 'S1', 'S0'],
  outputs: [...bits('Y'), 'Z', 'C'],
  goal: aluGoal(),
  rules: { only: ['nand'] },
})

/** The built-in ALU with two select switches (the third select, S2, is left off), a display for the result and two flag LEDs. A is 6, B is 9. */
function aluToPlay(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('hexin', 0, 0, { label: 'A', params: { value: 6 } })
  const bb = b.add('hexin', 0, 140, { label: 'B', params: { value: 9 } })
  const alu = b.add('alu', 150, 0)
  const res = b.add('hexdisp', 340, 0, { label: 'F' })
  const z = b.add('led', 340, 120, { label: 'Z', params: { color: 'yellow' } })
  const c = b.add('led', 340, 170, { label: 'C', params: { color: 'red' } })
  ;[1, 0].forEach((k, i) => {
    const sw = b.add('switch', 150 + i * 50, 250, { label: `S${k}` })
    b.wire(`${sw}.Q`, `${alu}.S${k}`)
  })
  for (let i = 0; i < 4; i++) {
    b.wire(`${a}.${'ABCD'[i]}`, `${alu}.A${i}`)
    b.wire(`${bb}.${'ABCD'[i]}`, `${alu}.B${i}`)
    b.wire(`${alu}.F${i}`, `${res}.${'ABCD'[i]}`)
  }
  b.wire(`${alu}.Z`, `${z}.A`)
  b.wire(`${alu}.Co`, `${c}.A`)
  return b.build()
}

export const CH06: Step[] = [
  {
    id: 'is-zero',
    chapter: 'alu',
    title: 'Is it zero?',
    kind: 'build',
    summary: 'A zero detector: Z is 1 when all four bits are 0.',
    palette: PALETTE,
    chip: 'ZERO',
    uses: ['nor-from-kit', 'and-from-nand'],
    challenge: comb({
      id: 'path-zero',
      group: 'Learn: The ALU',
      title: 'Zero detector',
      lesson: [],
      task: 'Make Z light up only when A3, A2, A1 and A0 are all off.',
      hint: 'A NOR is on only when both its inputs are off. Use one for A3 and A2 and one for A1 and A0: Z is on when both are.',
      inputs: bits('A'),
      outputs: ['Z'],
      goal: 'Z = ¬(A3 + A2 + A1 + A0)',
      rules: { only: ['nand'] },
    }),
    solution: zeroSolution,
    lesson: [
      { p: 'A computer is always asking “is it zero?”: has the countdown finished, are these two numbers the same (their difference is zero)? The answer is one bit, and it tells the program which way to go. Before you build the ALU you need the part that asks.' },
      { p: 'Z must be 1 only when every one of the four bits is 0. That is a NOR of four bits: it is 1 when none of them is on. Your NOR has two inputs, so use two of them, one for each pair of bits, and an AND to say that both pairs are zero.' },
    ],
  },
  {
    id: 'compare',
    chapter: 'alu',
    title: 'Which is bigger?',
    kind: 'build',
    summary: 'Compare two 2-bit numbers: A greater than B, or equal.',
    palette: PALETTE,
    uses: ['xor-from-kit', 'not-from-nand', 'and-from-nand', 'or-from-nand', 'nor-from-kit'],
    challenge: 'compare',
    rules: { only: ['nand'] },
    solution: compareSolution,
    lesson: [
      { p: 'To compare two numbers you look at the biggest column first. A is the number A1 A0 and B is B1 B0. A is bigger if its high bit beats B’s (A1 is 1 and B1 is 0). If the high bits are the same, the low bits decide: A0 is 1 and B0 is 0.' },
      { p: 'Two bits are the same when their XOR is 0, so the numbers are equal when both pairs are the same: a NOR of the two XORs. GT is the OR of the two cases: “the high bit beats B’s, or the high bits are the same and the low bit does”.' },
      { p: 'A computer has another way to compare: subtract, and see if the answer is zero. You will see that with the ALU.' },
    ],
  },
  {
    id: 'alu4',
    chapter: 'alu',
    title: 'The ALU',
    kind: 'build',
    summary: 'One block that adds, subtracts, ANDs and ORs, and tells you if the answer is zero.',
    palette: PALETTE,
    chip: 'ALU',
    uses: ['addsub', 'and-from-nand', 'or-from-nand', 'mux', 'is-zero', 'not-from-nand', 'xor-from-kit'],
    challenge: aluChallenge,
    solution: aluSolution,
    lesson: [
      { p: 'The ALU, the arithmetic logic unit, is the part of a processor that does the sums. It has two numbers in, A and B, two select bits that choose the operation, and the result Y out, with two flags that say something about it: Z, the result is zero, and C, the carry.' },
      {
        table: {
          head: ['S1', 'S0', 'Y'],
          rows: [
            ['0', '0', 'A + B'],
            ['0', '1', 'A − B'],
            ['1', '0', 'A AND B'],
            ['1', '1', 'A OR B'],
          ],
        },
      },
      { p: 'You have every piece. Your ADDSUB adds and subtracts: send S0 into its SUB input. For AND and OR, put an AND and an OR on each pair of bits, and let S0 choose between them with a multiplexer. Then a second multiplexer per bit, with S1, chooses between the adder’s answer and the logic. Z is your ZERO on the four result bits.' },
      { p: 'The carry C is the adder’s Cout, shown only while S1 is off (AND and OR have no carry). When you subtract, a carry out of 1 means the answer was not negative, so C is flipped to say “borrow” instead: an XOR with S0 does that. The check tries all 1024 combinations of the ten inputs.' },
    ],
  },
  {
    id: 'alu-tour',
    chapter: 'alu',
    title: 'The ALU, built in',
    kind: 'explore',
    summary: 'The built-in ALU with its flags: make Z light, then C.',
    open: { build: aluToPlay },
    palette: ['hexin', 'hexdisp', 'alu', 'led', 'switch'],
    task: 'Make Z light up, then make C light up. Operate the two select switches and the number B.',
    goals: [
      { led: 'Z', is: 1, text: 'Z is lit: the result is 0' },
      { led: 'C', is: 1, text: 'C is lit: the sum carried out' },
    ],
    lesson: [
      { p: 'This is the same block as yours, built in: [[A]] and [[B]] go in, [[S1]] and [[S0]] choose the operation and [[F]] shows the result. The built-in ALU can do four more things (it has a third select, S2, which is left off here), but the first four are yours: 00 add, 01 subtract, 10 AND, 11 OR.' },
      { p: 'It starts on ADD with 6 + 9 = 15. Turn on [[S1]] to AND them: 0110 and 1001 have no bit in common, so the result is 0 and [[Z]] lights. Then add again, and click [[B]] once to make it 10: 6 + 10 = 16 does not fit in four bits, so the result shows 0 and the carry [[C]] lights too.' },
      { p: 'Z and C are what a program uses to decide: “was it zero?”, “did it overflow?”. A processor keeps them in flags, and a jump instruction looks at them. You will build that in chapter 9.' },
    ],
  },
]
