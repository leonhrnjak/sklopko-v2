import { CircuitBuilder } from './builder'
import { frameAround, note } from './annotate'
import type { Circuit } from './circuit'

/** The flip-flops' propagation delay in these examples, in gate delays: slow enough that the ripple shows (and the exact engine runs). */
export const FF_DELAY = 3

/**
 * Three counters on one clock. A ripple counter (each stage clocked by the one before) and a synchronous counter (JK flip-flops
 * sharing the clock, with an AND gate for each carry): both count the same, but the ripple counter passes through wrong numbers when
 * several bits change, which the waveforms show. A ring counter circulates a single 1.
 */
export function syncCounter(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 520, { params: { hz: 2 }, label: 'Clock' })
  const probes = (signals: [string, string][], y: number) =>
    signals.forEach(([label, from], i) => b.wire(from, `${b.add('probe', 200 + i * 100, y, { label })}.A`))
  const NIB = ['A', 'B', 'C', 'D']

  // ---- Ripple counter: each stage is clocked by the inverted output of the one before ----------------------------
  const ripple = [0, 1, 2, 3].map((i) => b.add('tff', 200 + i * 140, 20))
  ripple.forEach((f) => (b.c.comps[f].delay = FF_DELAY))
  b.wire(`${clk}.Q`, `${ripple[0]}.CLK`)
  for (let i = 1; i < 4; i++) b.wire(`${ripple[i - 1]}.NQ`, `${ripple[i]}.CLK`)
  const rippleCount = b.add('hexdisp', 800, 20, { label: 'Ripple count' })
  ripple.forEach((f, i) => b.wire(`${f}.Q`, `${rippleCount}.${NIB[i]}`))
  probes([['CLK', `${clk}.Q`], ...ripple.map((f, i): [string, string] => [`Ripple Q${i}`, `${f}.Q`])], 200)
  const guide = note(
    b,
    1000,
    20,
    'Two counters on one clock, counting the same. In the ripple counter each flip-flop waits for the one before it, so going from 7 to 8 passes through 6, 4 and 0: open Timing or the waveforms and look at the Ripple Q bits step one after another. In the synchronous counter every flip-flop sees the clock together, and an AND gate says when the next bit may change, so the bits change at once. The ring counter keeps one 1 going round.',
    34,
  )
  frameAround(b, 'Ripple counter (T flip-flops)', [...ripple, rippleCount, guide])

  // ---- Synchronous counter: JK flip-flops on the same clock; bit n toggles when all lower bits are 1 -------------
  const y1 = 420
  const one = b.add('const', 100, y1 + 20, { params: { value: 1 }, label: 'J = K = 1' })
  const sync = [0, 1, 2, 3].map((i) => b.add('jkff', 260 + i * 200, y1))
  sync.forEach((f) => (b.c.comps[f].delay = FF_DELAY))
  sync.forEach((f) => b.wire(`${clk}.Q`, `${f}.CLK`))
  const and1 = b.add('and', 380, y1 + 200, { label: 'Q0 · Q1' })
  const and2 = b.add('and', 580, y1 + 200, { label: 'Q0 · Q1 · Q2' })
  b.wire(`${sync[0]}.Q`, `${and1}.A`)
  b.wire(`${sync[1]}.Q`, `${and1}.B`)
  b.wire(`${and1}.Y`, `${and2}.A`)
  b.wire(`${sync[2]}.Q`, `${and2}.B`)
  const toggles = [`${one}.Q`, `${sync[0]}.Q`, `${and1}.Y`, `${and2}.Y`]
  sync.forEach((f, i) => {
    b.wire(toggles[i], `${f}.J`)
    b.wire(toggles[i], `${f}.K`)
  })
  const syncCount = b.add('hexdisp', 1100, y1 + 20, { label: 'Synchronous count' })
  sync.forEach((f, i) => b.wire(`${f}.Q`, `${syncCount}.${NIB[i]}`))
  probes(sync.map((f, i): [string, string] => [`Sync Q${i}`, `${f}.Q`]), y1 + 340)
  frameAround(b, 'Synchronous counter (JK flip-flops)', [one, ...sync, and1, and2, syncCount])

  // ---- Ring counter ------------------------------------------------------------------------------------
  const y2 = y1 + 560
  const ring = b.add('ringcounter', 260, y2, { label: 'Ring counter' })
  b.wire(`${clk}.Q`, `${ring}.CLK`)
  const lamps = [0, 1, 2, 3].map((i) => b.add('led', 460, y2 + i * 50, { label: `Q${i}` }))
  lamps.forEach((l, i) => b.wire(`${ring}.Q${i}`, `${l}.A`))
  frameAround(b, 'Ring counter: one 1 goes round', [ring, ...lamps])
  return b.build()
}
