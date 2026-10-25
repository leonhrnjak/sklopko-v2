import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { deserialize, serialize } from '../model/serialize'
import { loadIntoSim, sim } from '../app/sim'
import { getDef } from './registry'

const hzParam = () => getDef('clock').params!.find((p) => p.key === 'hz')!

/** A clock a circuit can easily keep up with. */
function slow() {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 0, { params: { hz: 4 } })
  const n = b.add('counter', 100, 0)
  b.wire(`${clk}.Q`, `${n}.CLK`)
  return b.build()
}

describe('the clock’s rates', () => {
  it('go from a quarter of a hertz to one megahertz, the last as a real 6502 runs', () => {
    const rates = hzParam().options!.map((o) => o.value as number)
    expect(rates[0]).toBe(0.25)
    expect(rates[rates.length - 1]).toBe(1_000_000)
    expect(rates).toContain(4096) // (the old top rate is still there)
    expect(rates).toEqual([...rates].sort((a, b) => a - b))
    expect(hzParam().options!.find((o) => o.value === 1_000_000)!.label).toBe('1 MHz')
    // Hertz below a thousand, kilohertz from there (the rates are powers of two, so 1024 Hz is 1.024 kHz), then megahertz.
    const label = (hz: number) => hzParam().options!.find((o) => o.value === hz)!.label
    expect([0.25, 512, 1024, 4096, 16384, 524288].map(label)).toEqual(['0.25 Hz', '512 Hz', '1.024 kHz', '4.096 kHz', '16.384 kHz', '524.288 kHz'])
  })

  it('make a half period of half a microsecond at 1 MHz', () => {
    expect(getDef('clock').clockHalfPeriod!({ hz: 1_000_000 })).toBeCloseTo(0.0005, 10)
    expect(getDef('clock').clockHalfPeriod!({ hz: 1 })).toBe(500)
  })

  it('are kept in a saved circuit', () => {
    const b = new CircuitBuilder()
    const id = b.add('clock', 0, 0, { params: { hz: 1_000_000 } })
    const back = deserialize(JSON.parse(JSON.stringify(serialize(b.build()))))
    expect(back.comps[id].params.hz).toBe(1_000_000)
  })

  it('run as fast as the page can, and no faster than the time it is given', () => {
    const b = new CircuitBuilder()
    const clk = b.add('clock', 0, 0, { params: { hz: 1_000_000 } })
    const n = b.add('counter', 100, 0)
    b.wire(`${clk}.Q`, `${n}.CLK`)
    loadIntoSim(b.build())
    sim.setHistory(false)
    sim.settle()
    const t0 = performance.now()
    sim.frame(16, 10) // one frame of the app: 16 ms of simulated time, at most 10 ms of work
    const took = performance.now() - t0
    expect(took).toBeLessThan(200) // (the budget is 10 ms; the rest is slack for a slow machine)
    expect(sim.time).toBeGreaterThan(15.9) // (what could not be simulated is skipped, the clock does not fall behind)
    expect(sim.lagging).toBe(true) // (and the simulator says so, so that the app can give it more of the frame)
    loadIntoSim(slow())
    sim.settle()
    sim.frame(16, 10)
    expect(sim.lagging).toBe(false)
  })
})
