import { useMemo, useRef, useState } from 'react'
import { checkpointFsm, editFsm, selectInFsm, useFsm } from '../../app/fsm'
import { STATE_RADIUS, addState, addTransition, deleteState, deleteTransition, moveState } from '../../model/fsm-edit'
import { arrowHead, arrowsOf, diagramBounds, edgePoint, entryArrow, onRim, stateAt, type Pt } from './geometry'
import { Selected } from './Selected'

type Drag = { kind: 'move'; id: string; dx: number; dy: number; moved: boolean } | { kind: 'link'; from: string; to: Pt }

const NUDGE = 10

/** The machine as a picture: states are circles, transitions arrows. Drag a state to move it, drag from its rim to another state to join them. */
export function DiagramView() {
  const fsm = useFsm((s) => s.fsm)
  const sel = useFsm((s) => s.selected)
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** "Add transition" mode, for touch screens and keyboards: click the state it leaves, then the state it goes to. */
  const [linking, setLinking] = useState<{ from: string | null } | null>(null)

  const arrows = useMemo(() => arrowsOf(fsm), [fsm])
  const bounds = useMemo(() => diagramBounds(fsm), [fsm])
  const byId = (id: string) => fsm.states.find((s) => s.id === id)

  const point = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current!
    const m = el.getScreenCTM()
    if (!m) return { x: e.clientX, y: e.clientY }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  const focusEditor = () => requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.fsm-selected [data-fsm-focus]')?.focus())

  const join = (from: string, to: string) => {
    let id = ''
    editFsm((f) => {
      const r = addTransition(f, from, to)
      id = r.id
      return r.fsm
    })
    selectInFsm({ kind: 'transition', id })
    focusEditor()
  }

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const target = e.target as Element
    const p = point(e)
    const stateEl = target.closest('[data-state]')
    const transEl = target.closest('[data-trans]')
    if (stateEl) {
      const id = stateEl.getAttribute('data-state')!
      const s = byId(id)!
      selectInFsm({ kind: 'state', id })
      if (linking) {
        if (linking.from === null) setLinking({ from: id })
        else {
          join(linking.from, id)
          setLinking(null)
        }
        return
      }
      svg.current!.setPointerCapture(e.pointerId)
      const c = { x: s.x ?? 0, y: s.y ?? 0 }
      setDrag(onRim(c, p) ? { kind: 'link', from: id, to: p } : { kind: 'move', id, dx: p.x - c.x, dy: p.y - c.y, moved: false })
    } else if (transEl) {
      selectInFsm({ kind: 'transition', id: transEl.getAttribute('data-trans')! })
    } else {
      selectInFsm(null)
      if (linking) setLinking({ from: null })
    }
  }

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const p = point(e)
    if (drag.kind === 'link') {
      setDrag({ ...drag, to: p })
      return
    }
    if (!drag.moved) {
      if (Math.hypot(p.x - drag.dx - (byId(drag.id)?.x ?? 0), p.y - drag.dy - (byId(drag.id)?.y ?? 0)) < 3) return
      checkpointFsm() // the whole drag is one undo step
      setDrag({ ...drag, moved: true })
    }
    editFsm((f) => moveState(f, drag.id, Math.max(STATE_RADIUS, p.x - drag.dx), Math.max(STATE_RADIUS, p.y - drag.dy)), { commit: false })
  }

  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.kind === 'link') {
      const to = stateAt(fsm, point(e), 6)
      if (to) join(drag.from, to)
    }
    setDrag(null)
  }

  const addAt = (p: Pt) => {
    let id = ''
    editFsm((f) => {
      const r = addState(f, p.x, p.y)
      id = r.id
      return r.fsm
    })
    selectInFsm({ kind: 'state', id })
    focusEditor()
  }

  const onKey = (e: React.KeyboardEvent<SVGElement>, kind: 'state' | 'transition', id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectInFsm({ kind, id })
      focusEditor()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      editFsm((f) => (kind === 'state' ? deleteState(f, id) : deleteTransition(f, id)))
      selectInFsm(null)
    } else if (kind === 'state' && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const s = byId(id)
      if (!s) return
      const dx = e.key === 'ArrowLeft' ? -NUDGE : e.key === 'ArrowRight' ? NUDGE : 0
      const dy = e.key === 'ArrowUp' ? -NUDGE : e.key === 'ArrowDown' ? NUDGE : 0
      editFsm((f) => moveState(f, id, Math.max(STATE_RADIUS, (s.x ?? 0) + dx), Math.max(STATE_RADIUS, (s.y ?? 0) + dy)), { merge: `nudge:${id}` })
    }
  }

  const label = (t: (typeof fsm.transitions)[number]) => {
    const outs = fsm.type === 'mealy' && t.outputs.length ? ` / ${t.outputs.join(' ')}` : ''
    return `${t.guard.trim()}${outs}`
  }

  const linkFrom = drag?.kind === 'link' ? byId(drag.from) : linking?.from ? byId(linking.from) : undefined

  return (
    <div className="fsm-diagram-view">
      <div className="row fsm-tools">
        <button onClick={() => addAt({ x: 160 + fsm.states.length * 20, y: 140 })}>+ State</button>
        <button
          className={linking ? 'active' : ''}
          aria-pressed={!!linking}
          onClick={() => setLinking(linking ? null : { from: null })}
          title="Click the state a transition leaves, then the state it goes to"
        >
          + Transition
        </button>
        <small className="fsm-hint">
          {linking
            ? linking.from
              ? 'Now click the state it goes to (the same state makes a loop).'
              : 'Click the state the transition leaves.'
            : 'Drag a state to move it. Drag from its rim to another state to join them. Double-click empty space to add a state.'}
        </small>
      </div>
      <svg
        ref={svg}
        className="fsm-svg"
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        role="group"
        aria-label="State diagram"
        data-testid="fsm-diagram"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={(e) => {
          const t = e.target as Element
          if (t.closest('[data-state]')) focusEditor()
          else if (!t.closest('[data-trans]')) addAt(point(e))
        }}
      >
        <g>
          {byId(fsm.reset) && (() => {
            const s = byId(fsm.reset)!
            const a = entryArrow({ x: s.x ?? 0, y: s.y ?? 0 })
            return (
              <g className="fsm-entry" aria-hidden="true">
                <path d={a.d} />
                <polygon points={arrowHead(a.tip, a.angle)} />
                <text x={a.label.x} y={a.label.y} textAnchor="start">
                  reset
                </text>
              </g>
            )
          })()}
          {fsm.transitions.map((t) => {
            const a = arrows.get(t.id)
            if (!a) return null
            const text = label(t)
            const isSel = sel?.kind === 'transition' && sel.id === t.id
            const name = `Transition from ${byId(t.from)?.name} to ${byId(t.to)?.name}${t.guard.trim() ? `, when ${t.guard.trim()}` : ''}`
            return (
              <g key={t.id} className={`fsm-arrow${isSel ? ' selected' : ''}`} data-trans={t.id} tabIndex={0} role="button" aria-label={name} aria-pressed={isSel} onKeyDown={(e) => onKey(e, 'transition', t.id)}>
                <path className="hit" d={a.d} />
                <path className="line" d={a.d} />
                <polygon points={arrowHead(a.tip, a.angle)} />
                {text && (
                  <text x={a.label.x} y={a.label.y} textAnchor={a.anchor}>
                    {text}
                  </text>
                )}
              </g>
            )
          })}
        </g>
        <g>
          {fsm.states.map((s) => {
            const isSel = sel?.kind === 'state' && sel.id === s.id
            const outs = fsm.type === 'moore' ? s.outputs.join(' ') : ''
            return (
              <g
                key={s.id}
                className={`fsm-state${isSel ? ' selected' : ''}${fsm.reset === s.id ? ' reset' : ''}`}
                data-state={s.id}
                transform={`translate(${s.x ?? 0} ${s.y ?? 0})`}
                tabIndex={0}
                role="button"
                aria-label={`State ${s.name}${fsm.reset === s.id ? ' (reset state)' : ''}`}
                aria-pressed={isSel}
                onKeyDown={(e) => onKey(e, 'state', s.id)}
              >
                <circle r={STATE_RADIUS} />
                <text y={outs ? -4 : 4} className={s.name.length > 8 ? 'small' : undefined}>
                  {s.name}
                </text>
                {outs && (
                  <text y={13} className="outs">
                    {outs}
                  </text>
                )}
              </g>
            )
          })}
        </g>
        {linkFrom && drag?.kind === 'link' && (
          <g className="fsm-preview" aria-hidden="true">
            {(() => {
              const c = { x: linkFrom.x ?? 0, y: linkFrom.y ?? 0 }
              const start = edgePoint(c, drag.to)
              return <path d={`M${start.x} ${start.y} L${drag.to.x} ${drag.to.y}`} />
            })()}
          </g>
        )}
      </svg>
      <Selected />
    </div>
  )
}
