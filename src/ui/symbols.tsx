import { createContext, useContext, type ReactNode } from 'react'
import { SEG_HEX } from '../engine/components/io'
import { getDef } from '../engine/registry'
import { X, toNum, type Layout, type PinDef, type V } from '../engine/types'
import { sim } from '../app/sim'
import type { Comp } from '../model/circuit'

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

const vClass = (v: V) => (v === 1 ? 'v1' : v === 0 ? 'v0' : 'vx')

/** Line from the pin tip to the body edge (or to `inner`), with an inversion bubble if needed. */
function Stub({ pin, inner }: { pin: PinDef; inner: { x: number; y: number } }) {
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

function GateSym({ type, l }: { type: string; l: Layout }) {
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

function BoxSym({ l, title, children }: { l: Layout; title?: string; children?: ReactNode }) {
  return (
    <>
      {l.pins.map((p) => (
        <Stub key={p.name} pin={p} inner={edgePoint(p, l)} />
      ))}
      <rect className="sym-body" x={0} y={0} width={l.w} height={l.h} rx={3} />
      <ClockMarks l={l} />
      <PinLabels l={l} />
      {title && <Title text={title} x={l.w / 2} y={l.h / 2} />}
      {children}
    </>
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

const LED_COLORS: Record<string, string> = {
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#facc15',
  blue: '#3b82f6',
  white: '#f1f5f9',
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
      const v = val('A')
      const color = LED_COLORS[String(p.color)] ?? LED_COLORS.green
      content = (
        <>
          <Stub pin={l.pins[0]} inner={{ x: 0, y: 10 }} />
          {v === 1 && <circle cx={10} cy={10} r={14} fill={color} opacity={0.25} />}
          <circle
            cx={10}
            cy={10}
            r={10}
            className={`led ${v === X ? 'led-x' : ''}`}
            fill={color}
            fillOpacity={v === 1 ? 1 : 0.16}
          />
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
    case 'bar': {
      const vs = ins()
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
    case 'mux':
    case 'demux':
      content = <MuxSym l={l} title={def.title!(p)} demux={comp.type === 'demux'} />
      break
    default:
      content = <BoxSym l={l} title={def.title?.(p) ?? def.name} />
  }

  return <Orient.Provider value={{ rot: comp.rot, flip: comp.flip }}>{content}</Orient.Provider>
}
