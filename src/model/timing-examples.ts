import { frameAround, note } from './annotate'
import { CircuitBuilder } from './builder'
import type { Circuit } from './circuit'

/**
 * Two examples for the timing view. Signals race through paths of different length, and a gate that reads them in between
 * sees a value that should never have been there: a glitch.
 */

/**
 * Y = A·B + ¬A·C with B and C both 1: Y should stay 1 whatever A does. When A falls, the product A·B drops one gate delay
 * before ¬A·C rises (the inverter is in the way), so Y dips to 0 for a moment. The second copy has the consensus term B·C
 * as well, which holds Y at 1 while the other two products swap over.
 */
export function hazard(): Circuit {
  const b = new CircuitBuilder()
  const sw = {
    A: b.add('switch', 0, 40, { label: 'A', params: { on: true } }),
    B: b.add('switch', 0, 240, { label: 'B', params: { on: true } }),
    C: b.add('switch', 0, 440, { label: 'C', params: { on: true } }),
  }
  const copy = (y: number, consensus: boolean) => {
    const not = b.add('not', 200, y + 40)
    const p1 = b.add('and', 340, y)
    const p2 = b.add('and', 340, y + 100)
    const p3 = consensus ? b.add('and', 340, y + 200) : undefined
    const or = b.add('or', 520, y + 80, { params: { inputs: consensus ? 3 : 2 } })
    const led = b.add('led', 700, y + 100, { label: consensus ? 'Y (with B·C)' : 'Y (hazard)' })
    b.wire(`${sw.A}.Q`, `${not}.A`)
    b.wire(`${sw.A}.Q`, `${p1}.A`)
    b.wire(`${sw.B}.Q`, `${p1}.B`)
    b.wire(`${not}.Y`, `${p2}.A`)
    b.wire(`${sw.C}.Q`, `${p2}.B`)
    b.wire(`${p1}.Y`, `${or}.A`)
    b.wire(`${p2}.Y`, `${or}.B`)
    if (p3) {
      b.wire(`${sw.B}.Q`, `${p3}.A`)
      b.wire(`${sw.C}.Q`, `${p3}.B`)
      b.wire(`${p3}.Y`, `${or}.C`)
    }
    b.wire(`${or}.Y`, `${led}.A`)
    return [not, p1, p2, ...(p3 ? [p3] : []), or, led]
  }
  const top = copy(0, false)
  const bottom = copy(420, true)
  frameAround(b, 'Y = A·B + ¬A·C', top, 'pink')
  frameAround(b, 'The same, with the term B·C added', bottom, 'green')
  note(
    b,
    0,
    -330,
    'Y = A·B + ¬A·C. With B and C both 1, Y should be 1 whatever A does. But the inverter makes ¬A·C rise one gate delay AFTER A·B falls, so for a moment neither is 1. Click switch A (it starts on) so it turns off, then open Timing (toolbar): the diagram shows Y dipping to 0 for one gate delay, the glitch is marked on the wire, and the second copy stays at 1. Its extra term B·C is 1 the whole time and holds Y up.',
    60,
  )
  return b.build()
}

/**
 * A 4-bit ripple-carry adder with realistic delays (a full adder takes 6 gate delays), adding A + B. A starts at 5 and B at 1:
 * click A to make it 6, and two input bits change at once. Each adder first works out its sum with the carry of the last answer, until the new
 * carry ripples along: the sum bits flicker before they settle, one after another, and the carry chain is the slowest path.
 */
export function ripple(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('hexin', 0, 0, { label: 'A', params: { value: 5 } })
  const bb = b.add('hexin', 0, 200, { label: 'B', params: { value: 1 } })
  const pins = ['A', 'B', 'C', 'D']
  const fa: string[] = []
  for (let i = 0; i < 4; i++) {
    const f = b.add('fulladd', 280 + i * 260, 60, { label: `Bit ${i}` })
    b.c.comps[f].delay = 6
    fa.push(f)
    b.wire(`${a}.${pins[i]}`, `${f}.A`)
    b.wire(`${bb}.${pins[i]}`, `${f}.B`)
    if (i) b.wire(`${fa[i - 1]}.Co`, `${f}.Ci`)
    const led = b.add('led', 340 + i * 260, 260, { label: `S${i}` })
    b.wire(`${f}.S`, `${led}.A`)
  }
  const disp = b.add('hexdisp', 1360, 40, { label: 'A + B' })
  fa.forEach((f, i) => b.wire(`${f}.S`, `${disp}.${pins[i]}`))
  const co = b.add('led', 1360, 200, { label: 'Carry out', params: { color: 'yellow' } })
  b.wire(`${fa[3]}.Co`, `${co}.A`)
  frameAround(b, 'Four full adders, 6 gate delays each', fa, 'blue')
  note(
    b,
    0,
    -300,
    'A ripple-carry adder: each full adder passes its carry to the next. A is 5 and B is 1. Click A to make it 6: two input bits change at once, and each adder first works with the carry from the old sum. Open Timing: the diagram shows sum bits S1, S2 and S3 flickering before they settle, one after another as the carry travels. The slowest path is the carry going through all four adders: 4 × 6 = 24 gate delays.',
    60,
  )
  return b.build()
}
