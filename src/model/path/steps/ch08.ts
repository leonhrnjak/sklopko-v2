import { CircuitBuilder } from '../../builder'
import { comb, seq } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId } from '../chips'
import type { Step } from '../types'
import { withChips } from './ch02'

/**
 * Chapter 8: Counting and memories. Palette: NAND, switches, LEDs and the learner's kit; the rule is NAND only (every chip of the kit is
 * NAND inside). Clocked circuits power up knowing nothing, so each has a CLR that clears it on the next clock tick.
 */

const PALETTE = ['nand', 'switch', 'led']

const bits = (name: string) => [3, 2, 1, 0].map((i) => `${name}${i}`)
const num = (n: number, name: string) => Object.fromEntries(bits(name).map((k, i) => [k, (n >> (3 - i)) & 1])) as Record<string, 0 | 1>

/** T flip-flop: the flip-flop's D is its own Q XOR T, cleared when CLR is on. */
function tffSolution(): Circuit {
  const { b, ins, outs } = withChips(['T', 'CLR', 'CLK'], ['Q'], ['dff', 'xor-from-kit', 'not-from-nand', 'and-from-nand'])
  const flip = b.ic(chipId('xor-from-kit'), 130, 0)
  const nclr = b.ic(chipId('not-from-nand'), 130, 140)
  const keep = b.ic(chipId('and-from-nand'), 250, 40)
  const ff = b.ic(chipId('dff'), 360, 40)
  b.wire(`${ff}.Q`, `${flip}.A`)
  b.wire(`${ins.T}.Q`, `${flip}.B`)
  b.wire(`${ins.CLR}.Q`, `${nclr}.A`)
  b.wire(`${flip}.Y`, `${keep}.A`)
  b.wire(`${nclr}.Y`, `${keep}.B`)
  b.wire(`${keep}.Y`, `${ff}.D`)
  b.wire(`${ins.CLK}.Q`, `${ff}.CLK`)
  b.wire(`${ff}.Q`, `${outs.Q}.A`)
  return b.build()
}

/** COUNT4: a register whose next value is its own value plus EN (the carry in of the adder), cleared by CLR. */
function counterSolution(): Circuit {
  const { b, ins, outs } = withChips(['EN', 'CLR', 'CLK'], bits('Q'), ['reg4', 'adder4', 'not-from-nand', 'and-from-nand', 'or-from-nand'])
  const nclr = b.ic(chipId('not-from-nand'), 110, 330)
  const load = b.ic(chipId('or-from-nand'), 110, 440)
  const add = b.ic(chipId('adder4'), 230, -30)
  const reg = b.ic(chipId('reg4'), 520, 20)
  b.wire(`${ins.CLR}.Q`, `${nclr}.A`)
  b.wire(`${ins.EN}.Q`, `${load}.A`)
  b.wire(`${ins.CLR}.Q`, `${load}.B`)
  b.wire(`${ins.EN}.Q`, `${add}.Cin`)
  const zero = b.add('const', 150, 330, { params: { value: 0 } })
  for (const k of [3, 2, 1, 0]) b.wire(`${zero}.Q`, `${add}.B${k}`)
  b.wire(`${load}.Y`, `${reg}.LD`)
  b.wire(`${ins.CLK}.Q`, `${reg}.CLK`)
  bits('Q').forEach((q, i) => {
    const clear = b.ic(chipId('and-from-nand'), 390, i * 80)
    b.wire(`${reg}.${q}`, `${add}.A${3 - i}`)
    b.wire(`${add}.S${3 - i}`, `${clear}.A`)
    b.wire(`${nclr}.Y`, `${clear}.B`)
    b.wire(`${clear}.Y`, `${reg}.D${3 - i}`)
    b.wire(`${reg}.${q}`, `${outs[q]}.A`)
  })
  return b.build()
}

/** PC: as the counter, with a multiplexer in front of each bit to load D instead of counting. */
function pcSolution(): Circuit {
  const { b, ins, outs } = withChips([...bits('D'), 'LD', 'EN', 'CLR', 'CLK'], bits('Q'), ['reg4', 'adder4', 'mux', 'not-from-nand', 'and-from-nand', 'or-from-nand'])
  const nclr = b.ic(chipId('not-from-nand'), 110, 560)
  const either = b.ic(chipId('or-from-nand'), 110, 640)
  const load = b.ic(chipId('or-from-nand'), 230, 640)
  const add = b.ic(chipId('adder4'), 230, -30)
  const reg = b.ic(chipId('reg4'), 640, 20)
  b.wire(`${ins.LD}.Q`, `${either}.A`)
  b.wire(`${ins.EN}.Q`, `${either}.B`)
  b.wire(`${either}.Y`, `${load}.A`)
  b.wire(`${ins.CLR}.Q`, `${load}.B`)
  b.wire(`${load}.Y`, `${reg}.LD`)
  b.wire(`${ins.CLR}.Q`, `${nclr}.A`)
  b.wire(`${ins.EN}.Q`, `${add}.Cin`)
  const zero = b.add('const', 150, 560, { params: { value: 0 } })
  for (const k of [3, 2, 1, 0]) b.wire(`${zero}.Q`, `${add}.B${k}`)
  b.wire(`${ins.CLK}.Q`, `${reg}.CLK`)
  bits('Q').forEach((q, i) => {
    const k = 3 - i
    const pick = b.ic(chipId('mux'), 370, i * 130)
    const clear = b.ic(chipId('and-from-nand'), 510, i * 130)
    b.wire(`${reg}.${q}`, `${add}.A${k}`)
    b.wire(`${ins.LD}.Q`, `${pick}.S`)
    b.wire(`${add}.S${k}`, `${pick}.A`)
    b.wire(`${ins[`D${k}`]}.Q`, `${pick}.B`)
    b.wire(`${pick}.Y`, `${clear}.A`)
    b.wire(`${nclr}.Y`, `${clear}.B`)
    b.wire(`${clear}.Y`, `${reg}.D${k}`)
    b.wire(`${reg}.${q}`, `${outs[q]}.A`)
  })
  return b.build()
}

/** The four words of the ROM of step 8.4, at addresses 0 to 3. */
const ROM_WORDS = [0b0101, 0b0011, 0b1100, 0b1010]

/** The addresses at which a bit of the ROM's words is 1. */
const romLines = (bit: number) => ROM_WORDS.flatMap((w, a) => ((w >> bit) & 1 ? [a] : []))

const minterm = (a: number) => `${a & 2 ? 'A1' : '¬A1'}·${a & 1 ? 'A0' : '¬A0'}`
const romGoal = () => [3, 2, 1, 0].map((bit) => `D${bit} = ${romLines(bit).map(minterm).join(' + ')}`).join('\n')

/** The ROM: a decoder picks the address; each data bit is an OR of the address lines whose word has that bit. */
function romSolution(): Circuit {
  const { b, ins, outs } = withChips(['A1', 'A0'], bits('D'), ['decoder', 'or-from-nand'])
  const dec = b.ic(chipId('decoder'), 120, 80)
  b.wire(`${ins.A1}.Q`, `${dec}.A1`)
  b.wire(`${ins.A0}.Q`, `${dec}.A0`)
  ;[3, 2, 1, 0].forEach((bit, i) => {
    const lines = romLines(bit)
    const any = b.ic(chipId('or-from-nand'), 320, i * 90)
    b.wire(`${dec}.Y${lines[0]}`, `${any}.A`)
    b.wire(`${dec}.Y${lines[1]}`, `${any}.B`)
    b.wire(`${any}.Y`, `${outs[`D${bit}`]}.A`)
  })
  return b.build()
}

/** RAM4: a decoder and WE choose which of four REG4 loads; the built-in 4:1 multiplexer of each bit picks the word to read. */
function ramSolution(): Circuit {
  const { b, ins, outs } = withChips([...bits('D'), 'A1', 'A0', 'WE', 'CLK'], bits('Q'), ['reg4', 'decoder', 'and-from-nand'])
  const dec = b.ic(chipId('decoder'), 120, 560)
  b.wire(`${ins.A1}.Q`, `${dec}.A1`)
  b.wire(`${ins.A0}.Q`, `${dec}.A0`)
  const words = [0, 1, 2, 3].map((w) => {
    const write = b.ic(chipId('and-from-nand'), 250, 560 + w * 90)
    const reg = b.ic(chipId('reg4'), 400, w * 140 - 20)
    b.wire(`${dec}.Y${w}`, `${write}.A`)
    b.wire(`${ins.WE}.Q`, `${write}.B`)
    b.wire(`${write}.Y`, `${reg}.LD`)
    b.wire(`${ins.CLK}.Q`, `${reg}.CLK`)
    for (const d of bits('D')) b.wire(`${ins[d]}.Q`, `${reg}.${d}`)
    return reg
  })
  bits('Q').forEach((q, i) => {
    const pick = b.add('mux', 640, i * 140, { params: { n: 4 } })
    words.forEach((reg, w) => b.wire(`${reg}.${q}`, `${pick}.I${w}`))
    b.wire(`${ins.A1}.Q`, `${pick}.S1`)
    b.wire(`${ins.A0}.Q`, `${pick}.S0`)
    b.wire(`${pick}.Y`, `${outs[q]}.A`)
  })
  return b.build()
}

/** A built-in RAM (16 words) and a ROM holding the digits of pi, with an address and data to choose, and a write switch and a clock. */
function memoriesToPlay(): Circuit {
  const b = new CircuitBuilder()
  const addr = b.add('hexin', 0, 0, { label: 'Address' })
  const data = b.add('hexin', 0, 130, { label: 'Data' })
  const we = b.add('switch', 0, 260, { label: 'WE' })
  const clk = b.add('switch', 0, 320, { label: 'CLK' })
  const ram = b.add('ram', 220, 130, { label: 'RAM' })
  const rom = b.add('rom', 220, -140, { label: 'ROM', params: { data: '3 1 4 1 5 9 2 6 5 3 5 8 9 7 9 3' } })
  const ramOut = b.add('hexdisp', 480, 130, { label: 'RAM out' })
  const romOut = b.add('hexdisp', 480, -140, { label: 'ROM out' })
  for (let i = 0; i < 4; i++) {
    const pin = 'ABCD'[i]
    b.wire(`${addr}.${pin}`, `${ram}.A${i}`)
    b.wire(`${addr}.${pin}`, `${rom}.A${i}`)
    b.wire(`${data}.${pin}`, `${ram}.D${i}`)
    b.wire(`${ram}.Q${i}`, `${ramOut}.${pin}`)
    b.wire(`${rom}.D${i}`, `${romOut}.${pin}`)
  }
  b.wire(`${we}.Q`, `${ram}.WE`)
  b.wire(`${clk}.Q`, `${ram}.CLK`)
  return b.build()
}

export const CH08: Step[] = [
  {
    id: 'tff',
    chapter: 'counting',
    title: 'A flip-flop that toggles',
    kind: 'build',
    summary: 'The T flip-flop: while T is on, Q flips on every tick.',
    palette: PALETTE,
    chip: 'TFF',
    uses: ['dff', 'xor-from-kit', 'not-from-nand', 'and-from-nand'],
    challenge: seq({
      id: 'path-tff',
      group: 'Learn: Counting',
      title: 'T flip-flop',
      lesson: [],
      task: 'On a clock tick, Q flips if T is on and stays if T is off. CLR on makes the tick clear Q to 0 instead.',
      hint: 'D must be the opposite of Q when T is on, and Q itself when T is off: that is Q XOR T. Then force D to 0 when CLR is on with an AND of the XOR and NOT CLR.',
      inputs: ['T', 'CLR', 'CLK'],
      outputs: ['Q'],
      rules: { only: ['nand'] },
      solution: tffSolution,
      steps: [
        // A flip-flop powers up knowing nothing, so the first tick clears it.
        { set: { T: 0, CLR: 1 }, pulse: 'CLK', expect: { Q: 0 } },
        { set: { CLR: 0, T: 1 }, expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: {}, pulse: 'CLK', expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: { T: 0 }, pulse: 'CLK', expect: { Q: 1 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: { T: 1 }, pulse: 'CLK', expect: { Q: 0 } },
        { set: {}, pulse: 'CLK', expect: { Q: 1 } },
        { set: { CLR: 1 }, pulse: 'CLK', expect: { Q: 0 } },
      ],
    }),
    solution: tffSolution,
    lesson: [
      { p: 'Your register keeps a value; the next step is a flip-flop that changes it by itself. A toggle, or T, flip-flop flips its output on every clock tick while T is on, and keeps it while T is off. If a flip-flop toggles on every tick, its output goes up and down at half the speed of the clock: a divide-by-two, the first step of counting.' },
      { p: 'You already have everything: a D flip-flop whose D is “my own Q, flipped when T is on”. Flipping a bit when T is on is an XOR: Q XOR T is Q when T is 0 and NOT Q when T is 1.' },
      { p: 'A circuit like this has a problem at power-up: the flip-flop knows nothing, so its own Q, fed back, keeps it unknown for ever. Real counters have a clear input. Add CLR: when it is on, the next tick sets Q to 0 whatever else is happening. That is an AND of the XOR with NOT CLR.' },
    ],
  },
  {
    id: 'counter4',
    chapter: 'counting',
    title: 'A counter',
    kind: 'build',
    summary: 'A 4-bit register that adds one to itself on every tick, from 0 to 15 and round again.',
    chip: 'COUNT4',
    palette: [...PALETTE, 'const'],
    uses: ['reg4', 'adder4', 'not-from-nand', 'and-from-nand', 'or-from-nand'],
    challenge: seq({
      id: 'path-counter4',
      group: 'Learn: Counting',
      title: 'Four-bit counter',
      lesson: [],
      task: 'Q3 to Q0 count up by one on every clock tick while EN is on. CLR on makes the tick clear them to 0.',
      hint: 'Your REG4 holds the number. Feed it back through an ADD4 (B tied to a Constant 0, Cin = EN, so it adds 1 only when EN is on) and clear it with an AND of each bit with NOT CLR. The register loads when EN or CLR is on.',
      inputs: ['EN', 'CLR', 'CLK'],
      outputs: bits('Q'),
      rules: { only: ['nand'] },
      solution: counterSolution,
      steps: [
        { set: { EN: 0, CLR: 1 }, pulse: 'CLK', expect: num(0, 'Q') },
        { set: { CLR: 0 }, pulse: 'CLK', expect: num(0, 'Q') },
        { set: { EN: 1 }, expect: num(0, 'Q') },
        ...Array.from({ length: 17 }, (_, i) => ({ set: {}, pulse: 'CLK', expect: num((i + 1) & 15, 'Q') })),
        { set: { EN: 0 }, pulse: 'CLK', expect: num(1, 'Q') },
        { set: { CLR: 1 }, pulse: 'CLK', expect: num(0, 'Q') },
      ],
    }),
    solution: counterSolution,
    lesson: [
      { p: 'A counter is a register that adds one to itself on every tick. You have both parts: your REG4 holds the number, and your ADD4 can add. Wire the register’s output into one side of the adder, add 1, and feed the sum back into the register.' },
      { p: 'The adder adds the carry in, Cin, to the number: if Cin is 1 it computes the number plus 1, and if Cin is 0 it computes the number itself. So wire EN, the “count” switch, to Cin: the counter counts while EN is on and holds while it is off. The other side of the adder, B, is not used: tie all four of its bits to a Constant part set to 0 (a pin that is connected to nothing is unknown, not 0).' },
      { p: 'The register has to load every tick for this to work when EN is on, and when CLR is on. Give it LD = EN OR CLR, and clear each sum bit with an AND with NOT CLR, as you did for the T flip-flop. After 15 comes 0: the sum does not fit in four bits and its carry out is not kept, so the counter wraps round. The check counts 17 ticks.' },
    ],
  },
  {
    id: 'pc',
    chapter: 'counting',
    title: 'A program counter',
    kind: 'build',
    summary: 'A counter that can also load a number: count on to the next instruction, or jump.',
    palette: [...PALETTE, 'const'],
    chip: 'PC',
    uses: ['reg4', 'adder4', 'mux', 'not-from-nand', 'and-from-nand', 'or-from-nand'],
    challenge: seq({
      id: 'path-pc',
      group: 'Learn: Counting',
      title: 'Program counter',
      lesson: [],
      task: 'On a tick: CLR clears Q to 0; else LD loads D3 to D0; else EN adds one; else Q stays.',
      hint: 'Your counter, with a multiplexer in front of each bit: LD chooses between the sum and D. The register must load when LD, EN or CLR is on.',
      inputs: [...bits('D'), 'LD', 'EN', 'CLR', 'CLK'],
      outputs: bits('Q'),
      rules: { only: ['nand'] },
      solution: pcSolution,
      steps: [
        { set: { ...num(0, 'D'), LD: 0, EN: 0, CLR: 1 }, pulse: 'CLK', expect: num(0, 'Q') },
        { set: { CLR: 0, EN: 1 }, pulse: 'CLK', expect: num(1, 'Q') },
        { set: {}, pulse: 'CLK', expect: num(2, 'Q') },
        { set: { ...num(9, 'D'), LD: 1 }, pulse: 'CLK', expect: num(9, 'Q') },
        { set: { LD: 0 }, pulse: 'CLK', expect: num(10, 'Q') },
        { set: {}, pulse: 'CLK', expect: num(11, 'Q') },
        { set: { EN: 0 }, pulse: 'CLK', expect: num(11, 'Q') },
        { set: { ...num(6, 'D'), LD: 1 }, pulse: 'CLK', expect: num(6, 'Q') },
        { set: { ...num(15, 'D'), LD: 0 }, pulse: 'CLK', expect: num(6, 'Q') },
        { set: { EN: 1 }, pulse: 'CLK', expect: num(7, 'Q') },
        { set: { LD: 1, CLR: 1 }, pulse: 'CLK', expect: num(0, 'Q') },
      ],
    }),
    solution: pcSolution,
    lesson: [
      { p: 'The part of a computer that says which instruction is next is the program counter, the PC. Most of the time it counts: after instruction 3 comes 4. But a jump has to be able to put a new number in it: go back to 2, go on to 9.' },
      { p: 'So the PC is your counter with a choice in front of each bit: a multiplexer, with LD as its select, between “the number plus one” and the new number on D. When LD is on, the PC loads D at the next tick (even if EN is off); when LD is off and EN is on, it counts; when both are off, it holds. CLR still clears it.' },
      { p: 'This is the heart of every jump in the computer you will build in chapter 9.' },
    ],
  },
  {
    id: 'rom-gates',
    chapter: 'counting',
    title: 'A ROM is a decoder and some ORs',
    kind: 'build',
    summary: 'Four words stored in gates: the address picks a line, and the data bits are ORs of lines.',
    palette: PALETTE,
    uses: ['decoder', 'or-from-nand'],
    challenge: comb({
      id: 'path-rom',
      group: 'Learn: Counting',
      title: 'A four-word ROM',
      lesson: [],
      task: 'The address A1 A0 selects a word, shown on D3 to D0: word 0 is 0101, word 1 is 0011, word 2 is 1100 and word 3 is 1010.',
      hint: 'Your DEC2 makes one line for each address. A data bit is 1 for the addresses whose word has a 1 there: OR those lines. D3, for example, is 1 for words 2 and 3.',
      inputs: ['A1', 'A0'],
      outputs: bits('D'),
      goal: romGoal(),
      rules: { only: ['nand'] },
    }),
    solution: romSolution,
    lesson: [
      { p: 'A read-only memory, a ROM, is a table of words: give it an address and it answers with the word stored there. It sounds like something different from a gate, but a ROM is a decoder and some ORs. The decoder turns the address into one line; each data bit is an OR of the lines whose word has a 1 in that place.' },
      { p: 'Here are four words of four bits: 0101, 0011, 1100 and 1010. Word 0 has 1s in D2 and D0, word 1 in D1 and D0, word 2 in D3 and D2, word 3 in D3 and D1. So D3 is the OR of the lines for words 2 and 3, and so on. Chips from the real world burn the table in with fuses or masks; the idea is the same.' },
    ],
  },
  {
    id: 'ram4x4',
    chapter: 'counting',
    title: 'Four words you can write',
    kind: 'build',
    summary: 'A RAM of four words of four bits: write one word, read any.',
    palette: [...PALETTE, 'mux'],
    chip: 'RAM4',
    uses: ['reg4', 'decoder', 'and-from-nand'],
    challenge: seq({
      id: 'path-ram4',
      group: 'Learn: Counting',
      title: 'RAM of four words',
      lesson: [],
      task: 'The word at address A1 A0 is always on Q. On a clock tick with WE on, D is written to that word and no other.',
      hint: 'Four REG4. Your DEC2 and an AND with WE choose which one loads. To read, each output bit needs a 4:1 multiplexer, and this once you may use the built-in one (you earned it with chapter 4).',
      inputs: [...bits('D'), 'A1', 'A0', 'WE', 'CLK'],
      outputs: bits('Q'),
      rules: { only: ['nand', 'mux'] },
      solution: ramSolution,
      steps: [
        // The words power up unknown: write every word with ones first.
        ...[0, 1, 2, 3].map((a) => ({ set: { ...num(15, 'D'), A1: (a >> 1) as 0 | 1, A0: (a & 1) as 0 | 1, WE: 1 as const }, pulse: 'CLK', expect: num(15, 'Q') })),
        ...[5, 10, 3, 12].map((v, a) => ({ set: { ...num(v, 'D'), A1: (a >> 1) as 0 | 1, A0: (a & 1) as 0 | 1 }, pulse: 'CLK', expect: num(v, 'Q') })),
        { set: { WE: 0, A1: 0, A0: 0 }, expect: num(5, 'Q') },
        { set: { ...num(15, 'D') }, pulse: 'CLK', expect: num(5, 'Q') },
        { set: { A0: 1 }, expect: num(10, 'Q') },
        { set: { A1: 1, A0: 0 }, expect: num(3, 'Q') },
        { set: { A0: 1 }, expect: num(12, 'Q') },
        { set: { A1: 0, WE: 1, ...num(7, 'D') }, pulse: 'CLK', expect: num(7, 'Q') },
        { set: { A0: 0, WE: 0 }, expect: num(5, 'Q') },
        { set: { A1: 1 }, expect: num(3, 'Q') },
      ],
    }),
    solution: ramSolution,
    lesson: [
      { p: 'A RAM is read-write memory: a row of registers, one for each address, and two things around them. To write, the address is decoded and only the chosen register gets its load input, so only that word takes the data on the tick. To read, a multiplexer for each bit picks the chosen register’s output.' },
      { p: 'You have all of it: four REG4, your DEC2 to pick one, an AND with WE so that nothing is written unless WE is on, and the choosing of what to read. The choice among four words is a 4:1 multiplexer for each bit. You built a 2:1 multiplexer in chapter 4, and the built-in 4:1 is the faster version of the same thing; it is in the parts list now.' },
      { p: 'The registers power up knowing nothing, so the check first writes ones in every word and then other numbers, and reads them back, with WE off, to see that nothing changes without it.' },
    ],
  },
  {
    id: 'rom-ram-tour',
    chapter: 'counting',
    title: 'ROM and RAM, built in',
    kind: 'explore',
    summary: 'The built-in RAM and ROM: write a word, and find a word in the ROM.',
    open: { build: memoriesToPlay },
    palette: ['hexin', 'hexdisp', 'ram', 'rom', 'switch', 'led'],
    task: 'Store 9 at address 3 of the RAM, then find a 9 in the ROM by changing the address.',
    ordered: true,
    goals: [
      { memory: 'RAM', at: 3, is: 9, text: 'RAM word 3 is 9' },
      { display: 'ROM out', is: 9, text: 'The ROM shows 9' },
    ],
    lesson: [
      { p: 'The built-in [[RAM]] is the memory you just built, with 16 words. Choose an address with [[Address]], a number with [[Data]], turn [[WE]] on and switch [[CLK]] on: the rising edge writes the word. [[RAM out]] always shows the word at the address. While the simulation is paused you can also click the RAM and edit its words in the inspector.' },
      { p: 'The [[ROM]] has the first sixteen digits of pi stored in it (3 1 4 1 5 9 …). It has no WE and no clock: it has no way to be written, only an address in and a word out, which [[ROM out]] shows. The same [[Address]] feeds both.' },
      { p: 'You now have every part a processor needs: gates, an adder and an ALU, flip-flops and registers, a counter, and memory. In chapter 9 you put them together.' },
    ],
  },
]
