import { useEffect, useMemo, useRef, type PointerEvent as RPointerEvent } from 'react'
import { sim } from '../app/sim'
import { useStore } from '../app/store'
import { downloadBlob } from '../app/files'
import { WAVE_WINDOWS, buildRows, clearTraces, exportVcd, setFormat, setViewEnd, setWaveOpen, setWaveView, setWindowMs, useWave, type Row } from '../app/waveform'
import { TimingView } from './TimingView'
import type { NumberTrace, Trace } from '../engine/components/io'
import { formatValue, groupTrace, type NumberFormat } from '../engine/groups'
import type { V } from '../engine/types'

const ROW_H = 38
const AXIS_H = 24
const PAD_R = 10

const labelWidth = (width: number) => (width < 520 ? 76 : 120)

/** Index of the first entry greater than `x` in a sorted array. */
function upperBound(a: number[], x: number) {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Draw a group's number as a bus: a hexagon per value, with the value written inside when it fits. */
function drawBus(ctx: CanvasRenderingContext2D, row: Row, top: number, x0: number, plotW: number, t0: number, end: number, windowMs: number, format: NumberFormat) {
  const bus = row.bus
    ? ((sim.state(row.probes[0].id) as NumberTrace | undefined) ?? { t: [], v: [] })
    : groupTrace(
        row.probes.map((p) => (sim.state(p.id) as Trace | undefined) ?? { t: [], v: [] }),
        row.probes.map((p) => p.bit),
      )
  if (!bus.t.length) return
  const px = (t: number) => x0 + ((t - t0) / windowMs) * plotW
  const yTop = top + 9
  const yBot = top + ROW_H - 11
  const yMid = (yTop + yBot) / 2
  const slant = 4
  const right = x0 + plotW
  ctx.save()
  ctx.beginPath()
  ctx.rect(x0, top, plotW + PAD_R, ROW_H)
  ctx.clip()
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let k = Math.max(0, upperBound(bus.t, t0) - 1); k < bus.t.length && bus.t[k] <= end; k++) {
    const a = Math.max(px(bus.t[k]), x0)
    const b = Math.min(k + 1 < bus.t.length ? px(bus.t[k + 1]) : right, right)
    if (b <= a) continue
    const known = bus.v[k] >= 0
    ctx.strokeStyle = known ? cssVar('--wire-1') : cssVar('--wire-x')
    ctx.beginPath()
    ctx.moveTo(a + slant, yTop)
    ctx.lineTo(b - slant, yTop)
    ctx.lineTo(b, yMid)
    ctx.lineTo(b - slant, yBot)
    ctx.lineTo(a + slant, yBot)
    ctx.lineTo(a, yMid)
    ctx.closePath()
    ctx.stroke()
    const text = formatValue(bus.v[k], row.width, format)
    if (b - a > text.length * 7 + 4 * slant) {
      ctx.fillStyle = known ? cssVar('--text') : cssVar('--muted')
      ctx.fillText(text, (a + b) / 2, yMid + 0.5)
    }
  }
  ctx.restore()
}

/** Draw every probe's trace and the time axis. `end` is the right edge of the window in simulated ms. */
function draw(canvas: HTMLCanvasElement, rows: Row[], width: number, windowMs: number, end: number, format: NumberFormat, background?: string) {
  const dpr = window.devicePixelRatio || 1
  const height = rows.length * ROW_H + AXIS_H
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  const colors: Record<V, string> = { 0: cssVar('--wire-0'), 1: cssVar('--wire-1'), 2: cssVar('--wire-x'), 3: cssVar('--wire-z') }
  const text = cssVar('--text')
  const muted = cssVar('--muted')
  const line = cssVar('--panel-border')
  const x0 = labelWidth(width)
  const plotW = Math.max(10, width - x0 - PAD_R)
  const t0 = end - windowMs
  const px = (t: number) => x0 + ((t - t0) / windowMs) * plotW

  // Time axis and vertical grid lines.
  const pxPerSec = plotW / (windowMs / 1000)
  const step = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find((s) => s * pxPerSec >= 56) ?? 100
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.lineWidth = 1
  for (let s = Math.max(0, Math.ceil(t0 / 1000 / step) * step); s * 1000 <= end + 1e-6; s += step) {
    const x = Math.round(px(s * 1000)) + 0.5
    ctx.strokeStyle = line
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, rows.length * ROW_H)
    ctx.stroke()
    ctx.fillStyle = muted
    ctx.fillText(`${+s.toFixed(2)} s`, x, rows.length * ROW_H + AXIS_H / 2)
  }

  rows.forEach((row, i) => {
    const top = i * ROW_H
    const yHigh = top + 9
    const yLow = top + ROW_H - 11
    const level = (v: V) => (v === 1 ? yHigh : v === 0 ? yLow : (yHigh + yLow) / 2)

    ctx.strokeStyle = line
    ctx.beginPath()
    ctx.moveTo(0, top + ROW_H - 0.5)
    ctx.lineTo(width, top + ROW_H - 0.5)
    ctx.stroke()
    ctx.fillStyle = text
    ctx.textAlign = 'left'
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.fillText(row.name, 8, top + ROW_H / 2, x0 - 16)

    if (row.group || row.bus) return drawBus(ctx, row, top, x0, plotW, t0, end, windowMs, format)
    const tr = sim.state(row.probes[0].id) as Trace | undefined
    if (!tr || !tr.t.length) return
    // Horizontal runs take the colour of their value, vertical edges the colour of the new value.
    const paths: Record<V, Path2D> = { 0: new Path2D(), 1: new Path2D(), 2: new Path2D(), 3: new Path2D() }
    let k = Math.max(0, upperBound(tr.t, t0) - 1)
    let x = Math.max(px(tr.t[k]), x0)
    let v = tr.v[k]
    let y = level(v)
    for (k++; k < tr.t.length && tr.t[k] <= end; k++) {
      const xn = px(tr.t[k])
      paths[v].moveTo(x, y)
      paths[v].lineTo(xn, y)
      const yn = level(tr.v[k])
      paths[tr.v[k]].moveTo(xn, y)
      paths[tr.v[k]].lineTo(xn, yn)
      x = xn
      y = yn
      v = tr.v[k]
    }
    paths[v].moveTo(x, y)
    paths[v].lineTo(x0 + plotW, y)

    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, top, plotW + PAD_R, ROW_H)
    ctx.clip()
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    for (const val of [3, 2, 0, 1] as V[]) {
      ctx.strokeStyle = colors[val]
      ctx.stroke(paths[val])
    }
    ctx.restore()
  })
}

export function WaveformPanel() {
  const open = useWave((s) => s.open)
  const view = useWave((s) => s.view)
  const windowMs = useWave((s) => s.windowMs)
  const viewEnd = useWave((s) => s.viewEnd)
  const comps = useStore((s) => s.circuit.comps)
  const body = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; end: number } | null>(null)

  const format = useWave((s) => s.format)
  const rows = useMemo(() => buildRows(comps), [comps])

  // The first probe in a circuit opens the panel.
  const seen = useRef(0)
  useEffect(() => {
    if (rows.length > 0 && seen.current === 0) {
      setWaveOpen(true)
      setWaveView('waves')
    }
    seen.current = rows.length
  }, [rows.length])

  // Redraw whenever time moves or a trace changes.
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  })
  useEffect(() => {
    if (!open) return
    let raf = 0
    let lastKey = ''
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const el = canvas.current
      const wrap = body.current
      if (!el || !wrap) return
      const { windowMs, viewEnd, format } = useWave.getState()
      if (useStore.getState().running && viewEnd !== null) setViewEnd(null)
      const width = wrap.clientWidth
      const end = viewEnd ?? sim.time
      let key = `${end}|${windowMs}|${format}|${width}|${devicePixelRatio}|${cssVar('--canvas')}`
      for (const r of rowsRef.current) {
        key += `|${r.key}:${r.name}:${r.width}`
        for (const p of r.probes) {
          const tr = sim.state(p.id) as Trace | undefined
          key += `,${p.bit}:${tr ? tr.t.length + '/' + tr.t[tr.t.length - 1] : ''}`
        }
      }
      if (key === lastKey) return
      lastKey = key
      draw(el, rowsRef.current, width, windowMs, end, format)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [open, rows.length, view])

  /** The window as it is on screen, on the panel's background, as a PNG. */
  const exportPng = () => {
    const wrap = body.current
    if (!wrap || !rows.length) return
    const { windowMs, viewEnd, format } = useWave.getState()
    const off = document.createElement('canvas')
    draw(off, rows, Math.max(wrap.clientWidth, 480), windowMs, viewEnd ?? sim.time, format, cssVar('--panel') || '#ffffff')
    off.toBlob((blob) => blob && downloadBlob('waveforms.png', blob), 'image/png')
  }

  if (!open) return null

  // Paused: drag sideways to look back in time. Double-click returns to the present.
  const onDown = (e: RPointerEvent) => {
    if (useStore.getState().running) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, end: useWave.getState().viewEnd ?? sim.time }
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    const wrap = body.current
    if (!d || !wrap) return
    const { windowMs } = useWave.getState()
    const plotW = Math.max(10, wrap.clientWidth - labelWidth(wrap.clientWidth) - PAD_R)
    const end = d.end - ((e.clientX - d.x) / plotW) * windowMs
    // Don't scroll past the start of the recording (the window may extend before it a little).
    const earliest = Math.min(sim.time, windowMs)
    setViewEnd(end >= sim.time ? null : Math.max(earliest, end))
  }
  const onUp = () => {
    drag.current = null
  }

  return (
    <section className="wave-panel" aria-label={view === 'timing' ? 'Timing' : 'Waveforms'} data-testid="waves">
      <header className="wave-head">
        <div className="seg" role="tablist" aria-label="Panel">
          <button role="tab" aria-selected={view === 'waves'} className={view === 'waves' ? 'active' : ''} onClick={() => setWaveView('waves')}>
            Waveforms
          </button>
          <button role="tab" aria-selected={view === 'timing'} className={view === 'timing' ? 'active' : ''} onClick={() => setWaveView('timing')}>
            Timing
          </button>
        </div>
        {view === 'waves' && (
        <>
        <label className="wave-window">
          <span>Window</span>
          <select value={windowMs} onChange={(e) => setWindowMs(Number(e.target.value))} aria-label="Time window">
            {WAVE_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w / 1000} s
              </option>
            ))}
          </select>
        </label>
        {rows.some((r) => r.group || r.bus) && (
          <label className="wave-window">
            <span>Numbers</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as NumberFormat)} aria-label="Number format">
              <option value="hex">Hex</option>
              <option value="dec">Decimal</option>
              <option value="bin">Binary</option>
            </select>
          </label>
        )}
        {viewEnd !== null && (
          <button onClick={() => setViewEnd(null)} title="Jump back to the present">
            ⏭ Live
          </button>
        )}
        <button onClick={exportPng} disabled={!rows.length} title="Save the window as it is on screen as a PNG image">
          PNG
        </button>
        <button onClick={exportVcd} disabled={!rows.length} title="Save everything recorded as a VCD file, which waveform viewers such as GTKWave open">
          VCD
        </button>
        <button onClick={clearTraces} disabled={!rows.length} title="Erase the recorded traces">
          Clear
        </button>
        </>
        )}
        <button className="wave-close" onClick={() => setWaveOpen(false)} aria-label="Close waveforms">
          ✕
        </button>
      </header>
      {view === 'timing' && (
        <div className="wave-body">
          <TimingView />
        </div>
      )}
      <div className="wave-body" ref={body} hidden={view === 'timing'}>
        {rows.length ? (
          <canvas
            ref={canvas}
            data-testid="wave-canvas"
            style={{ height: rows.length * ROW_H + AXIS_H }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={() => setViewEnd(null)}
          />
        ) : (
          <p className="wave-empty">
            Place a <b>Probe</b> (Input / output) and wire it to any signal. Its trace appears here, named after the
            probe’s label.
          </p>
        )}
      </div>
    </section>
  )
}
