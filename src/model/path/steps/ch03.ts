import { startOf } from '../../challenges'
import type { Circuit } from '../../circuit'
import { nandNandSolution, sopFromKit } from '../sop'
import type { Block, Step } from '../types'

/** Chapter 3: From a truth table to gates. Palette: NAND, switches, LEDs and the learner's kit. */

const PALETTE = ['nand', 'switch', 'led']

/** The truth table of 3-input majority, the running example. Its 1-rows are 3, 5, 6 and 7. */
const MAJORITY: Block = {
  table: {
    head: ['A', 'B', 'C', 'Y'],
    rows: [
      ['0', '0', '0', '0'],
      ['0', '0', '1', '0'],
      ['0', '1', '0', '0'],
      ['0', '1', '1', '1'],
      ['1', '0', '0', '0'],
      ['1', '0', '1', '1'],
      ['1', '1', '0', '1'],
      ['1', '1', '1', '1'],
    ],
    highlight: [3, 5, 6, 7],
  },
}

/** The four 1-rows of majority as products, as the table gives them. */
const MAJORITY_ROWS = [
  ['¬A', 'B', 'C'],
  ['A', '¬B', 'C'],
  ['A', 'B', '¬C'],
  ['A', 'B', 'C'],
]

/** Valid = ¬D3 + ¬D2·¬D1, as NAND(D3, NAND(¬D2, ¬D1)): two inverters, the NAND that makes the OR, and the last NAND. 4 gates. */
function bcdSolution(): Circuit {
  const { b, ins, outs } = startOf(['D3', 'D2', 'D1', 'D0'], ['Valid'])
  const n2 = b.add('nand', 110, 70)
  const n1 = b.add('nand', 110, 140)
  const either = b.add('nand', 220, 100)
  const out = b.add('nand', 330, 30)
  b.wire(`${ins.D2}.Q`, `${n2}.A`)
  b.wire(`${ins.D2}.Q`, `${n2}.B`)
  b.wire(`${ins.D1}.Q`, `${n1}.A`)
  b.wire(`${ins.D1}.Q`, `${n1}.B`)
  b.wire(`${n2}.Y`, `${either}.A`)
  b.wire(`${n1}.Y`, `${either}.B`)
  b.wire(`${ins.D3}.Q`, `${out}.A`)
  b.wire(`${either}.Y`, `${out}.B`)
  b.wire(`${out}.Y`, `${outs.Valid}.A`)
  return b.build()
}

export const CH03: Step[] = [
  {
    id: 'table-to-sop',
    chapter: 'tables',
    title: 'Every truth table is a circuit',
    kind: 'read',
    summary: 'Each 1-row is an AND of the inputs. OR them: sum of products.',
    lesson: [
      { p: 'So far you were told what each gate should do. Here is the general question: given any truth table, how do you find the gates? There is always a way, and it is easy to follow. Take three inputs, A, B and C, and an output that is 1 when at least two of them are 1: a majority vote.' },
      MAJORITY,
      { p: 'Look only at the rows where Y is 1. Each one says: “Y is 1 when A, B and C are exactly like this.” Write that as an AND of the inputs, using the input itself where the row has a 1 and its inverse where the row has a 0. Row 011 is ¬A·B·C: it is 1 for that row and for no other.' },
      { p: 'Y is 1 when any of the four rows is, so OR the four terms together: Y = ¬A·B·C + A·¬B·C + A·B·¬C + A·B·C. This is called a sum of products, and it is a correct circuit for every truth table there is. It is not a small one, and the rest of this chapter makes it smaller.' },
      {
        quiz: [
          {
            q: 'What is the term for row 101 (A = 1, B = 0, C = 1)?',
            options: ['A·B·C', 'A·¬B·C', '¬A·B·¬C'],
            answer: 1,
            why: 'The term is 1 only for that row: A as it is, B inverted because the row has a 0, C as it is.',
          },
          {
            q: 'A table has five rows where the output is 1. How many terms does its sum of products have?',
            options: ['Five', 'Eight', 'As many as it has inputs'],
            answer: 0,
            why: 'One term for each 1-row, and the 0-rows need nothing.',
          },
        ],
      },
    ],
  },
  {
    id: 'sop-majority',
    chapter: 'tables',
    title: 'Majority, row by row',
    kind: 'build',
    summary: 'Build the four terms and OR them, with your kit.',
    palette: PALETTE,
    uses: ['not-from-nand', 'and-from-nand', 'or-from-nand'],
    challenge: 'majority',
    rules: { only: ['nand'] },
    task: 'Make Y light up when at least two of A, B and C are on, with one term for each 1-row of the table.',
    hint: 'Y = ¬A·B·C + A·¬B·C + A·B·¬C + A·B·C. A term of three inputs is an AND of an AND: or use a NAND with three inputs (select it and change “Inputs”) followed by a NOT. Do not mind how big it gets.',
    solution: () => sopFromKit(['A', 'B', 'C'], 'Y', MAJORITY_ROWS),
    lesson: [
      { p: 'Build the sum of products you just wrote down, with the chips in Your kit: a NOT for every input that a term inverts, ANDs for the terms and ORs to add them up.' },
      { p: 'It will be a big circuit, and that is the point: count the chips. Then see how much smaller the same function gets in the next steps. You can also see the answer a program would give: Logic → Build circuit makes a circuit from the expression.' },
    ],
  },
  {
    id: 'combine-terms',
    chapter: 'tables',
    title: 'Two terms that differ in one variable',
    kind: 'read',
    summary: 'X·Y + X·¬Y = X: how a big sum of products gets smaller.',
    lesson: [
      { p: 'Look at the terms of majority that differ in a single input: A·B·C and A·B·¬C. Together they are A·B·(C + ¬C). C or not C is always true, so the pair is just A·B: the input that changes drops out.' },
      { p: 'In general X·Y + X·¬Y = X. The rule works on any two terms that are alike except for one inverted input. Apply it again and again and the four terms of majority become three: A·B + A·C + B·C. The row 111 is used three times, once with each of the other rows, and that is fine: Y is 1 when any term is, so a term can be counted twice.' },
      {
        quiz: [
          {
            q: 'Simplify A·B·C + A·B·¬C.',
            options: ['A·B', 'A·B·C', 'C'],
            answer: 0,
            why: 'The two terms differ only in C, so C drops out and A·B is left.',
          },
        ],
      },
    ],
  },
  {
    id: 'kmap',
    chapter: 'tables',
    title: 'The Karnaugh map',
    kind: 'read',
    summary: 'A picture of that merging: rectangles of 1s, each one term.',
    lesson: [
      { p: 'Finding the terms that differ in one input is hard to do by eye in a list. A Karnaugh map lays the truth table out so that the cells next to each other differ in exactly one input. The labels run 00, 01, 11, 10, not in counting order, to keep it so; the left and right edges, and the top and bottom, count as next to each other too.' },
      { kmap: { inputs: ['A', 'B', 'C'], output: 'Y', ones: [3, 5, 6, 7] } },
      { p: 'Draw rectangles round the 1s, as big as you can, with 1, 2, 4 or 8 cells. Each rectangle is one term of the circuit, and a bigger rectangle is a shorter term: two cells drop one input, four cells drop two. The rectangles of majority are the three coloured ones, A·B, A·C and B·C, which are the three terms you found by merging.' },
      {
        quiz: [
          {
            q: 'The map of majority has three rectangles of two 1s each. How many terms does its smallest sum of products have?',
            options: ['Three', 'Four', 'Six'],
            answer: 0,
            why: 'One term for each rectangle: A·B, A·C and B·C.',
          },
          {
            q: 'On a map of three inputs, a rectangle of four 1s is a term with how many inputs?',
            options: ['One', 'Two', 'Three'],
            answer: 0,
            why: 'Each time a rectangle doubles, one more input drops out: two cells leave two inputs, four cells leave one.',
          },
        ],
      },
    ],
  },
  {
    id: 'sop-bcd',
    chapter: 'tables',
    title: 'Is it a decimal digit?',
    kind: 'build',
    summary: 'Four inputs: read the groups off the map, build the small circuit.',
    palette: PALETTE,
    challenge: 'valid-bcd',
    rules: { only: ['nand'] },
    star: { maxParts: 4 },
    task: 'Make Valid light up when the number D3 D2 D1 D0 is from 0 to 9, using only NAND gates.',
    hint: 'The two rectangles are ¬D3 (the numbers 0 to 7) and ¬D2·¬D1 (0, 1, 8 and 9). So Valid = ¬D3 + ¬D2·¬D1. An OR is a NAND of inverted inputs: ¬D2·¬D1 inverted is D2 + D1, so Valid = NAND(D3, D2 + D1).',
    solution: bcdSolution,
    lesson: [
      { p: 'Four switches make a number from 0 to 15, and a decimal digit goes only up to 9. Here is the map of the output that is 1 for the numbers 0 to 9:' },
      { kmap: { inputs: ['D3', 'D2', 'D1', 'D0'], output: 'Valid', ones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } },
      { p: 'Two rectangles cover all the 1s: the top two rows (D3 is 0), and the two left-hand cells of the top row and of the bottom row (D2 and D1 are both 0; the top and bottom rows are next to each other, so these four cells are one rectangle). D0 does not matter at all.' },
      { p: 'Build it with NAND gates only. The terms are ¬D3 and ¬D2·¬D1; for a star, find the 4-gate version.' },
    ],
  },
  {
    id: 'nand-nand',
    chapter: 'tables',
    title: 'Everything in NAND',
    kind: 'read',
    summary: 'AND-OR becomes NAND-NAND: each term a NAND, and a NAND of those.',
    lesson: [
      { p: 'A sum of products is a layer of ANDs and then an OR. De Morgan, from the end of the last chapter, turns it into two layers of NAND with nothing else: NAND(a, b, …) = ¬a + ¬b + …, so a NAND of the inverted terms is an OR of the terms. And a NAND of the inputs of a term is the inverted term.' },
      { p: 'So: make a NAND for each term. Its output is the inverted term. Feed all those into one more NAND. The result is the OR of the terms, with no inverters in between, and all the gates are of one kind. An input that a term needs inverted is a NAND with its inputs tied together.' },
      { p: 'Majority, A·B + A·C + B·C, needs three NANDs of two inputs, one for each term, and a NAND of three inputs to put them together: four gates and no inverters.' },
      {
        quiz: [
          {
            q: 'Which circuit is A·B + C in NAND-NAND form?',
            options: ['NAND( NAND(A, B), NAND(C, C) )', 'NAND( A, B, C )', 'NAND( NAND(A, B), C )'],
            answer: 0,
            why: 'One NAND for the term A·B, one for the term C (a NAND with its inputs tied inverts C), then a NAND of those two.',
          },
        ],
      },
    ],
  },
  {
    id: 'sop-nand',
    chapter: 'tables',
    title: 'Majority in four NANDs',
    kind: 'build',
    summary: 'Majority again, as NAND-NAND: three NANDs and a NAND.',
    palette: PALETTE,
    challenge: 'majority',
    rules: { only: ['nand'] },
    star: { maxParts: 4 },
    task: 'Make Y light up when at least two of A, B and C are on, with NAND gates only, and no inverters.',
    hint: 'Y = A·B + A·C + B·C. One NAND for A and B, one for A and C, one for B and C. Then a NAND with three inputs (select it and change “Inputs”) takes the three.',
    solution: () => nandNandSolution(['A', 'B', 'C'], 'Y', [['A', 'B'], ['A', 'C'], ['B', 'C']]),
    after: { step: 'xor-from-kit', text: 'Now you can get the star on XOR: A⊕B = A·¬(A·B) + B·¬(A·B) is a NAND-NAND form that shares one NAND, so it takes 4 gates.' },
    lesson: [
      { p: 'You built majority from about fourteen chips. Now build it again the way you have just seen: the smallest sum of products, A·B + A·C + B·C, as NAND-NAND.' },
      { p: 'Four gates, against about fourteen chips that are each several NANDs inside. Making the sum of products small is the work that circuit designers spend their time on.' },
    ],
  },
]
