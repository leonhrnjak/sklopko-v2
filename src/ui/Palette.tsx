import { memo, useState } from 'react'
import { setPlacing, useStore } from '../app/store'
import { CATEGORIES, DEFS } from '../engine/registry'
import { layoutOf } from '../engine/simulator'
import { paramDefaults, type ComponentDef } from '../engine/types'
import type { Comp } from '../model/circuit'
import { paletteDrag } from './paletteDrag'
import { CompSymbol } from './symbols'

const Thumb = memo(function Thumb({ def }: { def: ComponentDef }) {
  const params = paramDefaults(def)
  const l = layoutOf(def.type, params)
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

export function Palette() {
  const placing = useStore((s) => s.placing)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
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
                        if (e.button !== 0) return
                        e.preventDefault()
                        Object.assign(paletteDrag, { active: true, moved: false, x: e.clientX, y: e.clientY })
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
    </aside>
  )
}
