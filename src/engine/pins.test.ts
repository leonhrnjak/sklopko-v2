import { describe, expect, it } from 'vitest'
import { pinKey, pinRows } from './pindocs'
import { DEFS } from './registry'
import { paramDefaults, type ComponentDef, type Params } from './types'
import { viewLayoutOf } from './viewlayout'

/** The default params, and each select option, each switch, and each number at its smallest and largest, changed on its own, so every shape of a part is looked at. */
function variants(def: ComponentDef): Params[] {
  const base = paramDefaults(def)
  const out: Params[] = [base]
  for (const d of def.params ?? []) {
    if (d.kind === 'select') for (const o of d.options!) out.push({ ...base, [d.key]: o.value })
    if (d.kind === 'number') for (const v of [d.min, d.max]) if (v !== undefined) out.push({ ...base, [d.key]: v })
    if (d.kind === 'bool') out.push({ ...base, [d.key]: !base[d.key] })
  }
  return out
}

// A custom IC lists its own pins, and notes and frames have none.
const SKIP = new Set(['ic', 'note', 'frame'])

describe('pin documentation', () => {
  for (const def of DEFS.filter((d) => !SKIP.has(d.type))) {
    it(`${def.type} says what every pin does, and has no text for a pin it lacks`, () => {
      const used = new Set<string>()
      for (const p of variants(def)) {
        for (const pin of viewLayoutOf(def.type, p).pins) {
          const k = pinKey(def, pin.name)
          expect(k, `${def.type} pin ${pin.name} (${JSON.stringify(p)})`).toBeDefined()
          used.add(k!.key)
        }
        for (const r of pinRows(def, p)) expect(r.text.trim().length, `${def.type} ${r.names}`).toBeGreaterThan(8)
      }
      expect(Object.keys(def.pins ?? {}).filter((k) => !used.has(k)), `${def.type}: keys that match no pin`).toEqual([])
    })
  }
})
