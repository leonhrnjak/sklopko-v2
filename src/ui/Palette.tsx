import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { deleteIC, enterDefinitionById, renameIC } from '../app/ics'
import { usePath } from '../app/path'
import { setPartsOpen, usePartsDrawer } from '../app/parts'
import { setPlacing, useStore } from '../app/store'
import { CATEGORIES, DEFS } from '../engine/registry'
import { viewLayoutOf } from '../engine/viewlayout'
import { paramDefaults, type ComponentDef, type Params } from '../engine/types'
import type { Comp, ICDef } from '../model/circuit'
import { icParams, placingIC } from '../model/ic'
import { paletteDrag } from './paletteDrag'
import { CompSymbol } from './symbols'

const Thumb = memo(function Thumb({ def }: { def: ComponentDef }) {
  return <PartThumb type={def.type} params={paramDefaults(def)} />
})

/** A custom IC as it looks when placed. */
function IcThumb({ def }: { def: ICDef }) {
  const params = useMemo(() => icParams(def), [def])
  return <PartThumb type="ic" params={params} />
}

function PartThumb({ type, params }: { type: string; params: Params }) {
  const l = viewLayoutOf(type, params)
  let x1 = 0
  let y1 = 0
  let x2 = l.w
  let y2 = l.h
  for (const p of l.pins) {
    x1 = Math.min(x1, p.x)
    y1 = Math.min(y1, p.y)
    x2 = Math.max(x2, p.x)
    y2 = Math.max(y2, p.y)
  }
  const pad = 6
  const comp: Comp = { id: '__thumb', type, x: 0, y: 0, rot: 0, flip: false, params }
  return (
    <svg
      className="thumb"
      viewBox={`${x1 - pad} ${y1 - pad} ${x2 - x1 + 2 * pad} ${y2 - y1 + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <CompSymbol comp={comp} layout={l} live={false} />
    </svg>
  )
}

const WIDTH_KEY = 'sklopko.paletteWidth'
const DEFAULT_WIDTH = 216
const MIN_WIDTH = 170
const MAX_WIDTH = 460

function savedWidth() {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY))
    if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w
  } catch {
    // Storage unavailable: use the default.
  }
  return DEFAULT_WIDTH
}

function applyWidth(w: number) {
  document.documentElement.style.setProperty('--palette-w', `${w}px`)
}

applyWidth(savedWidth())

/** Drag handle on the palette's right edge (desktop only). Double-click resets the width. */
function Resizer() {
  const start = useRef<{ x: number; w: number } | null>(null)
  const onDown = (e: RPointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: savedWidthNow() }
  }
  const onMove = (e: RPointerEvent) => {
    if (!start.current) return
    const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start.current.w + e.clientX - start.current.x))
    applyWidth(w)
  }
  const onUp = () => {
    if (!start.current) return
    start.current = null
    try {
      localStorage.setItem(WIDTH_KEY, String(savedWidthNow()))
    } catch {
      // Not persisted; fine.
    }
  }
  return (
    <div
      className="palette-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize parts panel"
      title="Drag to resize · double-click to reset"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => {
        applyWidth(DEFAULT_WIDTH)
        try {
          localStorage.removeItem(WIDTH_KEY)
        } catch {
          // ignore
        }
      }}
    />
  )
}

function savedWidthNow() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--palette-w')) || DEFAULT_WIDTH
}

/** "ICs in this circuit": the custom ICs of the document, placed like any other part (see `placingIC`). */
function IcSection({
  ics,
  q,
  placing,
  collapsed,
  toggle,
  lastPointer,
  kit,
}: {
  ics: Record<string, ICDef> | undefined
  q: string
  placing: string | null
  collapsed: boolean
  toggle: () => void
  lastPointer: { current: string }
  /** The chips are the learner's kit (a step of the learning path is open): they are only placed, not edited, renamed or deleted. */
  kit: boolean
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const items = Object.values(ics ?? {}).filter((d) => !q || d.name.toLowerCase().includes(q))
  if (!items.length) return null
  return (
    <section className="palette-section" data-testid="ic-section">
      <button className="palette-heading" onClick={toggle} aria-expanded={!collapsed}>
        <span className={`chevron${collapsed ? ' closed' : ''}`}>▾</span>
        {kit ? 'Your kit' : 'ICs in this circuit'}
      </button>
      {!collapsed && (
        <div className="palette-grid">
          {items.map((d) => {
            const what = placingIC(d.id)
            return (
              <div key={d.id} className="ic-item">
                {renaming === d.id ? (
                  <div className="palette-item">
                    <IcThumb def={d} />
                    <input
                      className="ic-rename"
                      aria-label={`New name for ${d.name}`}
                      defaultValue={d.name}
                      maxLength={40}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        if (e.target.dataset.cancel !== '1') renameIC(d.id, e.target.value)
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          e.currentTarget.dataset.cancel = '1'
                          e.currentTarget.blur()
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    className={`palette-item${placing === what ? ' active' : ''}`}
                    title={kit ? `${d.name}: a chip from your kit` : `${d.name}: a custom IC of this circuit`}
                    data-type={what}
                    onPointerDown={(e) => {
                      lastPointer.current = e.pointerType
                      if (e.pointerType !== 'mouse' || e.button !== 0) return
                      e.preventDefault()
                      Object.assign(paletteDrag, { active: true, moved: false, x: e.clientX, y: e.clientY })
                      setPlacing(placing === what ? null : what)
                    }}
                    onClick={(e) => {
                      if (lastPointer.current === 'mouse' && e.detail !== 0) return
                      setPlacing(placing === what ? null : what)
                    }}
                  >
                    <IcThumb def={d} />
                    <span className="palette-name">{d.name}</span>
                  </button>
                )}
                {!kit && (
                  <div className="ic-actions">
                    <button onClick={() => enterDefinitionById(d.id)} aria-label={`Edit ${d.name}`} title="Open the circuit inside it to change it" data-testid={`ic-edit-${d.id}`}>
                      Edit
                    </button>
                    <button onClick={() => setRenaming(d.id)} aria-label={`Rename ${d.name}`} title="Rename it">
                      Rename
                    </button>
                    <button onClick={() => deleteIC(d.id)} aria-label={`Delete ${d.name}`} title="Delete it (only when nothing uses it)" data-testid={`ic-delete-${d.id}`}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function Palette() {
  const placing = useStore((s) => s.placing)
  const ics = useStore((s) => s.circuit.ics)
  // While a step of the learning path is open, the parts are the step's, and the chips are the learner's kit.
  const stepParts = usePath((s) => s.palette)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const lastPointer = useRef('mouse')
  const q = query.trim().toLowerCase()
  const open = usePartsDrawer((s) => s.open)

  // On a phone, choosing a part folds the list away while it waits to be placed, so the canvas it is to be tapped onto is all in
  // view; once it is placed (or cancelled) the list comes back, ready for the next part. The handle overrides this.
  const foldedForPlacing = useRef(false)
  useEffect(() => {
    if (!matchMedia('(max-width: 760px)').matches) return
    if (placing && usePartsDrawer.getState().open) {
      foldedForPlacing.current = true
      setPartsOpen(false)
    } else if (!placing && foldedForPlacing.current) {
      foldedForPlacing.current = false
      setPartsOpen(true)
    }
  }, [placing])

  return (
    <aside className="palette">
      <button className="palette-handle" onClick={() => {
          foldedForPlacing.current = false
          setPartsOpen(!open)
        }}
        aria-expanded={open} aria-label="Parts" data-testid="parts-handle">
        <span className="grip" aria-hidden="true" />
        Parts <span className={`chevron${open ? '' : ' closed'}`}>▾</span>
      </button>
      <input
        className="search"
        placeholder="Search parts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search parts"
      />
      <div className="palette-scroll">
        <IcSection ics={ics} q={q} placing={placing} collapsed={!!collapsed.ics && !q} toggle={() => setCollapsed({ ...collapsed, ics: !collapsed.ics })} lastPointer={lastPointer} kit={stepParts !== null} />
        {CATEGORIES.map((cat) => {
          const items = DEFS.filter(
            (d) =>
              d.category === cat.id &&
              (!stepParts || stepParts.includes(d.type)) &&
              (!q || d.name.toLowerCase().includes(q) || d.type.includes(q) || d.description.toLowerCase().includes(q)),
          )
          if (!items.length) return null
          const closed = collapsed[cat.id] && !q
          return (
            <section key={cat.id} className="palette-section">
              <button
                className="palette-heading"
                onClick={() => setCollapsed({ ...collapsed, [cat.id]: !collapsed[cat.id] })}
                aria-expanded={!closed}
              >
                <span className={`chevron${closed ? ' closed' : ''}`}>▾</span>
                {cat.name}
              </button>
              {!closed && (
                <div className="palette-grid">
                  {items.map((d) => (
                    <button
                      key={d.type}
                      className={`palette-item${placing === d.type ? ' active' : ''}`}
                      title={`${d.name}: ${d.description}`}
                      data-type={d.type}
                      onPointerDown={(e) => {
                        lastPointer.current = e.pointerType
                        // Touch: let the list scroll; a tap (click) selects the part instead.
                        if (e.pointerType !== 'mouse' || e.button !== 0) return
                        e.preventDefault()
                        Object.assign(paletteDrag, { active: true, moved: false, x: e.clientX, y: e.clientY })
                        setPlacing(placing === d.type ? null : d.type)
                      }}
                      onClick={(e) => {
                        // Taps and keyboard activation; mouse presses were handled on pointerdown.
                        if (lastPointer.current === 'mouse' && e.detail !== 0) return
                        setPlacing(placing === d.type ? null : d.type)
                      }}
                    >
                      <Thumb def={d} />
                      <span className="palette-name">{d.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
      <Resizer />
    </aside>
  )
}
