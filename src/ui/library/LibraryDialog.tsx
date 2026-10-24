import { useEffect, useState } from 'react'
import {
  closeLibraryDialog,
  copyDoc,
  downloadLibrary,
  importLibraryFile,
  newFromLibrary,
  openDoc,
  removeDoc,
  renameFromLibrary,
  setLibraryFilter,
  useLibraryUi,
  type LibraryFilter,
} from '../../app/libraryUi'
import { activeDoc, type DocMeta } from '../../app/library'
import { useDoc } from '../../app/documents'
import { fitView } from '../canvas/viewport'

const KIND_NAME = { circuit: 'Circuit', fsm: 'State machine' } as const

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Row({ meta, open }: { meta: DocMeta; open: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(meta.name)
  const done = (keep: boolean) => {
    setEditing(false)
    if (keep) void renameFromLibrary(meta, name)
    else setName(meta.name)
  }
  return (
    <li className={`library-row${open ? ' current' : ''}`} data-testid={`doc-${meta.id}`}>
      {editing ? (
        <input
          className="library-rename"
          aria-label={`New name for ${meta.name}`}
          value={name}
          maxLength={100}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done(true)
            if (e.key === 'Escape') {
              e.stopPropagation()
              done(false)
            }
          }}
        />
      ) : (
        <button
          className="library-open"
          onClick={async () => {
            if (await openDoc(meta)) requestAnimationFrame(fitView)
          }}
          title={`Open ${meta.name}`}
        >
          <b>{meta.name}</b>
          <small>
            {KIND_NAME[meta.kind]} · {when(meta.updated)}
            {open ? ' · open now' : ''}
          </small>
        </button>
      )}
      <span className="library-actions">
        <button onClick={() => (setName(meta.name), setEditing(true))} aria-label={`Rename ${meta.name}`} title="Rename">
          Rename
        </button>
        <button onClick={() => copyDoc(meta)} aria-label={`Duplicate ${meta.name}`} title="Make a copy">
          Duplicate
        </button>
        <button onClick={() => removeDoc(meta)} aria-label={`Delete ${meta.name}`} title="Delete (the toast can bring it back)">
          Delete
        </button>
      </span>
    </li>
  )
}

/** Everything in the library: circuits and state machines, newest first. Opening one never loses what was open: it stays here. */
export function LibraryDialog() {
  const { open, docs, filter, persistent } = useLibraryUi()
  // Re-render when the open document changes (its name, which one it is).
  useDoc((s) => s.name)
  useEffect(() => {
    if (!open) return
    // Escape in the rename box only cancels the rename.
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && closeLibraryDialog()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  const shown = docs.filter((d) => filter === 'all' || d.kind === filter)
  const isOpen = (d: DocMeta) => activeDoc(d.kind)?.id === d.id
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeLibraryDialog()}>
      <div className="modal library" role="dialog" aria-modal="true" aria-label="My circuits">
        <header className="modal-head">
          <strong>My circuits</strong>
          <span className="challenge-count">
            {docs.length} {docs.length === 1 ? 'document' : 'documents'}
          </span>
          <button className="modal-close" onClick={closeLibraryDialog} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {!persistent && <p className="logic-warning">⚠ This browser is not keeping your circuits after you close the page (private window?). Save a copy with “Download all”.</p>}
          <div className="library-bar">
            <button className="primary-action" onClick={newFromLibrary}>
              New circuit
            </button>
            <select value={filter} onChange={(e) => setLibraryFilter(e.target.value as LibraryFilter)} aria-label="Show">
              <option value="all">All</option>
              <option value="circuit">Circuits</option>
              <option value="fsm">State machines</option>
            </select>
            <span className="spacer" />
            <button onClick={downloadLibrary} title="Save every circuit and state machine in one file, as a backup">
              Download all
            </button>
            <button onClick={importLibraryFile} title="Add the circuits of a backup file; nothing here is overwritten">
              Import…
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="challenge-intro">{docs.length === 0 ? 'Nothing here yet. What you build is kept here automatically.' : 'Nothing of this kind.'}</p>
          ) : (
            <ul className="library-list">
              {shown.map((d) => (
                <Row key={d.id} meta={d} open={isOpen(d)} />
              ))}
            </ul>
          )}
          <p className="challenge-intro">
            Your circuits are kept in this browser only. Download a backup now and then; it also moves them to another computer.
          </p>
        </div>
      </div>
    </div>
  )
}
