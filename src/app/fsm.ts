import { create } from 'zustand'
import { encodeStates, generateFsm, type EncodingKind, type Fsm, type Generated } from '../model/fsm'
import { FSM_EXAMPLES } from '../model/fsm-examples'
import { blankFsm, fsmDocumentJson, layoutFsm, parseFsmDocument, type FsmDocument } from '../model/fsm-edit'
import { isEmbed } from './embed'
import { downloadText, openTextFile } from './files'
import { getDoc, metaOf, nextUntitled, openLastDoc, saveActive, setActive, type DocMeta, type NewDoc } from './library'
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

/** Where the one saved machine lived before the library; read once, to bring it in. */
const LEGACY_KEY = 'sklopko.fsm.v1'
const HISTORY = 100

function initial(): Pick<FsmEditor, 'fsm' | 'encoding' | 'custom'> {
  return { fsm: layoutFsm(FSM_EXAMPLES[1]), encoding: 'binary', custom: {} }
}

export const useFsm = create<FsmEditor>(() => ({ open: false, view: 'diagram', ...initial(), selected: null, past: [], future: [] }))

const documentOf = (s: FsmEditor): FsmDocument => ({ fsm: s.fsm, encoding: s.encoding, custom: s.custom })

type Machine = Pick<FsmEditor, 'fsm' | 'encoding' | 'custom'>

const sameMachine = (a: Machine, b: Machine) => a.fsm === b.fsm && a.encoding === b.encoding && a.custom === b.custom

// ---- Keeping the machine in the library -------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null
/** What is in the editor has no document yet (a starting point nobody has changed): it gets one at its first edit. */
let unsaved: (NewDoc & { base: Machine }) | null = { name: async () => useFsm.getState().fsm.name || 'State machine', base: useFsm.getState() }

const dataOf = () => JSON.parse(fsmDocumentJson(documentOf(useFsm.getState()))) as unknown

function save() {
  timer = null
  const create = unsaved ?? undefined
  unsaved = null
  // A failed save is already reported by the circuit's autosave: the library is the same one.
  saveActive('fsm', dataOf(), create && { name: create.name, origin: create.origin }).catch(() => {})
}

/** Save at once what was changed in the last moments (before another machine takes the editor). */
export function flushFsm() {
  if (!timer) return
  clearTimeout(timer)
  save()
}

useFsm.subscribe((s, prev) => {
  if (isEmbed() || sameMachine(s, prev)) return
  if (unsaved && sameMachine(s, unsaved.base)) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(save, 400)
})

/**
 * Put a machine in the editor as another document, with no undo history from the one before (that one stays in the library).
 * `stored`: it is the document the library has; otherwise it has none until it is edited (`on-edit`) or gets one now (`now`).
 */
function showMachine(doc: Partial<FsmDocument> & { fsm: Fsm }, how: { mode: 'stored'; meta: DocMeta } | ({ mode: 'now' | 'on-edit' } & NewDoc)) {
  flushFsm()
  useFsm.setState({ fsm: layoutFsm(doc.fsm), encoding: doc.encoding ?? 'binary', custom: doc.custom ?? {}, selected: null, past: [], future: [] })
  // Putting it there looked like a change to the autosave: it is not one.
  if (timer) clearTimeout(timer)
  timer = null
  unsaved = null
  if (how.mode === 'stored') {
    setActive(how.meta)
    return
  }
  setActive(null, 'fsm')
  const create = { name: how.name, origin: how.origin }
  if (how.mode === 'now') saveActive('fsm', dataOf(), create).catch(() => {})
  else unsaved = { ...create, base: useFsm.getState() }
}

/** Start the editor with the machine of the library (the one this tab had, else the last one used), or the one of an earlier version. */
export async function restoreFsm() {
  try {
    const rec = await openLastDoc('fsm')
    if (rec) {
      showMachine(parseFsmDocument(JSON.stringify(rec.data)), { mode: 'stored', meta: metaOf(rec) })
      return
    }
  } catch {
    // A record that no longer reads: carry on with what follows.
  }
  try {
    const old = localStorage.getItem(LEGACY_KEY)
    if (old) showMachine(parseFsmDocument(old), { mode: 'now', name: async () => useFsm.getState().fsm.name || 'State machine' })
  } catch {
    // Nothing usable stored: the starting example stays, unsaved until it is edited.
  }
}

/** Open a state machine of the library in the editor. Throws when it is gone or can no longer be read. */
export async function openStoredFsm(id: string) {
  const rec = await getDoc(id)
  if (!rec || rec.kind !== 'fsm') throw new Error('That state machine is no longer in your library.')
  showMachine(parseFsmDocument(JSON.stringify(rec.data)), { mode: 'stored', meta: metaOf(rec) })
  openFsm()
}

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

/** Replace the machine with another (a starting point or a file). It is a document of its own once it is edited (or at once, for a file). */
export function loadFsm(doc: Partial<FsmDocument> & { fsm: Fsm }, how: 'on-edit' | 'now' = 'on-edit') {
  showMachine(doc, { mode: how, name: async () => useFsm.getState().fsm.name || 'State machine' })
}

export function startFromBlank() {
  showMachine({ fsm: blankFsm() }, { mode: 'on-edit', name: () => nextUntitled('fsm') })
}
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
    loadFsm(parseFsmDocument(file.text), 'now')
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
