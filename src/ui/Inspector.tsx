import { useEffect, useState } from 'react'
import {
  deleteSelection,
  select,
  flipSelection,
  groupProbes,
  resetWireRoute,
  rotateSelection,
  applyRealisticDelays,
  setDelay,
  setLabel,
  setParam,
  setSheetOpen,
  ungroupProbes,
  useStore,
} from '../app/store'
import { getDef } from '../engine/registry'
import { isAnnotation, type Comp, type Wire } from '../model/circuit'
import { hasDelay, MAX_DELAY } from '../model/delays'
import { isLabel, labelNames, labelsNamed, probeGroups } from '../model/labels'
import { setCone, useTraceOptions } from '../app/trace'
import { traceNet } from '../model/trace'
import { ConsoleSection, LutSection, RamSection, RomSection } from './MemoryInspector'
import { TextParam } from './TextParam'

function deleteAndClose() {
  deleteSelection()
  setSheetOpen(false)
}

/** What a net label is linked to: the other labels of its name, and what is wrong if the link is broken. */
function LabelLinks({ comp }: { comp: Comp }) {
  const circuit = useStore((s) => s.circuit)
  const name = String(comp.params.name)
  if (!name) return <p className="desc">Give it a name. Labels with the same name carry the same signal.</p>
  const { sends, recvs } = labelsNamed(circuit, name)
  const all = [...sends, ...recvs]
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`
  let warning = ''
  if (!sends.length) warning = 'No Send label has this name yet, so Receive labels read unknown.'
  else if (sends.length > 1) warning = 'Several Send labels share this name. Only the first one that is driven is used.'
  return (
    <>
      <p className="desc">
        “{name}”: {count(sends.length, 'send')}, {count(recvs.length, 'receive')}.
      </p>
      {warning && <p className="field-error">{warning}</p>}
      {all.length > 1 && (
        <div className="row">
          <button onClick={() => select(all)}>Select all {all.length}</button>
        </div>
      )}
    </>
  )
}

/** What a probe's group looks like: how many probes make it up, and whether two of them claim the same bit. */
function ProbeGroupInfo({ comp }: { comp: Comp }) {
  const circuit = useStore((s) => s.circuit)
  const name = String(comp.params.group)
  if (!name) return <p className="desc">Probes with the same group name are drawn as one trace that shows the number they form.</p>
  const members = probeGroups(circuit).get(name) ?? []
  const clash = members.filter((k) => k.params.bit === comp.params.bit).length > 1
  return (
    <>
      <p className="desc">
        “{name}”: {members.length} probe{members.length === 1 ? '' : 's'}, bits {members.map((k) => k.params.bit).sort((a, b) => Number(a) - Number(b)).join(', ')}.
      </p>
      {clash && <p className="field-error">Another probe in this group uses bit {String(comp.params.bit)} too. Give each its own.</p>}
      <div className="row">
        <button onClick={() => select(members.map((k) => k.id))}>Select the group</button>
        <button onClick={() => ungroupProbes([comp.id])}>Take out of the group</button>
      </div>
    </>
  )
}

/** Several probes selected: offer to draw them as one number. */
function GroupProbes({ ids }: { ids: string[] }) {
  const circuit = useStore((s) => s.circuit)
  // Suggest the part of the first label before its number: ACC0, ACC1… → ACC.
  const first = [...ids].map((id) => circuit.comps[id].label ?? '').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] ?? ''
  const [name, setName] = useState(first.replace(/[^A-Za-z0-9_]/g, '').replace(/\d+$/, '').slice(0, 12))
  const valid = /^[A-Za-z0-9_]{1,12}$/.test(name)
  const grouped = ids.some((id) => circuit.comps[id].params.group)
  return (
    <>
      <p className="desc">
        Draw these {ids.length} probes as one trace that shows the number they form. Bits follow the order of their
        labels: ACC0 is bit 0, the least significant.
      </p>
      <label className="field">
        <span>Group name</span>
        <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} aria-invalid={!valid} className={valid ? undefined : 'invalid'} />
        {!valid && <small className="field-error">Letters, digits and underscores, up to 12 characters.</small>}
        {ids.length > 16 && <small className="field-error">A group holds at most 16 probes.</small>}
      </label>
      <div className="row">
        <button disabled={!valid || ids.length > 16} onClick={() => groupProbes(ids, name)}>
          Group {ids.length} probes
        </button>
        {grouped && <button onClick={() => ungroupProbes(ids)}>Ungroup</button>}
      </div>
    </>
  )
}

/** How long a part takes to react, in gate delays. */
function DelayField({ comp }: { comp: Comp }) {
  return (
    <label className="field" title="How many gate delays this part takes to change its outputs after its inputs change. The timing view uses it.">
      <span>Delay (gate delays)</span>
      <input
        type="number"
        min={1}
        max={MAX_DELAY}
        step={1}
        value={comp.delay ?? 1}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value))
          if (Number.isFinite(n)) setDelay([comp.id], n)
        }}
      />
    </label>
  )
}

/** Set many delays at once: to the delays of real chips, or back to 1. */
function DelayTools({ ids, scope }: { ids: string[]; scope: string }) {
  const circuit = useStore((s) => s.circuit)
  const targets = ids.filter((id) => circuit.comps[id] && hasDelay(circuit.comps[id]))
  if (!targets.length) return null
  return (
    <>
      <h3>Delays</h3>
      <p className="desc">Every part takes one gate delay unless you change it. Real chips differ: an inverter is quick, an XOR is slow.</p>
      <div className="row">
        <button onClick={() => applyRealisticDelays(targets)} title={`Give ${scope} the delays of real chips`}>
          Realistic delays
        </button>
        <button onClick={() => applyRealisticDelays(targets, true)} disabled={!targets.some((id) => circuit.comps[id].delay)}>
          Set all to 1
        </button>
      </div>
    </>
  )
}

function CompInspector({ comp }: { comp: Comp }) {
  const def = getDef(comp.type)
  const circuit = useStore((s) => s.circuit)
  const [label, setLabelDraft] = useState(comp.label ?? '')

  return (
    <>
      <h2>{def.name}</h2>
      <p className="desc">{def.description}</p>
      {!isAnnotation(comp) && (
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
      )}
      {def.params?.map((p) => {
        // A ROM's contents (hex, or a program with its instruction set) are handled together, below.
        if (comp.type === 'rom' && (p.key === 'isa' || p.key === 'source' || p.key === 'data')) return null
        if (comp.type === 'lut' && p.key === 'data') return null // edited in the table below
        // A breakpoint that waits for any change has no value to compare with.
        if (comp.type === 'breakpoint' && p.key === 'value' && comp.params.when === 'changes') return null
        const v = comp.params[p.key]
        if (p.kind === 'bool')
          return (
            <label key={p.key} className="field check">
              <input type="checkbox" checked={!!v} onChange={(e) => setParam(comp.id, p.key, e.target.checked)} />
              <span>{p.label}</span>
            </label>
          )
        if (p.kind === 'text')
          return (
            <TextParam
              key={`${p.key}|${String(v)}`}
              comp={comp}
              p={p}
              suggestions={
                isLabel(comp.type)
                  ? labelNames(circuit).filter((n) => n !== v)
                  : comp.type === 'probe'
                    ? [...probeGroups(circuit).keys()].filter((n) => n !== v)
                    : undefined
              }
            />
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
      {hasDelay(comp) && <DelayField comp={comp} />}
      {comp.type === 'rom' && <RomSection comp={comp} />}
      {comp.type === 'ram' && <RamSection comp={comp} />}
      {comp.type === 'lut' && <LutSection comp={comp} />}
      {comp.type === 'console' && <ConsoleSection comp={comp} />}
      {isLabel(comp.type) && <LabelLinks comp={comp} />}
      {comp.type === 'probe' && <ProbeGroupInfo comp={comp} />}
      <div className="row">
        {!isAnnotation(comp) && (
          <>
            <button onClick={rotateSelection} title="Rotate (R)">
              ⟳ Rotate
            </button>
            <button onClick={flipSelection} title="Flip (F)">
              ⇋ Flip
            </button>
          </>
        )}
        <button className="danger" onClick={deleteAndClose} title="Delete (Del)">
          Delete
        </button>
      </div>
    </>
  )
}

function WireInspector({ wire }: { wire: Wire }) {
  const circuit = useStore((s) => s.circuit)
  const cone = useTraceOptions((s) => s.cone)
  const net = traceNet(circuit, wire.id)
  const name = (comp: string, pin: string) => `${circuit.comps[comp]?.label || getDef(circuit.comps[comp]?.type ?? 'switch').name} ${pin}`
  const reached = [...net.pins].filter((k) => k !== (net.source && `${net.source.comp}:${net.source.pin}`))
  return (
    <>
      <h2>Wire</h2>
      <p className="desc">
        {net.source ? (
          <>
            The signal from <b>{name(net.source.comp, net.source.pin)}</b> reaches {reached.length} pin{reached.length === 1 ? '' : 's'}.
            The rings on the canvas mark them and the glow follows the wires, also through net labels.
          </>
        ) : null}{' '}
        Drag a segment to reshape it, or drag the wire's end at the input pin to re-plug it.
      </p>
      <label className="field check">
        <input type="checkbox" checked={cone} onChange={(e) => setCone(e.target.checked)} />
        <span>Also show what feeds it (the logic back to the nearest registers, memories and inputs)</span>
      </label>
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
  const circuit = useStore((s) => s.circuit)
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
          <b>Net labels:</b> a Send label and a Receive label with the same name act as one wire, however far apart.
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
      <DelayTools ids={Object.keys(circuit.comps)} scope="every part" />
    </>
  )
}

export function Inspector() {
  const sheetOpen = useStore((s) => s.sheetOpen)
  const selection = useStore((s) => s.selection)
  const circuit = useStore((s) => s.circuit)
  // A program needs room for its lines: widen the panel (on desktop) while one is selected.
  const only = selection.length === 1 ? circuit.comps[selection[0]] : undefined
  const wide = only?.type === 'rom' && only.params.isa !== 'none'
  useEffect(() => {
    document.documentElement.style.setProperty('--inspector-w', wide ? '380px' : '250px')
    return () => {
      document.documentElement.style.removeProperty('--inspector-w')
    }
  }, [wide])
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
        {selection.every((id) => circuit.comps[id]?.type === 'probe') && <GroupProbes key={selection.join(',')} ids={selection} />}
        <DelayTools ids={selection} scope="the selected parts" />
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
