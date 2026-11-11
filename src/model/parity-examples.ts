import { CircuitBuilder } from './builder'
import { frameAround, note } from './annotate'
import type { Circuit } from './circuit'

/**
 * Two small coding ideas. A parity bit sent with four data bits over a line that two switches can corrupt: a generator on the sending
 * side, a checker on the receiving side, and an Error lamp. And a Gray counter beside a binary one: the waveforms show that a Gray code
 * changes one bit at each step, a binary count sometimes several.
 */
export function parityGray(): Circuit {
  const b = new CircuitBuilder()
  const NIB = ['A', 'B', 'C', 'D']
  const lamp = (x: number, y: number, label: string, color = 'green') => b.add('led', x, y, { label, params: { color } })

  // ---- A parity bit over a line ------------------------------------------------------------------------
  const data = b.add('hexin', 0, 20, { label: 'Data to send', params: { value: 11 } })
  const sent = b.add('hexdisp', 0, 180, { label: 'Sent' })
  NIB.forEach((p) => b.wire(`${data}.${p}`, `${sent}.${p}`))
  const gen = b.add('parity', 180, 20, { label: 'Parity generator', params: { n: 4 } })
  NIB.forEach((p, i) => b.wire(`${data}.${p}`, `${gen}.I${i}`))
  const pbit = lamp(180, 200, 'Parity bit')
  b.wire(`${gen}.ODD`, `${pbit}.A`)

  // The line: two switches flip bit 0 and bit 1 on the way (an XOR with the switch).
  const flip0 = b.add('switch', 400, 120, { label: 'Flip bit 0' })
  const flip1 = b.add('switch', 400, 200, { label: 'Flip bit 1' })
  const x0 = b.add('xor', 540, 20, { label: 'bit 0' })
  const x1 = b.add('xor', 540, 120, { label: 'bit 1' })
  b.wire(`${data}.A`, `${x0}.A`)
  b.wire(`${flip0}.Q`, `${x0}.B`)
  b.wire(`${data}.B`, `${x1}.A`)
  b.wire(`${flip1}.Q`, `${x1}.B`)
  frameAround(b, 'The line', [flip0, flip1, x0, x1])

  // The receiver: a parity checker over the four data bits and the parity bit (the other three inputs of the 8-input part are 0).
  const check = b.add('parity', 760, 20, { label: 'Parity checker', params: { n: 8 } })
  const received = [`${x0}.Y`, `${x1}.Y`, `${data}.C`, `${data}.D`]
  received.forEach((from, i) => b.wire(from, `${check}.I${i}`))
  b.wire(`${gen}.ODD`, `${check}.I4`)
  ;[5, 6, 7].forEach((i) => b.wire(`${b.add('const', 700, 20 + i * 30, { params: { value: 0 } })}.Q`, `${check}.I${i}`))
  const got = b.add('hexdisp', 960, 20, { label: 'Received' })
  received.forEach((from, i) => b.wire(from, `${got}.${NIB[i]}`))
  const error = lamp(960, 180, 'Error', 'red')
  b.wire(`${check}.ODD`, `${error}.A`)
  const guide = note(
    b,
    1100,
    20,
    'The sender adds a parity bit that makes the number of 1s even. The receiver counts the 1s again, parity bit included: if the count is odd, the Error lamp lights. Flip bit 0 and the error is caught. Flip bit 0 and bit 1 together, and it is not: two wrong bits keep the count even. Change the data, and watch the parity bit follow.',
    34,
  )
  frameAround(b, 'Parity: catching a flipped bit', [data, sent, gen, pbit, flip0, flip1, x0, x1, check, got, error, guide])

  // ---- A Gray counter beside a binary one --------------------------------------------------------------
  const y0 = 560
  const clk = b.add('clock', 0, y0 + 40, { params: { hz: 2 }, label: 'Clock' })
  const cnt = b.add('counter', 160, y0, { params: { mod: 16 }, label: 'Counter' })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  const binary = b.add('hexdisp', 340, y0, { label: 'Binary' })
  NIB.forEach((p) => b.wire(`${cnt}.${p}`, `${binary}.${p}`))
  const gray = b.add('gray', 340, y0 + 160, { label: 'Binary → Gray' })
  NIB.forEach((p, i) => b.wire(`${cnt}.${p}`, `${gray}.B${i}`))
  const grayDisp = b.add('hexdisp', 520, y0 + 160, { label: 'Gray code' })
  NIB.forEach((p, i) => b.wire(`${gray}.G${i}`, `${grayDisp}.${p}`))
  const signals: [string, string][] = [
    ...NIB.map((p, i): [string, string] => [`Binary ${i}`, `${cnt}.${p}`]),
    ...NIB.map((p, i): [string, string] => [`Gray ${i}`, `${gray}.G${i}`]),
  ]
  signals.forEach(([label, from], i) => b.wire(from, `${b.add('probe', 160 + (i % 4) * 100, y0 + 360 + Math.floor(i / 4) * 100, { label })}.A`))
  const grayNote = note(
    b,
    700,
    y0,
    'The same counter, shown twice. In binary, going from 7 to 8 changes all four bits; in Gray code every step changes exactly one bit (7 is 0100, 8 is 1100). Open the waveforms and compare Binary and Gray: that is why Gray codes are used for position sensors and for passing counts between clocks.',
    34,
  )
  frameAround(b, 'A Gray counter beside a binary one', [clk, cnt, binary, gray, grayDisp, grayNote, ...Object.values(b.c.comps).filter((k) => k.type === 'probe').map((k) => k.id)])
  return b.build()
}
