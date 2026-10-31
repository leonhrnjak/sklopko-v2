import { describe, expect, it } from 'vitest'
import { DEFS } from './registry'
import { layoutOf } from './layoutcache'
import type { ComponentDef, Params, V } from './types'

/** A small deterministic random generator (mulberry32). */
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The default params, and each param with a choice set to each of its values, one at a time. */
function variants(def: ComponentDef): Params[] {
  const base: Params = {}
  for (const p of def.params ?? []) base[p.key] = p.default
  const out: Params[] = [base]
  for (const p of def.params ?? []) {
    const values: (string | number | boolean)[] =
      p.kind === 'select' ? (p.options ?? []).map((o) => o.value) : p.key === 'bits' || p.key === 'n' ? Array.from({ length: (p.max ?? 16) - (p.min ?? 2) + 1 }, (_, i) => (p.min ?? 2) + i) : []
    for (const v of values) if (v !== p.default) out.push({ ...base, [p.key]: v })
  }
  return out
}

const draw = (r: () => number, acceptsZ: boolean): V => {
  const x = r()
  if (x < 0.08) return 2
  if (x < 0.1) return acceptsZ ? 3 : 2
  return x < 0.55 ? 0 : 1
}

function make(def: ComponentDef, params: Params) {
  const pins = layoutOf(def.type, params).pins
  const ins = pins.filter((p) => p.dir === 'in')
  const outs = pins.filter((p) => p.dir === 'out')
  return {
    clock: ins.map((p) => !!p.clock),
    names: ins.map((p) => p.name),
    mk: () => ({ ins: new Array<V>(ins.length).fill(2), outs: new Array<V>(outs.length).fill(2), state: def.init?.(params), params }),
  }
}

describe('timing classes (docs/spec-sim-speed-tier2.md)', () => {
  it('every part type has one', () => {
    expect(DEFS.filter((d) => !d.timing).map((d) => d.type)).toEqual([])
  })

  for (const def of DEFS.filter((d) => d.timing === 'registered')) {
    it(`${def.type} is registered: with its clock and its immediate inputs (${(def.immediateIns ?? []).join(' ') || 'none'}) still, nothing else changes the outputs`, () => {
      const r = rng(def.type.length * 31 + def.type.charCodeAt(0))
      for (const params of variants(def)) {
        const { clock, names, mk } = make(def, params)
        const hold = clock.map((c, i) => c || (def.immediateIns ?? []).includes(names[i]))
        expect(clock.some(Boolean), `${def.type} has a clock pin`).toBe(true)
        for (let run = 0; run < 12; run++) {
          const inst = mk()
          const zOk = !!def.acceptsZ
          // Get the part into some state: a few clocked steps with random inputs.
          for (let step = 0; step < 6; step++) {
            for (let i = 0; i < inst.ins.length; i++) inst.ins[i] = draw(r, zOk)
            def.evaluate(inst)
          }
          // Now hold the clock and the immediate pins still and change everything else.
          for (let i = 0; i < inst.ins.length; i++) if (hold[i]) inst.ins[i] = inst.ins[i] > 1 ? 0 : inst.ins[i]
          def.evaluate(inst)
          const before = inst.outs.join('')
          for (let step = 0; step < 20; step++) {
            for (let i = 0; i < inst.ins.length; i++) if (!hold[i]) inst.ins[i] = draw(r, zOk)
            def.evaluate(inst)
            expect(inst.outs.join(''), `${def.type} ${JSON.stringify(params)} run ${run} step ${step}`).toBe(before)
          }
        }
      }
    })
  }

  for (const def of DEFS.filter((d) => d.timing === 'comb')) {
    it(`${def.type} is combinational: its outputs depend on the inputs now, not on what came before`, () => {
      const r = rng(def.type.length * 17 + def.type.charCodeAt(0))
      for (const params of variants(def)) {
        const { mk } = make(def, params)
        const history = mk()
        const zOk = !!def.acceptsZ
        for (let step = 0; step < 60; step++) {
          for (let i = 0; i < history.ins.length; i++) history.ins[i] = draw(r, zOk)
          def.evaluate(history)
          const fresh = mk()
          fresh.ins = [...history.ins]
          def.evaluate(fresh)
          expect(history.outs.join(''), `${def.type} ${JSON.stringify(params)} step ${step} ins ${history.ins.join('')}`).toBe(fresh.outs.join(''))
        }
      }
    })
  }
})
