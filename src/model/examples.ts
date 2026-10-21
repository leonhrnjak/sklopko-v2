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

export const EXAMPLES: Example[] = [
  { id: 'counter', name: 'Counter → 7-segment display', build: counterDisplay },
  { id: 'gates', name: 'Basic gates', build: basicGates },
  { id: 'sr', name: 'SR latch from NOR gates', build: srLatch },
  { id: 'dlatch', name: 'D latch from NAND gates', build: nandDLatch },
  { id: 'shift', name: 'Shift register (D flip-flops)', build: shiftRegister },
  { id: 'ripple', name: 'Ripple counter (T flip-flops)', build: rippleCounter },
  { id: 'adder', name: '4-bit adder', build: adder },
  { id: 'mux', name: '4:1 multiplexer', build: muxDemo },
  { id: 'osc', name: 'Ring oscillator (unstable)', build: ringOscillator },
]
