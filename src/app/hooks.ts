import { useSyncExternalStore } from 'react'
import type { V } from '../engine/types'
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
