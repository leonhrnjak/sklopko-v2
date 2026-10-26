import { CircuitBuilder } from '../../builder'
import type { Circuit } from '../../circuit'
import type { Step } from '../types'

/** A switch wired to an LED: the first thing to play with. */
function switchAndLed(): Circuit {
  const b = new CircuitBuilder()
  const s = b.add('switch', 0, 40, { label: 'S' })
  const y = b.add('led', 240, 40, { label: 'Y' })
  b.wire(`${s}.Q`, `${y}.A`)
  return b.build()
}

/** A 4-bit input wired to a hex display. */
function numberAndDisplay(): Circuit {
  const b = new CircuitBuilder()
  const n = b.add('hexin', 0, 0, { label: 'N' })
  const d = b.add('hexdisp', 200, 0, { label: 'Number' })
  for (const pin of ['A', 'B', 'C', 'D']) b.wire(`${n}.${pin}`, `${d}.${pin}`)
  return b.build()
}

/** Chapter 1: Signals and wires. */
export const CH01: Step[] = [
  {
    id: 'bits',
    chapter: 'signals',
    title: 'A bit is a 0 or a 1',
    kind: 'explore',
    summary: 'A switch, a wire and an LED: play with them.',
    open: { build: switchAndLed },
    palette: ['switch', 'led'],
    task: 'Click the switch S until the LED Y is lit, then click it again to turn it off.',
    goals: [
      { led: 'Y', is: 1, text: 'Y is lit' },
      { led: 'Y', is: 0, text: 'Y is dark again' },
    ],
    ordered: true,
    lesson: [
      { p: 'Everything in a computer is made of signals that are either 0 or 1. One such signal is a bit. A switch makes a bit: click it to flip it between 0 (off) and 1 (on). An LED shows one: lit for 1, dark for 0.' },
      { p: 'The switch [[S]] and the LED [[Y]] on the canvas are already joined by a wire. Wires are green when they carry a 1, red when they carry a 0, and grey when nothing is driving them yet. Make the LED light, then make it go dark again.' },
    ],
  },
  {
    id: 'wire',
    chapter: 'signals',
    title: 'Make the light follow the switch',
    kind: 'build',
    summary: 'Your first circuit: a switch, a wire and an LED.',
    challenge: 'wire',
    palette: ['switch', 'led'],
    lesson: [
      { p: 'You have seen that a switch makes a bit and an LED shows one. Here the switch and the LED are not joined yet: a wire carries a bit from one part to another, and you draw it. Drag from the little pin at the right of the switch to the pin at the left of the LED.' },
      { p: 'Press Run at the top to start the simulation, then flip the switch and watch the LED.' },
    ],
  },
  {
    id: 'binary',
    chapter: 'signals',
    title: 'Counting with four bits',
    kind: 'read',
    summary: 'Four bits make 16 numbers. Place values 8, 4, 2, 1.',
    lesson: [
      { p: 'One bit has two values. Two bits can be arranged in 2 × 2 = 4 ways, three bits in 8, and four bits in 2 × 2 × 2 × 2 = 16 ways: the numbers 0 to 15.' },
      { p: 'Each place in a binary number is worth twice the place to its right, just as in decimal each place is worth ten times: from the right they are 1, 2, 4 and 8. Add up the places that hold a 1.' },
      {
        table: {
          head: ['8s', '4s', '2s', '1s', 'The number'],
          rows: [
            ['0', '1', '1', '0', '4 + 2 = 6'],
            ['1', '0', '1', '1', '8 + 2 + 1 = 11'],
            ['1', '1', '1', '1', '8 + 4 + 2 + 1 = 15'],
          ],
        },
      },
      { p: 'Four bits are a convenient size: one hexadecimal digit (0 to 9, then A to F for 10 to 15) writes exactly four bits, so 1011 is B. The computer you will build is 4 bits wide. The real chip at the end of the path is 8 bits wide, which is two hexadecimal digits: 0 to 255.' },
      {
        quiz: [
          { q: 'What number is 1011?', options: ['9', '11', '13'], answer: 1, why: '8 + 2 + 1 = 11.' },
          { q: 'How is 6 written in four bits?', options: ['0110', '0011', '1100'], answer: 0, why: '6 = 4 + 2, so the 4s and the 2s places hold a 1.' },
          { q: 'How many different numbers can four bits hold?', options: ['8', '15', '16'], answer: 2, why: '2 × 2 × 2 × 2 = 16: the numbers 0 to 15.' },
        ],
      },
    ],
  },
  {
    id: 'show-nine',
    chapter: 'signals',
    title: 'Making numbers',
    kind: 'explore',
    summary: 'Four bits in, a hex digit out: make 9, then 15.',
    open: { build: numberAndDisplay },
    palette: ['hexin', 'hexdisp'],
    task: 'Click the 4-bit input N to count up until the display shows 9, and then on to 15.',
    goals: [
      { display: 'Number', is: 9, text: 'The display shows 9' },
      { display: 'Number', is: 15, text: 'The display shows F, which is 15' },
    ],
    ordered: true,
    lesson: [
      { p: 'The part on the left, [[N]], is four bits in one: a 4-bit input. Click it to count up (Alt or Option-click counts down). Its four wires carry the bits to the display [[Number]], which shows the number as one digit.' },
      { p: 'After 9 the display goes on with the letters A to F, because one digit can hold 16 values: that is hexadecimal. 15 is F, the biggest number four bits can make. For the same idea with more parts, open the Counter example from Examples.' },
    ],
  },
]
