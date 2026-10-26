import type { Step } from '../types'

/** Chapter 1: Signals and wires. */
export const CH01: Step[] = [
  {
    id: 'wire',
    chapter: 'signals',
    title: 'Make the light follow the switch',
    kind: 'build',
    summary: 'Your first circuit: a switch, a wire and an LED.',
    challenge: 'wire',
    palette: ['switch', 'led'],
    lesson: [
      { p: 'Everything in a computer is made of signals that are either 0 or 1. One such signal is a bit. A switch makes a bit: click it to flip it between 0 (off) and 1 (on). An LED shows one: lit for 1, dark for 0.' },
      { p: 'A wire carries a bit from one part to another. Wires are green when they carry a 1, red when they carry a 0, and grey when nothing is driving them yet. To draw one, drag from the little pin at the right of the switch to the pin at the left of the LED.' },
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
]
