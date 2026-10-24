import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from './builder'
import { emptyCircuit } from './circuit'
import { EXAMPLES } from './examples'
import { thumbnailSvg } from './thumbnail'

describe('thumbnailSvg', () => {
  it('draws an empty circuit as an empty picture', () => {
    const svg = thumbnailSvg(emptyCircuit())
    expect(svg).toMatch(/^<svg [^>]*viewBox="-12 -12 24 24"/)
    expect(svg).not.toContain('<path')
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('draws parts as boxes and wires as lines, and displays dark', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const led = b.add('led', 120, 0)
    const seg = b.add('seg7', 240, 0)
    b.wire(`${sw}.Q`, `${led}.A`)
    const svg = thumbnailSvg(b.build())
    expect(svg).toContain('<path d="M')
    expect(svg.match(/<rect /g)).toHaveLength(1 + 3) // the background and three parts
    expect(svg).toContain('fill="#23272e"')
    expect(seg).toBeTruthy()
  })

  it('has no text and nothing active, so it is safe to show as an image', () => {
    for (const ex of EXAMPLES.slice(0, 8)) {
      const svg = thumbnailSvg(ex.build())
      expect(svg).not.toMatch(/<text|<script|onload|href/i)
    }
  })

  it('is the same every time', () => {
    const c = EXAMPLES[0].build()
    expect(thumbnailSvg(c)).toBe(thumbnailSvg(c))
  })
})
