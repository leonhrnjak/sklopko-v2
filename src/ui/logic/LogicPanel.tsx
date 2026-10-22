import { useEffect } from 'react'
import { closeLogic, setLogicTab, useLogic, type LogicTab } from '../../app/logic'
import { AnalyzeTab } from './AnalyzeTab'
import { BuildTab } from './BuildTab'
import { CompareTab } from './CompareTab'

const TABS: [LogicTab, string][] = [
  ['analyze', 'Analyze circuit'],
  ['build', 'Build circuit'],
  ['compare', 'Compare'],
]

/** Truth tables, Boolean expressions and Karnaugh maps: work out what a circuit does, build one, or check two agree. */
export function LogicPanel() {
  const open = useLogic((s) => s.open)
  const tab = useLogic((s) => s.tab)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeLogic()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeLogic()}>
      <div className="modal logic" role="dialog" aria-modal="true" aria-label="Logic tools">
        <header className="modal-head">
          <strong>Logic</strong>
          <div className="seg" role="tablist" aria-label="Logic tools">
            {TABS.map(([id, name]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setLogicTab(id)}>
                {name}
              </button>
            ))}
          </div>
          <button className="modal-close" onClick={closeLogic} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{tab === 'analyze' ? <AnalyzeTab /> : tab === 'build' ? <BuildTab /> : <CompareTab />}</div>
      </div>
    </div>
  )
}
