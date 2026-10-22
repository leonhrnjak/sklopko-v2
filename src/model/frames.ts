import { boundsRect, isFrame, type Circuit, type Rect } from './circuit'

/** Is `inner` wholly within `outer`? */
export const isInside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

/**
 * The parts that sit inside a frame: those whose whole area (body and pin tips) lies within it. Frames inside it count
 * too, with what they hold. The frame itself does not.
 */
export function contentsOf(c: Circuit, frameId: string): string[] {
  const frame = c.comps[frameId]
  if (!frame || !isFrame(frame)) return []
  const area = boundsRect(frame)
  return Object.values(c.comps)
    .filter((k) => k.id !== frameId && isInside(boundsRect(k), area))
    .map((k) => k.id)
}

/** `ids` plus whatever sits inside the frames among them: what moves when a frame is dragged. */
export function withFrameContents(c: Circuit, ids: string[]): string[] {
  const all = new Set(ids)
  for (const id of ids) for (const inner of contentsOf(c, id)) all.add(inner)
  return [...all]
}
