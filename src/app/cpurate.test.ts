import { describe, expect, it } from 'vitest'
import { describeRate, RateMeter } from './cpurate'

describe('the CPU rate meter', () => {
  it('gives nothing until a second has passed, then cycles a second over that second', () => {
    const m = new RateMeter()
    expect(m.sample(0, 0, true)).toBeNull()
    expect(m.sample(400, 40, true)).toBeNull()
    expect(m.sample(1000, 100, true)).toBe(100)
  })

  it('keeps the last reading until the next full second, and then measures the new one', () => {
    const m = new RateMeter()
    m.sample(0, 0, true)
    m.sample(1000, 100, true)
    expect(m.sample(1500, 1000, true)).toBe(100)
    expect(m.sample(2000, 1100, true)).toBe(1000)
  })

  it('gives nothing while paused, and begins again when it runs', () => {
    const m = new RateMeter()
    m.sample(0, 0, true)
    m.sample(1000, 100, true)
    expect(m.sample(1100, 100, false)).toBeNull()
    expect(m.sample(5000, 100, true)).toBeNull() // (the first reading after a pause is the start of a new second)
    expect(m.sample(6000, 400, true)).toBe(300)
  })

  it('begins again when the count goes down (a reset, a step back)', () => {
    const m = new RateMeter()
    m.sample(0, 500, true)
    expect(m.sample(1000, 600, true)).toBe(100)
    expect(m.sample(1100, 5, true)).toBeNull()
    expect(m.sample(2100, 205, true)).toBe(200)
  })
})

describe('describing the rate', () => {
  it('says what the CPU does a second and how that compares with a real 6502 at 1 MHz', () => {
    expect(describeRate(80_000)).toBe('Running at 80,000 cycles a second (8% of a 1 MHz 6502)')
    expect(describeRate(1_000_000)).toBe('Running at 1,000,000 cycles a second (100% of a 1 MHz 6502)')
    expect(describeRate(26_123)).toBe('Running at 26,000 cycles a second (2.6% of a 1 MHz 6502)')
    expect(describeRate(4_100)).toBe('Running at 4,100 cycles a second (0.4% of a 1 MHz 6502)')
    expect(describeRate(600_000)).toBe('Running at 600,000 cycles a second (60% of a 1 MHz 6502)')
  })
})
