import { CircuitBuilder } from './builder'
import type { Circuit, Rot } from './circuit'

export interface Example {
  /** Also the URL slug: sklopko.example/<id> opens this example. */
  id: string
  name: string
  build(): Circuit
}

function counterDisplay(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 60, { params: { hz: 2 } })
  const cnt = b.add('counter', 120, 40)
  const dec = b.add('bcd7', 280, 10)
  const seg = b.add('seg7', 440, 10)
  const rst = b.add('button', 60, 210, { label: 'Reset' })
  const co = b.add('led', 300, 230, { label: 'Carry', params: { color: 'yellow' } })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  for (const p of ['A', 'B', 'C', 'D']) b.wire(`${cnt}.${p}`, `${dec}.${p}`)
  for (const p of 'abcdefg') b.wire(`${dec}.${p}`, `${seg}.${p}`)
  b.wire(`${rst}.Q`, `${cnt}.R`)
  b.wire(`${cnt}.CO`, `${co}.A`)
  return b.build()
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

/**
 * Instruction set of the 4-bit computer: an instruction is `opcode (3 bits) | operand (4 bits)`, opcode in bits 4–6.
 * Bit 0 of ADD (4) / SUB (5) is wired straight to the ALU's select line, which is why they are neighbours.
 */
export const OPCODES = { LDI: 0, LDA: 1, STA: 2, JMP: 3, ADD: 4, SUB: 5, JNC: 6, HALT: 7 } as const

const instr = (op: keyof typeof OPCODES, operand = 0) =>
  ((OPCODES[op] << 4) | operand).toString(16).toUpperCase().padStart(2, '0')

/** Address of the output port: `STA 15` writes the accumulator to the Output register, as well as to RAM. */
export const OUT_PORT = 15

/**
 * Fibonacci: RAM[0] = a, RAM[1] = b, RAM[2] = a + b. Each number is written to the output port as soon as it is
 * known, so the Output display reads 0 1 1 2 3 5 8 D (13). The next sum no longer fits in 4 bits (carry): it stops.
 */
export const FIBONACCI = [
  instr('LDI', 0),
  instr('STA', 0), // a = 0
  instr('STA', OUT_PORT), // output 0
  instr('LDI', 1),
  instr('STA', 1), // b = 1
  instr('LDA', 1), // 5: loop
  instr('STA', OUT_PORT), //    output b
  instr('ADD', 0), //    acc = b + a, sets the carry flag
  instr('STA', 2), //    t = a + b
  instr('LDA', 1),
  instr('STA', 0), //    a = b
  instr('LDA', 2),
  instr('STA', 1), //    b = t
  instr('JNC', 5), //    no carry: next number
  instr('HALT'),
].join(' ')

/**
 * Control ROM, addressed by the opcode. Bits: 0 accumulator load, 1–2 accumulator source (0 operand, 1 ALU, 2 RAM),
 * 3 RAM write, 4 flag load, 5 jump, 6 jump if no carry, 7 halt.
 */
export const CONTROL = ['01', '05', '08', '20', '13', '13', '40', '80'].join(' ')

/** Where each part of the computer sits: `[x, y]`, plus `true` when it is flipped (inputs on the right). */
export const COMPUTER_LAYOUT: Record<string, [number, number, boolean?]> = {
  clk: [440, 620],
  pc: [120, 60],
  prog: [320, 40],
  ctl: [540, 320],
  ncarry: [740, 430],
  jnc: [820, 410],
  take: [920, 410],
  nhalt: [740, 500],
  halted: [800, 500],
  ram: [740, 100],
  alu: [900, 40],
  z1: [900, 290],
  amux0: [1080, 40],
  amux1: [1080, 180],
  amux2: [1080, 320],
  amux3: [1080, 460],
  acc: [1260, 120],
  flags: [1260, 320],
  z2: [1200, 420],
  pcDisp: [120, 290],
  accDisp: [1420, 120],
  carry: [1420, 340],
  zflag: [1420, 400],
  probe0: [520, 640],
  probe1: [250, 300],
  probe2: [250, 340],
  probe3: [250, 380],
  probe4: [250, 420],
  probe5: [1500, 40],
  probe6: [1500, 80],
  probe7: [1500, 120],
  probe8: [1500, 160],
  probe9: [1500, 260],
  outAnd: [1080, 620],
  out: [1260, 560],
  outDisp: [1420, 560],
}

/** The computer's parts and wires, positioned by `layout` (every part by its key). */
export function computerBuilder(layout: Record<string, [number, number, boolean?]>) {
  const b = new CircuitBuilder()
  const keys: Record<string, string> = {}
  const part = (key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}) => {
    const [x, y, flip] = layout[key] ?? [0, 0]
    return (keys[key] = b.add(type, x, y, { ...opts, ...(flip ? { flip } : {}) }))
  }
  const n4 = (prefix: string) => bitNames(prefix, 4)
  const Q = ['QA', 'QB', 'QC', 'QD']

  // ---- Fetch: program counter and program ROM -------------------------------------------------
  const clk = part('clk', 'clock', { params: { hz: 4 }, label: 'Clock' })
  const pc = part('pc', 'counterld', { label: 'PC' })
  const prog = part('prog', 'rom', { params: { abits: 4, dbits: 8, data: FIBONACCI }, label: 'Program' })
  wireBits(b, pc, n4('Q'), prog, n4('A'))
  wireBits(b, prog, n4('D'), pc, n4('D')) // jump target = operand
  b.wire(`${clk}.Q`, `${pc}.CLK`)

  // ---- Decode: control ROM ---------------------------------------------------------------------
  const ctl = part('ctl', 'rom', { params: { abits: 3, dbits: 8, data: CONTROL }, label: 'Control' })
  ;['D4', 'D5', 'D6'].forEach((p, i) => b.wire(`${prog}.${p}`, `${ctl}.A${i}`))

  // Load the jump target if the jump bit is set, or the jump-if-no-carry bit while the carry flag is 0.
  // On halt the counter stops counting.
  const flags = part('flags', 'register', { label: 'Flags' })
  const ncarry = part('ncarry', 'not', { label: 'no carry' })
  const jnc = part('jnc', 'and', { label: 'jump if no carry' })
  const take = part('take', 'or', { label: 'load PC' })
  const nhalt = part('nhalt', 'not', { label: 'not halted' })
  b.wire(`${flags}.QA`, `${ncarry}.A`)
  b.wire(`${ctl}.D6`, `${jnc}.A`)
  b.wire(`${ncarry}.Y`, `${jnc}.B`)
  b.wire(`${ctl}.D5`, `${take}.A`)
  b.wire(`${jnc}.Y`, `${take}.B`)
  b.wire(`${take}.Y`, `${pc}.LD`)
  b.wire(`${ctl}.D7`, `${nhalt}.A`)
  b.wire(`${nhalt}.Y`, `${pc}.EN`)
  const halted = part('halted', 'led', { label: 'Halted', params: { color: 'red' } })
  b.wire(`${ctl}.D7`, `${halted}.A`)

  // ---- Execute: RAM, ALU, accumulator ---------------------------------------------------------
  const ram = part('ram', 'ram', { label: 'Data RAM' })
  const alu = part('alu', 'alu', { label: 'ALU' })
  const acc = part('acc', 'register', { label: 'ACC' })
  const amux = [0, 1, 2, 3].map((i) => part(`amux${i}`, 'mux', { params: { n: 4 }, label: `ACC input, bit ${i}` }))
  wireBits(b, prog, n4('D'), ram, n4('A')) // RAM address = operand
  wireBits(b, acc, Q, ram, n4('D'))
  b.wire(`${ctl}.D3`, `${ram}.WE`)
  b.wire(`${clk}.Q`, `${ram}.CLK`)
  wireBits(b, acc, Q, alu, n4('A'))
  wireBits(b, ram, n4('Q'), alu, n4('B'))
  const z1 = part('z1', 'const', { params: { value: 0 } })
  b.wire(`${z1}.Q`, `${alu}.S1`)
  b.wire(`${z1}.Q`, `${alu}.S2`)
  b.wire(`${prog}.D4`, `${alu}.S0`) // opcode bit 0: ADD (0) or SUB (1)
  amux.forEach((m, i) => {
    b.wire(`${prog}.D${i}`, `${m}.I0`) // LDI: the operand itself
    b.wire(`${alu}.F${i}`, `${m}.I1`) // ADD, SUB
    b.wire(`${ram}.Q${i}`, `${m}.I2`) // LDA
    b.wire(`${ctl}.D1`, `${m}.S0`)
    b.wire(`${ctl}.D2`, `${m}.S1`)
    b.wire(`${m}.Y`, `${acc}.${NIB[i]}`)
  })
  b.wire(`${ctl}.D0`, `${acc}.LD`)
  b.wire(`${clk}.Q`, `${acc}.CLK`)

  // ---- Output port: STA 15 (RAM write, address 15) also loads the Output register --------------------
  const outAnd = part('outAnd', 'and', { params: { inputs: 5 }, label: 'write to port' })
  b.wire(`${ctl}.D3`, `${outAnd}.A`)
  n4('D').forEach((p, i) => b.wire(`${prog}.${p}`, `${outAnd}.${String.fromCharCode(66 + i)}`))
  const out = part('out', 'register', { label: 'Output port' })
  wireBits(b, acc, Q, out, NIB)
  b.wire(`${outAnd}.Y`, `${out}.LD`)
  b.wire(`${clk}.Q`, `${out}.CLK`)
  const outDisp = part('outDisp', 'hexdisp', { label: 'Output' })
  wireBits(b, out, Q, outDisp, NIB)

  // ---- Flags --------------------------------------------------------------------------------
  b.wire(`${alu}.Co`, `${flags}.A`)
  b.wire(`${alu}.Z`, `${flags}.B`)
  const z2 = part('z2', 'const', { params: { value: 0 } })
  b.wire(`${z2}.Q`, `${flags}.C`)
  b.wire(`${z2}.Q`, `${flags}.D`)
  b.wire(`${ctl}.D4`, `${flags}.LD`)
  b.wire(`${clk}.Q`, `${flags}.CLK`)

  // ---- Readouts: PC and accumulator in hex, flags, and waveforms ----------------------------------
  const pcDisp = part('pcDisp', 'hexdisp', { label: 'PC' })
  wireBits(b, pc, n4('Q'), pcDisp, NIB)
  const accDisp = part('accDisp', 'hexdisp', { label: 'ACC' })
  wireBits(b, acc, Q, accDisp, NIB)
  const carry = part('carry', 'led', { label: 'Carry', params: { color: 'yellow' } })
  const zflag = part('zflag', 'led', { label: 'Zero', params: { color: 'red' } })
  b.wire(`${flags}.QA`, `${carry}.A`)
  b.wire(`${flags}.QB`, `${zflag}.A`)
  const signals: [string, string][] = [
    ['CLK', `${clk}.Q`],
    ...n4('Q').map((q, i): [string, string] => [`PC${i}`, `${pc}.${q}`]),
    ...Q.map((q, i): [string, string] => [`ACC${i}`, `${acc}.${q}`]),
    ['Carry', `${flags}.QA`],
  ]
  signals.forEach(([label, from], i) => {
    const p = part(`probe${i}`, 'probe', { label })
    b.wire(from, `${p}.A`)
  })
  return { b, keys }
}

/**
 * A complete 4-bit computer that runs a program from ROM, one instruction per clock cycle. The program counter steps
 * through a program ROM; a second ROM turns the opcode into control signals; the ALU, a RAM and an accumulator do the
 * work; a carry flag lets the program decide when to stop. Edit the program in the ROM's inspector (hex words).
 */
function computer(): Circuit {
  return computerBuilder(COMPUTER_LAYOUT).b.build()
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

export const EXAMPLES: Example[] = [
  { id: 'counter', name: 'Counter → 7-segment display', build: counterDisplay },
  { id: 'intersection', name: 'Traffic lights with pedestrian crossing', build: trafficLights },
  { id: 'dice', name: 'Electronic dice', build: dice },
  { id: 'clock', name: 'Digital clock (HH:MM:SS)', build: digitalClock },
  { id: 'matrix', name: 'Dot matrix smiley (scanned)', build: matrixSmiley },
  { id: 'computer', name: '4-bit computer (runs Fibonacci)', build: computer },
  { id: 'calculator', name: 'Calculator: ALU, multiplier, ROM, BCD', build: calculator },
  { id: 'gates', name: 'Basic gates', build: basicGates },
  { id: 'sr-latch', name: 'SR latch from NOR gates', build: srLatch },
  { id: 'd-latch', name: 'D latch from NAND gates', build: nandDLatch },
  { id: 'shift-register', name: 'Shift register (D flip-flops)', build: shiftRegister },
  { id: 'ripple-counter', name: 'Ripple counter (T flip-flops)', build: rippleCounter },
  { id: 'adder', name: '4-bit adder', build: adder },
  { id: 'mux', name: '4:1 multiplexer', build: muxDemo },
  { id: 'oscillator', name: 'Ring oscillator (unstable)', build: ringOscillator },
]

/** The example named by a URL path like "/intersection", if any. */
export function exampleFromPath(pathname: string): Example | undefined {
  const slug = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, '')).toLowerCase()
  return EXAMPLES.find((e) => e.id === slug)
}
