import { CircuitBuilder } from './builder'
import { frameAround, note } from './annotate'
import type { Circuit } from './circuit'

/**
 * Subtracting: a bit at a time (half and full subtractor), on four bits (the adder/subtractor, which subtracts by adding the two's
 * complement, beside the plain subtractor), and on eight bits on a bus.
 */
export function subtract(): Circuit {
  const b = new CircuitBuilder()
  const lamp = (x: number, y: number, label: string, color = 'green') => b.add('led', x, y, { label, params: { color } })
  const NIB = ['A', 'B', 'C', 'D']

  // ---- One bit -----------------------------------------------------------------------------------------
  const a1 = b.add('switch', 0, 20, { label: 'A', params: { on: true } })
  const b1 = b.add('switch', 0, 120, { label: 'B' })
  const bi = b.add('switch', 0, 240, { label: 'Borrow in' })
  const hs = b.add('halfsub', 160, 20, { label: 'Half subtractor' })
  const fs = b.add('fullsub', 160, 240, { label: 'Full subtractor' })
  b.wire(`${a1}.Q`, `${hs}.A`)
  b.wire(`${b1}.Q`, `${hs}.B`)
  b.wire(`${a1}.Q`, `${fs}.A`)
  b.wire(`${b1}.Q`, `${fs}.B`)
  b.wire(`${bi}.Q`, `${fs}.Bi`)
  b.wire(`${hs}.D`, `${lamp(320, 30, 'A − B')}.A`)
  b.wire(`${hs}.Bo`, `${lamp(320, 100, 'Borrow', 'yellow')}.A`)
  b.wire(`${fs}.D`, `${lamp(320, 250, 'A − B − borrow in')}.A`)
  b.wire(`${fs}.Bo`, `${lamp(320, 320, 'Borrow', 'yellow')}.A`)
  frameAround(b, 'One bit', [a1, b1, bi, hs, fs])

  // ---- Four bits ---------------------------------------------------------------------------------------
  const x0 = 620
  const a4 = b.add('hexin', x0, 20, { label: 'A', params: { value: 3 } })
  const b4 = b.add('hexin', x0, 160, { label: 'B', params: { value: 5 } })
  const mode = b.add('switch', x0, 320, { label: 'Subtract', params: { on: true } })
  const as = b.add('addsub4', x0 + 160, 20, { label: 'Adder / subtractor' })
  const sub = b.add('sub4', x0 + 160, 420, { label: 'Subtractor' })
  NIB.forEach((p, i) => {
    b.wire(`${a4}.${p}`, `${as}.A${i}`)
    b.wire(`${b4}.${p}`, `${as}.B${i}`)
    b.wire(`${a4}.${p}`, `${sub}.A${i}`)
    b.wire(`${b4}.${p}`, `${sub}.B${i}`)
  })
  b.wire(`${mode}.Q`, `${as}.M`)
  const result = b.add('hexdisp', x0 + 340, 20, { label: 'Result' })
  NIB.forEach((p, i) => b.wire(`${as}.S${i}`, `${result}.${p}`))
  // The four result bits as lamps, the top one (bit 3) is the sign.
  ;[3, 2, 1, 0].forEach((bit, k) => b.wire(`${as}.S${bit}`, `${lamp(x0 + 340, 150 + k * 50, `S${bit}`)}.A`))
  b.wire(`${as}.S3`, `${lamp(x0 + 460, 150, 'Negative (S3)', 'red')}.A`)
  b.wire(`${as}.Co`, `${lamp(x0 + 460, 230, 'Carry out', 'yellow')}.A`)
  b.wire(`${as}.V`, `${lamp(x0 + 460, 310, 'Overflow', 'red')}.A`)
  const diff = b.add('hexdisp', x0 + 340, 420, { label: 'A − B' })
  NIB.forEach((p, i) => b.wire(`${sub}.D${i}`, `${diff}.${p}`))
  b.wire(`${sub}.Bo`, `${lamp(x0 + 340, 540, 'Borrow (A < B)', 'yellow')}.A`)
  const guide = note(
    b,
    x0 + 160,
    690,
    'Subtract is on: the adder/subtractor adds the two’s complement of B, so 3 − 5 shows E, which is −2 in four bits: the top bit, the sign, is 1. Switch Subtract off and it adds. The plain subtractor beside it gives the same bits, and its borrow says A is smaller than B. Try A = 7, B = 1 and then 7 + 1 with Subtract off: the overflow lamp lights, because 8 does not fit in four signed bits.',
    28,
  )
  frameAround(b, 'Four bits: two’s complement', [a4, b4, mode, as, sub, result, diff, guide])

  // ---- Eight bits on a bus -----------------------------------------------------------------------------
  const x1 = 1380
  const a8 = b.add('busin', x1, 20, { label: 'A', params: { bits: 8, value: '05' } })
  const b8 = b.add('busin', x1, 140, { label: 'B', params: { bits: 8, value: '09' } })
  const bs = b.add('bussub', x1 + 160, 20, { label: 'Subtractor', params: { bits: 8 } })
  const bas = b.add('busaddsub', x1 + 160, 520, { label: 'Adder / subtractor', params: { bits: 8 } })
  const m8 = b.add('switch', x1, 300, { label: 'Subtract', params: { on: true } })
  for (const part of [bs, bas]) {
    b.wire(`${a8}.Q`, `${part}.A`)
    b.wire(`${b8}.Q`, `${part}.B`)
  }
  b.wire(`${m8}.Q`, `${bas}.M`)
  const disp = (x: number, y: number, label: string, format: string) => b.add('busdisp', x, y, { label, params: { bits: 8, format } })
  b.wire(`${bs}.D`, `${disp(x1 + 340, 20, 'A − B (unsigned)', 'dec')}.A`)
  b.wire(`${bs}.D`, `${disp(x1 + 340, 100, 'A − B (binary)', 'bin')}.A`)
  b.wire(`${bs}.Bo`, `${lamp(x1 + 340, 190, 'Borrow', 'yellow')}.A`)
  b.wire(`${bas}.S`, `${disp(x1 + 340, 520, 'Result (unsigned)', 'dec')}.A`)
  b.wire(`${bas}.S`, `${disp(x1 + 340, 600, 'Result (binary)', 'bin')}.A`)
  b.wire(`${bas}.Co`, `${lamp(x1 + 340, 690, 'Carry out', 'yellow')}.A`)
  b.wire(`${bas}.V`, `${lamp(x1 + 340, 750, 'Overflow', 'red')}.A`)
  frameAround(b, 'Eight bits on a bus', [a8, b8, m8, bs, bas])
  return b.build()
}
