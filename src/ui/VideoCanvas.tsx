import { useEffect, useRef } from 'react'
import { VIDEO_H, VIDEO_W, type VideoState } from '../engine/components/video'
import { videoPixels } from '../engine/videopalette'

/** The shortest time between two pictures: 30 a second. */
const FRAME_MS = 1000 / 30

/** The video chip's picture on a canvas of its own pixels (scaled by CSS), redrawn in one pass whenever the chip's picture changed. */
export function VideoCanvas({ st, width, height }: { st: VideoState | undefined; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const rev = st?.rev
  const last = useRef(0)
  useEffect(() => {
    const draw = () => {
      const ctx = ref.current?.getContext('2d')
      if (!ctx || !st) return
      last.current = performance.now()
      const image = ctx.createImageData(VIDEO_W, VIDEO_H)
      videoPixels(st.px, new Uint32Array(image.data.buffer))
      ctx.putImageData(image, 0, 0)
    }
    // At most 30 pictures a second: a change that comes sooner waits for the rest of the frame.
    const wait = last.current + FRAME_MS - performance.now()
    if (wait <= 0) {
      draw()
      return
    }
    const timer = window.setTimeout(draw, wait)
    return () => window.clearTimeout(timer)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [rev])
  return <canvas ref={ref} className="video-canvas" width={VIDEO_W} height={VIDEO_H} style={{ width, height }} aria-label="Video output" />
}
