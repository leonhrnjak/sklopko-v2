import { memo, useMemo } from 'react'
import { getDef } from '../../engine/registry'
import { useCompSignature, usePinValue } from '../../app/hooks'
import { boundsRect, compLayout, findPin, labelAnchor, worldPins, type Comp, type Point, type Wire } from '../../model/circuit'
import type { Circuit } from '../../model/circuit'
import { hopArcsD, hopPathD, junctions } from '../../routing/path'
import { CompSymbol } from '../symbols'
import { compTransform } from '../transform'

const LIVE_CATEGORIES = new Set(['io', 'display'])

export const ComponentView = memo(function ComponentView({
  comp,
  selected,
  related = false,
}: {
  comp: Comp
  selected: boolean
  /** Another net label with the same name as the selected one. */
  related?: boolean
}) {
  const def = getDef(comp.type)
  const l = compLayout(comp)
  // Only parts that show their values need to re-render while the simulation runs.
  useCompSignature(comp.id, LIVE_CATEGORIES.has(def.category) || !!def.live || comp.type === 'button')
  const b = boundsRect(comp)
  const label = labelAnchor(comp)
  return (
    <g
      className={`comp${def.interactive ? ' interactive' : ''}${selected ? ' selected' : ''}${comp.type === 'frame' ? ' frame' : ''}`}
      data-kind="comp"
      data-id={comp.id}
    >
      {selected && <rect className="sel-outline" x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx={4} />}
      {related && !selected && <rect className="rel-outline" x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx={4} />}
      <g transform={compTransform(comp, l)}>
        <CompSymbol comp={comp} layout={l} live />
      </g>
      {selected && comp.type === 'frame' && (
        <rect className="resize-handle" data-kind="resize" data-id={comp.id} x={b.x + b.w - 8} y={b.y + b.h - 8} width={14} height={14} rx={3}>
          <title>Drag to resize</title>
        </rect>
      )}
      {comp.label && (
        <text className="comp-label" x={label.x} y={label.y} textAnchor="middle">
          {comp.label}
        </text>
      )}
    </g>
  )
})

export const PinsView = memo(function PinsView({ comp, r }: { comp: Comp; r: number }) {
  return (
    <>
      {worldPins(comp).map((p) => (
        <circle
          key={p.def.name}
          className="pin"
          cx={p.pos.x}
          cy={p.pos.y}
          r={r}
          data-kind="pin"
          data-comp={comp.id}
          data-pin={p.def.name}
          data-dir={p.def.dir}
        >
          <title>{p.def.label?.replace('~', 'not ') || p.def.name}</title>
        </circle>
      ))}
    </>
  )
})

const pathD = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')

const valueClass = (v: number) => (v === 1 ? 'v1' : v === 0 ? 'v0' : 'vx')

interface WireViewProps {
  wire: Wire
  selected: boolean
  /** Crossing points where this wire hops over another. */
  hops?: Point[]
  /** Part of the signal being traced (`net`), or of the logic feeding it (`cone`). */
  traced?: 'net' | 'cone'
}

const sameHops = (a?: Point[], b?: Point[]) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y))

export const WireView = memo(function WireView({ wire, selected, hops, traced }: WireViewProps) {
  const v = usePinValue(wire.from.comp, wire.from.pin)
  const d = hopPathD(wire.path, hops)
  return (
    <g data-kind="wire" data-id={wire.id} className={selected ? 'wire-group selected' : 'wire-group'}>
      {traced && <path className={`wire-trace ${traced}`} d={d} />}
      {selected && <path className="wire-sel" d={d} />}
      <path className={`wire ${valueClass(v)}`} d={d} />
      {wire.path.slice(1).map((b, i) => {
        const a = wire.path[i]
        return (
          <line
            key={i}
            className={`wire-hit ${a.y === b.y ? 'h' : 'v'}`}
            data-seg={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          />
        )
      })}
    </g>
  )
}, (a, b) => a.wire === b.wire && a.selected === b.selected && a.traced === b.traced && sameHops(a.hops, b.hops))

/** The bridges of one wire, in the wire's colour. */
const HopArc = memo(
  function HopArc({ wire, hops }: { wire: Wire; hops: Point[] }) {
    const v = usePinValue(wire.from.comp, wire.from.pin)
    return <path className={`wire ${valueClass(v)}`} d={hopArcsD(hops)} />
  },
  (a, b) => a.wire.from === b.wire.from && sameHops(a.hops, b.hops),
)

/** All bridges, drawn above every wire so a hop is never hidden by the wire it passes over. */
export function HopArcs({ wires, hops, hidden }: { wires: Record<string, Wire>; hops: Map<string, Point[]>; hidden?: string | null }) {
  return (
    <>
      {Object.values(wires).map((w) => {
        const h = hops.get(w.id)
        return h && w.id !== hidden ? <HopArc key={w.id} wire={w} hops={h} /> : null
      })}
    </>
  )
}

/** Preview of a wire being edited or drawn (no simulator value). */
export function GhostWire({ path, ok }: { path: Point[]; ok?: boolean }) {
  return <path className={`wire ghost${ok ? ' ok' : ''}`} d={pathD(path)} />
}

const JunctionDot = memo(function JunctionDot({ net, p }: { net: string; p: Point }) {
  const [comp, pin] = net.split(':')
  const v = usePinValue(comp, pin)
  return <circle className={`junction ${valueClass(v)}`} cx={p.x} cy={p.y} r={3.5} />
})

export const Junctions = memo(function Junctions({ wires }: { wires: Record<string, Wire> }) {
  const dots = useMemo(() => junctions(Object.values(wires)), [wires])
  return (
    <>
      {dots.map((j) => (
        <JunctionDot key={`${j.net}@${j.p.x},${j.p.y}`} net={j.net} p={j.p} />
      ))}
    </>
  )
})

/** Rings round the pins a traced signal reaches; the part that drives it gets a filled one. */
export function TraceRings({ circuit, pins, source }: { circuit: Circuit; pins: Set<string>; source: string | null }) {
  return (
    <>
      {[...pins].map((k) => {
        const [comp, pin] = k.split(':')
        const p = circuit.comps[comp] && findPin(circuit.comps[comp], pin)
        return p ? <circle key={k} className={`trace-ring${k === source ? ' source' : ''}`} cx={p.pos.x} cy={p.pos.y} r={7} /> : null
      })}
    </>
  )
}
