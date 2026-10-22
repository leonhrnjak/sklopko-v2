import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { MAX_ROWS, addDiagramSignal, clearDiagramSignals, diagramRows, setGlitchesOnly, settleTicks, useCapture, useDiagram, type DiagramRow } from '../app/glitches'
import { sim } from '../app/sim'
import { select, useStore } from '../app/store'
import { traceOf } from '../engine/glitch'
import { partName } from '../model/timing'

const ROW_H = 30
const AXIS_H = 22
const PAD_R = 12
const labelWidth = (width: number) => (width < 520 ? 92 : 150)

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const levelName = (v: number) => (v === 2 ? 'unknown' : String(v))

/** One step trace per row, time along the bottom in ticks. A signal that glitched has its glitch shaded. */
function draw(canvas: HTMLCanvasElement, rows: DiagramRow[], frames: Uint8Array[], width: number) {
  const dpr = window.devicePixelRatio || 1
  const height = rows.length * ROW_H + AXIS_H
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const x0 = labelWidth(width)
  const plotW = Math.max(10, width - x0 - PAD_R)
  const slots = frames.length
  const dx = plotW / slots
  const px = (k: number) => x0 + k * dx
  const colors = [cssVar('--wire-0'), cssVar('--wire-1'), cssVar('--wire-x')]
  const text = cssVar('--text')
  const muted = cssVar('--muted')
  const border = cssVar('--panel-border')

  // Ticks along the bottom, with a faint line through the rows.
  const every = slots <= 24 ? 1 : slots <= 60 ? 5 : slots <= 150 ? 10 : 25
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let k = 0; k < slots; k += every) {
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px(k) + 0.5, 0)
    ctx.lineTo(px(k) + 0.5, rows.length * ROW_H)
    ctx.stroke()
    ctx.fillStyle = muted
    ctx.fillText(String(k), px(k), rows.length * ROW_H + 5)
  }

  rows.forEach((row, r) => {
    const top = r * ROW_H
    const yHigh = top + 8
    const yLow = top + ROW_H - 8
    const level = (v: number) => (v === 1 ? yHigh : v === 0 ? yLow : (yHigh + yLow) / 2)
    const tr = traceOf(frames, row.net)
    if (row.glitch) {
      ctx.fillStyle = cssVar('--trace')
      ctx.globalAlpha = 0.28
      ctx.fillRect(px(row.glitch.from), top + 2, Math.max(2, (row.glitch.to - row.glitch.from) * dx), ROW_H - 4)
      ctx.globalAlpha = 1
    }
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    for (let k = 0; k < slots; k++) {
      ctx.strokeStyle = colors[tr[k] === 1 ? 1 : tr[k] === 0 ? 0 : 2]
      ctx.beginPath()
      if (k > 0 && tr[k] !== tr[k - 1]) {
        ctx.moveTo(px(k), level(tr[k - 1]))
        ctx.lineTo(px(k), level(tr[k]))
      } else ctx.moveTo(px(k), level(tr[k]))
      ctx.lineTo(px(k + 1), level(tr[k]))
      ctx.stroke()
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillStyle = row.glitch ? cssVar('--trace') : text
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, top, x0 - 6, ROW_H)
    ctx.clip()
    ctx.fillText(row.name, 4, top + ROW_H / 2)
    ctx.restore()
  })
}

/** The last change of the circuit, tick by tick, with the signals that glitched. */
export function TickDiagram() {
  const circuit = useStore((s) => s.circuit)
  const selection = useStore((s) => s.selection)
  const view = useCapture()
  const extra = useDiagram((s) => s.extra)
  const glitchesOnly = useDiagram((s) => s.glitchesOnly)
  // The element that gives the diagram its width. It only exists once there is something to draw, so it is a state, not a ref:
  // the observer must attach when it appears.
  const [wrap, setWrap] = useState<HTMLElement | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState('')

  // Record the ticks while this is shown.
  useEffect(() => {
    sim.setCapture(true)
    return () => sim.setCapture(false)
  }, [])
  useEffect(() => {
    if (!wrap) return
    const measure = () => setWidth(Math.max(1, wrap.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [wrap])

  const rows = useMemo(() => (view ? diagramRows(circuit, (c, p) => sim.netOf(c, p), view, extra, glitchesOnly) : []), [circuit, view, extra, glitchesOnly])
  useEffect(() => {
    if (view && rows.length && canvas.current) draw(canvas.current, rows, view.capture.frames, width)
  }, [view, rows, width])
  // Redraw when the colours change (light/dark).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const again = () => view && rows.length && canvas.current && draw(canvas.current, rows, view.capture.frames, width)
    mq.addEventListener('change', again)
    return () => mq.removeEventListener('change', again)
  }, [view, rows, width])

  const wire = selection.length === 1 ? circuit.wires[selection[0]] : undefined
  const wireKey = wire ? `${wire.from.comp}:${wire.from.pin}` : null
  const canAdd = !!wireKey && !extra.includes(wireKey)
  const nameOfNet = (net: number) => {
    const [comp, pin] = (view?.names[net] ?? ':').split(':')
    return circuit.comps[comp] ? `${partName(circuit.comps[comp])} ${pin}` : `net ${net}`
  }

  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!view) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x0 = labelWidth(rect.width)
    const plotW = Math.max(10, rect.width - x0 - PAD_R)
    const tick = Math.floor(((e.clientX - rect.left - x0) / plotW) * view.capture.frames.length)
    const r = Math.floor((e.clientY - rect.top) / ROW_H)
    const row = rows[r]
    if (!row || tick < 0 || tick >= view.capture.frames.length) return setHover('')
    setHover(`tick ${tick}: ${row.name} = ${levelName(view.capture.frames[tick][row.net])}${row.glitch && tick >= row.glitch.from && tick < row.glitch.to ? ' (glitch)' : ''}`)
  }

  const ticks = view ? settleTicks(view.capture.frames) : 0
  const when = view ? (view.capture.cause === 'clock' ? 'a clock edge' : 'a change of an input (or loading the circuit)') : ''

  return (
    <section className="tick-diagram" aria-label="The last change, tick by tick">
      <h4>The last change, tick by tick</h4>
      {view ? (
        <>
          <p data-testid="tick-info">
            After {when}, at {(view.capture.time / 1000).toFixed(3)} s, the circuit took <b>{ticks} gate delay{ticks === 1 ? '' : 's'}</b> to settle
            {view.capture.truncated ? ' (more than are shown)' : ''}.{' '}
            {view.glitches.length ? (
              <b data-testid="glitch-count">
                {view.glitches.length} signal{view.glitches.length === 1 ? '' : 's'} glitched.
              </b>
            ) : (
              <span data-testid="glitch-count">No signal glitched.</span>
            )}
          </p>
          <div className="timing-controls">
            <label className="field check">
              <input type="checkbox" checked={glitchesOnly} onChange={(e) => setGlitchesOnly(e.target.checked)} />
              <span>Glitches only</span>
            </label>
            <button disabled={!canAdd} onClick={() => wireKey && addDiagramSignal(wireKey)} title="Select a wire, then add its signal to the diagram">
              Add the selected wire
            </button>
            {extra.length > 0 && <button onClick={clearDiagramSignals}>Remove added signals</button>}
          </div>
          {rows.length ? (
            <div className="tick-wrap" ref={setWrap}>
              <canvas ref={canvas} data-testid="tick-canvas" style={{ width, height: rows.length * ROW_H + AXIS_H }} onPointerMove={onMove} onPointerLeave={() => setHover('')} />
              {rows.length >= MAX_ROWS && <small>Showing the first {MAX_ROWS} signals.</small>}
            </div>
          ) : (
            <p className="wave-empty" ref={setWrap}>
              {glitchesOnly ? 'Nothing glitched.' : 'No signals to show: put an LED or a probe on the circuit, or select a wire and add it.'}
            </p>
          )}
          <p className="tick-readout" aria-live="polite">
            {hover || 'Time runs along the bottom, one step per gate delay. Point at the diagram to read a value.'}
          </p>
          {view.glitches.length > 0 && (
            <>
              <h4>Glitches</h4>
              <ul className="glitch-list" aria-label="Glitches">
                {view.glitches.slice(0, 12).map((g) => {
                  const comp = (view.names[g.net] || ':').split(':')[0]
                  return (
                    <li key={g.net}>
                      <button className="timing-part" onClick={() => circuit.comps[comp] && select([comp])} title="Select the part that drives it">
                        {nameOfNet(g.net)}
                      </button>
                      : a <b>{g.kind}</b> glitch. It {g.kind === 'dynamic' ? 'changes' : `should stay ${g.first}, but changes`} {g.changes} times, from tick {g.from} to tick {g.to}.
                    </li>
                  )
                })}
              </ul>
              <p className="glitch-hint">
                A glitch is a short wrong value while the signals race through paths of different length. Gates that read it at the wrong
                moment (a clock input, a latch) can act on it.
              </p>
            </>
          )}
        </>
      ) : (
        <p className="wave-empty">
          Flip a switch or step the clock, and the circuit’s last change appears here one gate delay at a time. A signal that changes more often than it
          needs to is a <b>glitch</b>.
        </p>
      )}
    </section>
  )
}
