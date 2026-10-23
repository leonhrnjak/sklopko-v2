import { getDef } from '../engine/registry'
import { MAX_DELAY } from '../engine/simulator'
import type { Category } from '../engine/types'
import { isAnnotation, compLayout, type Comp } from './circuit'
import { isLabel } from './labels'

export { MAX_DELAY }

/** Does a part have a propagation delay worth setting? Not inputs, clocks, labels, notes or parts without outputs. */
export function hasDelay(k: Comp): boolean {
  if (isAnnotation(k) || isLabel(k.type)) return false
  const def = getDef(k.type)
  if (def.interactive || def.clockHalfPeriod || k.type === 'const') return false
  return compLayout(k).pins.some((p) => p.dir === 'out')
}

/** Gate delays that make a circuit behave a little like real chips: inverters are fast, XOR and big blocks are slow. */
const BY_TYPE: Record<string, number> = {
  not: 1,
  buf: 2,
  nand: 2,
  nor: 2,
  and: 3,
  or: 3,
  xor: 4,
  xnor: 4,
  halfadd: 4,
  halfsub: 4,
  fulladd: 6,
  fullsub: 6,
  add4: 10,
  sub4: 10,
  addsub4: 12,
  cmp4: 8,
  mul: 12,
  alu: 12,
  mux: 3,
  tribuf: 2,
  busjoin: 1,
  demux: 3,
  decoder: 3,
  rom: 6,
  ram: 6,
  lut: 4,
}
const BY_CATEGORY: Partial<Record<Category, number>> = { sequential: 3, arithmetic: 6, memory: 6, routing: 3, coding: 4, display: 1 }

/** The "realistic" delay for a part, in gate delays. */
export function realisticDelay(k: Comp): number {
  return Math.min(MAX_DELAY, BY_TYPE[k.type] ?? BY_CATEGORY[getDef(k.type).category] ?? 1)
}
