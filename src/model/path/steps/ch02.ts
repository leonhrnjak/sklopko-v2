import { comb, startOf } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId, chipTable } from '../chips'
import type { Step } from '../types'

/** Chapter 2: NAND is all you need. Palette: NAND, switches, LEDs, and the learner's kit. */

const PALETTE = ['nand', 'switch', 'led']

/** A starting layout with the chips of these steps in its table, for a solution built from them. */
function withChips(inputs: string[], outputs: string[], uses: string[]) {
  const s = startOf(inputs, outputs)
  s.b.c.ics = chipTable(uses, {})
  return s
}

/** NOT: both inputs of one NAND tied together. */
function notSolution(): Circuit {
  const { b, ins, outs } = startOf(['A'], ['Y'])
  const g = b.add('nand', 200, 0)
  b.wire(`${ins.A}.Q`, `${g}.A`)
  b.wire(`${ins.A}.Q`, `${g}.B`)
  b.wire(`${g}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** AND: a NAND, then a NOT. */
function andSolution(): Circuit {
  const { b, ins, outs } = withChips(['A', 'B'], ['Y'], ['not-from-nand'])
  const g = b.add('nand', 140, 20)
  const inv = b.ic(chipId('not-from-nand'), 290, 30)
  b.wire(`${ins.A}.Q`, `${g}.A`)
  b.wire(`${ins.B}.Q`, `${g}.B`)
  b.wire(`${g}.Y`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** OR: a NAND of the two inverted inputs. */
function orSolution(): Circuit {
  const { b, ins, outs } = withChips(['A', 'B'], ['Y'], ['not-from-nand'])
  const na = b.ic(chipId('not-from-nand'), 130, -10)
  const nb = b.ic(chipId('not-from-nand'), 130, 80)
  const g = b.add('nand', 290, 20)
  b.wire(`${ins.A}.Q`, `${na}.A`)
  b.wire(`${ins.B}.Q`, `${nb}.A`)
  b.wire(`${na}.Y`, `${g}.A`)
  b.wire(`${nb}.Y`, `${g}.B`)
  b.wire(`${g}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** NOR: an OR, then a NOT. */
function norSolution(): Circuit {
  const { b, ins, outs } = withChips(['A', 'B'], ['Y'], ['or-from-nand', 'not-from-nand'])
  const or = b.ic(chipId('or-from-nand'), 140, 20)
  const inv = b.ic(chipId('not-from-nand'), 300, 30)
  b.wire(`${ins.A}.Q`, `${or}.A`)
  b.wire(`${ins.B}.Q`, `${or}.B`)
  b.wire(`${or}.Y`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** XOR: (A OR B) AND NOT (A AND B). */
function xorSolution(): Circuit {
  const { b, ins, outs } = withChips(['A', 'B'], ['Y'], ['or-from-nand', 'and-from-nand', 'not-from-nand'])
  const either = b.ic(chipId('or-from-nand'), 130, -20)
  const both = b.ic(chipId('and-from-nand'), 130, 80)
  const inv = b.ic(chipId('not-from-nand'), 280, 90)
  const out = b.ic(chipId('and-from-nand'), 400, 20)
  b.wire(`${ins.A}.Q`, `${either}.A`)
  b.wire(`${ins.B}.Q`, `${either}.B`)
  b.wire(`${ins.A}.Q`, `${both}.A`)
  b.wire(`${ins.B}.Q`, `${both}.B`)
  b.wire(`${both}.Y`, `${inv}.A`)
  b.wire(`${either}.Y`, `${out}.A`)
  b.wire(`${inv}.Y`, `${out}.B`)
  b.wire(`${out}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** The challenge a step of this chapter is checked against: switches A (and B), LED Y, and only NAND gates. */
const nandOnly = (id: string, title: string, task: string, hint: string, inputs: string[], goal: string) =>
  comb({ id, group: 'Learn: NAND is all you need', title, lesson: [], task, hint, inputs, outputs: ['Y'], goal, rules: { only: ['nand'] } })

/** Two switches, a NAND and an LED, wired. */
function nandToPlay(): Circuit {
  const { b, ins, outs } = startOf(['A', 'B'], ['Y'])
  const g = b.add('nand', 200, 20)
  b.wire(`${ins.A}.Q`, `${g}.A`)
  b.wire(`${ins.B}.Q`, `${g}.B`)
  b.wire(`${g}.Y`, `${outs.Y}.A`)
  return b.build()
}

export const CH02: Step[] = [
  {
    id: 'meet-nand',
    chapter: 'nand',
    title: 'Meet the NAND gate',
    kind: 'explore',
    summary: 'Find the only combination that makes a NAND give 0.',
    open: { build: nandToPlay },
    palette: PALETTE,
    task: 'Click the switches A and B until the LED Y goes dark.',
    goals: [{ led: 'Y', is: 0, text: 'Y is dark' }],
    lesson: [
      { p: 'A gate is a part that takes some bits in and gives a bit out, by a fixed rule. The one you will use for everything is the NAND gate. Here it is, with two switches in, [[A]] and [[B]], and an LED out, [[Y]].' },
      { p: 'Try all four settings of A and B and watch Y. There is exactly one setting that makes Y go dark: find it.' },
    ],
  },
  {
    id: 'not-from-nand',
    chapter: 'nand',
    title: 'NOT, from one NAND',
    kind: 'build',
    summary: 'Turn a NAND into an inverter.',
    palette: PALETTE,
    chip: 'NOT',
    symbol: 'not',
    lesson: [
      { p: 'A NAND gate is an AND with its output flipped: it gives 0 only when both of its inputs are 1, and 1 in every other case.' },
      {
        table: {
          head: ['A', 'B', 'NAND'],
          rows: [
            ['0', '0', '1'],
            ['0', '1', '1'],
            ['1', '0', '1'],
            ['1', '1', '0'],
          ],
        },
      },
      { p: 'Look at the two rows where A and B are the same: 0 0 gives 1, and 1 1 gives 0. Feed one signal into both inputs and the gate is an inverter, a NOT.' },
      { p: 'Here is the rule of this chapter: you are given only NAND. Every other gate you need, you build from it. Each circuit you get right goes into Your kit, in the parts list, as a chip you can place in the next steps.' },
    ],
    challenge: nandOnly('path-not', 'NOT from NAND', 'Make Y the opposite of A, using one NAND gate.', 'Wire A to both inputs of the NAND, then the NAND to Y.', ['A'], 'Y = ¬A'),
    solution: notSolution,
  },
  {
    id: 'and-from-nand',
    chapter: 'nand',
    title: 'AND, from NAND and your NOT',
    kind: 'build',
    summary: 'A NAND, then the NOT you built.',
    palette: PALETTE,
    chip: 'AND',
    symbol: 'and',
    uses: ['not-from-nand'],
    lesson: [
      { p: 'AND gives 1 only when both inputs are 1. That is exactly the opposite of NAND, so an AND is a NAND followed by a NOT.' },
      { p: 'You do not need to build the NOT again: it is in Your kit, in the parts list on the left. Place it like any other part. Inside, it is one NAND, so the circuit still follows the rule of using only NAND.' },
    ],
    challenge: nandOnly('path-and', 'AND from NAND', 'Make Y = A AND B.', 'Wire A and B to a NAND, and the NAND to your NOT, and your NOT to Y.', ['A', 'B'], 'Y = A·B'),
    solution: andSolution,
  },
  {
    id: 'or-from-nand',
    chapter: 'nand',
    title: 'OR, with De Morgan’s help',
    kind: 'build',
    summary: 'Invert both inputs, then NAND them.',
    palette: PALETTE,
    chip: 'OR',
    symbol: 'or',
    uses: ['not-from-nand'],
    challenge: 'or-from-nand',
    solution: orSolution,
    lesson: [
      { p: 'OR gives 1 when at least one input is 1. A NAND gives 1 when at least one input is 0. So if you invert both inputs first, a NAND does the job of an OR: it gives 1 when at least one of the original inputs was 1.' },
      { p: 'In symbols, NAND(NOT A, NOT B) = NOT(NOT A AND NOT B) = A OR B. This is one of De Morgan’s laws, and you will see the other one in the last step of this chapter.' },
    ],
  },
  {
    id: 'nor-from-kit',
    chapter: 'nand',
    title: 'NOR, from your kit',
    kind: 'build',
    summary: 'An OR followed by a NOT.',
    palette: PALETTE,
    chip: 'NOR',
    symbol: 'nor',
    uses: ['or-from-nand', 'not-from-nand'],
    lesson: [
      { p: 'NOR is OR with its output flipped: it gives 1 only when both inputs are 0. You have both pieces in your kit.' },
      { p: 'This is how it will go from now on: a new gate is a few of the ones you already have, wired together. Nobody looks inside a chip once it works.' },
    ],
    challenge: nandOnly('path-nor', 'NOR from your kit', 'Make Y = NOT (A OR B).', 'Wire A and B to your OR, and the OR to your NOT.', ['A', 'B'], 'Y = ¬(A + B)'),
    solution: norSolution,
  },
  {
    id: 'xor-from-kit',
    chapter: 'nand',
    title: 'XOR, from your kit',
    kind: 'build',
    summary: '“A or B, but not both”.',
    palette: PALETTE,
    chip: 'XOR',
    symbol: 'xor',
    uses: ['or-from-nand', 'and-from-nand', 'not-from-nand'],
    star: { maxParts: 4 },
    hint: 'For the star: NAND(A, B) is useful in more than one place. Feed it, together with A, into one NAND, and together with B into another. (Chapter 3 shows why this works: come back to it after that.)',
    lesson: [
      { p: 'XOR (“exclusive or”) gives 1 when its two inputs differ: A or B, but not both. In gates that is (A OR B) AND NOT (A AND B).' },
      { p: 'Build it from OR, AND and NOT in your kit. It will be a correct XOR, though not a small one: every chip of your kit is NAND inside, and they add up.' },
      { p: 'For a star, make it with 4 NAND gates in all. There is a way that shares one NAND between two parts of the circuit. A star never blocks anything: skip it and come back later if you like.' },
    ],
    challenge: nandOnly('path-xor', 'XOR from your kit', 'Make Y = A XOR B.', 'Y is 1 when exactly one of A and B is 1: (A OR B) AND NOT (A AND B).', ['A', 'B'], 'Y = A ⊕ B'),
    solution: xorSolution,
  },
  {
    id: 'nand-recap',
    chapter: 'nand',
    title: 'Why chips are made of NAND',
    kind: 'read',
    summary: 'Universal gates, and De Morgan’s two laws.',
    lesson: [
      { p: 'You have just built NOT, AND, OR, NOR and XOR from one kind of gate. That works for every logic function, however large: NAND is universal, and so is NOR. Real chips are drawn with many kinds of gates, but the transistors underneath are mostly arranged as NANDs and NORs, because they are the simplest to make.' },
      { p: 'De Morgan’s laws are what made the OR work. Inverting every input and the output of an AND gives an OR, and the other way round:' },
      {
        table: {
          head: ['Law', 'In words'],
          rows: [
            ['NOT (A AND B) = (NOT A) OR (NOT B)', 'A NAND is an OR of the inverted inputs.'],
            ['NOT (A OR B) = (NOT A) AND (NOT B)', 'A NOR is an AND of the inverted inputs.'],
          ],
        },
      },
      {
        quiz: [
          { q: 'NAND(A, B) is the same as…', options: ['NOT A AND NOT B', 'NOT A OR NOT B', 'A OR B'], answer: 1, why: 'De Morgan: inverting an AND gives an OR of the inverted inputs.' },
          { q: 'NOR(A, B) is the same as…', options: ['NOT A AND NOT B', 'NOT A OR NOT B', 'A AND B'], answer: 0, why: 'De Morgan again: inverting an OR gives an AND of the inverted inputs.' },
        ],
      },
      { p: 'Next you will turn any truth table into gates, then use gates to choose between signals, and then to add numbers. Your kit keeps what you built, and the same parts will be in the parts list as ready-made ones when you finish a chapter.' },
    ],
  },
]
