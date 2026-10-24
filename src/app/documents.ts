import type { Circuit } from '../model/circuit'
import { serialize } from '../model/serialize'
import { isEmbed } from './embed'
import { nextUntitled, saveActive, setActive, type DocMeta, type NewDoc } from './library'
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

function store(c: Circuit, create?: NewDoc) {
  saveActive('circuit', serialize(c), create).catch(() => {
    // Storage full or blocked; the circuit still works, it just won't survive a reload.
    if (!failed) showToast('Your circuit could not be saved in this browser.')
    failed = true
  })
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
  const create = { name: how.name, origin: how.origin }
  if (how.mode === 'now') store(c, create)
  else unsaved = { ...create, past: useStore.getState().past }
}

/** A blank circuit, "Untitled N" once it has something in it. */
export function newCircuit() {
  openCircuit({ comps: {}, wires: {} }, { mode: 'on-edit', name: () => nextUntitled('circuit') })
}
