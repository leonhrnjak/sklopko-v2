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
  lastBackup,
  listDocs,
  noteBackup,
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
  /** When *Download all* last ran, to show "Last backup: …". */
  backedUp: number | null
}

export const useLibraryUi = create<LibraryUi>(() => ({ open: false, docs: [], filter: 'all', persistent: true, backedUp: lastBackup() }))

export async function refreshLibrary() {
  useLibraryUi.setState({ docs: await listDocs(), persistent: isPersistent(), backedUp: lastBackup() })
}

export async function openLibraryDialog() {
  useLibraryUi.setState({ open: true })
  await refreshLibrary()
}

export const closeLibraryDialog = () => useLibraryUi.setState({ open: false })
export const setLibraryFilter = (filter: LibraryFilter) => useLibraryUi.setState({ filter })

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Open a document of the library (a circuit on the canvas, a state machine in its editor), and close the dialog unless told not
 * to. Resolves to whether it was opened.
 */
export async function openDoc(meta: DocMeta, closeDialog = true): Promise<boolean> {
  try {
    if (meta.kind === 'fsm') await openStoredFsm(meta.id)
    else if (activeDoc('circuit')?.id !== meta.id) {
      await openStoredCircuit(meta.id)
      setExampleUrl(null)
    }
    if (closeDialog) closeLibraryDialog()
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
          .then(() => wasOpen && openDoc(meta, false)) // the dialog stays: more may be deleted
      },
    },
  )
}

// ---- Backup -------------------------------------------------------------------------------------

export async function downloadLibrary() {
  const backup = await exportAll()
  // The progress and the kit of Learn go in the same file: what was built is in the documents, what was done is here.
  const learn = (await import('./pathBackup')).addLearn(backup)
  downloadText('sklopko-library.json', JSON.stringify(backup), 'application/json')
  noteBackup()
  useLibraryUi.setState({ backedUp: Date.now() })
  showToast(`Saved ${backup.docs.length} ${backup.docs.length === 1 ? 'document' : 'documents'}${learn} to a file.`)
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
    const data = JSON.parse(file.text)
    const { added, skipped } = await importDocs(data, readable)
    await refreshLibrary()
    const learn = data?.learn ? (await import('./pathBackup')).restoreText(data.learn) : ''
    showToast(`Added ${added} ${added === 1 ? 'document' : 'documents'}${skipped ? ` (${skipped} could not be read)` : ''}${learn}.`)
  } catch (e) {
    showToast(e instanceof SyntaxError ? 'That is not a Sklopko library file.' : reason(e))
  }
}
