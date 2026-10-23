import { useEffect } from 'react'
import { closeFsm, setFsmView, useFsm, type FsmView } from '../../app/fsm'
import { DiagramView } from './DiagramView'
import { SidePanel } from './SidePanel'
import { TableView } from './TableView'

const VIEWS: [FsmView, string][] = [
  ['diagram', 'Diagram'],
  ['table', 'Table'],
]

/** Describe a state machine as states and transitions, check it, and generate a circuit of gates and flip-flops from it. */
export function FsmPanel() {
  const open = useFsm((s) => s.open)
  const view = useFsm((s) => s.view)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      const t = e.target as Element | null
      const typing = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)
      if (e.key === 'Escape' && !typing) closeFsm()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeFsm()}>
      <div className="modal fsm" role="dialog" aria-modal="true" aria-label="State machines">
        <header className="modal-head">
          <strong>State machines</strong>
          <div className="seg" role="tablist" aria-label="View">
            {VIEWS.map(([id, name]) => (
              <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setFsmView(id)}>
                {name}
              </button>
            ))}
          </div>
          <button className="modal-close" onClick={closeFsm} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body fsm-grid">
          <SidePanel />
          <main className="fsm-main">{view === 'diagram' ? <DiagramView /> : <TableView />}</main>
        </div>
      </div>
    </div>
  )
}
