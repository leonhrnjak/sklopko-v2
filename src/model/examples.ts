import { CircuitBuilder } from './builder'
import type { Circuit } from './circuit'

export interface Example {
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

function shiftRegister(): Circuit {
  const b = new CircuitBuilder()
  const data = b.add('switch', 20, 10, { label: 'Data', params: { on: true } })
  const clk = b.add('clock', 0, 120, { params: { hz: 1 } })
  let prev = `${data}.Q`
  for (let i = 0; i < 4; i++) {
    const x = 100 + i * 150
    const ff = b.add('dff', x, 0)
    b.wire(prev, `${ff}.D`)
    b.wire(`${clk}.Q`, `${ff}.CLK`)
    const led = b.add('led', x + 120, -70, { label: `Q${i}` })
    b.wire(`${ff}.Q`, `${led}.A`)
    prev = `${ff}.Q`
  }
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
  return b.build()
}

/**
 * Two-way traffic light with a pedestrian crossing. A counter steps through 16 phases; bit D says whose turn it is
 * (0 = north–south, 1 = east–west) and steps 6–7 of each half (bits C and B both 1) are yellow.
 * A pedestrian press is remembered by an SR latch until the next north–south green, when WALK lights up.
 */
function trafficLights(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 40, { params: { hz: 2 }, label: '2 Hz' })
  const cnt = b.add('counter', 120, 20, { params: { mod: 16 } })
  const stepDisp = b.add('hexdisp', 270, 20, { label: 'Step' })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  for (const p of ['A', 'B', 'C', 'D']) b.wire(`${cnt}.${p}`, `${stepDisp}.${p}`)

  // Phase decoding.
  const yellowTime = b.add('and', 440, 160, { label: 'yellow time' })
  const greenTime = b.add('nand', 440, 240, { label: 'green time' })
  const nsTurn = b.add('not', 440, 330, { label: 'N–S turn' })
  b.wire(`${cnt}.C`, `${yellowTime}.A`)
  b.wire(`${cnt}.B`, `${yellowTime}.B`)
  b.wire(`${cnt}.C`, `${greenTime}.A`)
  b.wire(`${cnt}.B`, `${greenTime}.B`)
  b.wire(`${cnt}.D`, `${nsTurn}.A`)

  // North–south light.
  const nsRed = b.add('led', 760, 0, { label: 'N–S', params: { color: 'red' } })
  const nsYellow = b.add('led', 760, 50, { params: { color: 'yellow' } })
  const nsGreen = b.add('led', 760, 100, { params: { color: 'green' } })
  const nsY = b.add('and', 640, 40)
  const nsG = b.add('and', 640, 90)
  b.wire(`${cnt}.D`, `${nsRed}.A`)
  b.wire(`${nsTurn}.Y`, `${nsY}.A`)
  b.wire(`${yellowTime}.Y`, `${nsY}.B`)
  b.wire(`${nsY}.Y`, `${nsYellow}.A`)
  b.wire(`${nsTurn}.Y`, `${nsG}.A`)
  b.wire(`${greenTime}.Y`, `${nsG}.B`)
  b.wire(`${nsG}.Y`, `${nsGreen}.A`)

  // East–west light.
  const ewRed = b.add('led', 760, 260, { label: 'E–W', params: { color: 'red' } })
  const ewYellow = b.add('led', 760, 310, { params: { color: 'yellow' } })
  const ewGreen = b.add('led', 760, 360, { params: { color: 'green' } })
  const ewY = b.add('and', 640, 300)
  const ewG = b.add('and', 640, 350)
  b.wire(`${nsTurn}.Y`, `${ewRed}.A`)
  b.wire(`${cnt}.D`, `${ewY}.A`)
  b.wire(`${yellowTime}.Y`, `${ewY}.B`)
  b.wire(`${ewY}.Y`, `${ewYellow}.A`)
  b.wire(`${cnt}.D`, `${ewG}.A`)
  b.wire(`${greenTime}.Y`, `${ewG}.B`)
  b.wire(`${ewG}.Y`, `${ewGreen}.A`)

  // Pedestrians: the latch remembers a press until the north–south light turns yellow.
  const request = b.add('button', 300, 470, { label: 'Pedestrian button' })
  const latch = b.add('srlatch', 440, 460, { label: 'request' })
  const walk = b.add('and', 640, 470)
  const dontWalk = b.add('not', 640, 540)
  const walkLed = b.add('led', 760, 480, { label: 'WALK', params: { color: 'green' } })
  const stopLed = b.add('led', 760, 540, { label: "DON'T WALK", params: { color: 'red' } })
  b.wire(`${request}.Q`, `${latch}.S`)
  b.wire(`${nsY}.Y`, `${latch}.R`)
  b.wire(`${latch}.Q`, `${walk}.A`)
  b.wire(`${nsG}.Y`, `${walk}.B`)
  b.wire(`${walk}.Y`, `${walkLed}.A`)
  b.wire(`${walk}.Y`, `${dontWalk}.A`)
  b.wire(`${dontWalk}.Y`, `${stopLed}.A`)
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

export const EXAMPLES: Example[] = [
  { id: 'counter', name: 'Counter → 7-segment display', build: counterDisplay },
  { id: 'traffic', name: 'Traffic lights with pedestrian crossing', build: trafficLights },
  { id: 'dice', name: 'Electronic dice', build: dice },
  { id: 'clock', name: 'Digital clock (HH:MM:SS)', build: digitalClock },
  { id: 'gates', name: 'Basic gates', build: basicGates },
  { id: 'sr', name: 'SR latch from NOR gates', build: srLatch },
  { id: 'dlatch', name: 'D latch from NAND gates', build: nandDLatch },
  { id: 'shift', name: 'Shift register (D flip-flops)', build: shiftRegister },
  { id: 'ripple', name: 'Ripple counter (T flip-flops)', build: rippleCounter },
  { id: 'adder', name: '4-bit adder', build: adder },
  { id: 'mux', name: '4:1 multiplexer', build: muxDemo },
  { id: 'osc', name: 'Ring oscillator (unstable)', build: ringOscillator },
]
