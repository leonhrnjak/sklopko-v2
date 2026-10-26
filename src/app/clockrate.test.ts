import { describe, expect, it } from 'vitest'
import { ClockMeter, describeClock, formatHz } from './clockrate'

describe('the clock meter', () => {
  it('gives nothing until a second has passed, then the share of the clock time that was simulated', () => {
    const m = new ClockMeter()
    expect(m.sample(0, 0, 0, true)).toBeNull()
    expect(m.sample(500, 500, 0, true)).toBeNull()
    expect(m.sample(1000, 1000, 360, true)).toBeCloseTo(0.64)
  })

  it('measures each second on its own', () => {
    const m = new ClockMeter()
    m.sample(0, 0, 0, true)
    m.sample(1000, 1000, 500, true)
    expect(m.sample(2000, 2000, 500, true)).toBe(1)
  })

  it('gives nothing while paused, and begins again when it runs', () => {
    const m = new ClockMeter()
    m.sample(0, 0, 0, true)
    m.sample(1000, 1000, 0, true)
    expect(m.sample(1100, 1000, 0, false)).toBeNull()
    expect(m.sample(5000, 1000, 0, true)).toBeNull()
    expect(m.sample(6000, 2000, 500, true)).toBe(0.5)
  })

  it('begins again when the totals go down (another circuit)', () => {
    const m = new ClockMeter()
    m.sample(0, 5000, 0, true)
    expect(m.sample(1000, 6000, 0, true)).toBe(1)
    expect(m.sample(1100, 10, 0, true)).toBeNull()
  })
})

describe('describing the clock', () => {
  it('writes frequencies short', () => {
    expect(formatHz(1)).toBe('1 Hz')
    expect(formatHz(0.5)).toBe('0.5 Hz')
    expect(formatHz(2500)).toBe('2.5 kHz')
    expect(formatHz(1_000_000)).toBe('1 MHz')
    expect(formatHz(640_000)).toBe('640 kHz')
  })

  it('names only the asked rate while the clock keeps up, and the rate it reaches when it does not', () => {
    expect(describeClock(1000, null)).toEqual({ text: 'Clock 1 kHz', slow: false })
    expect(describeClock(1000, 0.97)).toEqual({ text: 'Clock 1 kHz', slow: false })
    expect(describeClock(1_000_000, 0.64)).toEqual({ text: 'Clock 1 MHz · reaching 640 kHz (64%)', slow: true })
  })
})
