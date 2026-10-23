import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFS } from '../engine/registry'
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
