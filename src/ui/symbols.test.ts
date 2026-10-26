import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFS } from '../engine/registry'
import { icParams } from '../model/ic'
import { paramDefaults, type Params } from '../engine/types'
import { viewLayoutOf } from '../engine/viewlayout'
import type { Comp } from '../model/circuit'
import { CompSymbol } from './symbols'

/** Every way of setting one param of a part, the others at their defaults (and the bus mode both ways where it has one). */
function variants(type: string): Params[] {
  const def = DEFS.find((d) => d.type === type)!
  const base = paramDefaults(def)
  const out: Params[] = [base]
  for (const p of def.params ?? []) {
    const values = p.kind === 'select' ? (p.options ?? []).map((o) => o.value) : p.kind === 'number' ? [p.min!, p.max!] : p.kind === 'bool' ? [true, false] : []
    for (const v of values) out.push({ ...base, [p.key]: v })
  }
  return out
}

describe('symbols', () => {
  it('draw for every part, in every mode and with every setting', () => {
    for (const def of DEFS)
      for (const params of variants(def.type)) {
        const where = `${def.type} ${JSON.stringify(params)}`
        const comp: Comp = { id: 'c', type: def.type, x: 0, y: 0, rot: 0, flip: false, params }
        const layout = viewLayoutOf(def.type, params)
        const html = renderToStaticMarkup(createElement('svg', null, createElement(CompSymbol, { comp, layout, live: false })))
        expect(html.length, where).toBeGreaterThan(20)
        expect(html, where).not.toContain('NaN')
        expect(html, where).not.toContain('undefined')
      }
  })
})

describe('a custom IC', () => {
  const draw = (symbol?: 'and' | 'not', live = false) => {
    const circuit = { comps: {}, wires: {} }
    const params = icParams({ id: 'c', name: 'Chip', circuit, symbol })
    const inputs = symbol === 'not' ? 'A:1' : 'A:1,B:1'
    const p = { ...params, ins: inputs, outs: 'Y:1', ...(symbol ? { symbol } : {}) }
    const comp: Comp = { id: 'c', type: 'ic', x: 0, y: 0, rot: 0, flip: false, params: p }
    return renderToStaticMarkup(createElement('svg', null, createElement(CompSymbol, { comp, layout: viewLayoutOf('ic', p), live })))
  }

  it('is drawn as the gate it is, in a chip frame with its name on a tab, when it has a symbol; else as a box', () => {
    const gate = draw('and', true)
    expect(gate).toContain('ic-gate')
    expect(gate).toContain('chip-body')
    expect(gate).toContain('Chip') // the name on the tab
    // The glyph on the tab opens the chip: only where the part is live (not in the parts list or on a ghost).
    expect(gate).toContain('<title>Chip</title>') // the whole name, as a tooltip
    expect(gate).toContain('chip-open')
    expect(draw('and')).not.toContain('chip-open')
    expect(draw('and')).toContain('chip-glyph')
    expect(gate).toContain('<path')
    expect(gate).not.toContain('NaN')
    expect(draw('not')).toContain('ic-gate')
    const box = draw()
    expect(box).not.toContain('ic-gate')
    expect(box).toContain('<rect')
  })
})

