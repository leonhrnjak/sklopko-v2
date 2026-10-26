import { createPortal } from 'react-dom'
import { useSpot } from '../../app/pathSpot'
import { useStore } from '../../app/store'
import { boundsRect } from '../../model/circuit'

const PAD = 8

/** The outline of the part a lesson is pointing at, and the dimming round it after a click. Drawn over the canvas. */
export function Spotlight() {
  const hover = useSpot((s) => s.hover)
  const focus = useSpot((s) => s.focus)
  const circuit = useStore((s) => s.circuit)
  const view = useStore((s) => s.view)
  const host = document.querySelector('.stage-view')
  const label = focus ?? hover
  if (!host || !label) return null
  const rects = Object.values(circuit.comps)
    .filter((k) => k.label === label)
    .map((k) => {
      const b = boundsRect(k)
      return { x: b.x * view.zoom + view.x - PAD, y: b.y * view.zoom + view.y - PAD, w: b.w * view.zoom + 2 * PAD, h: b.h * view.zoom + 2 * PAD }
    })
  if (!rects.length) return null
  return createPortal(
    <svg className="spot-layer" aria-hidden data-testid="spotlight" data-label={label} data-dim={focus ? 'on' : 'off'}>
      {focus && (
        <>
          <defs>
            <mask id="spot-hole">
              <rect width="100%" height="100%" fill="white" />
              {rects.map((r, i) => (
                <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={8} fill="black" />
              ))}
            </mask>
          </defs>
          <rect className="spot-dim" width="100%" height="100%" mask="url(#spot-hole)" />
        </>
      )}
      {rects.map((r, i) => (
        <rect key={i} className="spot-ring" x={r.x} y={r.y} width={r.w} height={r.h} rx={8} />
      ))}
    </svg>,
    host,
  )
}
