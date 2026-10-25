import { useStore } from '../app/store'
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, zoomBy, zoomTo } from './canvas/viewport'

/** Zoom out, the zoom now (click it for 100%) and zoom in, in a corner of the canvas. The wheel, pinch and +/- keys do the same. */
export function ZoomControls() {
  const zoom = useStore((s) => s.view.zoom)
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM + 1e-6} aria-label="Zoom out" title="Zoom out (−)">
        −
      </button>
      <button className="zoom-level" onClick={() => zoomTo(1)} aria-label={`Zoom ${Math.round(zoom * 100)}%, click for 100%`} title="Back to 100%" data-testid="zoom-level">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM - 1e-6} aria-label="Zoom in" title="Zoom in (+)">
        +
      </button>
    </div>
  )
}
