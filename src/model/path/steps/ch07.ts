import { CircuitBuilder } from '../../builder'
import { seq } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId } from '../chips'
import type { Step } from '../types'
import { withChips } from './ch02'

/**
 * Chapter 7: Memory. Palette: NAND, switches, LEDs and the learner's kit; the rule is NAND only (every chip of the kit is NAND inside).
 * The checks are steps that set switches and pulse the clock (`pulse`), and look at the LEDs after each.
 */

const PALETTE = ['nand', 'switch', 'led']

/** One NAND that feeds itself, with an Enable switch: the smallest circuit that never settles. */
function feedbackToPlay(): Circuit {
  const b = new CircuitBuilder()
  const en = b.add('switch', 0, 0, { label: 'Enable' })
  const g = b.add('nand', 140, 0)
  b.wire(`${en}.Q`, `${g}.A`)
  b.wire(`${g}.Y`, `${g}.B`)
  b.wire(`${g}.Y`, `${b.add('led', 300, 0, { label: 'Out' })}.A`)
  return b.build()
}

/** SR: two NORs, each fed by the other's output. */
function srSolution(): Circuit {
  const { b, ins, outs } = withChips(['S', 'R'], ['Q', 'NQ'], ['nor-from-kit'])
  const q = b.ic(chipId('nor-from-kit'), 190, 0)
  const nq = b.ic(chipId('nor-from-kit'), 190, 110)
  b.wire(`${ins.R}.Q`, `${q}.A`)
  b.wire(`${nq}.Y`, `${q}.B`)
  b.wire(`${ins.S}.Q`, `${nq}.A`)
  b.wire(`${q}.Y`, `${nq}.B`)
  b.wire(`${q}.Y`, `${outs.Q}.A`)
  b.wire(`${nq}.Y`, `${outs.NQ}.A`)
  return b.build()
}

/** DLATCH: S = D·E and R = ¬D·E, into an SR latch. */
function dLatchSolution(): Circuit {
  const { b, ins, outs } = withChips(['D', 'E'], ['Q'], ['not-from-nand', 'and-from-nand', 'sr-latch'])
  const inv = b.ic(chipId('not-from-nand'), 100, 90)
  const set = b.ic(chipId('and-from-nand'), 210, 0)
  const reset = b.ic(chipId('and-from-nand'), 210, 110)
  const latch = b.ic(chipId('sr-latch'), 340, 40)
  b.wire(`${ins.D}.Q`, `${set}.A`)
  b.wire(`${ins.E}.Q`, `${set}.B`)
  b.wire(`${ins.D}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${reset}.A`)
  b.wire(`${ins.E}.Q`, `${reset}.B`)
  b.wire(`${set}.Y`, `${latch}.S`)
  b.wire(`${reset}.Y`, `${latch}.R`)
  b.wire(`${latch}.Q`, `${outs.Q}.A`)
  return b.build()
}

/** DFF: a master latch that is open while CLK is low, and a slave that is open while it is high. */
function dffSolution(): Circuit {
  const { b, ins, outs } = withChips(['D', 'CLK'], ['Q'], ['not-from-nand', 'd-latch'])
  const inv = b.ic(chipId('not-from-nand'), 100, 90)
  const master = b.ic(chipId('d-latch'), 210, 0)
  const slave = b.ic(chipId('d-latch'), 340, 20)
  b.wire(`${ins.D}.Q`, `${master}.D`)
  b.wire(`${ins.CLK}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${master}.E`)
  b.wire(`${master}.Q`, `${slave}.D`)
  b.wire(`${ins.CLK}.Q`, `${slave}.E`)
  b.wire(`${slave}.Q`, `${outs.Q}.A`)
  return b.build()
}

/** REG1: a multiplexer in front of a flip-flop, choosing between the new bit and the flip-flop's own output. */
function reg1Solution(): Circuit {
  const { b, ins, outs } = withChips(['D', 'LD', 'CLK'], ['Q'], ['mux', 'dff'])
  const pick = b.ic(chipId('mux'), 150, 20)
  const ff = b.ic(chipId('dff'), 290, 40)
  b.wire(`${ins.LD}.Q`, `${pick}.S`)
  b.wire(`${ff}.Q`, `${pick}.A`)
  b.wire(`${ins.D}.Q`, `${pick}.B`)
  b.wire(`${pick}.Y`, `${ff}.D`)
  b.wire(`${ins.CLK}.Q`, `${ff}.CLK`)
  b.wire(`${ff}.Q`, `${outs.Q}.A`)
  return b.build()
}

const bits = (name: string) => [3, 2, 1, 0].map((i) => `${name}${i}`)

/** REG4: four REG1, sharing LD and CLK. */
function reg4Solution(): Circuit {
  const { b, ins, outs } = withChips([...bits('D'), 'LD', 'CLK'], bits('Q'), ['reg1'])
  bits('D').forEach((d, i) => {
    const r = b.ic(chipId('reg1'), 200, i * 100 - 20)
    b.wire(`${ins[d]}.Q`, `${r}.D`)
    b.wire(`${ins.LD}.Q`, `${r}.LD`)
    b.wire(`${ins.CLK}.Q`, `${r}.CLK`)
    b.wire(`${r}.Q`, `${outs[`Q${3 - i}`]}.A`)
  })
  return b.build()
}

/** A word on D3 to D0 as the switches of a step. */
const word = (n: number) => ({ D3: (n >> 3) & 1, D2: (n >> 2) & 1, D1: (n >> 1) & 1, D0: n & 1 }) as Record<string, 0 | 1>
const out4 = (n: number) => ({ Q3: (n >> 3) & 1, Q2: (n >> 2) & 1, Q1: (n >> 1) & 1, Q0: n & 1 }) as Record<string, 0 | 1>

export const CH07: Step[] = [
  {
    id: 'feedback',
    chapter: 'memory',
    title: 'A gate that feeds itself',
    kind: 'explore',
    summary: 'Wire a gate’s output back to its own input and watch it never settle.',
    open: { build: feedbackToPlay },
    palette: PALETTE,
    task: 'Turn Enable on and watch the circuit fail to settle, then turn it off again.',
    goals: [
      { oscillating: true, text: 'The circuit never settles' },
      { switches: { Enable: 0 }, text: 'Enable is off again, and the gate settles' },
    ],
    ordered: true,
    lesson: [
      { p: 'Everything you have built so far had an answer that depended only on the switches. There was no way to tell what the circuit had done a moment ago. To remember, a circuit has to be able to look at its own output: a wire from the output of a gate round to one of its own inputs.' },
      { p: 'This is the simplest such circuit: a NAND whose output goes back to its own input B. While [[Enable]] is off, the NAND is 1 whatever its other input does, so it is steady. Turn [[Enable]] on and the NAND becomes a NOT of its own output: if the output is 1 it must become 0, and then 1 again, for ever. The simulator notices that it cannot settle and says so.' },
      { p: 'A gate that contradicts itself is no use. Next you will feed two gates to each other in a way that agrees with itself, and then the circuit has two steady states: it can hold a 0 or a 1, and which one depends on what happened last. That is a bit of memory.' },
    ],
  },
  {
    id: 'sr-latch',
    chapter: 'memory',
    title: 'Two NORs that remember',
    kind: 'build',
    summary: 'The SR latch: a pulse on S sets Q, a pulse on R resets it, and with both off it keeps what it had.',
    palette: PALETTE,
    chip: 'SR',
    uses: ['nor-from-kit'],
    challenge: 'sr-latch',
    rules: { only: ['nand'] },
    solution: srSolution,
    lesson: [
      { p: 'Take two NOR gates and feed the output of each into an input of the other. Q = NOR(R, NQ) and NQ = NOR(S, Q). Unlike the NAND that fed itself, this agrees with itself in two ways: Q on and NQ off, or Q off and NQ on. Once it is in one of those, it stays there.' },
      { p: 'The other inputs, S for set and R for reset, push it from one to the other. A pulse on S makes NQ off, which lets Q come on; a pulse on R does the opposite. With both off, the loop holds, and that holding is the memory. Do not turn both on together: the latch cannot make up its mind, and when you let go of both the winner is a matter of luck.' },
      { p: 'The check sets and resets the latch and looks at Q and NQ after each change. Build it from two NORs of your kit.' },
    ],
  },
  {
    id: 'd-latch',
    chapter: 'memory',
    title: 'A latch with an enable',
    kind: 'build',
    summary: 'A latch that follows D while E is on and holds when E is off.',
    palette: PALETTE,
    chip: 'DLATCH',
    uses: ['not-from-nand', 'and-from-nand', 'sr-latch'],
    challenge: 'd-latch',
    rules: { only: ['nand'] },
    solution: dLatchSolution,
    lesson: [
      { p: 'An SR latch has two inputs that mean “set” and “reset”, which is awkward: you must remember never to press both. What you want is one wire with the value you want to store, D, and one wire that says “now”, E for enable.' },
      { p: 'Build that from the SR latch. While E is on, S should be D and R should be NOT D, so Q follows D. While E is off, both S and R should be off, so the latch holds. S = D AND E, and R = NOT D AND E: that does both, and the two can never be on together.' },
      { p: 'This is the D latch, the cell that every register and every memory chip is made of.' },
    ],
  },
  {
    id: 'dff',
    chapter: 'memory',
    title: 'The flip-flop',
    kind: 'build',
    summary: 'Two D latches in a row, one open while the clock is low and one while it is high, store D when the clock rises.',
    palette: PALETTE,
    chip: 'DFF',
    uses: ['not-from-nand', 'd-latch'],
    challenge: seq({
      id: 'path-dff',
      group: 'Learn: Memory',
      title: 'D flip-flop',
      lesson: [],
      task: 'Make Q take the value of D at the moment CLK goes from 0 to 1, and keep it until the next time. Changing D at any other time must do nothing.',
      hint: 'Two D latches in a row. The first is open when CLK is 0 (give it NOT CLK), the second is open when CLK is 1.',
      inputs: ['D', 'CLK'],
      outputs: ['Q'],
      rules: { only: ['nand'] },
      solution: dffSolution,
      steps: [
        // A flip-flop powers up knowing nothing: the first tick gives it a value.
        { set: { D: 0 }, pulse: 'CLK', expect: { Q: 0 } },
        { set: { D: 1 }, expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: { D: 0 }, expect: { Q: 1 } },
        { set: {}, pulse: 'CLK', expect: { Q: 0 } },
        { set: { D: 1 }, expect: { Q: 0 } },
        { set: { CLK: 1 }, expect: { Q: 1 } },
        { set: { D: 0 }, expect: { Q: 1 } },
        { set: { CLK: 0 }, expect: { Q: 1 } },
        { set: {}, pulse: 'CLK', expect: { Q: 0 } },
      ],
    }),
    solution: dffSolution,
    lesson: [
      { p: 'A D latch listens to D for as long as E is on, which is a problem when many latches pass numbers along and a number can race all the way through them in one go. A computer wants every register to take its new value at the same instant: when the clock ticks.' },
      { p: 'The trick is two latches in a row. The first, the master, is open while CLK is 0 and so follows D; the second, the slave, is open while CLK is 1 and follows the master. The instant CLK rises, the master closes holding whatever D was, and the slave opens and passes that on. While CLK stays at 1, the master is shut: changing D does nothing. That is a D flip-flop: it samples D on the rising edge of the clock.' },
      { p: 'In the table, ⏉ marks a pulse of CLK: it goes to 1 and back to 0. The check also raises CLK and leaves it up, changing D, to see that nothing follows. A flip-flop powers up knowing nothing, so the first step gives it a value with one tick.' },
    ],
  },
  {
    id: 'reg1',
    chapter: 'memory',
    title: 'One bit you can load',
    kind: 'build',
    summary: 'A flip-flop and a multiplexer: it takes D on a clock tick only when LD is on.',
    palette: PALETTE,
    chip: 'REG1',
    uses: ['mux', 'dff'],
    challenge: seq({
      id: 'path-reg1',
      group: 'Learn: Memory',
      title: 'One-bit register',
      lesson: [],
      task: 'On a clock tick, Q takes D if LD is on, and keeps its value if LD is off.',
      hint: 'A flip-flop ticks every time, so put a multiplexer in front of its D: LD chooses between the new D and the flip-flop’s own Q.',
      inputs: ['D', 'LD', 'CLK'],
      outputs: ['Q'],
      rules: { only: ['nand'] },
      solution: reg1Solution,
      steps: [
        { set: { D: 0, LD: 1 }, pulse: 'CLK', expect: { Q: 0 } },
        { set: { D: 1 }, expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: { D: 0, LD: 0 }, expect: { Q: 1 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: { LD: 1 }, expect: { Q: 1 } },
        { set: {}, pulse: 'CLK', expect: { Q: 0 } },
        { set: { D: 1, LD: 0 }, expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 0 } },
        { set: { LD: 1 }, expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
      ],
    }),
    solution: reg1Solution,
    lesson: [
      { p: 'Your flip-flop takes D at every tick of the clock. A register is more polite: it has a load input, LD, and keeps its bit unless LD says “take the new one”. A computer has one clock for all of it, so the register cannot turn the clock off; it has to feed its own value back in.' },
      { p: 'You already have the part that chooses. A multiplexer with LD as its select: with LD off it passes the flip-flop’s own Q back to its D, so the tick changes nothing; with LD on it passes the new D. Wire the multiplexer’s output to the flip-flop.' },
    ],
  },
  {
    id: 'reg4',
    chapter: 'memory',
    title: 'A four-bit register',
    kind: 'build',
    summary: 'Four one-bit registers with one clock and one load: a whole number to keep.',
    palette: PALETTE,
    chip: 'REG4',
    uses: ['reg1'],
    challenge: seq({
      id: 'path-reg4',
      group: 'Learn: Memory',
      title: 'Four-bit register',
      lesson: [],
      task: 'On a clock tick, Q3 to Q0 take D3 to D0 if LD is on, and keep their value if LD is off.',
      hint: 'Four REG1 side by side. The four D inputs are separate; LD and CLK go to all four.',
      inputs: ['D3', 'D2', 'D1', 'D0', 'LD', 'CLK'],
      outputs: ['Q3', 'Q2', 'Q1', 'Q0'],
      rules: { only: ['nand'] },
      solution: reg4Solution,
      steps: [
        { set: { ...word(0), LD: 1 }, pulse: 'CLK', expect: out4(0) },
        { set: { ...word(10) }, expect: out4(0) },
        { set: {}, pulse: 'CLK', expect: out4(10) },
        { set: { ...word(5), LD: 0 }, expect: out4(10) },
        { set: {}, pulse: 'CLK', expect: out4(10) },
        { set: { LD: 1 }, expect: out4(10) },
        { set: {}, pulse: 'CLK', expect: out4(5) },
        { set: { ...word(10), LD: 0 }, expect: out4(5) },
        { set: {}, pulse: 'CLK', expect: out4(5) },
        { set: { ...word(0), LD: 1 }, expect: out4(5) },
        { set: {}, pulse: 'CLK', expect: out4(0) },
      ],
    }),
    solution: reg4Solution,
    lesson: [
      { p: 'A number is four bits, so a register that holds a number is four of your one-bit registers side by side. Each has its own D and its own Q; they share one LD and one CLK, so that all four bits are loaded on the same tick or none are.' },
      { p: 'This is the register of the computer you will build: it holds the accumulator, the value the computer is working on, and the next chapter makes it count.' },
    ],
  },
]
