import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import { ALU_OPS } from '../engine/components/combinational'
import { CONSOLE_ROWS, FB_SIZE, GAMEPAD_BUTTONS, KEYPAD_LAYOUTS, gamepadHeld, speakerPitch, type ConsoleState, type FramebufferState, type GamepadState, type KeypadState, type SpeakerState } from '../engine/components/devices'
import { SEG_HEX } from '../engine/components/io'
import { SCREEN_COLS, SCREEN_ROWS } from '../engine/acia'
import type { TerminalState } from '../engine/components/terminal'
import type { LcdPartState } from '../engine/components/lcd'
import { LCD_COLS, LCD_ROWS, lcdCode, lcdCursorAt } from '../engine/hd44780'
import { romGlyph } from '../engine/lcdfont'
import { inputOnTerminal, keyOnTerminal, typeOnTerminal } from '../app/terminal'
import { NOTE_LINE_H, NOTE_PAD, wrapText } from '../engine/components/annotation'
import { TABLE_ROW_H, TABLE_TOP, parseWords, showsTable, tableShape } from '../engine/components/memory'
import { probeBits } from '../engine/components/io'
import { getDef } from '../engine/registry'
import { X, Z, toNum, type Layout, type PinDef, type V } from '../engine/types'
import { useSettings } from '../app/settings'
import { sim } from '../app/sim'
import type { Comp } from '../model/circuit'

/** The terminal's screen: the height of a line and the width of a character, in the symbol's own units. */
const TERM_LINE_H = 11
const TERM_CHAR_W = 6

// The LCD: a dot is 2.4 px on a 3 px grid, a character 5 dots wide with a dot of space, and 8 rows high (the eighth is the cursor's).
const LCD_DOT = 3
const LCD_CELL_W = 6 * LCD_DOT
const LCD_CELL_H = 8 * LCD_DOT + LCD_DOT
const LCD_X = 44
const LCD_Y = 12
const LCD_PAD = 6
const LCD_W = LCD_COLS * LCD_CELL_W + 2 * LCD_PAD
const LCD_H = LCD_ROWS * LCD_CELL_H + 2 * LCD_PAD

/** The dots of the characters on the display, as one path (a square for each lit dot). */
function lcdDots(st: LcdPartState): { d: string; cursor: { x: number; y: number } | null; blink: { x: number; y: number } | null } {
  let d = ''
  const dot = (x: number, y: number) => {
    d += `M${x} ${y}h${LCD_DOT - 0.6}v${LCD_DOT - 0.6}h${-(LCD_DOT - 0.6)}z`
  }
  const at = (row: number, col: number) => ({ x: LCD_X + LCD_PAD + col * LCD_CELL_W, y: LCD_Y + LCD_PAD + row * LCD_CELL_H })
  for (let row = 0; row < LCD_ROWS; row++) {
    for (let col = 0; col < LCD_COLS; col++) {
      const code = lcdCode(st, row, col)
      const rows = code < 16 ? Array.from({ length: 8 }, (_, r) => st.cgram[(code & 7) * 8 + r] & 31) : romGlyph(code)
      const o = at(row, col)
      rows.forEach((bits, r) => {
        for (let b = 0; b < 5; b++) if ((bits >> (4 - b)) & 1) dot(o.x + b * LCD_DOT, o.y + r * LCD_DOT)
      })
    }
  }
  const c = lcdCursorAt(st)
  return { d, cursor: c && st.cursor ? at(c.row, c.col) : null, blink: c && st.blink ? at(c.row, c.col) : null }
}

/** The character display: the dots of what is in the display memory (when the display is on), the cursor and its blink. */
function LcdSym({ l, st }: { l: Layout; st: LcdPartState | undefined }) {
  const on = !!st?.display
  const { d, cursor, blink } = st && on ? lcdDots(st) : { d: '', cursor: null, blink: null }
  return (
    <BoxSym l={l}>
      <rect className={on ? 'lcd-body' : 'lcd-body off'} x={LCD_X} y={LCD_Y} width={LCD_W} height={LCD_H} rx={4} />
      <path className="lcd-dots" d={d} />
      {cursor && <rect className="lcd-cursor" x={cursor.x} y={cursor.y + 7 * LCD_DOT} width={5 * LCD_DOT - 0.6} height={LCD_DOT - 0.6} />}
      {blink && <rect className="lcd-blink" x={blink.x - 1} y={blink.y - 1} width={5 * LCD_DOT + 1.4} height={8 * LCD_DOT + 1.4} />}
      {st && st.busy > 0 && <circle className="lcd-busy" cx={LCD_X + LCD_W - 7} cy={LCD_Y + 7} r={2.5} />}
      <Title text={on ? 'LCD 16×2' : 'LCD 16×2 (display off)'} x={LCD_X + LCD_W / 2} y={LCD_Y + LCD_H + 16} />
    </BoxSym>
  )
}

/** Rotation/flip of the enclosing component, so text can stay upright. */
const Orient = createContext({ rot: 0, flip: false })

function Txt(props: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; className?: string; children: ReactNode }) {
  const { rot, flip } = useContext(Orient)
  const { x, y, className, children } = props
  let anchor = props.anchor ?? 'middle'
  // Where does local +x point on screen? If left, swap anchors so labels stay inside the body.
  const sx = flip ? -1 : 1
  const dirX = [sx, 0, -sx, 0][rot]
  if (dirX < 0) anchor = anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : anchor
  else if (dirX === 0 && anchor !== 'middle') anchor = 'middle'
  const t = rot || flip ? `translate(${x} ${y}) scale(${sx} 1) rotate(${-rot * 90}) translate(${-x} ${-y})` : undefined
  const overline = typeof children === 'string' && children.startsWith('~')
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" transform={t} className={className}>
      {overline ? <tspan textDecoration="overline">{(children as string).slice(1)}</tspan> : children}
    </text>
  )
}

const vClass = (v: V) => (v === 1 ? 'v1' : v === 0 ? 'v0' : v === 3 ? 'vz' : 'vx')

/** Line from the pin tip to the body edge (or to `inner`), with an inversion bubble if needed. A bus pin is thick, with a slash. */
function Stub({ pin, inner }: { pin: PinDef; inner: { x: number; y: number } }) {
  if (pin.bus) {
    const mx = (pin.x + inner.x) / 2
    const my = (pin.y + inner.y) / 2
    return (
      <>
        <line className="sym-line bus" x1={inner.x} y1={inner.y} x2={pin.x} y2={pin.y} />
        <line className="sym-line bus-slash" x1={mx - 2.5} y1={my + 4} x2={mx + 2.5} y2={my - 4} />
      </>
    )
  }
  if (pin.invert) {
    const dx = Math.sign(pin.x - inner.x)
    const dy = Math.sign(pin.y - inner.y)
    return (
      <>
        <circle className="sym-line bubble" cx={inner.x + dx * 5} cy={inner.y + dy * 5} r={4.5} />
        <line className="sym-line" x1={inner.x + dx * 10} y1={inner.y + dy * 10} x2={pin.x} y2={pin.y} />
      </>
    )
  }
  return <line className="sym-line" x1={inner.x} y1={inner.y} x2={pin.x} y2={pin.y} />
}

const edgePoint = (pin: PinDef, l: Layout) => {
  switch (pin.side) {
    case 'l':
      return { x: 0, y: pin.y }
    case 'r':
      return { x: l.w, y: pin.y }
    case 't':
      return { x: pin.x, y: 0 }
    case 'b':
      return { x: pin.x, y: l.h }
  }
}

// ---- Gates -------------------------------------------------------------------------------------

/** IEC 60617 qualifying symbol drawn inside the rectangle of each gate. */
const IEC_MARK: Record<string, string> = {
  and: '&',
  nand: '&',
  or: '≥1',
  nor: '≥1',
  xor: '=1',
  xnor: '=1',
  not: '1',
  buf: '1',
}

function IecGateSym({ type, l }: { type: string; l: Layout }) {
  return (
    <>
      {l.pins.map((p) => (
        <Stub key={p.name} pin={p} inner={edgePoint(p, l)} />
      ))}
      <rect className="sym-body" x={0} y={0} width={l.w} height={l.h} />
      <Title text={IEC_MARK[type]} x={l.w / 2} y={l.h / 2} />
    </>
  )
}

function GateSym({ type, l }: { type: string; l: Layout }) {
  const iec = useSettings((s) => s.gateStyle === 'iec')
  if (iec) return <IecGateSym type={type} l={l} />
  const { w, h } = l
  const shape = /^(n?and)$/.test(type) ? 'and' : /^(n?or)$/.test(type) ? 'or' : /^xn?or$/.test(type) ? 'xor' : 'buf'
  let body: string
  let back = (_y: number) => 0
  if (shape === 'and') {
    const r = h / 2
    body = `M0,0 H${w - r} A${r},${r} 0 0 1 ${w - r},${h} H0 Z`
  } else if (shape === 'buf') {
    body = `M0,-4 L${w},${h / 2} L0,${h + 4} Z`
  } else {
    const x0 = shape === 'xor' ? 10 : 0
    const c = h * 0.22
    const f = x0 + (w - x0) * 0.5
    body = `M${x0},0 Q${f},0 ${w},${h / 2} Q${f},${h} ${x0},${h} Q${x0 + c},${h / 2} ${x0},0 Z`
    back = (y) => {
      const t = y / h
      return 2 * c * t * (1 - t)
    }
  }
  return (
    <>
      {shape === 'xor' && <path className="sym-line" d={`M0,0 Q${h * 0.22},${h / 2} 0,${h}`} />}
      <path className="sym-body" d={body} />
      {l.pins.map((p) => (
        <Stub key={p.name} pin={p} inner={p.side === 'l' ? { x: back(p.y), y: p.y } : edgePoint(p, l)} />
      ))}
    </>
  )
}

// ---- Boxes -------------------------------------------------------------------------------------

function PinLabels({ l }: { l: Layout }) {
  return (
    <>
      {l.pins.map((p) => {
        const label = p.label ?? p.name
        if (!label) return null
        const clockShift = p.clock ? 8 : 0
        switch (p.side) {
          case 'l':
            return (
              <Txt key={p.name} x={5 + clockShift} y={p.y} anchor="start" className="pin-label">
                {label}
              </Txt>
            )
          case 'r':
            return (
              <Txt key={p.name} x={l.w - 5} y={p.y} anchor="end" className="pin-label">
                {label}
              </Txt>
            )
          case 't':
            return (
              <Txt key={p.name} x={p.x} y={9} className="pin-label">
                {label}
              </Txt>
            )
          case 'b':
            return (
              <Txt key={p.name} x={p.x} y={l.h - 9} className="pin-label">
                {label}
              </Txt>
            )
        }
      })}
    </>
  )
}

function ClockMarks({ l }: { l: Layout }) {
  return (
    <>
      {l.pins
        .filter((p) => p.clock)
        .map((p) => (
          <path key={p.name} className="sym-line" d={`M0,${p.y - 5} L7,${p.y} L0,${p.y + 5}`} />
        ))}
    </>
  )
}

/** Multi-line title kept upright as one block around its centre. */
function Title({ text, x, y }: { text: string; x: number; y: number }) {
  const { rot, flip } = useContext(Orient)
  const lines = text.split('\n')
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1) rotate(${-rot * 90})`}>
      {lines.map((line, i) => (
        <text key={i} x={0} y={(i - (lines.length - 1) / 2) * 14} textAnchor="middle" dominantBaseline="central" className="title">
          {line}
        </text>
      ))}
    </g>
  )
}

function BoxSym({ l, title, warn, children }: { l: Layout; title?: string; warn?: boolean; children?: ReactNode }) {
  return (
    <>
      {l.pins.map((p) => (
        <Stub key={p.name} pin={p} inner={edgePoint(p, l)} />
      ))}
      <rect className={warn ? 'sym-body contention' : 'sym-body'} x={0} y={0} width={l.w} height={l.h} rx={3} />
      <ClockMarks l={l} />
      <PinLabels l={l} />
      {title && <Title text={title} x={l.w / 2} y={l.h / 2} />}
      {children}
    </>
  )
}

/** Memory symbol: a small table of all words, the addressed one highlighted. */
function MemSym({ l, title, words, digits, addr }: { l: Layout; title: string; words: number[]; digits: number; addr: number }) {
  const { rows, cols, cellW } = tableShape(words.length, digits)
  // Upright text doesn't fit the short side of a turned box, so the name is left out there.
  const sideways = useContext(Orient).rot % 2 === 1
  const x0 = (l.w - cols * cellW) / 2
  if (!showsTable(words.length)) return <BoxSym l={l} title={title} />
  return (
    <BoxSym l={l}>
      {words.map((v, i) => {
        const cx = x0 + Math.floor(i / rows) * cellW
        const cy = TABLE_TOP + (i % rows) * TABLE_ROW_H
        const hl = i === addr
        return (
          <g key={i}>
            {hl && <rect className="mem-hl" x={cx + 1} y={cy} width={cellW - 2} height={TABLE_ROW_H} rx={2} />}
            <Txt x={cx + cellW / 2} y={cy + TABLE_ROW_H / 2 + 0.5} className={`mem-cell${hl ? ' hl' : ''}`}>
              {v.toString(16).toUpperCase().padStart(digits, '0')}
            </Txt>
          </g>
        )
      })}
      {!sideways && <Title text={title} x={l.w / 2} y={l.h - 10} />}
    </BoxSym>
  )
}

function MuxSym({ l, title, demux }: { l: Layout; title: string; demux: boolean }) {
  const { w, h } = l
  const k = 14
  // Mux narrows to the right, demux to the left.
  const body = demux ? `M0,${k} L${w},0 L${w},${h} L0,${h - k} Z` : `M0,0 L${w},${k} L${w},${h - k} L0,${h} Z`
  const bottomAt = (x: number) => (demux ? h - k + (k * x) / w : h - (k * x) / w)
  return (
    <>
      {l.pins.map((p) => (
        <Stub key={p.name} pin={p} inner={p.side === 'b' ? { x: p.x, y: bottomAt(p.x) } : edgePoint(p, l)} />
      ))}
      <path className="sym-body" d={body} />
      {l.pins.map((p) =>
        p.side === 'b' ? (
          <Txt key={p.name} x={p.x} y={bottomAt(p.x) - 8} className="pin-label">
            {p.name}
          </Txt>
        ) : (
          <Txt
            key={p.name}
            x={p.side === 'l' ? 5 : w - 5}
            y={p.y}
            anchor={p.side === 'l' ? 'start' : 'end'}
            className="pin-label"
          >
            {p.name}
          </Txt>
        ),
      )}
      <Title text={title} x={w / 2} y={h / 2 - 4} />
    </>
  )
}

// ---- Displays ----------------------------------------------------------------------------------

function Digit({ x, y, w, h, segs, dp }: { x: number; y: number; w: number; h: number; segs: number; dp?: boolean }) {
  const t = Math.max(5, w * 0.17)
  const g = 1.2
  const L = x
  const R = x + w
  const T = y
  const B = y + h
  const M = (T + B) / 2
  const H = (x1: number, x2: number, yy: number) =>
    `${x1 + g},${yy} ${x1 + g + t / 2},${yy - t / 2} ${x2 - g - t / 2},${yy - t / 2} ${x2 - g},${yy} ${x2 - g - t / 2},${yy + t / 2} ${x1 + g + t / 2},${yy + t / 2}`
  const Vt = (y1: number, y2: number, xx: number) =>
    `${xx},${y1 + g} ${xx + t / 2},${y1 + g + t / 2} ${xx + t / 2},${y2 - g - t / 2} ${xx},${y2 - g} ${xx - t / 2},${y2 - g - t / 2} ${xx - t / 2},${y1 + g + t / 2}`
  const shapes = [H(L, R, T), Vt(T, M, R), Vt(M, B, R), H(L, R, B), Vt(M, B, L), Vt(T, M, L), H(L, R, M)]
  return (
    <g transform={`skewX(-6) translate(${(M * Math.tan((6 * Math.PI) / 180)).toFixed(2)} 0)`}>
      {shapes.map((pts, i) => (
        <polygon key={i} points={pts} className={segs & (1 << i) ? 'seg on' : 'seg'} />
      ))}
      {dp !== undefined && <circle cx={R + t * 0.9} cy={B} r={t / 2} className={dp ? 'seg on' : 'seg'} />}
    </g>
  )
}

/** Pixel colours of the pixel screen, by number of colours. */
const FB_COLORS: Record<string, string[]> = {
  2: ['#0b1220', '#facc15'],
  4: ['#0b1220', '#ef4444', '#22c55e', '#f8fafc'],
  shades: ['#0b1220', '#6d5a12', '#b08f12', '#facc15'],
}

const LED_COLORS: Record<string, string> = {
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#facc15',
  blue: '#3b82f6',
  white: '#f1f5f9',
}

/** How long a dot-matrix pixel keeps glowing after it was last lit, in simulated ms. */
const GLOW_MS = 250

function MatrixSym({ comp, l, live }: { comp: Comp; l: Layout; live: boolean }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const lit: Float64Array | undefined = live ? sim.state(comp.id)?.lit : undefined
  const vs = live ? sim.inputValues(comp.id) : []
  const now = sim.time
  let fading = false
  const levels: number[] = []
  for (let i = 0; i < 64; i++) {
    const r = i >> 3
    const c = i & 7
    let level = 0
    if (vs[r] === 1 && vs[8 + c] === 1) level = 1
    else if (lit) {
      // A negative age means the time was reset since the pixel last lit.
      const age = now - lit[i]
      if (age >= 0 && age < GLOW_MS) {
        level = 1 - age / GLOW_MS
        fading = true
      }
    }
    levels.push(level)
  }
  // Pixels fade as simulated time passes, even when no pin changes, so keep redrawing while any glows.
  useEffect(() => {
    if (!fading) return
    let id = requestAnimationFrame(function poll() {
      if (sim.time !== now) redraw()
      else id = requestAnimationFrame(poll)
    })
    return () => cancelAnimationFrame(id)
  })
  return (
    <>
      {l.pins.map((q) => (
        <Stub key={q.name} pin={q} inner={edgePoint(q, l)} />
      ))}
      <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
      {l.pins.map((q) => (
        <Txt key={q.name} x={q.side === 'l' ? 6 : q.x} y={q.side === 'l' ? q.y : 8} anchor={q.side === 'l' ? 'start' : 'middle'} className="pin-label display-label">
          {q.name}
        </Txt>
      ))}
      {levels.map((level, i) => {
        // Pixels sit where their row pin (left) and column pin (top) line up.
        const cx = 30 + (i & 7) * 20
        const cy = 20 + (i >> 3) * 20
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={7} className="seg" />
            {level > 0 && (
              <circle cx={cx} cy={cy} r={7} className="seg on px" style={{ opacity: level }} />
            )}
          </g>
        )
      })}
    </>
  )
}

// ---- Entry point -------------------------------------------------------------------------------

interface Props {
  comp: Comp
  layout: Layout
  /** Read live values from the simulator (false for palette thumbnails and ghosts). */
  live: boolean
}

export function CompSymbol({ comp, layout: l, live }: Props) {
  const def = getDef(comp.type)
  const p = comp.params
  const val = (pin: string): V => (live ? sim.pinValue(comp.id, pin) : 0)
  const ins = () => (live ? sim.inputValues(comp.id) : l.pins.filter((q) => q.dir === 'in').map(() => 0 as V))
  let content: ReactNode

  switch (comp.type) {
    case 'and':
    case 'or':
    case 'not':
    case 'nand':
    case 'nor':
    case 'xor':
    case 'xnor':
    case 'buf':
      content = <GateSym type={comp.type} l={l} />
      break
    case 'switch': {
      const on = !!p.on
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: l.w, y: 10 }} />
          <rect x={0} y={0} width={30} height={20} rx={10} className={`switch-track ${on ? 'f1' : 'f0'}`} />
          <circle cx={on ? 20 : 10} cy={10} r={7} className="switch-knob" />
          {p.key && (
            <text x={15} y={32} textAnchor="middle" className="switch-key">
              {String(p.key).toUpperCase()}
            </text>
          )}
        </>
      )
      break
    }
    case 'button': {
      const pressed = live && !!sim.state(comp.id)?.pressed
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: l.w, y: 10 }} />
          <rect x={0} y={0} width={20} height={20} rx={4} className="sym-body" />
          <circle cx={10} cy={10} r={6.5} className={`button-cap ${pressed ? 'f1' : 'f0'}`} />
        </>
      )
      break
    }
    case 'clock': {
      const v = val('Q')
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: l.w, y: 20 }} />
          <rect x={0} y={0} width={40} height={40} rx={4} className="sym-body" />
          <path className="sym-line" d="M7,27 h7 v-14 h12 v14 h7" />
          <rect x={14} y={30} width={12} height={5} rx={2} className={`clock-led ${vClass(v)}`} />
        </>
      )
      break
    }
    case 'probe': {
      if (probeBits(p) > 1) {
        const n = toNum(ins(), 0, probeBits(p))
        content = <BoxSym l={l} title={n < 0 ? '?' : n.toString(16).toUpperCase().padStart(Math.ceil(probeBits(p) / 4), '0')} />
        break
      }
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: 0, y: 10 }} />
          <rect x={0} y={0} width={30} height={20} rx={4} className="sym-body" />
          <path className="sym-line" d="M5,15 h5 v-9 h7 v9 h3" />
          <circle cx={25} cy={6} r={2.6} className={`clock-led ${vClass(val('A'))}`} />
        </>
      )
      break
    }
    case 'netsend':
    case 'netrecv': {
      // A flag with its pointed end facing away from the pin. A dot near the pin shows the signal.
      const send = comp.type === 'netsend'
      const name = String(p.name)
      const w = l.w
      const v = val(send ? 'A' : 'Y')
      const bits = Number(p.bits ?? 1)
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: send ? 0 : w, y: 10 }} />
          <polygon
            className="sym-body"
            points={send ? `0,0 ${w - 8},0 ${w},10 ${w - 8},20 0,20` : `8,0 ${w},0 ${w},20 8,20 0,10`}
          />
          {bits === 1 && <circle cx={send ? 8 : w - 8} cy={10} r={2.6} className={`clock-led ${vClass(v)}`} />}
          {comp.rot % 2 === 1 ? (
            // Turned a quarter: the text turns with the flag so it runs along it, reading top to bottom.
            <text
              x={send ? w / 2 + 3 : w / 2 - 2}
              y={10.5}
              textAnchor="middle"
              dominantBaseline="central"
              transform={`translate(${send ? w / 2 + 3 : w / 2 - 2} 10.5) scale(${comp.flip ? -1 : 1} 1) rotate(${comp.rot === 3 ? 180 : 0}) translate(${-(send ? w / 2 + 3 : w / 2 - 2)} -10.5)`}
              className={name ? 'net-name' : 'net-name empty'}
            >
              {(name || 'name') + (bits > 1 ? `[${bits}]` : '')}
            </text>
          ) : (
            <Txt x={send ? w / 2 + 3 : w / 2 - 2} y={10.5} className={name ? 'net-name' : 'net-name empty'}>
              {(name || 'name') + (bits > 1 ? `[${bits}]` : '')}
            </Txt>
          )}
        </>
      )
      break
    }
    case 'note': {
      const lines = wrapText(String(p.text), Math.max(8, Number(p.cols)))
      content = (
        <>
          <rect className={`note-body ${String(p.color)}`} x={0} y={0} width={l.w} height={l.h} rx={3} />
          {lines.map((line, i) => (
            <text key={i} className="note-text" x={NOTE_PAD} y={NOTE_PAD + 12 + i * NOTE_LINE_H}>
              {line}
            </text>
          ))}
        </>
      )
      break
    }
    case 'frame':
      content = (
        <>
          <rect className={`frame-fill ${String(p.color)}`} x={0} y={0} width={l.w} height={l.h} rx={6} />
          <rect className={`frame-edge ${String(p.color)}`} x={0} y={0} width={l.w} height={l.h} rx={6} />
          <rect className="frame-hit" x={0} y={0} width={l.w} height={l.h} rx={6} />
          <rect className="frame-bar" x={0} y={0} width={l.w} height={24} rx={6} />
          <text className="frame-title" x={10} y={13}>
            {String(p.title)}
          </text>
        </>
      )
      break
    case 'breakpoint': {
      const n = Number(p.width)
      const equals = p.when !== 'changes'
      const met = live && equals && toNum(ins(), 0, n) === Number(p.value)
      content =
        n === 1 ? (
          <>
            <Stub pin={l.pins[0]} inner={{ x: 0, y: 10 }} />
            <polygon className={`break-body${met ? ' met' : ''}`} points="6,0 44,0 50,6 50,14 44,20 6,20 0,14 0,6" />
            <Txt x={25} y={10.5} className="break-text">
              {equals ? `STOP=${String(p.value).slice(0, 3)}` : 'STOP Δ'}
            </Txt>
          </>
        ) : (
          <g className={`break-box${met ? ' met' : ''}`}>
            <BoxSym l={l} title={def.title!(p)} />
          </g>
        )
      break
    }
    case 'const': {
      const one = Number(p.value) === 1
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: l.w, y: 10 }} />
          <rect x={0} y={0} width={20} height={20} rx={3} className="sym-body" />
          <Txt x={10} y={10.5} className={`const-text ${one ? 't1' : 't0'}`}>
            {one ? '1' : '0'}
          </Txt>
        </>
      )
      break
    }
    case 'hexin': {
      const n = Number(p.value) & 15
      content = (
        <BoxSym l={l}>
          <Txt x={14} y={l.h / 2} className="hexin-digit">
            {n.toString(16).toUpperCase()}
          </Txt>
          <Txt x={14} y={l.h - 12} className="hint">
            {n}
          </Txt>
        </BoxSym>
      )
      break
    }
    case 'led': {
      // Side view of a 5mm LED: the pin is its leg, then the rim, then the domed lens pointing right.
      const v = val('A')
      const key = String(p.color) in LED_COLORS ? String(p.color) : 'green'
      const color = LED_COLORS[key]
      const on = v === 1
      const lens = 'M5,3.5 H12 A6.5,6.5 0 0 1 12,16.5 H5 Z'
      content = (
        <>
          <defs>
            <linearGradient id={`led-lens-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity={0.9} />
              <stop offset="0.3" stopColor={color} />
              <stop offset="1" stopColor={color} />
            </linearGradient>
            <radialGradient id={`led-glow-${key}`}>
              <stop offset="0" stopColor={color} stopOpacity={0.75} />
              <stop offset="0.5" stopColor={color} stopOpacity={0.25} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </radialGradient>
          </defs>
          <Stub pin={l.pins[0]} inner={{ x: 1, y: 10 }} />
          {on && <circle className="led-glow" cx={12} cy={10} r={19} fill={`url(#led-glow-${key})`} />}
          <g className={`led-fill${on ? ' on' : ''}`}>
            <rect x={1} y={1.5} width={4} height={17} rx={1.5} fill={color} />
            <path d={lens} fill={`url(#led-lens-${key})`} />
          </g>
          {on && <ellipse cx={12.5} cy={10} rx={3.2} ry={2.6} fill="#fff" opacity={0.65} />}
          <g className={`led-outline${v === X ? ' led-x' : ''}`}>
            <rect x={1} y={1.5} width={4} height={17} rx={1.5} />
            <path d={lens} />
          </g>
          <path className="led-shine" d="M7,6.3 H12.5" />
        </>
      )
      break
    }
    case 'seg7': {
      const vs = ins()
      let segs = 0
      for (let i = 0; i < 7; i++) if (vs[i] === 1) segs |= 1 << i
      content = (
        <>
          {l.pins.map((q) => (
            <Stub key={q.name} pin={q} inner={edgePoint(q, l)} />
          ))}
          <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
          {l.pins.map((q) => (
            <Txt key={q.name} x={6} y={q.y} anchor="start" className="pin-label display-label">
              {q.name}
            </Txt>
          ))}
          <Digit x={26} y={30} w={36} h={120} segs={segs} dp={vs[7] === 1} />
        </>
      )
      break
    }
    case 'hexdisp': {
      const n = toNum(ins(), 0, 4)
      content = (
        <>
          {l.pins.map((q) => (
            <Stub key={q.name} pin={q} inner={edgePoint(q, l)} />
          ))}
          <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
          {l.pins.map((q) => (
            <Txt key={q.name} x={6} y={q.y} anchor="start" className="pin-label display-label">
              {q.name}
            </Txt>
          ))}
          <Digit x={22} y={18} w={26} h={64} segs={n < 0 ? 1 << 6 : SEG_HEX[n]} />
        </>
      )
      break
    }
    case 'dicedisp': {
      const vs = ins()
      // Pip centres on a 3×3 grid, in input order TL, TR, ML, C, MR, BL, BR.
      const x0 = 36
      const y0 = 22
      const size = 116
      const at = (i: number) => x0 + size * [0.22, 0.5, 0.78][i]
      const yAt = (i: number) => y0 + size * [0.22, 0.5, 0.78][i]
      const pips: [number, number][] = [
        [0, 0],
        [2, 0],
        [0, 1],
        [1, 1],
        [2, 1],
        [0, 2],
        [2, 2],
      ]
      content = (
        <>
          {l.pins.map((q) => (
            <Stub key={q.name} pin={q} inner={edgePoint(q, l)} />
          ))}
          <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
          {l.pins.map((q) => (
            <Txt key={q.name} x={6} y={q.y} anchor="start" className="pin-label display-label">
              {q.name}
            </Txt>
          ))}
          <rect x={x0} y={y0} width={size} height={size} rx={18} className="die-face" />
          {pips.map(([cx, cy], i) => (
            <circle key={i} cx={at(cx)} cy={yAt(cy)} r={11} className={vs[i] === 1 ? 'seg on' : 'seg'} />
          ))}
        </>
      )
      break
    }
    case 'matrix':
      content = <MatrixSym comp={comp} l={l} live={live} />
      break
    case 'acia6551': {
      const st: TerminalState | undefined = live ? sim.state(comp.id) : undefined
      const lines = (st?.lines ?? ['']).slice(-SCREEN_ROWS)
      const last = lines.length - 1
      const x0 = 44
      const w = l.w - 54
      const h = SCREEN_ROWS * TERM_LINE_H + 8
      content = (
        <BoxSym l={l}>
          <rect className="screen-body" x={x0} y={12} width={w} height={h} rx={3} />
          {lines.map((line, i) =>
            line.trim() ? (
              <text key={i} x={x0 + 3} y={12 + 4 + (i + 0.5) * TERM_LINE_H} dominantBaseline="central" className="term-text">
                {line}
              </text>
            ) : null,
          )}
          {live && st && <rect className="term-cursor" x={x0 + 3 + Math.min(st.col, SCREEN_COLS - 1) * TERM_CHAR_W} y={12 + 4 + last * TERM_LINE_H + 1} width={TERM_CHAR_W} height={TERM_LINE_H - 2} />}
          {live && (
            <>
              <text x={x0 + w / 2} y={12 + h - 10} textAnchor="middle" className="term-hint">
                click to type
              </text>
              {/* The keyboard: a text box that cannot be seen. Clicking the screen focuses it (see `focusTerminal`); what is typed
                  into it goes to the chip's keyboard buffer. A phone's on-screen keyboard opens for it too. */}
              <foreignObject x={x0} y={12} width={w} height={h} className="term-input-box">
                <textarea
                  className="term-input"
                  data-terminal-input={comp.id}
                  aria-label="Terminal keyboard: type here"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return
                    if (keyOnTerminal(comp.id, e)) e.preventDefault()
                  }}
                  onInput={(e) => {
                    const box = e.currentTarget
                    const native = e.nativeEvent as InputEvent
                    inputOnTerminal(comp.id, box.value, native.inputType ?? '')
                    box.value = ''
                  }}
                  onPaste={(e) => {
                    e.preventDefault()
                    typeOnTerminal(comp.id, e.clipboardData.getData('text'))
                  }}
                />
              </foreignObject>
            </>
          )}
          <Title text="Terminal" x={x0 + w / 2} y={12 + h + (l.h - 12 - h) / 2} />
        </BoxSym>
      )
      break
    }
    case 'hd44780':
      content = <LcdSym l={l} st={live ? (sim.state(comp.id) as LcdPartState | undefined) : undefined} />
      break
    case 'console': {
      const st: ConsoleState | undefined = live ? sim.state(comp.id) : undefined
      const lines = (st?.lines ?? ['']).slice(-CONSOLE_ROWS)
      const last = lines.length - 1
      content = (
        <BoxSym l={l}>
          <rect className="screen-body" x={44} y={12} width={l.w - 54} height={CONSOLE_ROWS * 16 + 8} rx={3} />
          {lines.map((line, i) => (
            <text key={i} x={50} y={28 + i * 16} className="console-text">
              {line}
              {i === last && live && <tspan className="console-cursor">▌</tspan>}
            </text>
          ))}
          <Title text="Text console" x={44 + (l.w - 54) / 2} y={CONSOLE_ROWS * 16 + 34} />
        </BoxSym>
      )
      break
    }
    case 'framebuffer': {
      const st: FramebufferState | undefined = live ? sim.state(comp.id) : undefined
      const colors = FB_COLORS[Number(p.colors) === 4 ? (p.palette === 'shades' ? 'shades' : 4) : 2]
      const cell = 10
      content = (
        <BoxSym l={l}>
          <rect className="screen-body" x={44} y={12} width={FB_SIZE * cell} height={FB_SIZE * cell} rx={2} />
          {st?.px.map((v, i) =>
            v ? <rect key={i} x={44 + (i % FB_SIZE) * cell} y={12 + Math.floor(i / FB_SIZE) * cell} width={cell} height={cell} fill={colors[v] ?? colors[1]} /> : null,
          )}
          <Title text={`Pixel screen 16×16, ${Number(p.colors) === 4 ? (p.palette === 'shades' ? '4 shades' : '4 colours') : '1 bit'}`} x={44 + (FB_SIZE * cell) / 2} y={FB_SIZE * cell + 32} />
        </BoxSym>
      )
      break
    }
    case 'speaker': {
      const on = !!p.on
      const st: SpeakerState | undefined = live ? sim.state(comp.id) : undefined
      const sounding = on && !!st && speakerPitch(st.edges, sim.time) > 0
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: 0, y: 20 }} />
          <rect x={0} y={0} width={40} height={40} rx={4} className="sym-body" />
          <path className={`speaker-cone${sounding ? ' on' : ''}`} d="M8,16 h6 l9,-7 v22 l-9,-7 h-6 z" />
          {on ? (
            <path className={`sym-line speaker-wave${sounding ? ' on' : ''}`} d="M27,15 q5,5 0,10 M31,11 q9,9 0,18" />
          ) : (
            <path className="sym-line speaker-muted" d="M27,15 l9,10 M36,15 l-9,10" />
          )}
        </>
      )
      break
    }
    case 'keypad': {
      const st: KeypadState | undefined = live ? sim.state(comp.id) : undefined
      const layout = KEYPAD_LAYOUTS[String(p.layout)] ?? KEYPAD_LAYOUTS.hex
      content = (
        <BoxSym l={l}>
          {layout.labels.map((label, i) => {
            const x = 32 + (i % 4) * 21
            const y = 14 + (i >> 2) * 21
            const code = layout.codes[i]
            const down = !!st?.pressed && st.key === code
            return (
              <g key={i} data-key={code} className={`key${down ? ' down' : ''}`}>
                <rect data-key={code} x={x} y={y} width={19} height={19} rx={3} className="key-cap" />
                <Txt x={x + 9.5} y={y + 10} className="key-label">
                  {label}
                </Txt>
              </g>
            )
          })}
        </BoxSym>
      )
      break
    }
    case 'gamepad': {
      const st: GamepadState | undefined = live ? sim.state(comp.id) : undefined
      const held = st ? gamepadHeld(st) : 0
      // A cross of four buttons on the left, A and B on the right; each button carries its bit number for the pointer.
      const spots = [
        { x: 41, y: 14 },
        { x: 41, y: 52 },
        { x: 22, y: 33 },
        { x: 60, y: 33 },
        { x: 100, y: 46 },
        { x: 122, y: 30 },
      ]
      content = (
        <BoxSym l={l}>
          {GAMEPAD_BUTTONS.map((b, i) => {
            const down = ((held >> i) & 1) === 1
            const round = i >= 4
            return (
              <g key={b.pin} data-key={i} className={`key${down ? ' down' : ''}`}>
                {round ? (
                  <circle data-key={i} cx={spots[i].x + 9.5} cy={spots[i].y + 9.5} r={10} className="key-cap" />
                ) : (
                  <rect data-key={i} x={spots[i].x} y={spots[i].y} width={19} height={19} rx={3} className="key-cap" />
                )}
                <Txt x={spots[i].x + 9.5} y={spots[i].y + 10} className="key-label">
                  {b.label}
                </Txt>
              </g>
            )
          })}
        </BoxSym>
      )
      break
    }
    case 'bar': {
      const vs = ins()
      if (p.bus) {
        // One bus pin: the LEDs sit side by side.
        content = (
          <>
            <Stub pin={l.pins[0]} inner={edgePoint(l.pins[0], l)} />
            <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
            {vs.map((v, i) => (
              <rect key={i} x={6 + i * 10} y={l.h / 2 - 6} width={8} height={12} rx={2} className={v === 1 ? 'seg on' : 'seg'} />
            ))}
          </>
        )
        break
      }
      content = (
        <>
          {l.pins.map((q) => (
            <Stub key={q.name} pin={q} inner={edgePoint(q, l)} />
          ))}
          <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
          {l.pins.map((q, i) => (
            <rect key={q.name} x={8} y={q.y - 6} width={24} height={12} rx={2} className={vs[i] === 1 ? 'seg on' : 'seg'} />
          ))}
        </>
      )
      break
    }
    case 'alu': {
      const [s2, s1, s0] = ins().slice(8, 11)
      const op = s2 === X || s1 === X || s0 === X ? '?' : ALU_OPS[s2 * 4 + s1 * 2 + s0]
      content = <BoxSym l={l} title={live ? `ALU\n${op}` : 'ALU'} />
      break
    }
    case 'rom': {
      const abits = Number(p.abits)
      const dbits = Number(p.dbits)
      const addr = live ? toNum(ins(), 0, abits) : -1
      content = (
        <MemSym l={l} title={def.title!(p)} words={parseWords(String(p.data), 2 ** abits, dbits)} digits={dbits / 4} addr={addr} />
      )
      break
    }
    case 'ram': {
      const bits = Number(p.dbits)
      const abits = Number(p.abits) || 4
      const mem: number[] = (live && sim.state(comp.id)?.mem) || new Array(2 ** abits).fill(0)
      content = <MemSym l={l} title={def.title!(p)} words={mem} digits={bits / 4} addr={live ? toNum(ins(), bits + 2, abits) : -1} />
      break
    }
    case 'mux':
    case 'busmux':
    case 'demux':
      content = <MuxSym l={l} title={def.title!(p)} demux={comp.type === 'demux'} />
      break
    case 'busdisp': {
      const bits = Number(p.bits)
      const n = toNum(ins(), 0, bits)
      const text =
        n < 0 ? '?' : p.format === 'dec' ? String(n) : p.format === 'bin' ? n.toString(2).padStart(bits, '0') : n.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')
      content = (
        <>
          {l.pins.map((q) => (
            <Stub key={q.name} pin={q} inner={edgePoint(q, l)} />
          ))}
          <rect className="display-body" x={0} y={0} width={l.w} height={l.h} rx={4} />
          <Txt x={6} y={l.h / 2} anchor="start" className="pin-label display-label">
            A
          </Txt>
          <Txt x={l.w / 2 + 6} y={l.h / 2 + 1} className="bus-readout">
            {text}
          </Txt>
        </>
      )
      break
    }
    case 'tribuf': {
      // A bus of several bits is drawn as a box: its pins are buses.
      if (Number(p.bits) > 1) {
        content = <BoxSym l={l} title="TRI" />
        break
      }
      // A buffer triangle with its enable stub coming in from below.
      const { w, h } = l
      content = (
        <>
          <path className="sym-body" d={`M0,-4 L${w},${h / 2} L0,${h + 4} Z`} />
          <Stub pin={l.pins[0]} inner={{ x: 0, y: 10 }} />
          <Stub pin={l.pins[1]} inner={{ x: 20, y: 24 - (14 * 20) / w }} />
          <Stub pin={l.pins[2]} inner={{ x: w, y: 10 }} />
        </>
      )
      break
    }
    case 'busjoin': {
      // Warn when two or more drivers are active and the line came out unknown: contention.
      const n = Number(p.bits) || 1
      const vs = live ? ins() : []
      let clash = false
      for (let bit = 0; bit < n && live && !clash; bit++) {
        let active = 0
        for (let d = 0; d < Number(p.drivers); d++) if (vs[d * n + bit] !== Z) active++
        clash = active > 1 && val(n === 1 ? 'Y' : `Y${bit}`) === X
      }
      content = <BoxSym l={l} title="BUS" warn={clash} />
      break
    }
    default:
      content = <BoxSym l={l} title={def.title?.(p) ?? def.name} />
  }

  return <Orient.Provider value={{ rot: comp.rot, flip: comp.flip }}>{content}</Orient.Provider>
}
