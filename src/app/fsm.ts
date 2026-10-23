import { create } from 'zustand'
import { encodeStates, generateFsm, type EncodingKind, type Fsm, type Generated } from '../model/fsm'
import { FSM_EXAMPLES } from '../model/fsm-examples'
import { blankFsm, fsmDocumentJson, layoutFsm, parseFsmDocument, type FsmDocument } from '../model/fsm-edit'
import { downloadText, openTextFile } from './files'
import { insertCircuit, showToast } from './store'

export type FsmView = 'diagram' | 'table'
export type FsmSelection = { kind: 'state' | 'transition'; id: string } | null

interface FsmEditor {
  open: boolean
  view: FsmView
  fsm: Fsm
  encoding: EncodingKind
  /** The codes of the `custom` encoding, by state id. */
  custom: Record<string, number>
  selected: FsmSelection
  /** The machines before and after the current one, for undo and redo. */
  past: Fsm[]
  future: Fsm[]
}

const KEY = 'sklopko.fsm.v1'
const HISTORY = 100

function stored(): FsmDocument | null {
  try {
    const text = localStorage.getItem(KEY)
    return text ? parseFsmDocument(text) : null
  } catch {
    return null
  }
}

function initial(): Pick<FsmEditor, 'fsm' | 'encoding' | 'custom'> {
  const doc = stored()
  if (doc) return doc
  return { fsm: layoutFsm(FSM_EXAMPLES[1]), encoding: 'binary', custom: {} }
}

export const useFsm = create<FsmEditor>(() => ({ open: false, view: 'diagram', ...initial(), selected: null, past: [], future: [] }))

const documentOf = (s: FsmEditor): FsmDocument => ({ fsm: s.fsm, encoding: s.encoding, custom: s.custom })

function save() {
  try {
    localStorage.setItem(KEY, fsmDocumentJson(documentOf(useFsm.getState())))
  } catch {
    // Private windows and full storage: the machine is still there for this visit.
  }
}

useFsm.subscribe((s, prev) => {
  if (s.fsm !== prev.fsm || s.encoding !== prev.encoding || s.custom !== prev.custom) save()
})

export const openFsm = () => useFsm.setState({ open: true })
export const closeFsm = () => useFsm.setState({ open: false })
export const setFsmView = (view: FsmView) => useFsm.setState({ view })
export const selectInFsm = (selected: FsmSelection) => useFsm.setState({ selected })

let lastMerge: { key: string; at: number } | null = null

/**
 * Change the machine as one undo step. Edits with the same `merge` key close together (typing in one box) share a step.
 * `commit: false` changes it without a step of its own (for the drag of a state, which has one at its start).
 */
export function editFsm(change: (f: Fsm) => Fsm, options: { commit?: boolean; merge?: string } = {}) {
  const { fsm, past } = useFsm.getState()
  const next = change(fsm)
  if (next === fsm) return
  const now = Date.now()
  const merged = options.merge !== undefined && lastMerge?.key === options.merge && now - lastMerge.at < 1500
  lastMerge = options.merge !== undefined ? { key: options.merge, at: now } : null
  if (options.commit === false || merged) useFsm.setState({ fsm: next })
  else useFsm.setState({ fsm: next, past: [...past, fsm].slice(-HISTORY), future: [] })
}

/** Remember the machine as it is now as an undo step (before a drag begins). */
export function checkpointFsm() {
  const { fsm, past } = useFsm.getState()
  useFsm.setState({ past: [...past, fsm].slice(-HISTORY), future: [] })
}

export function undoFsm() {
  const { past, fsm, future } = useFsm.getState()
  if (!past.length) return
  useFsm.setState({ fsm: past[past.length - 1], past: past.slice(0, -1), future: [fsm, ...future], selected: null })
}

export function redoFsm() {
  const { past, fsm, future } = useFsm.getState()
  if (!future.length) return
  useFsm.setState({ fsm: future[0], past: [...past, fsm], future: future.slice(1), selected: null })
}

export const setEncoding = (encoding: EncodingKind) => useFsm.setState({ encoding })
export const setCustomCode = (stateId: string, code: number) => useFsm.setState((s) => ({ custom: { ...s.custom, [stateId]: code } }))

/** Replace the machine with another (a starting point or a file): one undo step. */
export function loadFsm(doc: Partial<FsmDocument> & { fsm: Fsm }) {
  const { fsm, past } = useFsm.getState()
  useFsm.setState({ fsm: layoutFsm(doc.fsm), encoding: doc.encoding ?? 'binary', custom: doc.custom ?? {}, selected: null, past: [...past, fsm].slice(-HISTORY), future: [] })
}

export const startFromBlank = () => loadFsm({ fsm: blankFsm() })
export const startFromExample = (index: number) => loadFsm({ fsm: structuredClone(FSM_EXAMPLES[index]) })

export function saveFsmFile() {
  const s = useFsm.getState()
  const name = s.fsm.name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'machine'
  downloadText(`${name}.fsm.json`, fsmDocumentJson(documentOf(s)), 'application/json')
}

/** Ask for a `.fsm.json` file and load it. Returns the reason when it cannot be read. */
export async function loadFsmFile(): Promise<string | null> {
  const file = await openTextFile('.json,application/json')
  if (!file) return null
  try {
    loadFsm(parseFsmDocument(file.text))
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** The circuit the current machine would give (unrouted, which is enough for counting its parts), or the reason it cannot be built. */
export function tryGenerate(fsm: Fsm, encoding: EncodingKind, custom: Record<string, number>, unrouted = true): Generated | Error {
  try {
    return generateFsm(fsm, { encoding, custom, unrouted })
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e))
  }
}

/** The codes the current encoding gives the states. */
export const codesFor = (fsm: Fsm, encoding: EncodingKind, custom: Record<string, number>) => encodeStates(fsm, encoding, custom)

/** Build the circuit from the machine and put it on the canvas. Returns true when it was built. */
export function placeFsmCircuit(): boolean {
  const { fsm, encoding, custom } = useFsm.getState()
  const made = tryGenerate(fsm, encoding, custom, false)
  if (made instanceof Error) {
    showToast(made.message)
    return false
  }
  const ids = insertCircuit(made.circuit)
  if (!ids.length) return false
  closeFsm()
  showToast('Built the state machine below the rest. Turn Reset off to start it; the clock steps it. Undo removes it.')
  return true
}
