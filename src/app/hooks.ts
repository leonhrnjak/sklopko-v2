import { useMemo, useSyncExternalStore } from 'react'
import type { V } from '../engine/types'
import type { Point, Wire } from '../model/circuit'
import { crossings } from '../routing/path'
import { useSettings } from './settings'
import { sim } from './sim'

const noSubscribe = () => () => {}

/** Live value at a pin; re-renders only when that value changes. */
export function usePinValue(comp: string, pin: string): V {
  return useSyncExternalStore(sim.subscribe, () => sim.pinValue(comp, pin))
}

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
