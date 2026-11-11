import { CircuitBuilder } from './builder'
import { frameAround, noteBelow } from './annotate'
import type { Circuit } from './circuit'

/**
 * Half adder and full adder, each built twice from the same switches: from gates, and as the one-part `halfadd` and `fulladd`,
 * so the learner can flip a switch and see both give the same sum and carry.
 */
export function adders(): Circuit {
  const b = new CircuitBuilder()
  const lamp = (x: number, y: number, label: string, color = 'green') => b.add('led', x, y, { label, params: { color } })

  // ---- Half adder: S = A xor B, C = A and B -----------------------------------------------------
  const a = b.add('switch', 0, 40, { label: 'A' })
  const bb = b.add('switch', 0, 140, { label: 'B' })
  const xor = b.add('xor', 160, 20)
  const and = b.add('and', 160, 120)
  b.wire(`${a}.Q`, `${xor}.A`)
  b.wire(`${bb}.Q`, `${xor}.B`)
  b.wire(`${a}.Q`, `${and}.A`)
  b.wire(`${bb}.Q`, `${and}.B`)
  const gs = lamp(300, 30, 'Sum')
  const gc = lamp(300, 130, 'Carry', 'yellow')
  b.wire(`${xor}.Y`, `${gs}.A`)
  b.wire(`${and}.Y`, `${gc}.A`)
  const ha = b.add('halfadd', 160, 300, { label: 'Half adder part' })
  b.wire(`${a}.Q`, `${ha}.A`)
  b.wire(`${bb}.Q`, `${ha}.B`)
  const ps = lamp(300, 310, 'Part sum')
  const pc = lamp(300, 380, 'Part carry', 'yellow')
  b.wire(`${ha}.S`, `${ps}.A`)
  b.wire(`${ha}.C`, `${pc}.A`)
  frameAround(b, 'Half adder from gates', [xor, and, gs, gc])
  frameAround(b, 'The same as one part', [ha, ps, pc])

  // ---- Full adder: two half adders and an OR ----------------------------------------------------
  const x0 = 640
  const fa = b.add('switch', x0, 40, { label: 'A' })
  const fb = b.add('switch', x0, 140, { label: 'B' })
  const ci = b.add('switch', x0, 240, { label: 'Carry in' })
  const x1 = b.add('xor', x0 + 160, 20)
  const a1 = b.add('and', x0 + 160, 120)
  const x2 = b.add('xor', x0 + 320, 40)
  const a2 = b.add('and', x0 + 320, 140)
  const or = b.add('or', x0 + 460, 130)
  b.wire(`${fa}.Q`, `${x1}.A`)
  b.wire(`${fb}.Q`, `${x1}.B`)
  b.wire(`${fa}.Q`, `${a1}.A`)
  b.wire(`${fb}.Q`, `${a1}.B`)
  b.wire(`${x1}.Y`, `${x2}.A`)
  b.wire(`${ci}.Q`, `${x2}.B`)
  b.wire(`${x1}.Y`, `${a2}.A`)
  b.wire(`${ci}.Q`, `${a2}.B`)
  b.wire(`${a1}.Y`, `${or}.A`)
  b.wire(`${a2}.Y`, `${or}.B`)
  const fs = lamp(x0 + 600, 50, 'Full sum')
  const fc = lamp(x0 + 600, 140, 'Carry out', 'yellow')
  b.wire(`${x2}.Y`, `${fs}.A`)
  b.wire(`${or}.Y`, `${fc}.A`)
  const fp = b.add('fulladd', x0 + 320, 340, { label: 'Full adder part' })
  b.wire(`${fa}.Q`, `${fp}.A`)
  b.wire(`${fb}.Q`, `${fp}.B`)
  b.wire(`${ci}.Q`, `${fp}.Ci`)
  const pfs = lamp(x0 + 600, 350, 'Part full sum')
  const pfc = lamp(x0 + 600, 420, 'Part carry out', 'yellow')
  b.wire(`${fp}.S`, `${pfs}.A`)
  b.wire(`${fp}.Co`, `${pfc}.A`)
  frameAround(b, 'Full adder from gates', [x1, a1, x2, a2, or, fs, fc])
  frameAround(b, 'The same as one part', [fp, pfs, pfc])

  noteBelow(
    b,
    'Each adder is built twice from the same switches: from gates, and as a single part. Flip A, B and Carry in and check that both give the same Sum and Carry. The full adder is two half adders and an OR gate. Try A = B = 1: the sum is 0 and the carry is 1, because 1 + 1 = 10 in binary.',
    60,
  )
  return b.build()
}
