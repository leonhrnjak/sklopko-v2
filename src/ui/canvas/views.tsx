import { memo, useMemo } from 'react'
import { getDef } from '../../engine/registry'
import { useCompSignature, useSignal } from '../../app/hooks'
import type { BitSource } from '../../model/buses'
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
          <title>{(p.def.label?.replace('~', 'not ') || p.def.name) + (p.def.bus ? ` (${p.def.bus}-bit bus)` : '')}</title>
        </circle>
      ))}
    </>
  )
})

const pathD = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')

interface WireViewProps {
  wire: Wire
  /** What drives each bit of the wire (see `BusModel.bits`): one entry for an ordinary wire, more for a bus. */
  bits: BitSource[]
  selected: boolean
  /** Crossing points where this wire hops over another. */
  hops?: Point[]
  /** Part of the signal being traced (`net`), of the logic feeding it (`cone`), or of the slowest path (`path`). */
  traced?: 'net' | 'cone' | 'path' | 'glitch'
}

const sameHops = (a?: Point[], b?: Point[]) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y))

const sameBits = (a: BitSource[], b: BitSource[]) =>
  a === b || (a.length === b.length && a.every((p, i) => p?.comp === b[i]?.comp && p?.pin === b[i]?.pin))

/** The tooltip of a bus wire: how wide it is and what it carries. */
const busTitle = (n: number, hex: string) => `${n}-bit bus: ${hex ? `0x${hex}` : '?'}`

export const WireView = memo(function WireView({ wire, bits, selected, hops, traced }: WireViewProps) {
  const sig = useSignal(bits)
  const bus = bits.length > 1
  const d = hopPathD(wire.path, hops)
  return (
    <g data-kind="wire" data-id={wire.id} className={selected ? 'wire-group selected' : 'wire-group'}>
      {traced && <path className={`wire-trace ${traced}`} d={d} />}
      {selected && <path className="wire-sel" d={d} />}
      <path className={`wire${bus ? ' bus' : ''} ${sig.cls}`} d={d} />
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
          >
            {bus && <title>{busTitle(bits.length, sig.hex)}</title>}
          </line>
        )
      })}
    </g>
  )
}, (a, b) => a.wire === b.wire && sameBits(a.bits, b.bits) && a.selected === b.selected && a.traced === b.traced && sameHops(a.hops, b.hops))

/** The bridges of one wire, in the wire's colour. */
const HopArc = memo(
  function HopArc({ bits, hops }: { bits: BitSource[]; hops: Point[] }) {
    const sig = useSignal(bits)
    return <path className={`wire${bits.length > 1 ? ' bus' : ''} ${sig.cls}`} d={hopArcsD(hops)} />
  },
  (a, b) => sameBits(a.bits, b.bits) && sameHops(a.hops, b.hops),
)

/** All bridges, drawn above every wire so a hop is never hidden by the wire it passes over. */
export function HopArcs({
  wires,
  bits,
  hops,
  hidden,
}: {
  wires: Record<string, Wire>
  bits: Map<string, BitSource[]>
  hops: Map<string, Point[]>
  hidden?: string | null
}) {
  return (
    <>
      {Object.values(wires).map((w) => {
        const h = hops.get(w.id)
        const b = bits.get(w.id)
        return h && b && w.id !== hidden ? <HopArc key={w.id} bits={b} hops={h} /> : null
      })}
    </>
  )
}

/** Preview of a wire being edited or drawn (no simulator value). */
export function GhostWire({ path, ok }: { path: Point[]; ok?: boolean }) {
  return <path className={`wire ghost${ok ? ' ok' : ''}`} d={pathD(path)} />
}

const JunctionDot = memo(function JunctionDot({ bits, p }: { bits: BitSource[]; p: Point }) {
  const sig = useSignal(bits)
  return <circle className={`junction ${sig.cls}`} cx={p.x} cy={p.y} r={bits.length > 1 ? 5 : 3.5} />
})

export const Junctions = memo(function Junctions({ wires, nets }: { wires: Record<string, Wire>; nets: Map<string, BitSource[]> }) {
  const dots = useMemo(() => junctions(Object.values(wires)), [wires])
  return (
    <>
      {dots.map((j) => {
        const b = nets.get(j.net)
        return b ? <JunctionDot key={`${j.net}@${j.p.x},${j.p.y}`} bits={b} p={j.p} /> : null
      })}
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
