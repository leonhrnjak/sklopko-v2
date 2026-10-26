import { parseProgram, resolveProgram } from '../logic/expr'
import { tableOfProgram, type TruthTable } from '../logic/table'
import { CircuitBuilder } from './builder'
import type { Circuit } from './circuit'
import { synthesize } from './synth'

/** Limits on what a solution may be built from. Switches, LEDs, constants, labels and notes are always allowed. */
export interface Rules {
  /** Only these gate and other logic parts (by part type) may be used. */
  only?: string[]
  /** At most this many logic parts in all. */
  maxParts?: number
}

/** One step of a test for a circuit with memory: set some switches, let it settle, pulse a switch (one rising and one falling edge), then read the LEDs. */
export interface Step {
  set: Record<string, 0 | 1>
  /** The switch to pulse after `set`, such as a clock. */
  pulse?: string
  expect: Record<string, 0 | 1>
}

interface Base {
  /** Also what progress is stored under: never change one. */
  id: string
  group: string
  title: string
  /** What the lesson teaches, a paragraph or two. */
  lesson: string[]
  /** What to build, in one sentence. */
  task: string
  hint: string
  /** The names of the switches and the LEDs the challenge expects (their labels, in the order they are listed). */
  inputs: string[]
  outputs: string[]
  rules?: Rules
  /** The canvas when the challenge starts: the labelled switches and LEDs, not yet connected. */
  starter(): Circuit
  /** A circuit that solves it. */
  solution(): Circuit
}

/** A circuit that is a function of its switches: every combination is tried and compared with the expressions in `goal`. */
export interface CombChallenge extends Base {
  kind: 'comb'
  /** Lines such as `Sum = A ⊕ B`, one for each output. */
  goal: string
}

/** A circuit with memory: the steps are run in order from the start. */
export interface SeqChallenge extends Base {
  kind: 'seq'
  steps: Step[]
}

export type Challenge = CombChallenge | SeqChallenge

/** The switches (on the left) and LEDs (on the right) with the given labels, ready to be wired. */
function starterOf(inputs: string[], outputs: string[]): () => Circuit {
  return () => {
    const b = new CircuitBuilder()
    inputs.forEach((name, i) => b.add('switch', 0, i * 70, { label: name }))
    outputs.forEach((name, i) => b.add('led', 460, i * 70, { label: name }))
    return b.build()
  }
}

/** Where the starter's switches and LEDs are, so a hand-built solution can use them. */
export const startOf = (inputs: string[], outputs: string[]) => {
  const b = new CircuitBuilder()
  const ins = Object.fromEntries(inputs.map((name, i) => [name, b.add('switch', 0, i * 70, { label: name })]))
  const outs = Object.fromEntries(outputs.map((name, i) => [name, b.add('led', 460, i * 70, { label: name })]))
  return { b, ins, outs }
}

export function comb(c: Omit<CombChallenge, 'kind' | 'starter' | 'solution'> & { solution?: () => Circuit }): CombChallenge {
  const { solution, ...rest } = c
  return {
    ...rest,
    kind: 'comb',
    starter: starterOf(c.inputs, c.outputs),
    solution:
      solution ??
      (() => {
        const { statements } = parseProgram(c.goal)
        const { program } = resolveProgram(statements)
        return synthesize({ ...program!, inputs: c.inputs })
      }),
  }
}

export function seq(c: Omit<SeqChallenge, 'kind' | 'starter'>): SeqChallenge {
  return { ...c, kind: 'seq', starter: starterOf(c.inputs, c.outputs) }
}

// ---- Hand-built solutions, for challenges that limit the parts --------------------------------------

/** A OR B from NAND gates only: a NAND with both inputs tied together is an inverter. */
function orFromNand(): Circuit {
  const { b, ins, outs } = startOf(['A', 'B'], ['Y'])
  const na = b.add('nand', 150, 0)
  const nb = b.add('nand', 150, 90)
  const out = b.add('nand', 290, 40)
  b.wire(`${ins.A}.Q`, `${na}.A`)
  b.wire(`${ins.A}.Q`, `${na}.B`)
  b.wire(`${ins.B}.Q`, `${nb}.A`)
  b.wire(`${ins.B}.Q`, `${nb}.B`)
  b.wire(`${na}.Y`, `${out}.A`)
  b.wire(`${nb}.Y`, `${out}.B`)
  b.wire(`${out}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** A XOR B as (A OR B) AND NOT (A AND B). */
function xorFromBasics(): Circuit {
  const { b, ins, outs } = startOf(['A', 'B'], ['Y'])
  const either = b.add('or', 130, 0)
  const both = b.add('and', 130, 90)
  const notBoth = b.add('not', 250, 100)
  const out = b.add('and', 340, 20)
  b.wire(`${ins.A}.Q`, `${either}.A`)
  b.wire(`${ins.B}.Q`, `${either}.B`)
  b.wire(`${ins.A}.Q`, `${both}.A`)
  b.wire(`${ins.B}.Q`, `${both}.B`)
  b.wire(`${both}.Y`, `${notBoth}.A`)
  b.wire(`${either}.Y`, `${out}.A`)
  b.wire(`${notBoth}.Y`, `${out}.B`)
  b.wire(`${out}.Y`, `${outs.Y}.A`)
  return b.build()
}

/** Even parity of four bits in one XNOR gate with four inputs. */
function parityGate(): Circuit {
  const { b, ins, outs } = startOf(['A', 'B', 'C', 'D'], ['Even'])
  const g = b.add('xnor', 200, 60, { params: { inputs: 4 } })
  for (const [i, name] of ['A', 'B', 'C', 'D'].entries()) b.wire(`${ins[name]}.Q`, `${g}.${String.fromCharCode(65 + i)}`)
  b.wire(`${g}.Y`, `${outs.Even}.A`)
  return b.build()
}

/** Two NOR gates feeding each other. */
function norLatch(): Circuit {
  const { b, ins, outs } = startOf(['S', 'R'], ['Q', 'NQ'])
  const g1 = b.add('nor', 180, 0)
  const g2 = b.add('nor', 180, 100)
  b.wire(`${ins.R}.Q`, `${g1}.A`)
  b.wire(`${g2}.Y`, `${g1}.B`)
  b.wire(`${ins.S}.Q`, `${g2}.B`)
  b.wire(`${g1}.Y`, `${g2}.A`)
  b.wire(`${g1}.Y`, `${outs.Q}.A`)
  b.wire(`${g2}.Y`, `${outs.NQ}.A`)
  return b.build()
}

/** An SR latch from four NAND gates, with the reset line made from D by an inverter. */
function nandDLatch(): Circuit {
  const { b, ins, outs } = startOf(['D', 'E'], ['Q'])
  const inv = b.add('not', 100, 130)
  const n1 = b.add('nand', 200, 0)
  const n2 = b.add('nand', 200, 130)
  const q = b.add('nand', 340, 10)
  const nq = b.add('nand', 340, 120)
  b.wire(`${ins.D}.Q`, `${n1}.A`)
  b.wire(`${ins.E}.Q`, `${n1}.B`)
  b.wire(`${ins.D}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${n2}.A`)
  b.wire(`${ins.E}.Q`, `${n2}.B`)
  b.wire(`${n1}.Y`, `${q}.A`)
  b.wire(`${nq}.Y`, `${q}.B`)
  b.wire(`${q}.Y`, `${nq}.A`)
  b.wire(`${n2}.Y`, `${nq}.B`)
  b.wire(`${q}.Y`, `${outs.Q}.A`)
  return b.build()
}

// ---- The challenges -------------------------------------------------------------------------------

const BASICS = 'Getting started'
const COMBINING = 'Combining gates'
const ARITHMETIC = 'Arithmetic and selection'
const MEMORY = 'Memory'

export const CHALLENGES: Challenge[] = [
  comb({
    id: 'wire',
    group: BASICS,
    title: 'Make the light follow the switch',
    lesson: [
      'A switch holds a 0 (off) or a 1 (on); click it to flip it. An LED shows what arrives at its pin: lit for 1, dark for 0. A wire carries the signal from a pin on one part to a pin on another: drag from one pin to the other.',
      'Press Run to start the simulation, then try your circuit by flipping the switch.',
    ],
    task: 'Connect the switch A to the LED Y, so that Y is on exactly when A is.',
    hint: 'Drag from the little pin at the right of the switch to the pin at the left of the LED.',
    inputs: ['A'],
    outputs: ['Y'],
    goal: 'Y = A',
  }),
  comb({
    id: 'not',
    group: BASICS,
    title: 'Invert the signal',
    lesson: [
      'A NOT gate (an inverter) turns a 0 into a 1 and a 1 into a 0. Gates are in the parts list on the left: drag one onto the canvas, then wire the switch to its input and its output to the LED.',
    ],
    task: 'Make Y the opposite of A.',
    hint: 'Place a NOT gate between the switch and the LED.',
    inputs: ['A'],
    outputs: ['Y'],
    goal: 'Y = ¬A',
  }),
  comb({
    id: 'and',
    group: BASICS,
    title: 'Both must be on',
    lesson: [
      'An AND gate gives 1 only when all of its inputs are 1. Its truth table lists the output for every combination of the inputs, and is how this challenge is checked: your circuit is tried with every combination of the switches.',
    ],
    task: 'Make Y light up only when both A and B are on.',
    hint: 'One AND gate does it.',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    goal: 'Y = A·B',
  }),
  comb({
    id: 'or',
    group: BASICS,
    title: 'Either will do',
    lesson: ['An OR gate gives 1 when at least one of its inputs is 1, and 0 only when all of them are 0.'],
    task: 'Make Y light up when A is on, when B is on, or both.',
    hint: 'One OR gate does it.',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    goal: 'Y = A + B',
  }),
  comb({
    id: 'nand',
    group: BASICS,
    title: 'Not both',
    lesson: ['A NAND gate is an AND followed by a NOT: it gives 0 only when all of its inputs are 1. It is the most common gate in real chips, because every other gate can be made from it.'],
    task: 'Make Y dark only when both A and B are on.',
    hint: 'Use a NAND gate, or an AND followed by a NOT.',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    goal: 'Y = ¬(A·B)',
  }),
  comb({
    id: 'a-not-b',
    group: COMBINING,
    title: 'A but not B',
    lesson: ['Gates can be chained: the output of one is the input of the next. Invert a signal with a NOT gate before it reaches another gate to ask for "off" instead of "on".'],
    task: 'Make Y light up when A is on and B is off.',
    hint: 'Pass B through a NOT gate, then AND it with A.',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    goal: 'Y = A·¬B',
  }),
  comb({
    id: 'xor-basics',
    group: COMBINING,
    title: 'Different, with the basics only',
    lesson: [
      'XOR ("exclusive or") is 1 when the inputs differ. It is the one gate in this list that is not a plain "and"/"or"/"not", but it can be built from them: "A or B, but not both".',
      'Some challenges limit which parts you may use, to make you work out how. The limits are shown with the task.',
    ],
    task: 'Make Y light up when A and B differ, using only AND, OR and NOT gates (no XOR).',
    hint: 'Y = (A OR B) AND NOT (A AND B): that is two gates feeding a third, with an inverter on one of them.',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    goal: 'Y = A ⊕ B',
    rules: { only: ['and', 'or', 'not'] },
    solution: xorFromBasics,
  }),
  comb({
    id: 'or-from-nand',
    group: COMBINING,
    title: 'Everything from NAND',
    lesson: [
      'NAND is "universal": any circuit can be built from NAND gates alone. Tie both inputs of a NAND together and it becomes a NOT; a NAND of two inverted signals is an OR (De Morgan: A OR B = NOT(NOT A AND NOT B)).',
    ],
    task: 'Make Y = A OR B using only NAND gates.',
    hint: 'Invert A and B with two NANDs that have both inputs tied together, then NAND the results.',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    goal: 'Y = A + B',
    rules: { only: ['nand'] },
    solution: orFromNand,
  }),
  comb({
    id: 'valid-bcd',
    group: COMBINING,
    title: 'Is it a decimal digit?',
    lesson: [
      'Four switches make a number from 0 to 15 (D3 is the 8s bit, D0 the 1s bit). A decimal digit only goes up to 9, so the numbers 10 to 15 are not digits. Look at the table in the goal: which bits are on in every number from 10 to 15?',
    ],
    task: 'Make Valid light up when the number D3 D2 D1 D0 is from 0 to 9.',
    hint: '10 to 15 all have D3 on, and D2 or D1 on as well. Valid = NOT (D3·D2 + D3·D1).',
    inputs: ['D3', 'D2', 'D1', 'D0'],
    outputs: ['Valid'],
    goal: 'Valid = ¬(D3·D2 + D3·D1)',
  }),
  comb({
    id: 'parity',
    group: COMBINING,
    title: 'Even number of ones',
    lesson: ['Gates can have more than two inputs: select one and change "Inputs" in the panel on the right. A XNOR gate with several inputs is 1 when an even number of them are 1, which makes it a parity checker.'],
    task: 'Make Even light up when an even number of A, B, C and D are on (zero counts as even), using at most two parts.',
    hint: 'A single XNOR gate with four inputs does it.',
    inputs: ['A', 'B', 'C', 'D'],
    outputs: ['Even'],
    goal: 'Even = ¬(A ⊕ B ⊕ C ⊕ D)',
    rules: { maxParts: 2 },
    solution: parityGate,
  }),
  comb({
    id: 'majority',
    group: ARITHMETIC,
    title: 'Majority vote',
    lesson: ['Write down the rows of the truth table where the output is 1 and AND the inputs of each; OR the results together: that is always a correct circuit ("sum of products"), though not always the smallest.'],
    task: 'Make Y light up when at least two of A, B and C are on.',
    hint: 'Y = A·B + A·C + B·C: three AND gates feeding one OR gate with three inputs.',
    inputs: ['A', 'B', 'C'],
    outputs: ['Y'],
    goal: 'Y = A·B + A·C + B·C',
  }),
  comb({
    id: 'mux',
    group: ARITHMETIC,
    title: 'Choose one of two',
    lesson: ['A multiplexer passes one of its inputs on, chosen by a select input. With S off it passes A, with S on it passes B. Multiplexers are everywhere in computers: they choose where data comes from.'],
    task: 'Make Y equal A when S is off, and B when S is on.',
    hint: 'Y = S·B + ¬S·A.',
    inputs: ['S', 'A', 'B'],
    outputs: ['Y'],
    goal: 'Y = S·B + ¬S·A',
  }),
  comb({
    id: 'half-adder',
    group: ARITHMETIC,
    title: 'Add two bits',
    lesson: ['Adding two one-bit numbers gives 0, 1 or 2 (binary 10). The low bit of the answer is the Sum, the high bit is the Carry. A half adder is just two gates.'],
    task: 'Make Sum and Carry the two bits of A + B.',
    hint: 'Sum is 1 when A and B differ; Carry is 1 when both are on.',
    inputs: ['A', 'B'],
    outputs: ['Sum', 'Carry'],
    goal: 'Sum = A ⊕ B\nCarry = A·B',
  }),
  comb({
    id: 'full-adder',
    group: ARITHMETIC,
    title: 'Add with a carry in',
    lesson: ['To add longer numbers, each column also has to add the carry from the column before it. A full adder adds three bits: A, B and Cin. Chain full adders and you can add numbers of any length.'],
    task: 'Make Sum and Cout the two bits of A + B + Cin.',
    hint: 'Sum = A ⊕ B ⊕ Cin. Cout is on when at least two of the three inputs are on.',
    inputs: ['A', 'B', 'Cin'],
    outputs: ['Sum', 'Cout'],
    goal: 'Sum = A ⊕ B ⊕ Cin\nCout = A·B + A·Cin + B·Cin',
  }),
  comb({
    id: 'compare',
    group: ARITHMETIC,
    title: 'Compare two 2-bit numbers',
    lesson: ['A comparator tells which of two numbers is bigger. Compare the high bits first; only if they are equal does the low bit matter. Two bits are equal when their XOR is 0.'],
    task: 'A is the number A1 A0 and B is B1 B0. Make GT light up when A > B, and EQ when A = B.',
    hint: 'EQ = both bit pairs equal. GT = A1·¬B1, or the high bits are equal and A0·¬B0.',
    inputs: ['A1', 'A0', 'B1', 'B0'],
    outputs: ['GT', 'EQ'],
    goal: 'GT = A1·¬B1 + ¬(A1 ⊕ B1)·A0·¬B0\nEQ = ¬(A1 ⊕ B1)·¬(A0 ⊕ B0)',
  }),
  seq({
    id: 'sr-latch',
    group: MEMORY,
    title: 'A latch that remembers',
    lesson: [
      'So far the output depended only on the switches right now. Feed a gate’s output back into another gate and a circuit can remember. Two NOR gates, each fed by the other’s output, make an SR latch: a pulse on S (set) turns Q on, a pulse on R (reset) turns it off, and with both off it keeps what it had.',
      'This kind of challenge is checked by running steps in order: set the switches, wait, read the LEDs.',
    ],
    task: 'Build an SR latch from NOR gates: Q turns on with S, off with R, and holds when both are off. NQ is always the opposite of Q.',
    hint: 'Q = NOR(R, NQ) and NQ = NOR(S, Q): wire the output of each gate to an input of the other.',
    inputs: ['S', 'R'],
    outputs: ['Q', 'NQ'],
    rules: { only: ['nor'] },
    solution: norLatch,
    steps: [
      { set: { S: 0, R: 1 }, expect: { Q: 0, NQ: 1 } },
      { set: { R: 0 }, expect: { Q: 0, NQ: 1 } },
      { set: { S: 1 }, expect: { Q: 1, NQ: 0 } },
      { set: { S: 0 }, expect: { Q: 1, NQ: 0 } },
      { set: { R: 1 }, expect: { Q: 0, NQ: 1 } },
      { set: { R: 0 }, expect: { Q: 0, NQ: 1 } },
    ],
  }),
  seq({
    id: 'd-latch',
    group: MEMORY,
    title: 'A latch with an enable',
    lesson: ['A gated D latch has one data input D and an enable E. While E is on, Q follows D. When E goes off, Q keeps the last value, and D is ignored until E comes back on. This is the cell that registers and memories are made of.'],
    task: 'Build a gated D latch from gates: Q follows D while E is on, and holds while E is off.',
    hint: 'Gate D with E to make a "set" signal and NOT D with E to make a "reset" signal, then feed those to an SR latch.',
    inputs: ['D', 'E'],
    outputs: ['Q'],
    rules: { only: ['nand', 'nor', 'and', 'or', 'not'] },
    solution: nandDLatch,
    steps: [
      { set: { D: 0, E: 1 }, expect: { Q: 0 } },
      { set: { D: 1 }, expect: { Q: 1 } },
      { set: { E: 0 }, expect: { Q: 1 } },
      { set: { D: 0 }, expect: { Q: 1 } },
      { set: { E: 1 }, expect: { Q: 0 } },
      { set: { E: 0 }, expect: { Q: 0 } },
      { set: { D: 1 }, expect: { Q: 0 } },
    ],
  }),
]

export const getChallenge = (id: string): Challenge | undefined => CHALLENGES.find((c) => c.id === id)

export const challengeGroups = (): { group: string; challenges: Challenge[] }[] => {
  const groups: { group: string; challenges: Challenge[] }[] = []
  for (const c of CHALLENGES) {
    const g = groups.find((x) => x.group === c.group)
    if (g) g.challenges.push(c)
    else groups.push({ group: c.group, challenges: [c] })
  }
  return groups
}

/** The truth table a combinational challenge asks for. */
export function goalTable(c: CombChallenge): TruthTable {
  const { statements } = parseProgram(c.goal)
  const { program } = resolveProgram(statements)
  return tableOfProgram({ ...program!, inputs: c.inputs })
}
