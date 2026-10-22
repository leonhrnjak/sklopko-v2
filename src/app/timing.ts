import { create } from 'zustand'
import { getDef } from '../engine/registry'
import type { Circuit } from '../model/circuit'
import { analyzeTiming, type Timing } from '../model/timing'

interface TimingState {
  /** How long one gate delay is in real life, for the maximum clock speed. A fast gate of the 74-series is about 10 ns. */
  nsPerDelay: number
  /** Mark the slowest path on the circuit. */
  showPath: boolean
}

export const useTiming = create<TimingState>(() => ({ nsPerDelay: 10, showPath: false }))
export const setNsPerDelay = (n: number) => useTiming.setState({ nsPerDelay: Math.min(10000, Math.max(0.1, n)) })
export const setShowPath = (showPath: boolean) => useTiming.setState({ showPath })

const cache = new WeakMap<Circuit, Timing>()

/** The circuit's timing, worked out once per version of the circuit (the panel and the canvas both ask for it). */
export function timingOf(c: Circuit): Timing {
  let t = cache.get(c)
  if (!t) cache.set(c, (t = analyzeTiming(c)))
  return t
}

/** `1.4 µs`, `140 ns`, `2.5 ms`. */
export function formatNs(ns: number): string {
  const trim = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, '').replace(/\.0$/, ''))
  if (ns >= 1e6) return `${trim(ns / 1e6)} ms`
  if (ns >= 1e3) return `${trim(ns / 1e3)} µs`
  return `${trim(ns)} ns`
}

/** `7.1 MHz`, `830 kHz`, `42 Hz`. */
export function formatHz(hz: number): string {
  const trim = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ''))
  if (hz >= 1e9) return `${trim(hz / 1e9)} GHz`
  if (hz >= 1e6) return `${trim(hz / 1e6)} MHz`
  if (hz >= 1e3) return `${trim(hz / 1e3)} kHz`
  return `${trim(hz)} Hz`
}

export interface ClockCheck {
  comp: string
  hz: number
  /** One full clock cycle, in ns. */
  periodNs: number
  /** Does the slowest path fit in one cycle? */
  fits: boolean
  /** How many times longer the cycle is than the path needs (below 1 means too fast). */
  ratio: number
}

/** For each clock of the circuit: is its cycle long enough for the slowest path (`delay` gate delays of `nsPerDelay` each)? */
export function clockChecks(c: Circuit, delay: number, nsPerDelay: number): ClockCheck[] {
  const pathNs = delay * nsPerDelay
  return Object.values(c.comps)
    .filter((k) => getDef(k.type).clockHalfPeriod)
    .map((k) => {
      const periodNs = getDef(k.type).clockHalfPeriod!(k.params) * 2 * 1e6
      return { comp: k.id, hz: 1e9 / periodNs, periodNs, fits: periodNs >= pathNs, ratio: pathNs > 0 ? periodNs / pathNs : Infinity }
    })
}
