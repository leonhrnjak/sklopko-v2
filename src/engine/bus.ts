import { RECV, SEND } from './netlabels'
import type { ComponentDef, ParamDef, Params, PinDef, PinGroup } from './types'

/**
 * Bus mode. A part with `groups` can show some of its scalar pins as one bus pin each: the model, the router and the
 * canvas use that view (`viewLayoutOf`); the simulator keeps the scalar layout, and `flatten` (model/buses.ts) turns
 * every bus wire into one wire per bit before it loads a circuit.
 */

/** The param that switches bus mode on for the existing parts. Placed now: on. Saved files without it: off. */
export const BUS_PARAM: ParamDef = { key: 'bus', label: 'Bus ports', kind: 'bool', default: true, legacy: false, structural: true }

/** Give a part a bus mode: the `bus` param, and the groups its bus mode draws. */
export function withBus(def: ComponentDef, groups: (p: Params) => PinGroup[]): ComponentDef {
  return { ...def, params: [...(def.params ?? []), BUS_PARAM], groups }
}

/** The bits of a bus pin (1 for an ordinary pin). */
export const pinWidth = (p: Pick<PinDef, 'bus'>) => p.bus ?? 1

const hasBusParam = (def: ComponentDef) => !!def.params?.some((p) => p.key === BUS_PARAM.key)

/** The groups a part shows as bus pins right now: none unless it has groups and bus mode is on. */
export function groupsOf(def: ComponentDef, params: Params): PinGroup[] {
  if (!def.groups) return []
  if (hasBusParam(def) && !params.bus) return []
  return def.groups(params)
}

/** Net labels of more than one bit are wiring too (they carry a bus by name, with nothing simulated). */
export const isBusLabel = (type: string, params: Params) => (type === SEND || type === RECV) && Number(params.bits ?? 1) > 1

/** How the bits of a splitter or merger divide: `split` like "4,4", or one bit each when it doesn't add up to `bits`. */
export function splitWidths(p: Params): number[] {
  const bits = Number(p.bits)
  const parts = String(p.split ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
  const ok = parts.length > 0 && parts.every((n) => Number.isInteger(n) && n >= 1) && parts.reduce((a, b) => a + b, 0) === bits
  return ok ? parts : Array.from({ length: bits }, () => 1)
}

/** Where each piece of a splitter or merger starts (bit offsets). */
export function splitOffsets(p: Params): number[] {
  let at = 0
  return splitWidths(p).map((w) => {
    const o = at
    at += w
    return o
  })
}
