import { useMemo, useSyncExternalStore } from 'react'
import type { V } from '../engine/types'
import type { BitSource } from '../model/buses'
import type { Point, Wire } from '../model/circuit'
import { crossings } from '../routing/path'
import { useSettings } from './settings'
import { sim } from './sim'

const noSubscribe = () => () => {}

/** Live value at a pin; re-renders only when that value changes. */
export function usePinValue(comp: string, pin: string): V {
  return useSyncExternalStore(sim.subscribe, () => sim.pinValue(comp, pin))
}

/** What a wire (or a bus pin) carries right now. */
export interface Signal {
  /** CSS class: `v0`/`v1` for a bit; `vb` for a bus of known bits, `vx` when any bit is unknown, `vz` when none is driven. */
  cls: string
  /** The bus as a number, or null when any bit is unknown or not driven. A single bit is its own value. */
  value: number | null
  /** The bus in hex (`5A`), or `?` when it isn't known. Empty for a single bit. */
  hex: string
}

const OPEN: V = 2

/** The values of some scalar pins, as a string of digits (one per bit, lowest first); a single bit stays a number. */
function readBits(bits: BitSource[]): number | string {
  if (bits.length === 1) return bits[0] ? sim.pinValue(bits[0].comp, bits[0].pin) : OPEN
  let s = ''
  for (const b of bits) s += b ? sim.pinValue(b.comp, b.pin) : OPEN
  return s
}

const BIT_CLASS = ['v0', 'v1', 'vx', 'vz']

function describe(sig: number | string): Signal {
  if (typeof sig === 'number') return { cls: BIT_CLASS[sig], value: sig < 2 ? sig : null, hex: '' }
  let value = 0
  let known = true
  let allZ = true
  for (let i = 0; i < sig.length; i++) {
    const v = sig.charCodeAt(i) - 48
    if (v > 1) known = false
    if (v !== 3) allZ = false
    if (v < 2) value += v * 2 ** i
  }
  return {
    cls: allZ ? 'vz' : known ? 'vb' : 'vx',
    value: known ? value : null,
    hex: known ? value.toString(16).toUpperCase().padStart(Math.ceil(sig.length / 4), '0') : '?',
  }
}

/**
 * Live value of a wire or bus pin from the scalar pins that drive its bits (see `BusModel.bits`). Re-renders only when
 * one of them changes.
 */
export function useSignal(bits: BitSource[]): Signal {
  const sig = useSyncExternalStore(sim.subscribe, () => readBits(bits))
  return useMemo(() => describe(sig), [sig])
}

/** What the signal an output pin drives is held at from outside (a forced wire), or null. */
export function useForced(comp: string | undefined, pin: string | undefined): 0 | 1 | null {
  return useSyncExternalStore(sim.subscribe, () => (comp && pin ? sim.forcedValue(comp, pin) : null))
}

/** How many signals are held at a level from outside. */
export const useForceCount = () => useSyncExternalStore(sim.subscribe, () => sim.forceCount)

/** Re-render when any pin of the component changes (for parts that display their values). */
export function useCompSignature(comp: string, enabled: boolean): string {
  return useSyncExternalStore(enabled ? sim.subscribe : noSubscribe, () => (enabled ? sim.signature(comp) : ''))
}

/** Re-render on every simulator publish; for small status displays. */
export function useSimStatus(): string {
  return useSyncExternalStore(sim.subscribe, () => `${sim.unstable ? 'u' : 's'}`)
}

/** Where each wire hops over another, or an empty map when hops are off. */
export function useHops(wires: Record<string, Wire>): Map<string, Point[]> {
  const on = useSettings((s) => s.hops)
  return useMemo(() => (on ? crossings(Object.values(wires)) : new Map<string, Point[]>()), [on, wires])
}
