import { create } from 'zustand'
import { MAX_TESTS } from '../model/serialize'
import { checkpoint, edit, useStore } from './store'

/** The testbench window: open or not. */
export const useTestbench = create<{ open: boolean }>(() => ({ open: false }))

export const openTestbench = () => useTestbench.setState({ open: true })
export const closeTestbench = () => useTestbench.setState({ open: false })

/** Set the testbench text of the circuit (one undo step); empty text removes it. */
export function setTests(text: string) {
  const next = text.trim() ? text.slice(0, MAX_TESTS) : undefined
  if (next === useStore.getState().circuit.tests) return
  checkpoint()
  edit((c) => {
    if (next === undefined) delete c.tests
    else c.tests = next
  }, false)
}
