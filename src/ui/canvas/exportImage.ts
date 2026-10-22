import { downloadBlob, downloadText } from '../../app/files'
import { showToast, useStore } from '../../app/store'
import { circuitRect } from '../../model/bounds'
import type { Rect } from '../../model/circuit'
import { canvasElement } from './viewport'

export type ExportArea = 'all' | 'view'
export type ExportFormat = 'svg' | 'png'

/** What is copied from the live style of each shape, so the file looks the same without this app's CSS. */
const STYLE_PROPS: [string, string][] = [
  ['fill', ''],
  ['fill-opacity', '1'],
  ['stroke', ''],
  ['stroke-width', ''],
  ['stroke-opacity', '1'],
  ['stroke-dasharray', 'none'],
  ['stroke-linecap', 'butt'],
  ['stroke-linejoin', 'miter'],
  ['opacity', '1'],
  ['font-family', ''],
  ['font-size', ''],
  ['font-weight', '400'],
  ['font-style', 'normal'],
  ['text-anchor', 'start'],
  ['dominant-baseline', 'auto'],
  ['text-decoration-line', 'none'],
  ['filter', 'none'],
]

/** Parts of the editing interface that don't belong in a picture of the circuit. */
const EDITING_ONLY = [
  '.sel-outline',
  '.rel-outline',
  '.wire-sel',
  '.wire-trace',
  '.trace-ring',
  '.wire-hit',
  '.layer-pins',
  '.layer-trace',
  '.marquee',
  '.ghost-comp',
  '.pin-target',
  '.resize-handle',
  '.wire.ghost',
]

const SHAPES = new Set(['path', 'rect', 'circle', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan'])

/** Copy the computed look of each shape in `live` onto the matching shape in `copy` (the two trees have the same shape). */
function inlineStyles(live: Element, copy: Element) {
  if (SHAPES.has(live.tagName)) {
    const cs = getComputedStyle(live)
    const style = (copy as SVGElement).style
    for (const [prop, normal] of STYLE_PROPS) {
      const v = cs.getPropertyValue(prop)
      if (v && v !== normal) style.setProperty(prop, v)
    }
  }
  for (let i = 0; i < live.children.length; i++) inlineStyles(live.children[i], copy.children[i])
}

/** The part of the world the canvas shows right now. */
function visibleRect(el: SVGSVGElement): Rect {
  const { view } = useStore.getState()
  const { width, height } = el.getBoundingClientRect()
  return { x: -view.x / view.zoom, y: -view.y / view.zoom, w: width / view.zoom, h: height / view.zoom }
}

/**
 * The circuit as a standalone SVG: as it looks now (wires in their current colours), without the selection, pins
 * and other editing marks. `area` is the whole circuit or what is on screen. Null if the canvas is not showing.
 */
export function buildSvg(area: ExportArea): { svg: string; width: number; height: number } | null {
  const el = canvasElement()
  const world = el?.querySelector<SVGGElement>(':scope > g')
  if (!el || !world) return null
  const rect = area === 'all' ? circuitRect(useStore.getState().circuit) : visibleRect(el)
  const width = Math.max(1, Math.round(rect.w))
  const height = Math.max(1, Math.round(rect.h))

  const copy = world.cloneNode(true) as SVGGElement
  inlineStyles(world, copy)
  copy.removeAttribute('transform') // the viewBox places the world, not the on-screen pan and zoom
  for (const selector of EDITING_ONLY) copy.querySelectorAll(selector).forEach((n) => n.remove())

  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('xmlns', NS)
  svg.setAttribute('viewBox', `${rect.x} ${rect.y} ${rect.w} ${rect.h}`)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  const title = document.createElementNS(NS, 'title')
  title.textContent = 'Sklopko circuit'
  const background = document.createElementNS(NS, 'rect')
  for (const [k, v] of Object.entries({ x: rect.x, y: rect.y, width: rect.w, height: rect.h })) background.setAttribute(k, String(v))
  background.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#ffffff')
  svg.append(title, background, copy)
  return { svg: new XMLSerializer().serializeToString(svg), width, height }
}

/** Draw an SVG into a PNG, twice as sharp as it is wide (but never more than 8000px a side). */
function svgToPng(svg: string, width: number, height: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const scale = Math.min(2, 8000 / Math.max(width, height))
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(resolve, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Save the circuit as a picture. */
export async function exportImage(format: ExportFormat, area: ExportArea) {
  const built = buildSvg(area)
  if (!built) return showToast('There is nothing to export yet.')
  if (format === 'svg') return downloadText('circuit.svg', built.svg, 'image/svg+xml')
  const png = await svgToPng(built.svg, built.width, built.height)
  if (png) downloadBlob('circuit.png', png)
  else showToast('The picture could not be made.')
}
