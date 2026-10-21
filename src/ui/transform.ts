import type { Layout } from '../engine/types'
import type { Comp } from '../model/circuit'

/** SVG transform placing a component's local coordinates in the world. */
export function compTransform(comp: Comp, l: Layout) {
  return `translate(${comp.x} ${comp.y}) rotate(${comp.rot * 90})${comp.flip ? ` translate(${l.w} 0) scale(-1 1)` : ''}`
}
