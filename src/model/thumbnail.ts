import { getDef, hasDef } from '../engine/registry'
import { bodyRect, isAnnotation, isFrame, type Circuit } from './circuit'
import { circuitRect } from './bounds'

/** A thumbnail is drawn at this width on screen, so line widths are chosen to look about this thick there. */
const SHOWN_WIDTH = 160
const BACKGROUND = '#f6f6f3'

const n = (v: number) => String(Math.round(v))

/**
 * A small picture of a circuit as SVG text: parts as boxes (displays dark), wires as thin lines, frames outlined. It uses fixed
 * colours, because it is shown as an image and not inside the page, and no text, so it stays small.
 */
export function thumbnailSvg(c: Circuit): string {
  const r = circuitRect(c, 12)
  const unit = Math.max(1, r.w) / SHOWN_WIDTH // one screen pixel, in circuit units
  const sw = (px: number) => (Math.round(px * unit * 10) / 10).toString()
  let frames = ''
  let parts = ''
  let screens = ''
  for (const k of Object.values(c.comps)) {
    if (!hasDef(k.type)) continue
    const b = bodyRect(k)
    const rect = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"/>`
    if (isFrame(k)) frames += rect
    else if (isAnnotation(k)) continue
    else if (getDef(k.type).category === 'display') screens += rect
    else parts += rect
  }
  let wires = ''
  for (const w of Object.values(c.wires)) {
    if (w.path.length > 1) wires += w.path.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('')
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)}" preserveAspectRatio="xMidYMid meet">` +
    `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="${BACKGROUND}"/>` +
    (frames ? `<g fill="none" stroke="#b9b9b2" stroke-width="${sw(1)}" stroke-dasharray="${sw(4)} ${sw(3)}">${frames}</g>` : '') +
    (wires ? `<path d="${wires}" fill="none" stroke="#4f9a6b" stroke-width="${sw(1)}" stroke-linejoin="round"/>` : '') +
    (parts ? `<g fill="#ffffff" stroke="#6d6d66" stroke-width="${sw(1)}">${parts}</g>` : '') +
    (screens ? `<g fill="#23272e" stroke="#23272e" stroke-width="${sw(1)}">${screens}</g>` : '') +
    `</svg>`
  )
}
