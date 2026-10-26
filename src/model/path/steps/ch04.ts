import { CircuitBuilder } from '../../builder'
import { comb } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId } from '../chips'
import type { Step } from '../types'
import { withChips } from './ch02'

/** Chapter 4: Choosing. Palette: NAND, switches, LEDs and the learner's kit; the rule is still NAND only (every chip of the kit is NAND inside). */

const PALETTE = ['nand', 'switch', 'led']

/** MUX: Y = S·B + ¬S·A. */
function muxSolution(): Circuit {
  const { b, ins, outs } = withChips(['S', 'A', 'B'], ['Y'], ['not-from-nand', 'and-from-nand', 'or-from-nand'])
  const inv = b.ic(chipId('not-from-nand'), 110, -10)
  const pickA = b.ic(chipId('and-from-nand'), 220, 20)
  const pickB = b.ic(chipId('and-from-nand'), 220, 120)
  const either = b.ic(chipId('or-from-nand'), 340, 70)
  b.wire(`${ins.S}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${pickA}.A`)
  b.wire(`${ins.A}.Q`, `${pickA}.B`)
  b.wire(`${ins.S}.Q`, `${pickB}.A`)
  b.wire(`${ins.B}.Q`, `${pickB}.B`)
  b.wire(`${pickA}.Y`, `${either}.A`)
  b.wire(`${pickB}.Y`, `${either}.B`)
  b.wire(`${either}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** DEMUX: D goes to Y1 when S is 1, to Y0 when S is 0. */
function demuxSolution(): Circuit {
  const { b, ins, outs } = withChips(['S', 'D'], ['Y0', 'Y1'], ['not-from-nand', 'and-from-nand'])
  const inv = b.ic(chipId('not-from-nand'), 110, -10)
  const to0 = b.ic(chipId('and-from-nand'), 250, 0)
  const to1 = b.ic(chipId('and-from-nand'), 250, 100)
  b.wire(`${ins.S}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${to0}.A`)
  b.wire(`${ins.D}.Q`, `${to0}.B`)
  b.wire(`${ins.S}.Q`, `${to1}.A`)
  b.wire(`${ins.D}.Q`, `${to1}.B`)
  b.wire(`${to0}.Y`, `${outs.Y0}.A`)
  b.wire(`${to1}.Y`, `${outs.Y1}.A`)
  return b.build()
}

/** DEC2: one AND for each of the four numbers, of the inputs or their inverses. */
function decoderSolution(): Circuit {
  const { b, ins, outs } = withChips(['A1', 'A0'], ['Y0', 'Y1', 'Y2', 'Y3'], ['not-from-nand', 'and-from-nand'])
  const n1 = b.ic(chipId('not-from-nand'), 100, -20)
  const n0 = b.ic(chipId('not-from-nand'), 100, 60)
  b.wire(`${ins.A1}.Q`, `${n1}.A`)
  b.wire(`${ins.A0}.Q`, `${n0}.A`)
  const row = (i: number, hi: string, lo: string) => {
    const g = b.ic(chipId('and-from-nand'), 280, i * 70)
    b.wire(hi, `${g}.A`)
    b.wire(lo, `${g}.B`)
    b.wire(`${g}.Y`, `${outs[`Y${i}`]}.A`)
  }
  row(0, `${n1}.Y`, `${n0}.Y`)
  row(1, `${n1}.Y`, `${ins.A0}.Q`)
  row(2, `${ins.A1}.Q`, `${n0}.Y`)
  row(3, `${ins.A1}.Q`, `${ins.A0}.Q`)
  return b.build()
}

/** The built-in 4:1 multiplexer with four switches in, two to choose, and an LED. */
function mux4ToPlay(): Circuit {
  const b = new CircuitBuilder()
  const m = b.add('mux', 260, 40)
  ;[0, 1, 2, 3].forEach((i) => b.wire(`${b.add('switch', 0, i * 70, { label: `D${i}` })}.Q`, `${m}.I${i}`))
  b.wire(`${b.add('switch', 120, 330, { label: 'S1' })}.Q`, `${m}.S1`)
  b.wire(`${b.add('switch', 200, 330, { label: 'S0' })}.Q`, `${m}.S0`)
  b.wire(`${m}.Y`, `${b.add('led', 460, 100, { label: 'Y' })}.A`)
  return b.build()
}

export const CH04: Step[] = [
  {
    id: 'mux',
    chapter: 'choosing',
    title: 'Choose one of two',
    kind: 'build',
    summary: 'A multiplexer: a select switch picks which input goes on.',
    palette: PALETTE,
    chip: 'MUX',
    uses: ['not-from-nand', 'and-from-nand', 'or-from-nand'],
    challenge: 'mux',
    rules: { only: ['nand'] },
    solution: muxSolution,
    lesson: [
      { p: 'A computer is always choosing where a number comes from: the next instruction or a jump, a value from memory or from the adder. A multiplexer, or mux, is the part that chooses. It has two data inputs, A and B, and a select input, S: with S off it passes A on, with S on it passes B.' },
      { p: 'Think of it as two doors. The A door is open only when S is 0, the B door only when S is 1; whatever came through either door goes on. You know how to do each of these things: a NOT for the “only when S is 0”, an AND to open a door, an OR to join the two.' },
    ],
  },
  {
    id: 'demux',
    chapter: 'choosing',
    title: 'Send it where you want',
    kind: 'build',
    summary: 'A demultiplexer: one input, sent to one of two outputs.',
    palette: PALETTE,
    chip: 'DEMUX',
    uses: ['not-from-nand', 'and-from-nand'],
    challenge: comb({
      id: 'path-demux',
      group: 'Learn: Choosing',
      title: 'Demultiplexer',
      lesson: [],
      task: 'Send D to Y1 when S is 1, and to Y0 when S is 0. The output that is not chosen stays 0.',
      hint: 'Y0 = ¬S·D and Y1 = S·D: two AND doors, one of them behind a NOT.',
      inputs: ['S', 'D'],
      outputs: ['Y0', 'Y1'],
      goal: 'Y0 = ¬S·D\nY1 = S·D',
      rules: { only: ['nand'] },
    }),
    solution: demuxSolution,
    lesson: [
      { p: 'A multiplexer is a choice among inputs; a demultiplexer is its mirror: one input, D, and a choice among outputs. With S off, D goes to Y0; with S on, D goes to Y1. The output that was not chosen stays at 0.' },
      { p: 'It is the same two doors, the other way round: each output is D AND the select (or its inverse).' },
    ],
  },
  {
    id: 'decoder',
    chapter: 'choosing',
    title: 'A line for each number',
    kind: 'build',
    summary: 'A 2-to-4 decoder: the number on the inputs lights one output.',
    palette: PALETTE,
    chip: 'DEC2',
    uses: ['not-from-nand', 'and-from-nand'],
    challenge: comb({
      id: 'path-decoder',
      group: 'Learn: Choosing',
      title: '2-to-4 decoder',
      lesson: [],
      task: 'Light exactly one of Y0 to Y3: the one whose number is on the switches A1 A0 (A1 is the 2s bit).',
      hint: 'Each output is an AND of A1 and A0, each taken as it is or inverted: Y2 is 10, so A1 and NOT A0.',
      inputs: ['A1', 'A0'],
      outputs: ['Y0', 'Y1', 'Y2', 'Y3'],
      goal: 'Y0 = ¬A1·¬A0\nY1 = ¬A1·A0\nY2 = A1·¬A0\nY3 = A1·A0',
      rules: { only: ['nand'] },
    }),
    solution: decoderSolution,
    lesson: [
      { p: 'A decoder turns a number into one line: with the number 2 on its two inputs, exactly output Y2 is 1 and the others are 0. This is how a computer says “the instruction is number 2: do the thing for 2” and how a memory picks one of its words.' },
      { p: 'Each output is an AND that is 1 for only one combination of the inputs: Y3 is 11, so A1 AND A0. For the others, invert the inputs that must be 0.' },
    ],
  },
  {
    id: 'mux4-tour',
    chapter: 'choosing',
    title: 'A 4-way multiplexer',
    kind: 'explore',
    summary: 'The built-in 4:1 mux: two select switches choose among four inputs.',
    open: { build: mux4ToPlay },
    palette: [...PALETTE, 'mux'],
    task: 'Choose input D2 with the select switches S1 and S0, then turn D2 on and watch Y.',
    goals: [
      { switches: { S1: 1, S0: 0 }, text: 'Choose input 2: S1 = 1 and S0 = 0' },
      { switches: { S1: 1, S0: 0, D2: 1 }, text: 'Turn D2 on while it is chosen' },
      { led: 'Y', is: 1, text: 'Y is lit' },
    ],
    ordered: true,
    lesson: [
      { p: 'With two select inputs you can choose among four. [[S1]] and [[S0]] together are a number from 0 to 3, and the multiplexer passes on the input with that number, D0 to D3. Every wider multiplexer is this idea again with more select lines.' },
      { p: 'This is the built-in multiplexer: it is what you would get from a few of your 2:1 chips. Try the four settings of S1 and S0 and see which input reaches Y.' },
    ],
  },
]
