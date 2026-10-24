import { describe, it } from 'vitest'
import { flatten } from '../model/buses'
import { CircuitBuilder } from '../model/builder'
import { EXAMPLES } from '../model/examples'
import { Simulator } from './simulator'

/**
 * Timings for the simulator, printed and never asserted. Skipped unless asked for: `VITE_BENCH=1 npx vitest run src/engine/bench`.
 * Run it before and after a change to how the simulator schedules its work.
 */
const on = !!import.meta.env.VITE_BENCH

/** A shift register of 400 flip-flops with three inverters between each pair: about 1,600 parts, all busy while a pattern moves through. */
function synthetic() {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 0, { params: { hz: 1000 } })
  const data = b.add('clock', 0, 60, { params: { hz: 130 } })
  let prev = `${data}.Q`
  for (let i = 0; i < 400; i++) {
    const ff = b.add('dff', 100 + i * 10, 0)
    b.wire(`${clk}.Q`, `${ff}.CLK`)
    b.wire(prev, `${ff}.D`)
    let q = `${ff}.Q`
    for (let k = 0; k < 3; k++) {
      const inv = b.add('not', 100 + i * 10, 40 + k * 40)
      b.wire(q, `${inv}.A`)
      q = `${inv}.Y`
    }
    prev = q
  }
  return b.build()
}

function time(name: string, build: () => ReturnType<typeof synthetic>, ms: number) {
  const sim = new Simulator()
  sim.load(flatten(build()))
  sim.settle()
  const t0 = performance.now()
  for (let i = 0; i < ms / 10; i++) sim.advance(10)
  const took = performance.now() - t0
  console.log(`${name}: ${ms} ms of simulated time in ${took.toFixed(0)} ms (${sim.ticks} ticks)`)
}

describe.skipIf(!on)('simulator timings', () => {
  it('the raycaster', { timeout: 120000 }, () => time('raycaster', EXAMPLES.find((e) => e.id === 'computer-raycaster')!.build, 1000))
  it('the prime sieve', { timeout: 120000 }, () => time('sieve', EXAMPLES.find((e) => e.id === 'computer-sieve')!.build, 1000))
  it('1,600 parts in a shift register', { timeout: 120000 }, () => time('synthetic', synthetic, 2000))
})
