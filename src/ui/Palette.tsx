import { memo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { setPlacing, useStore } from '../app/store'
import { CATEGORIES, DEFS } from '../engine/registry'
import { viewLayoutOf } from '../engine/viewlayout'
import { paramDefaults, type ComponentDef } from '../engine/types'
import type { Comp } from '../model/circuit'
import { paletteDrag } from './paletteDrag'
import { CompSymbol } from './symbols'

const Thumb = memo(function Thumb({ def }: { def: ComponentDef }) {
  const params = paramDefaults(def)
  const l = viewLayoutOf(def.type, params)
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
  const comp: Comp = { id: '__thumb', type: def.type, x: 0, y: 0, rot: 0, flip: false, params }
  return (
    <svg
      className="thumb"
      viewBox={`${x1 - pad} ${y1 - pad} ${x2 - x1 + 2 * pad} ${y2 - y1 + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <CompSymbol comp={comp} layout={l} live={false} />
    </svg>
  )
})

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

export function Palette() {
  const placing = useStore((s) => s.placing)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const lastPointer = useRef('mouse')
  const q = query.trim().toLowerCase()

  return (
    <aside className="palette">
      <input
        className="search"
        placeholder="Search parts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search parts"
      />
      <div className="palette-scroll">
        {CATEGORIES.map((cat) => {
          const items = DEFS.filter(
            (d) =>
              d.category === cat.id &&
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
