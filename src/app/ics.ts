import { create } from 'zustand'
import { inlineInstance, newICId, subCircuit } from '../model/ic'
import { newId } from '../model/circuit'
import { checkpoint, edit, select, showToast, useStore } from './store'

/** The "Make IC" window: open, and what it makes the IC from (the ids of some parts, or the whole circuit when null). */
export const useMakeIc = create<{ open: boolean; from: string[] | null }>(() => ({ open: false, from: null }))

/** Open the window: from the selected parts if some parts are selected, else from the whole circuit. */
export function openMakeIc() {
  const { selection, circuit } = useStore.getState()
  const parts = selection.filter((id) => id in circuit.comps)
  useMakeIc.setState({ open: true, from: parts.length ? parts : null })
}
export const closeMakeIc = () => useMakeIc.setState({ open: false })

/** Make a custom IC from the parts (or the whole circuit) and keep it in the circuit's list of ICs; nothing on the canvas changes. Returns its id. */
export function makeIC(name: string, from: string[] | null): string {
  const clean = name.trim().slice(0, 40) || 'IC'
  let id = ''
  checkpoint()
  edit((c) => {
    id = newICId(c.ics, clean)
    ;(c.ics ??= {})[id] = { id, name: clean, circuit: subCircuit(c, from ?? undefined) }
  }, false)
  showToast(`IC “${clean}” made. It is in the parts list, under “ICs in this circuit”.`)
  return id
}

/** Replace an instance on the canvas with the parts it is made of (one undo step). */
export function expandInstance(instId: string) {
  checkpoint()
  let ids: string[] | null = null
  edit((c) => {
    ids = inlineInstance(c, instId, newId)
  })
  if (ids) select((ids as string[]).filter((id) => id in useStore.getState().circuit.comps))
}
