import { memo, useMemo } from 'react'
import { getDef } from '../../engine/registry'
import { useCompSignature, usePinValue } from '../../app/hooks'
import { boundsRect, compLayout, labelAnchor, worldPins, type Comp, type Point, type Wire } from '../../model/circuit'
import { hopArcsD, hopPathD, junctions } from '../../routing/path'
import { CompSymbol } from '../symbols'
import { compTransform } from '../transform'

const LIVE_CATEGORIES = new Set(['io', 'display'])

export const ComponentView = memo(function ComponentView({ comp, selected }: { comp: Comp; selected: boolean }) {
  const def = getDef(comp.type)
  const l = compLayout(comp)
  // Only parts that show their values need to re-render while the simulation runs.
  useCompSignature(comp.id, LIVE_CATEGORIES.has(def.category) || !!def.live || comp.type === 'button')
  const b = boundsRect(comp)
  const label = labelAnchor(comp)
  return (
    <g
      className={`comp${def.interactive ? ' interactive' : ''}${selected ? ' selected' : ''}`}
      data-kind="comp"
      data-id={comp.id}
    >
      {selected && <rect className="sel-outline" x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx={4} />}
      <g transform={compTransform(comp, l)}>
        <CompSymbol comp={comp} layout={l} live />
      </g>
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
}

const sameHops = (a?: Point[], b?: Point[]) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y))

export const WireView = memo(function WireView({ wire, selected, hops }: WireViewProps) {
  const v = usePinValue(wire.from.comp, wire.from.pin)
  const d = hopPathD(wire.path, hops)
  return (
    <g data-kind="wire" data-id={wire.id} className={selected ? 'wire-group selected' : 'wire-group'}>
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
}, (a, b) => a.wire === b.wire && a.selected === b.selected && sameHops(a.hops, b.hops))

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
