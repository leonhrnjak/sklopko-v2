import { create } from 'zustand'
import { deserialize } from '../model/serialize'
import { parseFsmDocument } from '../model/fsm-edit'
import { newCircuit, openStoredCircuit } from './documents'
import { downloadText, openTextFile } from './files'
import { openStoredFsm, startFromBlank } from './fsm'
import {
  activeDoc,
  deleteDoc,
  duplicateDoc,
  exportAll,
  getDoc,
  importDocs,
  isPersistent,
  listDocs,
  renameDoc,
  restoreDoc,
  type DocKind,
  type DocMeta,
} from './library'
import { setExampleUrl } from './runtime'
import { showToast } from './store'

export type LibraryFilter = 'all' | DocKind

interface LibraryUi {
  open: boolean
  docs: DocMeta[]
  filter: LibraryFilter
  /** False when the library is only in memory: nothing here will be there next time. */
  persistent: boolean
}

export const useLibraryUi = create<LibraryUi>(() => ({ open: false, docs: [], filter: 'all', persistent: true }))

export async function refreshLibrary() {
  useLibraryUi.setState({ docs: await listDocs(), persistent: isPersistent() })
}

export async function openLibraryDialog() {
  useLibraryUi.setState({ open: true })
  await refreshLibrary()
}

export const closeLibraryDialog = () => useLibraryUi.setState({ open: false })
export const setLibraryFilter = (filter: LibraryFilter) => useLibraryUi.setState({ filter })

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Open a document of the library (a circuit on the canvas, a state machine in its editor). Resolves to whether it was opened. */
export async function openDoc(meta: DocMeta): Promise<boolean> {
  try {
    if (meta.kind === 'fsm') await openStoredFsm(meta.id)
    else if (activeDoc('circuit')?.id !== meta.id) {
      await openStoredCircuit(meta.id)
      setExampleUrl(null)
    }
    closeLibraryDialog()
    return true
  } catch (e) {
    showToast(`Could not open “${meta.name}”: ${reason(e)}`)
    return false
  }
}

/** A blank circuit, as with *New*. */
export function newFromLibrary() {
  newCircuit()
  setExampleUrl(null)
  closeLibraryDialog()
}

export async function renameFromLibrary(meta: DocMeta, name: string) {
  const clean = name.trim().slice(0, 100)
  if (!clean || clean === meta.name) return
  await renameDoc(meta.id, clean)
  await refreshLibrary()
}

export async function copyDoc(meta: DocMeta) {
  await duplicateDoc(meta.id, `${meta.name} copy`)
  await refreshLibrary()
}

/**
 * Delete a document. When it is the one that is open, a blank one takes its place first. The toast can bring it back (and open
 * it again, if it was open).
 */
export async function removeDoc(meta: DocMeta) {
  const rec = await getDoc(meta.id)
  const wasOpen = activeDoc(meta.kind)?.id === meta.id
  if (wasOpen) {
    if (meta.kind === 'circuit') {
      newCircuit()
      setExampleUrl(null)
    } else startFromBlank()
  }
  await deleteDoc(meta.id)
  await refreshLibrary()
  showToast(
    `Deleted “${meta.name}”.`,
    rec && {
      label: 'Undo',
      run: () => {
        void restoreDoc(rec)
          .then(refreshLibrary)
          .then(() => wasOpen && openDoc(meta))
      },
    },
  )
}

// ---- Backup -------------------------------------------------------------------------------------

export async function downloadLibrary() {
  const backup = await exportAll()
  downloadText('sklopko-library.json', JSON.stringify(backup), 'application/json')
  showToast(`Saved ${backup.docs.length} ${backup.docs.length === 1 ? 'document' : 'documents'} to a file.`)
}

/** Does this record's data read as what its kind says? */
function readable(rec: { kind: DocKind; data: unknown }): boolean {
  try {
    if (rec.kind === 'fsm') parseFsmDocument(JSON.stringify(rec.data))
    else deserialize(rec.data)
    return true
  } catch {
    return false
  }
}

/** Ask for a backup file and add what is in it. Nothing in the library is overwritten. */
export async function importLibraryFile() {
  const file = await openTextFile('.json,application/json')
  if (!file) return
  try {
    const { added, skipped } = await importDocs(JSON.parse(file.text), readable)
    await refreshLibrary()
    showToast(`Added ${added} ${added === 1 ? 'document' : 'documents'}${skipped ? ` (${skipped} could not be read)` : ''}.`)
  } catch (e) {
    showToast(e instanceof SyntaxError ? 'That is not a Sklopko library file.' : reason(e))
  }
}
