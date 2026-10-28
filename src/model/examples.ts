import { CircuitBuilder } from './builder'
import { counterDisplay } from './example-counter'
import { EXAMPLE_LIST, type ExampleInfo } from './examples-index'
import { PROGRAMS, computer2Builder, type Program } from './computer2'
import { frameAround, note } from './annotate'
import { beginnerComputer } from './beginner'
import { board6502 } from './board6502'
import { ball6502, basic6502, basicLcd6502, lcd6502, via6502, counter6502, echo6502, echoIrq6502, hello6502, keypad6502, sweep65c02, timer65c02 } from './board6502-examples'
import { micro6502, micro6502Basic } from './micro6502'
import { computerBlocks, icAdder } from './ic-examples'
import { hazard, ripple } from './timing-examples'
import { generateFsm } from './fsm'
import { SEQUENCE_DETECTOR, TRAFFIC_LIGHT, UP_DOWN_COUNTER, VENDING_MACHINE } from './fsm-examples'
import type { Circuit, Rot } from './circuit'

export interface Example extends ExampleInfo {
  build(): Circuit
}

function basicGates(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('switch', 0, 70, { label: 'A' })
  const bb = b.add('switch', 0, 170, { label: 'B', params: { on: true } })
  const gates = [
    b.add('and', 160, 0),
    b.add('or', 160, 80),
    b.add('xor', 160, 160),
    b.add('nand', 160, 240),
  ]
  const names = ['A AND B', 'A OR B', 'A XOR B', 'A NAND B']
  gates.forEach((g, i) => {
    b.wire(`${a}.Q`, `${g}.A`)
    b.wire(`${bb}.Q`, `${g}.B`)
    const led = b.add('led', 290, 80 * i + 10, { label: names[i] })
    b.wire(`${g}.Y`, `${led}.A`)
  })
  return b.build()
}

function srLatch(): Circuit {
  const b = new CircuitBuilder()
  const r = b.add('switch', 0, 0, { label: 'R (reset)' })
  const s = b.add('switch', 0, 140, { label: 'S (set)' })
  const g1 = b.add('nor', 120, 0)
  const g2 = b.add('nor', 120, 120)
  const q = b.add('led', 280, 10, { label: 'Q' })
  const nq = b.add('led', 280, 130, { label: 'not Q', params: { color: 'red' } })
  b.wire(`${r}.Q`, `${g1}.A`)
  b.wire(`${g2}.Y`, `${g1}.B`)
  b.wire(`${g1}.Y`, `${g2}.A`)
  b.wire(`${s}.Q`, `${g2}.B`)
  b.wire(`${g1}.Y`, `${q}.A`)
  b.wire(`${g2}.Y`, `${nq}.A`)
  return b.build()
}

function nandDLatch(): Circuit {
  const b = new CircuitBuilder()
  const d = b.add('switch', 0, 0, { label: 'D' })
  const en = b.add('switch', 0, 200, { label: 'EN' })
  const inv = b.add('not', 80, 140)
  const n1 = b.add('nand', 200, 0)
  const n2 = b.add('nand', 200, 140)
  const n3 = b.add('nand', 340, 10)
  const n4 = b.add('nand', 340, 130)
  const q = b.add('led', 500, 20, { label: 'Q' })
  const nq = b.add('led', 500, 140, { label: 'not Q', params: { color: 'red' } })
  b.wire(`${d}.Q`, `${n1}.A`)
  b.wire(`${en}.Q`, `${n1}.B`)
  b.wire(`${d}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${n2}.A`)
  b.wire(`${en}.Q`, `${n2}.B`)
  b.wire(`${n1}.Y`, `${n3}.A`)
  b.wire(`${n4}.Y`, `${n3}.B`)
  b.wire(`${n3}.Y`, `${n4}.A`)
  b.wire(`${n2}.Y`, `${n4}.B`)
  b.wire(`${n3}.Y`, `${q}.A`)
  b.wire(`${n4}.Y`, `${nq}.A`)
  return b.build()
}

/** A row of labelled probes (for the waveform panel) at (x, y), each wired to the given output pin. */
function probes(b: CircuitBuilder, signals: [label: string, from: string][], x: number, y: number) {
  signals.forEach(([label, from], i) => {
    const p = b.add('probe', x + i * 100, y, { label })
    b.wire(from, `${p}.A`)
  })
}

function shiftRegister(): Circuit {
  const b = new CircuitBuilder()
  const data = b.add('switch', 20, 10, { label: 'Data', params: { on: true } })
  const clk = b.add('clock', 0, 120, { params: { hz: 1 } })
  let prev = `${data}.Q`
  const q: string[] = []
  for (let i = 0; i < 4; i++) {
    const x = 100 + i * 150
    const ff = b.add('dff', x, 0)
    b.wire(prev, `${ff}.D`)
    b.wire(`${clk}.Q`, `${ff}.CLK`)
    const led = b.add('led', x + 120, -70, { label: `Q${i}` })
    b.wire(`${ff}.Q`, `${led}.A`)
    prev = `${ff}.Q`
    q.push(prev)
  }
  // Waveforms: the data ripples one stage per clock edge.
  probes(b, [['CLK', `${clk}.Q`], ...q.map((s, i): [string, string] => [`Q${i}`, s])], 0, 220)
  return b.build()
}

function adder(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('hexin', 0, 0, { label: 'A', params: { value: 5 } })
  const bb = b.add('hexin', 0, 140, { label: 'B', params: { value: 9 } })
  const add = b.add('add4', 140, 0)
  const out = b.add('hexdisp', 320, 40, { label: 'A + B' })
  const carry = b.add('led', 320, 190, { label: 'Carry (16)', params: { color: 'red' } })
  for (let i = 0; i < 4; i++) {
    const p = 'ABCD'[i]
    b.wire(`${a}.${p}`, `${add}.A${i}`)
    b.wire(`${bb}.${p}`, `${add}.B${i}`)
    b.wire(`${add}.S${i}`, `${out}.${p}`)
  }
  b.wire(`${add}.Co`, `${carry}.A`)
  return b.build()
}

function ringOscillator(): Circuit {
  const b = new CircuitBuilder()
  const en = b.add('switch', 0, 0, { label: 'Enable' })
  const g = b.add('nand', 100, 0)
  const n1 = b.add('not', 210, 10)
  const n2 = b.add('not', 300, 10)
  const led = b.add('led', 420, 10, { label: 'Out' })
  b.wire(`${en}.Q`, `${g}.A`)
  b.wire(`${n2}.Y`, `${g}.B`)
  b.wire(`${g}.Y`, `${n1}.A`)
  b.wire(`${n1}.Y`, `${n2}.A`)
  b.wire(`${n2}.Y`, `${led}.A`)
  return b.build()
}

function muxDemo(): Circuit {
  const b = new CircuitBuilder()
  const ins = [0, 1, 2, 3].map((i) =>
    b.add('switch', 0, 10 + i * 40 - 10, { label: `I${i}`, params: { on: i % 2 === 1 } }),
  )
  const mux = b.add('mux', 120, 0)
  const s1 = b.add('switch', 60, 180, { label: 'S1' })
  const s0 = b.add('switch', 60, 230, { label: 'S0' })
  const led = b.add('led', 260, 50, { label: 'Y' })
  ins.forEach((s, i) => b.wire(`${s}.Q`, `${mux}.I${i}`))
  b.wire(`${s1}.Q`, `${mux}.S1`)
  b.wire(`${s0}.Q`, `${mux}.S0`)
  b.wire(`${mux}.Y`, `${led}.A`)
  return b.build()
}

function rippleCounter(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 40, { params: { hz: 2 } })
  const ffs = [0, 1, 2, 3].map((i) => b.add('tff', 120 + i * 140, 20))
  const disp = b.add('hexdisp', 720, 160, { label: 'Count' })
  b.wire(`${clk}.Q`, `${ffs[0]}.CLK`)
  // Ripple counter: each stage is clocked by the inverted output of the previous one.
  for (let i = 1; i < 4; i++) b.wire(`${ffs[i - 1]}.NQ`, `${ffs[i]}.CLK`)
  ffs.forEach((f, i) => b.wire(`${f}.Q`, `${disp}.${'ABCD'[i]}`))
  probes(b, [['CLK', `${clk}.Q`], ...ffs.map((f, i): [string, string] => [`Q${i}`, `${f}.Q`])], 0, 220)
  return b.build()
}

/**
 * Digital clock HH:MM:SS. Six BCD counters share a 1 Hz clock; each counter's carry (CO) enables the next one,
 * so a digit advances only when all digits to its right roll over. An AND gate resets the hours at 24.
 * Holding a "set" button forces the minutes or hours to count once per second.
 */
function digitalClock(): Circuit {
  const b = new CircuitBuilder()
  // Digit blocks in reading order; counter on the left, its display on the right.
  const digits = [
    { key: 'ht', x: 0, mod: 10 },
    { key: 'hu', x: 300, mod: 10 },
    { key: 'mt', x: 700, mod: 6 },
    { key: 'mu', x: 1000, mod: 10 },
    { key: 'st', x: 1400, mod: 6 },
    { key: 'su', x: 1700, mod: 10 },
  ]
  const labels: Record<string, string> = { ht: 'Hours', mt: 'Minutes', st: 'Seconds' }
  const cnt: Record<string, string> = {}
  for (const d of digits) {
    cnt[d.key] = b.add('counter', d.x, 0, { params: { mod: d.mod } })
    // 20px gap so outputs that also feed other parts have room to branch off.
    const disp = b.add('hexdisp', d.x + 140, 0, labels[d.key] ? { label: labels[d.key] } : {})
    for (const p of ['A', 'B', 'C', 'D']) b.wire(`${cnt[d.key]}.${p}`, `${disp}.${p}`)
  }

  const clk = b.add('clock', -220, 220, { params: { hz: 1 }, label: '1 Hz' })
  for (const d of digits) b.wire(`${clk}.Q`, `${cnt[d.key]}.CLK`)
  // Blinking colons.
  for (const x of [570, 1270]) {
    const led = b.add('led', x, 40, { params: { color: 'red' } })
    b.wire(`${clk}.Q`, `${led}.A`)
  }

  // Carry chain, right to left. Minutes and hours can also be forced on with a set button.
  b.wire(`${cnt.su}.CO`, `${cnt.st}.EN`)
  // OR gates face up: carry and set button come in from below, the output goes up into the counter's EN.
  const orMin = b.add('or', 930, 200, { rot: 3 })
  const setMin = b.add('button', 880, 300, { label: 'Set minutes' })
  b.wire(`${cnt.st}.CO`, `${orMin}.A`)
  b.wire(`${setMin}.Q`, `${orMin}.B`)
  b.wire(`${orMin}.Y`, `${cnt.mu}.EN`)
  b.wire(`${cnt.mu}.CO`, `${cnt.mt}.EN`)
  const orHour = b.add('or', 230, 200, { rot: 3 })
  const setHour = b.add('button', 180, 300, { label: 'Set hours' })
  b.wire(`${cnt.mt}.CO`, `${orHour}.A`)
  b.wire(`${setHour}.Q`, `${orHour}.B`)
  b.wire(`${orHour}.Y`, `${cnt.hu}.EN`)
  b.wire(`${cnt.hu}.CO`, `${cnt.ht}.EN`)

  // 24 -> 00: hours-tens = 2 (bit B) and hours-units = 4 (bit C).
  // Flipped so its inputs face the hour digits and its output faces the reset pins.
  const at24 = b.add('and', 60, 200, { flip: true, label: '= 24' })
  b.wire(`${cnt.ht}.B`, `${at24}.A`)
  b.wire(`${cnt.hu}.C`, `${at24}.B`)
  b.wire(`${at24}.Y`, `${cnt.ht}.R`)
  b.wire(`${at24}.Y`, `${cnt.hu}.R`)

  // Waveforms: the tick, and the carries that make the next digit count.
  for (const [label, from, x] of [
    ['1 Hz', `${clk}.Q`, -220],
    ['Seconds tens', `${cnt.su}.CO`, 1700],
    ['Minutes', `${cnt.st}.CO`, 1400],
  ] as const) {
    const p = b.add('probe', x, 420, { label })
    b.wire(from, `${p}.A`)
  }
  return b.build()
}

/**
 * Two-way traffic light with pedestrian crossings, using the Croatian/European sequence
 * red -> red + yellow -> green -> yellow -> red. A 1 Hz clock steps a counter through 16 phases; bit D says whose
 * turn it is (0 = north–south, 1 = east–west). Within each half: step 0 is all red (so the crossing empties),
 * step 1 is red + yellow, steps 2–5 green, steps 6–7 yellow. Each crosswalk remembers a button press in a latch
 * and shows WALK during the next green of the road it runs alongside.
 */
function trafficLights(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 40, { params: { hz: 1 }, label: '1 Hz' })
  const cnt = b.add('counter', 120, 20, { params: { mod: 16 } })
  const stepDisp = b.add('hexdisp', 270, 20, { label: 'Step' })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  for (const p of ['A', 'B', 'C', 'D']) b.wire(`${cnt}.${p}`, `${stepDisp}.${p}`)

  // Phase decoding (within each half, s = bits C B A):
  //   s 0     red time    all red (clearance)
  //   s 1     red time    get ready: red + yellow for the road about to go
  //   s 2-5   green time
  //   s 6-7   yellow time
  const redTime = b.add('nor', 420, 140, { label: 'red time' })
  const getReady = b.add('and', 560, 110, { label: 'get ready' })
  const yellowTime = b.add('and', 420, 240, { label: 'yellow time' })
  const greenTime = b.add('nor', 560, 190, { label: 'green time' })
  const yellowLamp = b.add('or', 560, 270, { label: 'yellow lamp' })
  // Both turn signals pass through exactly one gate, so they change in step with the other decoded
  // signals. Using D directly (no gate) would briefly glitch E–W yellow on at 7 -> 8 and wrongly clear
  // the north crosswalk's request: a real race condition.
  const nsTurn = b.add('not', 420, 330, { label: 'N–S turn' })
  const ewTurn = b.add('buf', 420, 390, { label: 'E–W turn' })
  b.wire(`${cnt}.B`, `${redTime}.A`)
  b.wire(`${cnt}.C`, `${redTime}.B`)
  b.wire(`${redTime}.Y`, `${getReady}.A`)
  b.wire(`${cnt}.A`, `${getReady}.B`)
  b.wire(`${cnt}.C`, `${yellowTime}.A`)
  b.wire(`${cnt}.B`, `${yellowTime}.B`)
  b.wire(`${redTime}.Y`, `${greenTime}.A`)
  b.wire(`${yellowTime}.Y`, `${greenTime}.B`)
  b.wire(`${yellowTime}.Y`, `${yellowLamp}.A`)
  b.wire(`${getReady}.Y`, `${yellowLamp}.B`)
  b.wire(`${cnt}.D`, `${nsTurn}.A`)
  b.wire(`${cnt}.D`, `${ewTurn}.A`)

  // Lamp signals: each drives the same lamp on both lights of a road.
  // Red: the other road's turn, or red time. Yellow: own turn and yellow lamp. Green: own turn and green time.
  const nsR = b.add('or', 700, -10, { label: 'N–S red' })
  const nsY = b.add('and', 700, 50)
  const nsG = b.add('and', 700, 110)
  const ewR = b.add('or', 700, 250, { label: 'E–W red' })
  const ewY = b.add('and', 700, 310)
  const ewG = b.add('and', 700, 370)
  b.wire(`${ewTurn}.Y`, `${nsR}.A`)
  b.wire(`${redTime}.Y`, `${nsR}.B`)
  b.wire(`${nsTurn}.Y`, `${nsY}.A`)
  b.wire(`${yellowLamp}.Y`, `${nsY}.B`)
  b.wire(`${nsTurn}.Y`, `${nsG}.A`)
  b.wire(`${greenTime}.Y`, `${nsG}.B`)
  b.wire(`${nsTurn}.Y`, `${ewR}.A`)
  b.wire(`${redTime}.Y`, `${ewR}.B`)
  b.wire(`${ewTurn}.Y`, `${ewY}.A`)
  b.wire(`${yellowLamp}.Y`, `${ewY}.B`)
  b.wire(`${ewTurn}.Y`, `${ewG}.A`)
  b.wire(`${greenTime}.Y`, `${ewG}.B`)

  // The intersection, drawn like a street plan: each light lies across its road with the lenses facing the
  // crossing. Going round the crossing every light looks the same (red, yellow, green clockwise).
  //   N: row above, fed from the top     S: row below, fed from underneath
  //   W: column left, fed from the left  E: column right, fed from the right
  const cx = 1060
  const cy = 300
  const lamp = (x: number, y: number, rot: Rot, color: string, label?: string) =>
    b.add('led', x, y, { params: { color }, rot, ...(label ? { label } : {}) })
  // LED bodies are 20×20; these offsets put each lamp's centre at the given point for its rotation.
  const north = [-40, 0, 40].map((dx, i) => lamp(cx + dx + 10, cy - 120, 1, ['red', 'yellow', 'green'][i], i === 1 ? 'N' : undefined))
  const east = [-40, 0, 40].map((dy, i) => lamp(cx + 120, cy + dy + 10, 2, ['red', 'yellow', 'green'][i], i === 0 ? 'E' : undefined))
  const south = [40, 0, -40].map((dx, i) => lamp(cx + dx - 10, cy + 120, 3, ['red', 'yellow', 'green'][i], i === 1 ? 'S' : undefined))
  const west = [40, 0, -40].map((dy, i) => lamp(cx - 120, cy + dy - 10, 0, ['red', 'yellow', 'green'][i], i === 2 ? 'W' : undefined))
  const signals = { ns: [nsR, nsY, nsG], ew: [ewR, ewY, ewG] }
  for (const [light, sig] of [[north, signals.ns], [south, signals.ns], [west, signals.ew], [east, signals.ew]] as const)
    light.forEach((led, i) => b.wire(`${sig[i]}.Y`, `${led}.A`))

  // Two crosswalks, each with its own pole (title lamp = don't walk, green = walk, and a push button):
  //   West crossing, across the west road: walk while north–south traffic has green (pole at the SW corner).
  //   North crossing, across the north road: walk while east–west traffic has green (pole at the NE corner).
  // A latch remembers a press until that road group turns yellow, so one press = one crossing.
  // Pole lamps face left with their inputs on the right, so each crosswalk's logic sits just right of its pole.
  const crosswalk = (name: string, px: number, py: number, green: string, turn: string) => {
    const pole = (dy: number, color: string, label: string) =>
      b.add('led', px + 20, py + dy + 20, { rot: 2, label, params: { color } })
    const stop = pole(0, 'red', `${name} crossing`)
    const go = pole(50, 'green', 'Walk')
    const push = b.add('button', px, py + 100, { label: 'Push' })
    const latch = b.add('srlatch', px + 80, py + 150, { label: `${name} request` })
    const walk = b.add('and', px + 220, py + 140, { label: `${name} walk` })
    const dontWalk = b.add('not', px + 220, py + 210)
    // Clear the request when this road's green ends (its yellow time), not at red + yellow before it.
    const done = b.add('and', px, py + 170, { label: 'green over' })
    b.wire(`${turn}.Y`, `${done}.A`)
    b.wire(`${yellowTime}.Y`, `${done}.B`)
    b.wire(`${push}.Q`, `${latch}.S`)
    b.wire(`${done}.Y`, `${latch}.R`)
    b.wire(`${latch}.Q`, `${walk}.A`)
    b.wire(`${green}.Y`, `${walk}.B`)
    b.wire(`${walk}.Y`, `${go}.A`)
    b.wire(`${walk}.Y`, `${dontWalk}.A`)
    b.wire(`${dontWalk}.Y`, `${stop}.A`)
  }
  crosswalk('West', cx - 230, cy + 120, nsG, nsTurn)
  crosswalk('North', cx + 190, cy - 300, ewG, ewTurn)
  return b.build()
}

/**
 * Electronic dice. While ROLL is held, a fast clock (gated by an AND) spins a 0–5 counter; letting go stops it
 * somewhere unpredictable. Gates turn the count (0–5 = faces 1–6) into the seven pips of a die:
 * centre = odd faces, one diagonal = 2 and up, the other diagonal = 4 and up, middle pair = 6 only.
 */
function dice(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 30, { params: { hz: 32 }, label: 'Fast clock' })
  const roll = b.add('button', 10, 150, { label: 'Hold to roll' })
  const gate = b.add('and', 140, 60, { label: 'spin' })
  const cnt = b.add('counter', 280, 30, { params: { mod: 6 } })
  const rolling = b.add('led', 160, 190, { label: 'Rolling', params: { color: 'yellow' } })
  b.wire(`${clk}.Q`, `${gate}.A`)
  b.wire(`${roll}.Q`, `${gate}.B`)
  b.wire(`${gate}.Y`, `${cnt}.CLK`)
  b.wire(`${roll}.Q`, `${rolling}.A`)

  // Pip logic on the count c (A = bit 0).
  const centre = b.add('not', 500, 0, { label: 'odd face' })
  const diag1 = b.add('or', 500, 60, { params: { inputs: 3 }, label: '2 and up' })
  const ab = b.add('and', 500, 170)
  const diag2 = b.add('or', 600, 160, { label: '4 and up' })
  const six = b.add('and', 500, 250, { label: 'six' })
  b.wire(`${cnt}.A`, `${centre}.A`)
  b.wire(`${cnt}.A`, `${diag1}.A`)
  b.wire(`${cnt}.B`, `${diag1}.B`)
  b.wire(`${cnt}.C`, `${diag1}.C`)
  b.wire(`${cnt}.A`, `${ab}.A`)
  b.wire(`${cnt}.B`, `${ab}.B`)
  b.wire(`${ab}.Y`, `${diag2}.A`)
  b.wire(`${cnt}.C`, `${diag2}.B`)
  b.wire(`${cnt}.A`, `${six}.A`)
  b.wire(`${cnt}.C`, `${six}.B`)

  // The die: each signal lights a group of pips.
  const die = b.add('dicedisp', 800, 40, { label: 'Die' })
  b.wire(`${centre}.Y`, `${die}.C`)
  b.wire(`${diag1}.Y`, `${die}.TL`)
  b.wire(`${diag1}.Y`, `${die}.BR`)
  b.wire(`${diag2}.Y`, `${die}.TR`)
  b.wire(`${diag2}.Y`, `${die}.BL`)
  b.wire(`${six}.Y`, `${die}.ML`)
  b.wire(`${six}.Y`, `${die}.MR`)
  return b.build()
}

/** Wire `n` pins one to one: from `fromComp.<fromPrefix><i>` to `toComp.<toPrefix><i>`. */
function wireBits(
  b: CircuitBuilder,
  from: string,
  fromPins: string[],
  to: string,
  toPins: string[],
) {
  fromPins.forEach((p, i) => b.wire(`${from}.${p}`, `${to}.${toPins[i]}`))
}

const NIB = ['A', 'B', 'C', 'D']
const bitNames = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

/** Squares of 0..15 as ROM words (two hex digits each). */
export const SQUARES = Array.from({ length: 16 }, (_, i) => (i * i).toString(16).toUpperCase()).join(' ')

/**
 * Pocket calculator on two 4-bit numbers A and B. One row per block: the ALU with an operation selector (result in hex
 * and decimal, carry and zero flags, and a memory register you store into with a button), a multiplier, a ROM that
 * holds a table of squares, a decimal (BCD) adder and a comparator. All of them watch the same inputs.
 */
function calculator(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('hexin', 0, 0, { label: 'A', params: { value: 7 } })
  const bb = b.add('hexin', 0, 140, { label: 'B', params: { value: 6 } })
  const op = b.add('hexin', 0, 280, { label: 'Operation 0–7', params: { value: 0 } })
  const fromA = (to: string, prefix: string) => wireBits(b, a, NIB, to, bitNames(prefix, 4))
  const fromB = (to: string, prefix: string) => wireBits(b, bb, NIB, to, bitNames(prefix, 4))
  const disp = (x: number, y: number, label?: string) => b.add('hexdisp', x, y, label ? { label } : {})
  const zero = (x: number, y: number) => b.add('const', x, y, { params: { value: 0 } })

  // ---- ALU: result in hex and decimal, flags, and a memory register -------------------------------
  const alu = b.add('alu', 300, 0, { label: 'ALU' })
  fromA(alu, 'A')
  fromB(alu, 'B')
  b.wire(`${op}.A`, `${alu}.S0`)
  b.wire(`${op}.B`, `${alu}.S1`)
  b.wire(`${op}.C`, `${alu}.S2`)
  const res = disp(500, 20, 'Result')
  wireBits(b, alu, bitNames('F', 4), res, NIB)
  const dec = b.add('bin2bcd', 620, 10)
  wireBits(b, alu, bitNames('F', 4), dec, bitNames('B', 4))
  const tens = disp(760, 20, 'Decimal')
  const ones = disp(840, 20)
  wireBits(b, dec, bitNames('O', 4), ones, NIB)
  b.wire(`${dec}.T0`, `${tens}.A`)
  const z0 = zero(790, 140)
  for (const p of ['B', 'C', 'D']) b.wire(`${z0}.Q`, `${tens}.${p}`)
  const carry = b.add('led', 500, 160, { label: 'Carry / borrow', params: { color: 'yellow' } })
  const zflag = b.add('led', 500, 220, { label: 'Zero', params: { color: 'red' } })
  b.wire(`${alu}.Co`, `${carry}.A`)
  b.wire(`${alu}.Z`, `${zflag}.A`)
  // Memory: a register that stores the result each time the button is pressed.
  const store = b.add('button', 700, 200, { label: 'Store' })
  const mem = b.add('register', 960, 0, { label: 'Memory' })
  wireBits(b, alu, bitNames('F', 4), mem, NIB)
  b.wire(`${store}.Q`, `${mem}.CLK`)
  const mdisp = disp(1130, 40, 'M')
  wireBits(b, mem, ['QA', 'QB', 'QC', 'QD'], mdisp, NIB)

  // ---- Multiplier ------------------------------------------------------------------------------
  const mul = b.add('mul', 300, 320, { label: 'Multiplier' })
  fromA(mul, 'A')
  fromB(mul, 'B')
  const phi = disp(500, 320, 'A × B')
  const plo = disp(580, 320)
  wireBits(b, mul, bitNames('P', 4), plo, NIB)
  wireBits(b, mul, ['P4', 'P5', 'P6', 'P7'], phi, NIB)

  // ---- ROM lookup table of squares -----------------------------------------------------------------
  const rom = b.add('rom', 300, 560, { params: { abits: 4, dbits: 8, data: SQUARES }, label: 'Table of squares' })
  fromA(rom, 'A')
  const shi = disp(500, 560, 'A² from ROM')
  const slo = disp(580, 560)
  wireBits(b, rom, bitNames('D', 4), slo, NIB)
  wireBits(b, rom, ['D4', 'D5', 'D6', 'D7'], shi, NIB)

  // ---- BCD adder: decimal sum of two digits --------------------------------------------------------
  const bcd = b.add('bcdadd', 300, 800, { label: 'Decimal adder' })
  fromA(bcd, 'A')
  fromB(bcd, 'B')
  const btens = disp(500, 800, 'A + B (digits 0–9)')
  const bones = disp(580, 800)
  wireBits(b, bcd, bitNames('S', 4), bones, NIB)
  b.wire(`${bcd}.Co`, `${btens}.A`)
  const z1 = zero(540, 930)
  for (const p of ['B', 'C', 'D']) b.wire(`${z1}.Q`, `${btens}.${p}`)

  // ---- Comparator ---------------------------------------------------------------------------
  const cmp = b.add('cmp4', 300, 1060, { label: 'Comparator' })
  fromA(cmp, 'A')
  fromB(cmp, 'B')
  const leds: [string, string, string][] = [
    ['GT', 'A > B', 'green'],
    ['EQ', 'A = B', 'yellow'],
    ['LT', 'A < B', 'red'],
  ]
  leds.forEach(([pin, label, color], i) => {
    const led = b.add('led', 500, 1080 + i * 50, { label, params: { color } })
    b.wire(`${cmp}.${pin}`, `${led}.A`)
  })
  return b.build()
}

/** The computer running one of its programs, with notes and frames that name its parts. */
function computer2(p: Program): Circuit {
  const { b, keys } = computer2Builder({ source: p.source, hz: p.hz, devices: p.devices, octaves: p.octaves, keypad: p.keypad, probes: p.probes })
  const ids = (...parts: string[]) => parts.map((k) => keys[k]).filter(Boolean)
  const frame = (title: string, parts: string[], color?: string) => {
    if (parts.length) frameAround(b, title, parts, color)
  }
  frame('Fetch: PC and program ROM', ids('pcLo', 'pcHi', 'prog'))
  const bitsOf = (prefix: string) => Array.from({ length: 8 }, (_, i) => `${prefix}${i}`)
  const sub = ['sub14_', 'sub15_', 'sub'].flatMap((prefix) => [0, 1, 2, 3].map((i) => `${prefix}${i}`))
  frame('Decode: opcode to control signals', ids('ctl', 'ctl2', 'nd4', 'op14', 'op15', ...sub, 'ncarry', 'nzero', 'jnc', 'jc', 'jz', 'jnz', 'take', 'nhalt'), 'yellow')
  frame('Logic unit and ALU result', ids(...['and', 'or', 'xor', 'logic', 'result'].flatMap(bitsOf)), 'pink')
  frame('Which device? (port decoding)', ids('na0', 'na1', 'na2', 'na3', 'sel1', 'sel2', 'sel3', 'sel4', 'sel5', 'we1', 'we4', 'we5', 'fbSel', 'fbWe'), 'green')
  frame('ACC input: which source?', ids(...Array.from({ length: 8 }, (_, i) => `amux${i}`)), 'blue')
  frame('Output: the decimal display', ids('outLo', 'outHi', 'decLo', 'decRomTO', 'decRomH', 'decOnes', 'decTens', 'decHund', 'dispHund', 'dispTens', 'dispOnes'), 'green')
  frame('Devices', ids('keypad', 'console', 'screen', 'toggle', 'speaker'), 'green')
  note(b, 0, -300, p.note, 60)
  return b.build(0)
}

/** The smiley as ROM words: one row each, bit 0 is the leftmost pixel. */
export const SMILEY = ['3C', '42', 'A5', '81', 'A5', '99', '42', '3C']

function matrixSmiley(): Circuit {
  const b = new CircuitBuilder()
  // A counter walks through the rows. The decoder lights one row at a time, while the ROM holds the pixels
  // of that row and drives the columns. Scanned fast, the persistence of the display shows the whole image.
  const clk = b.add('clock', 0, 60, { params: { hz: 128 }, label: 'Scan clock' })
  const cnt = b.add('counter', 120, 40, { params: { mod: 8 }, label: 'Row counter' })
  const rom = b.add('rom', 320, 0, { params: { abits: 3, dbits: 8, data: SMILEY.join(' ') }, label: 'Image' })
  const dec = b.add('decoder', 320, 240, { params: { n: 3 }, label: 'Row select' })
  const mat = b.add('matrix', 620, 160)
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  ;['A', 'B', 'C'].forEach((p, i) => {
    b.wire(`${cnt}.${p}`, `${rom}.A${i}`)
    b.wire(`${cnt}.${p}`, `${dec}.A${i}`)
  })
  for (let i = 0; i < 8; i++) {
    b.wire(`${rom}.D${i}`, `${mat}.C${i}`)
    b.wire(`${dec}.Y${i}`, `${mat}.R${i}`)
  }
  return b.build()
}

function netLabels(): Circuit {
  // The counter and everything that reads it are far apart and have no wires between them: each of the four counter
  // bits is published under a name, and receive labels with the same name bring it back.
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 60, { params: { hz: 2 }, label: 'Clock' })
  const cnt = b.add('counter', 120, 40, { params: { mod: 16 }, label: 'Counter' })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  const disp = b.add('hexdisp', 760, 20, { label: 'Hex display' })
  NIB.forEach((pin, i) => {
    b.tap(`${cnt}.${pin}`, `BIT${i}`)
    b.tag(`${disp}.${pin}`, `BIT${i}`)
    // The same name can be received as often as you like.
    const led = b.add('led', 780, 180 + i * 50, { label: `Bit ${i}` })
    b.tag(`${led}.A`, `BIT${i}`)
  })
  note(
    b,
    120,
    230,
    'These parts are not joined by wires. Each counter bit goes into a Send label (BIT0 to BIT3), and the Receive labels with the same name, next to the display and the LEDs, carry the same signal. Click a label: the others with its name get a dotted outline.',
    36,
  )
  return b.build()
}

function sharedLine(): Circuit {
  // Three sources can talk on one line, but only one at a time: each has a tri-state buffer that lets go of the line (Z)
  // unless its enable switch is on. The bus junction joins them; two enabled at once make the line unknown (contention).
  const b = new CircuitBuilder()
  const junction = b.add('busjoin', 300, 80, { params: { drivers: 3 } })
  const line = b.add('led', 440, 100, { label: 'Shared line' })
  const names = ['A', 'B', 'C']
  const ids = names.map((n, i) => {
    const y = i * 120
    const data = b.add('switch', 0, y, { label: `Data ${n}`, params: { on: i === 0 } })
    const buf = b.add('tribuf', 120, y, { label: `Buffer ${n}` })
    const en = b.add('switch', 100, y + 60, { label: `Enable ${n}`, params: { on: i === 0 } })
    b.wire(`${data}.Q`, `${buf}.A`)
    b.wire(`${en}.Q`, `${buf}.EN`)
    b.wire(`${buf}.Y`, `${junction}.${n}`)
    return [data, buf, en]
  })
  b.wire(`${junction}.Y`, `${line}.A`)
  note(
    b,
    300,
    220,
    'The wires are dashed grey while a buffer lets go of the line (Z). Turn on one Enable switch and the line follows that source. Turn on two sources that disagree and the junction turns red: contention, the line is unknown.',
    36,
  )
  frameAround(b, 'Three sources, one line', ids.flat())
  return b.build()
}

function dataBus(): Circuit {
  // The way a real computer moves data: one shared 8-bit bus that several parts can drive, one at a time. Each source reaches
  // the bus through a tri-state buffer; the register loads whatever is on the bus when Load is on. (The 8-bit computer uses
  // multiplexers instead, which is simpler to read; this is the other design.)
  const b = new CircuitBuilder()
  const junction = b.add('busjoin', 380, 80, { params: { bits: 8, drivers: 3 }, label: 'Data bus' })
  const sources: string[] = []
  const ids = ['Input A', 'Input B', 'Register'].map((name, i) => {
    const y = i * 130
    const buf = b.add('tribuf', 240, y, { params: { bits: 8 }, label: `Buffer ${name}` })
    const en = b.add('switch', 220, y + 70, { label: `Enable ${name}`, params: { on: i === 0 } })
    b.wire(`${en}.Q`, `${buf}.EN`)
    b.wire(`${buf}.Y`, `${junction}.${'ABC'[i]}`)
    sources.push(`${buf}.A`)
    return [buf, en]
  })
  const a = b.add('busin', 0, 0, { params: { bits: 8, value: '5A' }, label: 'Input A' })
  const bb = b.add('busin', 0, 130, { params: { bits: 8, value: '27' }, label: 'Input B' })
  const reg = b.add('busreg', 620, 130, { params: { bits: 8 }, label: 'Register' })
  const clk = b.add('clock', 620, 0, { params: { hz: 1 }, label: 'Clock' })
  const load = b.add('switch', 620, 290, { label: 'Load', params: { on: false } })
  const disp = b.add('busdisp', 620, 380, { params: { bits: 8, format: 'hex' }, label: 'Bus value' })
  b.wire(`${a}.Q`, sources[0])
  b.wire(`${bb}.Q`, sources[1])
  b.wire(`${reg}.Q`, sources[2])
  b.wire(`${junction}.Y`, `${reg}.D`)
  b.wire(`${junction}.Y`, `${disp}.A`)
  b.wire(`${load}.Q`, `${reg}.LD`)
  b.wire(`${clk}.Q`, `${reg}.CLK`)
  note(
    b,
    0,
    300,
    'Turn on one Enable switch and its source drives the bus (hover the thick wire to read it). Switch on Load and the register copies the bus at the next clock tick. Enable the register too and it drives the bus with what it holds. Two Enables at once make the bus unknown (contention, the junction turns red); none at all leaves it floating.',
    40,
  )
  frameAround(b, 'Sources', [a, bb, ...ids.flat()])
  return b.build()
}

function busDemo(): Circuit {
  // A running total on thick 4-bit wires. A merger gathers the four bits of the input into one bus for the adder; the total
  // comes back to the adder's other input through a pair of bus labels (no wire in between); a splitter takes the total apart
  // again for the display, which still has four ordinary pins.
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 0, { params: { hz: 1 }, label: 'Clock' })
  const input = b.add('hexin', 0, 90, { params: { value: 3 }, label: 'Add this' })
  const merge = b.add('merger', 120, 90, { params: { bits: 4, split: '1,1,1,1' } })
  const add = b.add('add4', 420, 90, { params: { bus: true }, label: 'Adder' })
  const reg = b.add('register', 640, 90, { params: { bus: true }, label: 'Total' })
  const split = b.add('splitter', 900, 90, { params: { bits: 4, split: '1,1,1,1' } })
  const disp = b.add('hexdisp', 1070, 90, { label: 'Hex display' })
  NIB.forEach((pin, i) => b.wire(`${input}.${pin}`, `${merge}.A${i}`))
  b.wire(`${merge}.Y`, `${add}.A`)
  b.wire(`${add}.S`, `${reg}.IN`)
  b.wire(`${clk}.Q`, `${reg}.CLK`)
  b.wire(`${reg}.Q`, `${split}.A`)
  NIB.forEach((pin, i) => b.wire(`${split}.Y${i}`, `${disp}.${pin}`))
  b.tap(`${reg}.Q`, 'TOTAL', 20, 4)
  b.tag(`${add}.B`, 'TOTAL', 20, 4)
  note(
    b,
    120,
    250,
    'Thick wires carry four bits at once (hover one to read its value). Click the input to change what is added on each clock tick. The register and the adder are the ordinary 4-bit parts with "Bus ports" switched on: untick it in the inspector and they have single-bit pins again.',
    40,
  )
  return b.build()
}

/**
 * A master-slave D flip-flop from two gated latches. The master is open while CLK is 1 and the slave while CLK is 0,
 * so the output changes only at the moment CLK falls, however much D wobbles in between.
 */
function masterSlave(): Circuit {
  const b = new CircuitBuilder()
  const d = b.add('switch', 0, 20, { label: 'D' })
  const clk = b.add('switch', 0, 140, { label: 'CLK' })
  const inv = b.add('not', 110, 140)
  const master = b.add('dlatch', 220, 20)
  const slave = b.add('dlatch', 480, 20)
  const mq = b.add('led', 330, -50, { label: 'Master', params: { color: 'yellow' } })
  const q = b.add('led', 620, 30, { label: 'Q (slave)' })
  b.wire(`${d}.Q`, `${master}.D`)
  b.wire(`${clk}.Q`, `${master}.E`)
  b.wire(`${clk}.Q`, `${inv}.A`)
  b.wire(`${inv}.Y`, `${slave}.E`)
  b.wire(`${master}.Q`, `${slave}.D`)
  b.wire(`${master}.Q`, `${mq}.A`)
  b.wire(`${slave}.Q`, `${q}.A`)
  frameAround(b, 'Master: open while CLK = 1', [master, mq], 'yellow')
  frameAround(b, 'Slave: open while CLK = 0', [slave, q], 'green')
  probes(b, [['D', `${d}.Q`], ['CLK', `${clk}.Q`], ['Master', `${master}.Q`], ['Q', `${slave}.Q`]], 0, 260)
  note(
    b,
    0,
    340,
    'Set D, then raise CLK: the master copies D but the slave is shut, so Q does not move. Lower CLK: the master closes and the slave opens, and Q takes the value D had at that moment. Flip D while CLK is 0 and nothing happens at all.',
    60,
  )
  return b.build()
}

/**
 * A 4-bit linear-feedback shift register. The new bit is the XNOR of the last two, which walks through 15 of the 16
 * patterns before it repeats. (With XNOR the all-zero pattern is allowed, so Reset is a valid start.)
 */
function lfsr(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 20, { params: { hz: 4 } })
  const rst = b.add('button', 0, 140, { label: 'Reset' })
  const sr = b.add('shiftreg', 140, 0)
  const x = b.add('xnor', 140, 220)
  const leds = [0, 1, 2, 3].map((i) => b.add('led', 320 + i * 60, 20, { label: `Q${i}` }))
  const disp = b.add('hexdisp', 560, 20, { label: 'State' })
  b.wire(`${clk}.Q`, `${sr}.CLK`)
  b.wire(`${rst}.Q`, `${sr}.CLR`)
  b.wire(`${sr}.QC`, `${x}.A`)
  b.wire(`${sr}.QD`, `${x}.B`)
  b.wire(`${x}.Y`, `${sr}.SI`)
  ;['QA', 'QB', 'QC', 'QD'].forEach((p, i) => {
    b.wire(`${sr}.${p}`, `${leds[i]}.A`)
    b.wire(`${sr}.${p}`, `${disp}.${'ABCD'[i]}`)
  })
  note(
    b,
    300,
    140,
    'Each clock the bits move one place and the XNOR of the last two feeds the first. The pattern looks random but repeats exactly every 15 clocks. Press Reset to start again from 0000. LFSRs like this make noise generators, test patterns and CRC checks.',
    50,
  )
  return b.build()
}

/** Eight request lines in, the number of the highest one out, and a decoder turning that number back into one lit LED. */
function encoderDecoder(): Circuit {
  const b = new CircuitBuilder()
  const enc = b.add('encoder', 140, 0, { params: { n: 8 } })
  const dec = b.add('decoder', 360, 0, { params: { n: 3 } })
  const bar = b.add('bar', 520, 0, { params: { n: 8 } })
  const num = b.add('hexdisp', 360, 260, { label: 'Number' })
  const v = b.add('led', 260, 260, { label: 'Any request (V)', params: { color: 'yellow' } })
  for (let i = 0; i < 8; i++) {
    const sw = b.add('switch', 0, i * 30, { label: `Request ${i}` })
    b.wire(`${sw}.Q`, `${enc}.I${i}`)
    b.wire(`${dec}.Y${i}`, `${bar}.I${i}`)
  }
  for (let i = 0; i < 3; i++) {
    b.wire(`${enc}.A${i}`, `${dec}.A${i}`)
    b.wire(`${enc}.A${i}`, `${num}.${'ABC'[i]}`)
  }
  b.wire(`${enc}.V`, `${dec}.EN`)
  b.wire(`${enc}.V`, `${v}.A`)
  note(
    b,
    0,
    330,
    'Switch on several requests: the priority encoder reports only the highest one, as a 3-bit number. The decoder turns that number back into a single lit output. With no request at all V is 0, which also switches the decoder off.',
    60,
  )
  return b.build()
}

/**
 * Three devices share a 4-bit bus through tri-state buffers. An arbiter built from gates grants the bus to the lowest-numbered
 * requester only; the Override switch turns the arbiter off so every requester is granted, and the bus goes unknown.
 */
function arbiter(): Circuit {
  const b = new CircuitBuilder()
  const junction = b.add('busjoin', 360, 110, { params: { bits: 4, drivers: 3 }, label: 'Bus' })
  const disp = b.add('busdisp', 520, 110, { params: { bits: 4, format: 'hex' }, label: 'Bus value' })
  const req = [0, 1, 2].map((i) => b.add('switch', 0, i * 120 + 70, { label: `Request ${i + 1}` }))
  const bufs = [0, 1, 2].map((i) => {
    const dev = b.add('busin', 0, i * 120, { params: { bits: 4, value: ['3', '6', 'C'][i] }, label: `Device ${i + 1}` })
    const buf = b.add('tribuf', 150, i * 120, { params: { bits: 4 }, label: `Buffer ${i + 1}` })
    b.wire(`${dev}.Q`, `${buf}.A`)
    b.wire(`${buf}.Y`, `${junction}.${'ABC'[i]}`)
    return buf
  })
  const over = b.add('switch', 0, 440, { label: 'Override arbiter' })
  const not0 = b.add('not', 150, 400)
  const or1 = b.add('or', 250, 400)
  const grant1 = b.add('and', 370, 400)
  const nor01 = b.add('nor', 150, 480)
  const or2 = b.add('or', 250, 480)
  const grant2 = b.add('and', 370, 480)
  const led = [0, 1, 2].map((i) => b.add('led', 500, 360 + i * 60, { label: `Grant ${i + 1}`, params: { color: 'green' } }))
  b.wire(`${req[0]}.Q`, `${bufs[0]}.EN`)
  b.wire(`${req[0]}.Q`, `${led[0]}.A`)
  b.wire(`${req[0]}.Q`, `${not0}.A`)
  b.wire(`${not0}.Y`, `${or1}.B`)
  b.wire(`${over}.Q`, `${or1}.A`)
  b.wire(`${req[1]}.Q`, `${grant1}.A`)
  b.wire(`${or1}.Y`, `${grant1}.B`)
  b.wire(`${grant1}.Y`, `${bufs[1]}.EN`)
  b.wire(`${grant1}.Y`, `${led[1]}.A`)
  b.wire(`${req[0]}.Q`, `${nor01}.A`)
  b.wire(`${req[1]}.Q`, `${nor01}.B`)
  b.wire(`${nor01}.Y`, `${or2}.B`)
  b.wire(`${over}.Q`, `${or2}.A`)
  b.wire(`${req[2]}.Q`, `${grant2}.A`)
  b.wire(`${or2}.Y`, `${grant2}.B`)
  b.wire(`${grant2}.Y`, `${bufs[2]}.EN`)
  b.wire(`${grant2}.Y`, `${led[2]}.A`)
  b.wire(`${junction}.Y`, `${disp}.A`)
  frameAround(b, 'Arbiter: lowest request wins', [not0, or1, grant1, nor01, or2, grant2, over, ...led], 'green')
  note(
    b,
    360,
    230,
    'Switch on one or more Requests: only the lowest-numbered one is granted the bus, so the bus always holds one clean value. Now switch on Override: the arbiter grants everybody, the devices disagree, and the bus turns unknown.',
    36,
  )
  return b.build()
}

/** The 4-bit ALU with the flags a processor keeps: zero, carry and negative. */
function aluFlags(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('hexin', 0, 0, { label: 'A', params: { value: 7 } })
  const bb = b.add('hexin', 0, 140, { label: 'B', params: { value: 9 } })
  const alu = b.add('alu', 150, 0)
  const res = b.add('hexdisp', 340, 0, { label: 'Result F' })
  const z = b.add('led', 340, 120, { label: 'Zero (Z)', params: { color: 'yellow' } })
  const c = b.add('led', 340, 170, { label: 'Carry (C)', params: { color: 'red' } })
  const n = b.add('led', 340, 220, { label: 'Negative (N)', params: { color: 'green' } })
  ;[2, 1, 0].forEach((k, i) => {
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
  b.wire(`${alu}.F3`, `${n}.A`)
  note(
    b,
    0,
    330,
    'The S switches pick the operation (S2 S1 S0 as a binary number): 0 ADD, 1 SUB, 2 AND, 3 OR, 4 XOR, 5 NOT A, 6 A+1, 7 A-1. Z lights when the result is 0, C when the add carries out (or the subtract borrows), N when the top bit is set, i.e. the result is negative as a signed number. Try 15 + 1, then 5 - 5, then 7 + 1. A processor uses these flags to decide on a branch.',
    60,
  )
  return b.build()
}

/** Pulse-width modulation: a lamp that is on for Duty ticks out of every 16. */
function pwm(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 20, { params: { hz: 16 } })
  const cnt = b.add('counter', 130, 0, { params: { mod: 16 }, label: 'Counter' })
  const duty = b.add('hexin', 130, 200, { label: 'Duty', params: { value: 4 } })
  const cmp = b.add('cmp4', 330, 40)
  const lamp = b.add('led', 500, 60, { label: 'Lamp' })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  for (let i = 0; i < 4; i++) {
    b.wire(`${cnt}.${'ABCD'[i]}`, `${cmp}.A${i}`)
    b.wire(`${duty}.${'ABCD'[i]}`, `${cmp}.B${i}`)
  }
  b.wire(`${cmp}.LT`, `${lamp}.A`)
  probes(b, [['Count bit 3', `${cnt}.D`], ['Count bit 2', `${cnt}.C`], ['Lamp', `${cmp}.LT`]], 0, 330)
  note(
    b,
    0,
    420,
    'A counter runs from 0 to 15 over and over. The comparator lights the lamp while the count is below Duty, so the lamp is on for Duty ticks out of 16. Click Duty to change it and watch the Lamp wave in the waveform view get wider or narrower. At a real clock speed of thousands of ticks a second your eye sees only the average: a dimmer or brighter light, with no flicker. This is how microcontrollers dim LEDs and drive motors.',
    60,
  )
  return b.build()
}

/**
 * A push button that bounces, and two counters that count its presses: one wired straight to the contact, one behind a
 * debouncer. The contact is modelled as the button level XOR a burst of jitter for a few ticks after every change.
 * The debouncer takes a sample every 125 ms and only believes a level once it has seen it three times in a row.
 */
function debouncer(): Circuit {
  const b = new CircuitBuilder()
  const press = b.add('switch', 0, 40, { label: 'Press' })
  const jit = b.add('clock', 0, 140, { params: { hz: 32 }, label: 'Jitter clock' })
  const delay = b.add('shiftreg', 150, 0, { label: 'Delay' })
  const win = b.add('xor', 330, 20)
  const burst = b.add('and', 420, 20)
  const raw = b.add('xor', 510, 20)
  const rawLed = b.add('led', 640, 30, { label: 'Contact', params: { color: 'yellow' } })
  b.wire(`${press}.Q`, `${delay}.SI`)
  b.wire(`${jit}.Q`, `${delay}.CLK`)
  b.wire(`${press}.Q`, `${win}.A`)
  b.wire(`${delay}.QC`, `${win}.B`)
  b.wire(`${win}.Y`, `${burst}.A`)
  b.wire(`${jit}.Q`, `${burst}.B`)
  b.wire(`${press}.Q`, `${raw}.A`)
  b.wire(`${burst}.Y`, `${raw}.B`)
  b.wire(`${raw}.Y`, `${rawLed}.A`)
  frameAround(b, 'A bouncing button', [press, jit, delay, win, burst, raw, rawLed], 'yellow')

  const naive = b.add('counter', 150, 280, { params: { mod: 16 }, label: 'Naive counter' })
  const naiveDisp = b.add('hexdisp', 330, 280, { label: 'Presses (naive)' })
  b.wire(`${raw}.Y`, `${naive}.CLK`)
  for (const p of 'ABCD') b.wire(`${naive}.${p}`, `${naiveDisp}.${p}`)
  frameAround(b, 'Counting the contact directly', [naive, naiveDisp], 'pink')

  const sample = b.add('clock', 0, 520, { params: { hz: 8 }, label: 'Sample clock' })
  const hist = b.add('shiftreg', 150, 500, { label: 'Last three samples' })
  const all1 = b.add('and', 360, 500, { params: { inputs: 3 } })
  const all0 = b.add('nor', 360, 600, { params: { inputs: 3 } })
  const latch = b.add('srlatch', 480, 540, { label: 'Stable level' })
  const clean = b.add('led', 600, 540, { label: 'Clean', params: { color: 'green' } })
  const good = b.add('counter', 150, 740, { params: { mod: 16 }, label: 'Counter' })
  const goodDisp = b.add('hexdisp', 330, 740, { label: 'Presses (debounced)' })
  b.wire(`${raw}.Y`, `${hist}.SI`)
  b.wire(`${sample}.Q`, `${hist}.CLK`)
  for (const p of 'ABC') {
    b.wire(`${hist}.Q${p}`, `${all1}.${p}`)
    b.wire(`${hist}.Q${p}`, `${all0}.${p}`)
  }
  b.wire(`${all1}.Y`, `${latch}.S`)
  b.wire(`${all0}.Y`, `${latch}.R`)
  b.wire(`${latch}.Q`, `${clean}.A`)
  b.wire(`${latch}.Q`, `${good}.CLK`)
  for (const p of 'ABCD') b.wire(`${good}.${p}`, `${goodDisp}.${p}`)
  frameAround(b, 'Debounced: three equal samples in a row', [sample, hist, all1, all0, latch, clean, good, goodDisp], 'green')

  note(
    b,
    700,
    0,
    'Flip Press on and off. The yellow Contact LED flickers for a moment after every change, like a real switch. The naive counter counts every flicker, so it jumps by several for each press; the debounced counter counts once. The fix samples the contact slowly and only accepts a level once it has been seen three times in a row.',
    40,
  )
  return b.build()
}

/**
 * A stopwatch showing minutes and seconds. Start/Stop toggles a flip-flop that enables the counters; Lap copies the time into
 * three registers on the next tick, so the Lap display holds a split time while the main display keeps running.
 */
function stopwatch(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 260, { params: { hz: 1 }, label: '1 Hz' })
  const startBtn = b.add('button', 0, 40, { label: 'Start/Stop' })
  const resetBtn = b.add('button', 0, 120, { label: 'Reset' })
  const lapBtn = b.add('button', 0, 190, { label: 'Lap' })
  const run = b.add('tff', 110, 20, { label: 'Running' })
  const runLed = b.add('led', 240, 30, { label: 'Running', params: { color: 'green' } })
  b.wire(`${startBtn}.Q`, `${run}.CLK`)
  b.wire(`${run}.Q`, `${runLed}.A`)

  const names = ['Minutes', 'Tens of seconds', 'Seconds']
  const mods = [10, 6, 10]
  const cnt = mods.map((mod, i) => b.add('counter', 330 + i * 260, 0, { params: { mod }, label: `Counter ${names[i]}` }))
  const disp = mods.map((_, i) => b.add('hexdisp', 470 + i * 260, 0, { label: names[i] }))
  const reg = mods.map((_, i) => b.add('register', 330 + i * 260, 280, { label: `Latch ${names[i]}` }))
  const lapDisp = mods.map((_, i) => b.add('hexdisp', 470 + i * 260, 280, { label: `Lap ${names[i]}` }))
  cnt.forEach((c, i) => {
    b.wire(`${clk}.Q`, `${c}.CLK`)
    b.wire(`${resetBtn}.Q`, `${c}.R`)
    for (const p of 'ABCD') {
      b.wire(`${c}.${p}`, `${disp[i]}.${p}`)
      b.wire(`${c}.${p}`, `${reg[i]}.${p}`)
      b.wire(`${reg[i]}.Q${p}`, `${lapDisp[i]}.${p}`)
    }
    b.wire(`${clk}.Q`, `${reg[i]}.CLK`)
    b.wire(`${lapBtn}.Q`, `${reg[i]}.LD`)
  })
  // Seconds count while running; each digit to the left counts when the digit to its right is at its last value.
  b.wire(`${run}.Q`, `${cnt[2]}.EN`)
  b.wire(`${cnt[2]}.CO`, `${cnt[1]}.EN`)
  b.wire(`${cnt[1]}.CO`, `${cnt[0]}.EN`)
  frameAround(b, 'Time', [...cnt, ...disp], 'blue')
  frameAround(b, 'Lap time', [...reg, ...lapDisp], 'yellow')
  note(
    b,
    0,
    420,
    'Press Start/Stop to run and press it again to stop. Reset zeroes the time. Hold Lap for a moment (one clock tick, a second) to copy the time into the Lap display while the main one keeps counting.',
    60,
  )
  return b.build()
}

/**
 * A UART: one byte sent over a single wire and received again. The transmitter loads start bit, 8 data bits and stop bit into a
 * 12-bit shift register chain and shifts them out, one per baud tick. The receiver has its own clock, four times as fast: it
 * waits for the line to fall, then samples in the middle of each bit and collects the byte. (A real UART uses 16 times.)
 */
function uart(): Circuit {
  const b = new CircuitBuilder()
  const one = b.add('const', 0, 600, { params: { value: 1 } })
  const zero = b.add('const', 0, 650, { params: { value: 0 } })

  // Transmitter
  const lo = b.add('hexin', 0, 0, { label: 'Data low', params: { value: 5 } })
  const hi = b.add('hexin', 0, 140, { label: 'Data high', params: { value: 10 } })
  const send = b.add('switch', 0, 300, { label: 'Send' })
  const baud = b.add('clock', 0, 380, { params: { hz: 16 }, label: 'Baud clock' })
  const t1 = b.add('shiftreg', 200, 0, { label: 'TX 1' })
  const t2 = b.add('shiftreg', 400, 0, { label: 'TX 2' })
  const t3 = b.add('shiftreg', 600, 0, { label: 'TX 3' })
  const tbusy = b.add('dff', 200, 300, { label: 'TX busy' })
  const tstart = b.add('and', 340, 300)
  const tcnt = b.add('counter', 200, 460, { params: { mod: 16 }, label: 'TX bit counter' })
  const tdone = b.add('and', 340, 420)
  const tnd = b.add('not', 440, 420)
  const tkeep = b.add('and', 520, 400)
  const tnext = b.add('or', 620, 340)
  const line = b.add('or', 760, 40, { label: 'Line' })
  const lineLed = b.add('led', 860, 50, { label: 'Line (1 = idle)', params: { color: 'yellow' } })
  b.wire(`${baud}.Q`, `${t1}.CLK`)
  b.wire(`${baud}.Q`, `${t2}.CLK`)
  b.wire(`${baud}.Q`, `${t3}.CLK`)
  b.wire(`${baud}.Q`, `${tbusy}.CLK`)
  b.wire(`${baud}.Q`, `${tcnt}.CLK`)
  // Frame, in the order it leaves TX 3: start, d0..d7, stop (then idle ones).
  const loads: [string, string, string, string, string][] = [
    [t3, `${lo}.C`, `${lo}.B`, `${lo}.A`, `${zero}.Q`],
    [t2, `${hi}.C`, `${hi}.B`, `${hi}.A`, `${lo}.D`],
    [t1, `${one}.Q`, `${one}.Q`, `${one}.Q`, `${hi}.D`],
  ]
  for (const [sr, a, bb, c, d] of loads) {
    b.wire(a, `${sr}.A`)
    b.wire(bb, `${sr}.B`)
    b.wire(c, `${sr}.C`)
    b.wire(d, `${sr}.D`)
    b.wire(`${tstart}.Y`, `${sr}.LD`)
  }
  b.wire(`${one}.Q`, `${t1}.SI`)
  b.wire(`${t1}.QD`, `${t2}.SI`)
  b.wire(`${t2}.QD`, `${t3}.SI`)
  b.wire(`${tbusy}.NQ`, `${tstart}.A`)
  b.wire(`${send}.Q`, `${tstart}.B`)
  b.wire(`${tbusy}.NQ`, `${tcnt}.R`)
  b.wire(`${tcnt}.A`, `${tdone}.A`)
  b.wire(`${tcnt}.D`, `${tdone}.B`)
  b.wire(`${tdone}.Y`, `${tnd}.A`)
  b.wire(`${tbusy}.Q`, `${tkeep}.A`)
  b.wire(`${tnd}.Y`, `${tkeep}.B`)
  b.wire(`${tstart}.Y`, `${tnext}.A`)
  b.wire(`${tkeep}.Y`, `${tnext}.B`)
  b.wire(`${tnext}.Y`, `${tbusy}.D`)
  b.wire(`${tbusy}.NQ`, `${line}.A`)
  b.wire(`${t3}.QD`, `${line}.B`)
  b.wire(`${line}.Y`, `${lineLed}.A`)
  frameAround(b, 'Transmitter', [lo, hi, send, baud, t1, t2, t3, tbusy, tstart, tcnt, tdone, tnd, tkeep, tnext], 'blue')

  // Receiver
  const y = 820
  const rxclk = b.add('clock', 0, y, { params: { hz: 64 }, label: 'Receiver clock' })
  const rbusy = b.add('dff', 200, y, { label: 'RX busy' })
  const nl = b.add('not', 200, y + 180)
  const rstart = b.add('and', 300, y + 160)
  const phase = b.add('counter', 200, y + 280, { params: { mod: 4 }, label: 'Phase' })
  const bits = b.add('counter', 400, y + 280, { params: { mod: 16 }, label: 'RX bit counter' })
  const rdone = b.add('and', 540, y + 200)
  const rnd = b.add('not', 640, y + 200)
  const rkeep = b.add('and', 720, y + 180)
  const rnext = b.add('or', 820, y + 140)
  const r1 = b.add('shiftreg', 420, y - 40, { label: 'RX 1' })
  const r2 = b.add('shiftreg', 620, y - 40, { label: 'RX 2' })
  const r3 = b.add('shiftreg', 820, y - 40, { label: 'RX 3' })
  const regLo = b.add('register', 1020, y - 40, { label: 'Received low' })
  const regHi = b.add('register', 1020, y + 200, { label: 'Received high' })
  const outLo = b.add('hexdisp', 1200, y - 40, { label: 'Received low' })
  const outHi = b.add('hexdisp', 1200, y + 200, { label: 'Received high' })
  const rxLed = b.add('led', 1020, y + 400, { label: 'Receiving', params: { color: 'green' } })
  b.wire(`${line}.Y`, `${nl}.A`)
  b.wire(`${rxclk}.Q`, `${rbusy}.CLK`)
  b.wire(`${rbusy}.NQ`, `${rstart}.A`)
  b.wire(`${nl}.Y`, `${rstart}.B`)
  b.wire(`${rstart}.Y`, `${rnext}.A`)
  b.wire(`${rbusy}.Q`, `${rkeep}.A`)
  b.wire(`${rnd}.Y`, `${rkeep}.B`)
  b.wire(`${rkeep}.Y`, `${rnext}.B`)
  b.wire(`${rnext}.Y`, `${rbusy}.D`)
  b.wire(`${rxclk}.Q`, `${phase}.CLK`)
  b.wire(`${rbusy}.NQ`, `${phase}.R`)
  b.wire(`${phase}.B`, `${bits}.CLK`)
  b.wire(`${rbusy}.NQ`, `${bits}.R`)
  b.wire(`${bits}.D`, `${rdone}.A`)
  b.wire(`${bits}.B`, `${rdone}.B`)
  b.wire(`${rdone}.Y`, `${rnd}.A`)
  // The phase counter's second bit is the sample clock: it rises in the middle of every bit.
  for (const sr of [r1, r2, r3]) b.wire(`${phase}.B`, `${sr}.CLK`)
  b.wire(`${line}.Y`, `${r1}.SI`)
  b.wire(`${r1}.QD`, `${r2}.SI`)
  b.wire(`${r2}.QD`, `${r3}.SI`)
  const lowBits = [`${r3}.QA`, `${r2}.QD`, `${r2}.QC`, `${r2}.QB`]
  const highBits = [`${r2}.QA`, `${r1}.QD`, `${r1}.QC`, `${r1}.QB`]
  'ABCD'.split('').forEach((p, i) => {
    b.wire(lowBits[i], `${regLo}.${p}`)
    b.wire(highBits[i], `${regHi}.${p}`)
    b.wire(`${regLo}.Q${p}`, `${outLo}.${p}`)
    b.wire(`${regHi}.Q${p}`, `${outHi}.${p}`)
  })
  for (const reg of [regLo, regHi]) {
    b.wire(`${rxclk}.Q`, `${reg}.CLK`)
    b.wire(`${rdone}.Y`, `${reg}.LD`)
  }
  b.wire(`${rbusy}.Q`, `${rxLed}.A`)
  frameAround(b, 'Receiver', [rxclk, rbusy, nl, rstart, phase, bits, rdone, rnd, rkeep, rnext, r1, r2, r3, regLo, regHi, outLo, outHi, rxLed], 'green')

  probes(b, [['Baud clock', `${baud}.Q`], ['Line', `${line}.Y`], ['Sample clock', `${phase}.B`], ['Receiving', `${rbusy}.Q`]], 0, y + 560)
  note(
    b,
    0,
    y + 640,
    'Set the byte with the two Data inputs, then switch Send on (and off again). The line drops to 0 for the start bit, carries the eight data bits least significant first, and returns to 1 for the stop bit; open the waveform view with Line and Baud clock to see the frame. The receiver notices the falling edge, waits half a bit, then reads the line once per bit and copies the byte into Received.',
    60,
  )
  return b.build()
}

/** Each example's builder, by id. `EXAMPLES` pairs them with the names and groups of `examples-index.ts`. */
const BUILDERS: Record<string, () => Circuit> = {
  counter: counterDisplay,
  beginner: beginnerComputer,
  '6502': board6502,
  '6502-counter': counter6502,
  '6502-hello': hello6502,
  '6502-keypad': keypad6502,
  '6502-ball': ball6502,
  '6502-basic': basic6502,
  '6502-via': via6502,
  '6502-lcd': lcd6502,
  '6502-basic-lcd': basicLcd6502,
  '6502-echo': echo6502,
  '6502-echo-irq': echoIrq6502,
  '6502-parts': () => micro6502({ hz: 32 }),
  '6502-parts-basic': micro6502Basic,
  '65c02': sweep65c02,
  '65c02-timer': timer65c02,
  gates: basicGates,
  mux: muxDemo,
  encoder: encoderDecoder,
  labels: netLabels,
  'sr-latch': srLatch,
  'd-latch': nandDLatch,
  'master-slave': masterSlave,
  debounce: debouncer,
  'shift-register': shiftRegister,
  'ripple-counter': rippleCounter,
  adder,
  'alu-flags': aluFlags,
  calculator,
  tristate: sharedLine,
  buses: busDemo,
  arbiter,
  databus: dataBus,
  hazard,
  ripple,
  oscillator: ringOscillator,
  uart,
  'fsm-traffic': () => generateFsm(TRAFFIC_LIGHT).circuit,
  'fsm-detector': () => generateFsm(SEQUENCE_DETECTOR).circuit,
  'fsm-vending': () => generateFsm(VENDING_MACHINE).circuit,
  'fsm-updown': () => generateFsm(UP_DOWN_COUNTER).circuit,
  intersection: trafficLights,
  dice,
  stopwatch,
  clock: digitalClock,
  pwm,
  lfsr,
  matrix: matrixSmiley,
  ...Object.fromEntries(PROGRAMS.map((p) => [p.id, () => computer2(p)])),
  'ic-adder': icAdder,
  'computer-blocks': computerBlocks,
}

export const EXAMPLES: Example[] = EXAMPLE_LIST.map((info) => ({ ...info, build: BUILDERS[info.id] }))
