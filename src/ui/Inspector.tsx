import { useState } from 'react'
import {
  deleteSelection,
  flipSelection,
  resetWireRoute,
  rotateSelection,
  setLabel,
  setParam,
  setSheetOpen,
  useStore,
} from '../app/store'
import { getDef } from '../engine/registry'
import type { Comp, Wire } from '../model/circuit'

function deleteAndClose() {
  deleteSelection()
  setSheetOpen(false)
}

function CompInspector({ comp }: { comp: Comp }) {
  const def = getDef(comp.type)
  const [label, setLabelDraft] = useState(comp.label ?? '')

  return (
    <>
      <h2>{def.name}</h2>
      <p className="desc">{def.description}</p>
      <label className="field">
        <span>Label</span>
        <input
          value={label}
          placeholder="optional"
          maxLength={40}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => label !== (comp.label ?? '') && setLabel(comp.id, label.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      {def.params?.map((p) => {
        const v = comp.params[p.key]
        if (p.kind === 'bool')
          return (
            <label key={p.key} className="field check">
              <input type="checkbox" checked={!!v} onChange={(e) => setParam(comp.id, p.key, e.target.checked)} />
              <span>{p.label}</span>
            </label>
          )
        if (p.kind === 'select')
          return (
            <label key={p.key} className="field">
              <span>{p.label}</span>
              <select
                value={String(v)}
                onChange={(e) => {
                  const opt = p.options!.find((o) => String(o.value) === e.target.value)!
                  setParam(comp.id, p.key, opt.value)
                }}
              >
                {p.options!.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )
        return (
          <label key={p.key} className="field">
            <span>{p.label}</span>
            <input
              type="number"
              min={p.min}
              max={p.max}
              step={p.step ?? 1}
              value={Number(v)}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                if (Number.isFinite(n)) setParam(comp.id, p.key, Math.min(p.max ?? n, Math.max(p.min ?? n, n)))
              }}
            />
          </label>
        )
      })}
      <div className="row">
        <button onClick={rotateSelection} title="Rotate (R)">
          ⟳ Rotate
        </button>
        <button onClick={flipSelection} title="Flip (F)">
          ⇋ Flip
        </button>
        <button className="danger" onClick={deleteAndClose} title="Delete (Del)">
          Delete
        </button>
      </div>
    </>
  )
}

function WireInspector({ wire }: { wire: Wire }) {
  return (
    <>
      <h2>Wire</h2>
      <p className="desc">
        {wire.from.pin} → {wire.to.pin}. Drag a segment to reshape it, or drag the wire's end at the input pin to
        re-plug it.
      </p>
      <div className="row">
        <button onClick={() => resetWireRoute(wire.id)} disabled={!wire.manual} title="Double-click the wire">
          Auto-route
        </button>
        <button className="danger" onClick={deleteAndClose}>
          Delete
        </button>
      </div>
    </>
  )
}

function Help() {
  return (
    <>
      <h2>How to</h2>
      <ul className="help">
        <li>
          <b>Add parts:</b> drag from the left panel, or click one and then click the canvas (Shift keeps placing).
        </li>
        <li>
          <b>Wire:</b> press on a pin and drag to another pin. Drag a connected input to re-plug it.
        </li>
        <li>
          <b>Reshape wires:</b> drag a wire segment. Double-click to auto-route again.
        </li>
        <li>
          <b>Switches &amp; buttons:</b> click to operate (buttons stay pressed while held). To edit one instead,
          long-press it, right-click it, or drag it.
        </li>
        <li>
          <b>Navigate:</b> scroll or Space+drag to pan, ⌘/Ctrl+scroll or pinch to zoom, H to fit.
        </li>
        <li>
          <b>Touch screens:</b> tap a part in the list, then tap the canvas to place it. Drag empty canvas with one
          finger to pan, pinch to zoom. Selecting something shows Rotate, Delete and Edit buttons (long-press a
          switch or button to select it).
        </li>
      </ul>
      <h3>Shortcuts</h3>
      <dl className="keys">
        <dt>R / F</dt>
        <dd>rotate / flip</dd>
        <dt>Del</dt>
        <dd>delete</dd>
        <dt>⌘Z / ⇧⌘Z</dt>
        <dd>undo / redo</dd>
        <dt>⌘C ⌘V ⌘D</dt>
        <dd>copy, paste, duplicate</dd>
        <dt>⌘A</dt>
        <dd>select all</dd>
        <dt>Esc</dt>
        <dd>cancel / deselect</dd>
      </dl>
      <h3>Wire colors</h3>
      <div className="legend">
        <span className="swatch v1" /> 1 <span className="swatch v0" /> 0 <span className="swatch vx" /> unknown
      </div>
    </>
  )
}

export function Inspector() {
  const sheetOpen = useStore((s) => s.sheetOpen)
  const selection = useStore((s) => s.selection)
  const circuit = useStore((s) => s.circuit)
  let content
  if (selection.length === 1 && circuit.comps[selection[0]])
    content = (
      // Keyed on the label too, so the draft resets when the label changes elsewhere (e.g. undo).
      <CompInspector key={`${selection[0]}|${circuit.comps[selection[0]].label ?? ''}`} comp={circuit.comps[selection[0]]} />
    )
  else if (selection.length === 1 && circuit.wires[selection[0]]) content = <WireInspector wire={circuit.wires[selection[0]]} />
  else if (selection.length > 1)
    content = (
      <>
        <h2>{selection.length} selected</h2>
        <div className="row">
          <button onClick={rotateSelection}>⟳ Rotate</button>
          <button className="danger" onClick={deleteAndClose}>
            Delete
          </button>
        </div>
      </>
    )
  else content = <Help />
  return (
    <aside className={`inspector${sheetOpen ? ' open' : ''}`}>
      <button className="sheet-close" onClick={() => setSheetOpen(false)} aria-label="Close">
        ✕
      </button>
      {content}
    </aside>
  )
}
