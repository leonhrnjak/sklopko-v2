import { create } from 'zustand'
import type { Circuit } from '../model/circuit'
import { deserialize, serialize } from '../model/serialize'
import { thumbnailSvg } from '../model/thumbnail'
import { isEmbed } from './embed'
import { MAX_THUMB, activeDoc, getDoc, metaOf, nextUntitled, onActiveChange, renameDoc, saveActive, setActive, type DocMeta, type NewDoc } from './library'
import { replaceCircuit, showToast, useStore } from './store'

/**
 * How a circuit is put on the canvas, and what that means for the library:
 * - `stored`: it is the document the library has (already the active one); changes are saved into it.
 * - `now`: a new document, saved at once (a shared link, a file, a challenge).
 * - `on-edit`: shown without a document of its own (an example, a blank circuit); the first real edit makes one.
 */
export type Opening = { mode: 'stored'; meta: DocMeta } | ({ mode: 'now' | 'on-edit' } & NewDoc)

const DELAY = 400

let timer: ReturnType<typeof setTimeout> | null = null
/** The circuit the library already has, or that is deliberately not saved (yet). */
let marked: Circuit | null = null
/** What is on the canvas has no document yet: it gets one at the first real edit (the first undo step). */
let unsaved: (NewDoc & { past: unknown }) | null = null
let failed = false
let askedToKeep = false

/** Ask the browser not to clear the library when it is short of room: once, after the first save that worked. */
function askToKeep() {
  if (askedToKeep) return
  askedToKeep = true
  try {
    void navigator.storage?.persist?.()
  } catch {
    // Not offered: the library lives as long as the browser lets it.
  }
}

/** Its thumbnail, made as it is saved. A huge circuit gets none: the old one stays. */
function thumbnailOf(c: Circuit): string | undefined {
  const svg = thumbnailSvg(c)
  return svg.length <= MAX_THUMB ? svg : undefined
}

function store(c: Circuit, create?: NewDoc) {
  saveActive('circuit', serialize(c), create, thumbnailOf(c)).then(askToKeep, () => {
    // Storage full or blocked; the circuit still works, it just won't survive a reload.
    if (!failed) showToast('Your circuit could not be saved in this browser.')
    failed = true
  })
}

/** The open document: what the toolbar shows. `saved` is false for an example or blank circuit nobody has changed yet. */
export const useDoc = create<{ name: string; saved: boolean }>(() => ({ name: '', saved: false }))

onActiveChange((kind, meta) => {
  if (kind === 'circuit' && meta?.name) useDoc.setState({ name: meta.name, saved: true })
})

/** Give the open document another name (an unsaved one is saved under it when it is first edited). */
export function renameOpenDoc(name: string) {
  const clean = name.trim().slice(0, 100)
  if (!clean) return
  if (unsaved) {
    unsaved.name = clean
    useDoc.setState({ name: clean })
    return
  }
  const doc = activeDoc()
  if (doc) void renameDoc(doc.id, clean)
}

/** Save now what was changed in the last moments. */
function save() {
  timer = null
  const c = useStore.getState().circuit
  marked = c
  const create = unsaved ?? undefined
  unsaved = null
  store(c, create && { name: create.name, origin: create.origin })
}

export function flushSave() {
  if (!timer) return
  clearTimeout(timer)
  save()
}

/** Keep the library up to date with the canvas. */
export function startAutosave() {
  useStore.subscribe((s) => {
    if (isEmbed() || s.circuit === marked) return // an embedded circuit must not overwrite the visitor's saved one
    // Looking at an example, flipping its switches: there is nothing to keep until it is edited.
    if (unsaved && s.past === unsaved.past) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, DELAY)
  })
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSave)
}

/** Put a circuit on the canvas as another document. What was open is saved first and stays in the library. */
export function openCircuit(c: Circuit, how: Opening) {
  if (isEmbed()) {
    replaceCircuit(c)
    return
  }
  flushSave()
  replaceCircuit(c)
  // Putting it there looked like a change to the autosave: it is not one.
  if (timer) clearTimeout(timer)
  timer = null
  marked = c
  unsaved = null
  if (how.mode === 'stored') {
    setActive(how.meta)
    return
  }
  setActive(null)
  useDoc.setState({ name: typeof how.name === 'string' ? how.name : 'Untitled', saved: false })
  const create = { name: how.name, origin: how.origin }
  if (how.mode === 'now') store(c, create)
  else unsaved = { ...create, past: useStore.getState().past }
}

/** A blank circuit, "Untitled N" once it has something in it. */
export function newCircuit() {
  openCircuit({ comps: {}, wires: {} }, { mode: 'on-edit', name: () => nextUntitled('circuit') })
}

/** Open a circuit of the library. Throws when it is gone or can no longer be read. */
export async function openStoredCircuit(id: string) {
  const rec = await getDoc(id)
  if (!rec || rec.kind !== 'circuit') throw new Error('That circuit is no longer in your library.')
  openCircuit(deserialize(rec.data), { mode: 'stored', meta: metaOf(rec) })
}
