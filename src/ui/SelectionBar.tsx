import {
  deleteSelection,
  duplicateSelection,
  flipSelection,
  rotateSelection,
  setPlacing,
  setSheetOpen,
  useStore,
} from '../app/store'
import { openMakeIc } from '../app/ics'
import { placementOf } from '../model/ic'

/**
 * Floating actions for the selection on small screens, where there is no keyboard and the inspector is hidden.
 * Also shows the "tap to place" hint while a part is waiting to be placed.
 */
export function SelectionBar() {
  const selection = useStore((s) => s.selection)
  const circuit = useStore((s) => s.circuit)
  const placing = useStore((s) => s.placing)

  if (placing)
    return (
      <div className="action-bar placing-hint">
        <span>
          Tap the canvas to place <b>{placementOf(circuit, placing)?.name ?? 'the part'}</b>
        </span>
        <button onClick={() => setPlacing(null)}>Cancel</button>
      </div>
    )

  if (!selection.length) return null
  const hasComps = selection.some((id) => id in circuit.comps)
  return (
    <div className="action-bar compact-only" role="toolbar" aria-label="Selection actions">
      {selection.length === 1 && <button onClick={() => setSheetOpen(true)}>Edit</button>}
      {hasComps && (
        <>
          <button onClick={rotateSelection}>Rotate</button>
          <button onClick={flipSelection}>Flip</button>
          <button onClick={duplicateSelection}>Duplicate</button>
          {selection.length > 1 && <button onClick={() => openMakeIc(true)}>Make IC</button>}
        </>
      )}
      <button
        className="danger"
        onClick={() => {
          deleteSelection()
          setSheetOpen(false)
        }}
      >
        Delete
      </button>
    </div>
  )
}
