import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { closeContextMenu, useContextMenu } from '../../app/contextMenu'
import { enterInstance, openMakeIc } from '../../app/ics'
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  hasClipboard,
  paste,
  resetWireRoute,
  rotateSelection,
  selectAll,
  useStore,
} from '../../app/store'
import { isAnnotation } from '../../model/circuit'
import { fitView } from './viewport'

function Item({ onClick, keys, danger, disabled, children }: { onClick: () => void; keys?: string; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      role="menuitem"
      className={danger ? 'danger' : ''}
      disabled={disabled}
      onClick={() => {
        closeContextMenu()
        onClick()
      }}
    >
      <span>{children}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
}

/** The right-click menu of the canvas: what can be done with the part, wire or selection under the pointer, or with the canvas itself. */
export function ContextMenu() {
  const at = useContextMenu((s) => s.at)
  const selection = useStore((s) => s.selection)
  const circuit = useStore((s) => s.circuit)
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState({ x: 0, y: 0 })

  // Close on a press outside, Escape, scrolling, and when the window changes under it.
  useEffect(() => {
    if (!at) return
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeContextMenu()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('wheel', closeContextMenu, { passive: true })
    window.addEventListener('blur', closeContextMenu)
    window.addEventListener('resize', closeContextMenu)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('wheel', closeContextMenu)
      window.removeEventListener('blur', closeContextMenu)
      window.removeEventListener('resize', closeContextMenu)
    }
  }, [at])

  // Keep the menu on screen: opened near the right or bottom edge, it opens up and to the left instead.
  useLayoutEffect(() => {
    if (!at || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setShift({
      x: at.x + r.width > innerWidth - 8 ? -r.width : 0,
      y: at.y + r.height > innerHeight - 8 ? -r.height : 0,
    })
    // The menu itself has the focus (no item looks picked for a mouse user); the arrow keys move to the items.
    ref.current.focus({ preventScroll: true })
  }, [at, selection])

  if (!at) return null
  const comps = selection.filter((id) => id in circuit.comps)
  const wires = selection.filter((id) => id in circuit.wires)
  const onlyOneWire = comps.length === 0 && wires.length === 1
  const single = comps.length === 1 ? circuit.comps[comps[0]] : null
  const turnable = comps.some((id) => !isAnnotation(circuit.comps[id]))

  let items: ReactNode
  if (comps.length) {
    items = (
      <>
        {single?.type === 'ic' && <Item onClick={() => enterInstance(single.id)}>Open inside</Item>}
        {turnable && (
          <>
            <Item onClick={rotateSelection} keys="R">
              Rotate
            </Item>
            <Item onClick={flipSelection} keys="F">
              Flip
            </Item>
          </>
        )}
        <Item onClick={duplicateSelection} keys="⌘D">
          Duplicate
        </Item>
        <Item onClick={copySelection} keys="⌘C">
          Copy
        </Item>
        {comps.length > 1 && <Item onClick={() => openMakeIc(true)}>Collapse into IC…</Item>}
        <div className="menu-rule" role="separator" />
        <Item onClick={deleteSelection} keys="Del" danger>
          Delete
        </Item>
      </>
    )
  } else if (onlyOneWire) {
    items = (
      <>
        <Item onClick={() => resetWireRoute(wires[0])}>Auto-route</Item>
        <div className="menu-rule" role="separator" />
        <Item onClick={deleteSelection} keys="Del" danger>
          Delete
        </Item>
      </>
    )
  } else if (wires.length) {
    items = (
      <Item onClick={deleteSelection} keys="Del" danger>
        Delete
      </Item>
    )
  } else {
    items = (
      <>
        <Item onClick={paste} keys="⌘V" disabled={!hasClipboard()}>
          Paste
        </Item>
        <Item onClick={selectAll} keys="⌘A" disabled={!Object.keys(circuit.comps).length}>
          Select all
        </Item>
        <Item onClick={fitView} keys="H">
          Fit to screen
        </Item>
      </>
    )
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      aria-label="Canvas actions"
      style={{ left: at.x + shift.x, top: at.y + shift.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        const list = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')]
        const i = list.indexOf(document.activeElement as HTMLElement)
        const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
        list[next]?.focus()
        e.preventDefault()
      }}
    >
      {items}
    </div>
  )
}
