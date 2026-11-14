import { create } from 'zustand'
import { recordError } from './errors'

/**
 * Whether the simulator is alive. `failed` is the reason once the engine could not be loaded or the worker crashed: the footer then
 * says "Simulator stopped" instead of "Running" (kept apart from `app/sim.ts` so the start-up can set it without loading the engine).
 */
export const useSimHealth = create<{ failed: string | null }>(() => ({ failed: null }))

export function reportSimFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Simulator stopped:', error)
  recordError(error)
  useSimHealth.setState({ failed: message || 'unknown error' })
}

export function clearSimFailure() {
  useSimHealth.setState({ failed: null })
}
