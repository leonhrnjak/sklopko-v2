import { create } from 'zustand'
import { collapseSelection, deleteDefinition, enterDefinition, enterIC, inlineInstance, isUsed, leaveIC, levelsOf, newICId, renameDefinition, subCircuit } from '../model/ic'
import { isAnnotation, newId, type Circuit, type ICDef } from '../model/circuit'
import { checkpoint, edit, loadCircuit, select, showToast, undo as undoNow, useStore } from './store'
import { fitToScreen } from './view'

/**
 * The "Make IC" window: open, what it makes the IC from (the ids of some parts, or the whole circuit when null), and whether the
 * parts are replaced by the IC (collapsing them) or stay as they are.
 */
export const useMakeIc = create<{ open: boolean; from: string[] | null; replace: boolean }>(() => ({ open: false, from: null, replace: false }))

/** Open the window: from the selected parts if some parts are selected, else from the whole circuit. `replace` starts with "replace the parts" ticked. */
export function openMakeIc(replace = false) {
  const { selection, circuit } = useStore.getState()
  const parts = selection.filter((id) => id in circuit.comps)
  useMakeIc.setState({ open: true, from: parts.length ? parts : null, replace: replace && parts.length > 0 })
}
export const setMakeIcReplace = (replace: boolean) => useMakeIc.setState({ replace })
export const closeMakeIc = () => useMakeIc.setState({ open: false })

/**
 * Tells which gate a circuit is (`detectSymbol` in `model/icsymbol.ts`), if it is one. The caller passes it in: it needs the analyzer, which
 * loads with the Make IC window and not with the page.
 */
export type SymbolDetector = (body: Circuit) => ICDef['symbol']

/** Make a custom IC from the parts (or the whole circuit) and keep it in the circuit's list of ICs; nothing on the canvas changes. Returns its id. */
export function makeIC(name: string, from: string[] | null, replace = false, detect?: SymbolDetector): string {
  const clean = name.trim().slice(0, 40) || 'IC'
  let id = ''
  if (replace && from) return collapseInto(clean, from, detect)
  checkpoint()
  edit((c) => {
    id = newICId(c.ics, clean)
    const body = subCircuit(c, from ?? undefined)
    const symbol = detect?.({ ...body, ics: c.ics })
    ;(c.ics ??= {})[id] = { id, name: clean, circuit: body, ...(symbol ? { symbol } : {}) }
  }, false)
  showToast(`IC “${clean}” made. It is in the parts list, under “ICs in this circuit”.`)
  return id
}

/** Collapse parts into one IC: they are replaced by an instance, wired in their place, as one undo step. */
function collapseInto(name: string, from: string[], detect?: SymbolDetector): string {
  const { circuit } = useStore.getState()
  if (!from.some((id) => circuit.comps[id] && !isAnnotation(circuit.comps[id]))) return ''
  checkpoint()
  let made: ReturnType<typeof collapseSelection> = null
  edit((c) => {
    made = collapseSelection(c, from, name, newId, detect)
  })
  const result = made as ReturnType<typeof collapseSelection>
  if (!result) return ''
  select(result.ids)
  showToast(`${from.length} part${from.length === 1 ? '' : 's'} collapsed into the IC “${name}”.`)
  return result.defId
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

// ---- Editing the body of an IC -----------------------------------------------------------------------

const fitSoon = () => requestAnimationFrame(() => requestAnimationFrame(fitToScreen))

/** Show the inside of an instance's IC for editing. The undo history is the document's: undo works across the levels. */
export function enterInstance(instId: string) {
  const next = enterIC(useStore.getState().circuit, instId)
  if (!next) return
  loadCircuit(next)
  fitSoon()
}

/** Show the inside of an IC of the circuit for editing, from the parts list (no instance needed). */
export function enterDefinitionById(defId: string) {
  const next = enterDefinition(useStore.getState().circuit, defId)
  if (!next) return
  loadCircuit(next)
  fitSoon()
}

/**
 * Go back up `levels` levels (one by default; all the way with a large number). Every instance takes the pins the IC has now, and
 * wires to pins that are gone are dropped, which the toast says.
 */
export function leaveLevels(levels = 1) {
  let c = useStore.getState().circuit
  let dropped = 0
  for (let i = 0; i < levels && c.up; i++) {
    const back = leaveIC(c)
    c = back.circuit
    dropped += back.dropped
  }
  if (c === useStore.getState().circuit) return
  loadCircuit(c)
  fitSoon()
  if (dropped) showToast(`${dropped} wire${dropped === 1 ? ' was' : 's were'} removed: ${dropped === 1 ? 'its pin is' : 'their pins are'} not on the IC any more.`)
}

/** Go back up to the level that is `depth` levels below the top (0 is the main circuit). */
export const leaveToDepth = (depth: number) => leaveLevels(levelsOf(useStore.getState().circuit).length - depth)

/** Rename an IC; its instances show the new name. */
export function renameIC(id: string, name: string) {
  const clean = name.trim().slice(0, 40)
  const def = useStore.getState().circuit.ics?.[id]
  if (!def || !clean || clean === def.name) return
  checkpoint()
  edit((c) => renameDefinition(c, id, clean), false)
}

/** Remove an IC nothing uses. Returns false (and says why) when it is used or being edited. */
export function deleteIC(id: string): boolean {
  const c = useStore.getState().circuit
  const def = c.ics?.[id]
  if (!def) return false
  if (isUsed(c, id) || levelsOf(c).includes(id)) {
    showToast(`“${def.name}” is in use: take its instances out first.`)
    return false
  }
  checkpoint()
  edit((d) => deleteDefinition(d, id), false)
  showToast(`IC “${def.name}” deleted.`, { label: 'Undo', run: () => undoNow() })
  return true
}
