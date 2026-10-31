import { describe, it } from 'vitest'
import { flatten } from '../model/buses'
import { CircuitBuilder } from '../model/builder'
import { EXAMPLES } from '../model/examples'
import { board6502Builder } from '../model/board6502'
import { COUNTER_SOURCE } from '../model/programs6502'
import { micro6502Basic } from '../model/micro6502'
import { basicRomBytes } from '../model/basic-rom'
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

/** Clock edges per real second on the 6502 board (history on, as in the app), and what a snapshot of a big RAM would cost. */
function edgesPerSecond(name: string, o: Parameters<typeof board6502Builder>[0], edges: number, history = true) {
  const sim = new Simulator()
  sim.setHistory(history)
  sim.load(flatten(board6502Builder(o).b.build()))
  sim.settle()
  for (let i = 0; i < 100; i++) sim.advance((1000 / (o!.hz! * 2)) * 50 + 1e-6) // (warm up the code before it is timed)
  const half = 1000 / (o!.hz! * 2)
  const t0 = performance.now()
  for (let i = 0; i < edges / 50; i++) sim.advance(half * 50 + 1e-6)
  const took = performance.now() - t0
  console.log(`${name}: ${edges} edges in ${took.toFixed(0)} ms = ${((edges / took) * 1000).toFixed(0)} edges/s (${((edges / took) * 500).toFixed(0)} cycles/s)`)
}

/** Cycles per real second on a BASIC board, history off, after a warm-up: the number the speed work (docs/spec-sim-speed-tier1.md) is measured by. */
function basicCycles(name: string, sim: Simulator, edges: number) {
  sim.setHistory(false)
  sim.settle()
  for (let i = 0; i < 3000; i++) sim.stepClock()
  const t0 = performance.now()
  const k0 = sim.ticks
  for (let i = 0; i < edges; i++) sim.stepClock()
  const took = performance.now() - t0
  console.log(`${name}: ${((edges / 2 / took) * 1000).toFixed(0)} cycles/s, ${((sim.ticks - k0) / edges).toFixed(1)} ticks/edge`)
}

describe.skipIf(!on)('simulator timings', () => {
  it('BASIC boards: the 6502 built from parts, and the 6502 part', { timeout: 300000 }, () => {
    const parts = new Simulator()
    parts.load(flatten(micro6502Basic()))
    basicCycles('6502 from parts + BASIC', parts, 100000)
    const hex = basicRomBytes().map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const part = new Simulator()
    part.load(flatten(board6502Builder({ hz: 100, memory: 'big', rom: hex, devices: ['terminal'] }).b.build(false)))
    basicCycles('6502 part + BASIC', part, 400000)
  })
  it('the 6502 board, with and without the history for stepping back', { timeout: 120000 }, () => {
    const five = ['screen', 'gamepad', 'leds', 'console', 'keypad'] as const
    for (const history of [true, false]) {
      const h = history ? 'history on ' : 'history off'
      edgesPerSecond(`6502 board, LEDs, ${h}`, { hz: 1000, source: COUNTER_SOURCE, devices: ['leds'] }, 40000, history)
      edgesPerSecond(`6502 board, five devices, ${h}`, { hz: 1000, devices: [...five] }, 40000, history)
    }
  })
  it('a 64 KB array copy', () => {
    const a = new Uint8Array(65536)
    const t0 = performance.now()
    for (let i = 0; i < 20000; i++) a.slice()
    const took = performance.now() - t0
    console.log(`20,000 copies of 64 KB: ${took.toFixed(0)} ms (${((20000 / took) * 1000).toFixed(0)} per second)`)
  })
  it('the raycaster', { timeout: 120000 }, () => time('raycaster', EXAMPLES.find((e) => e.id === 'computer-raycaster')!.build, 1000))
  it('the prime sieve', { timeout: 120000 }, () => time('sieve', EXAMPLES.find((e) => e.id === 'computer-sieve')!.build, 1000))
  it('1,600 parts in a shift register', { timeout: 120000 }, () => time('synthetic', synthetic, 2000))
})
