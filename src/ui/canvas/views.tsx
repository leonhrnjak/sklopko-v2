import { memo, useMemo } from 'react'
import { getDef } from '../../engine/registry'
import { useCompSignature, usePinValue } from '../../app/hooks'
import { boundsRect, compLayout, worldPins, type Comp, type Point, type Wire } from '../../model/circuit'
import { junctions } from '../../routing/path'
import { CompSymbol } from '../symbols'
import { compTransform } from '../transform'

const LIVE_CATEGORIES = new Set(['io', 'display'])

export const ComponentView = memo(function ComponentView({ comp, selected }: { comp: Comp; selected: boolean }) {
  const def = getDef(comp.type)
  const l = compLayout(comp)
  // Only parts that show their values need to re-render while the simulation runs.
  useCompSignature(comp.id, LIVE_CATEGORIES.has(def.category) || comp.type === 'button')
  const b = boundsRect(comp)
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
        <text className="comp-label" x={b.x + b.w / 2} y={b.y - 8} textAnchor="middle">
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

export const WireView = memo(function WireView({ wire, selected }: { wire: Wire; selected: boolean }) {
  const v = usePinValue(wire.from.comp, wire.from.pin)
  const d = pathD(wire.path)
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
})

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
