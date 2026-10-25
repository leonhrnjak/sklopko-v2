import { historyOf } from '../model/ic'
import { checkpoint, edit, useStore } from './store'

/** Is the history for stepping back kept for the open circuit? */
export const useHistoryOn = () => useStore((s) => historyOf(s.circuit))

/**
 * Keep the history for stepping back, or run without it (one undo step). Off, a fast circuit such as a computer running a program
 * runs several times faster; the setting is saved with the circuit. The simulator follows the circuit (see `startRuntime`).
 */
export function setHistoryOn(on: boolean) {
  if (historyOf(useStore.getState().circuit) === on) return
  checkpoint()
  edit((d) => {
    let top = d
    while (top.up) top = top.up.outer
    if (on) delete top.history
    else top.history = false
  }, false)
}
