import { numbered } from '../../../bus'
import { box, names } from '../../../layouts'
import { X, Z, type ComponentDef, type ParamDef, type Params, type PinGroup, type V } from '../../../types'

/** Name of the i-th driver pin of a bus junction: A, B, C... */
const driverName = (i: number) => String.fromCharCode(65 + i)

/** Bits of a tri-state buffer or a bus junction: 1 is a single line, more is a bus (a part saved before had no such param: 1). */
const bitsParam: ParamDef = { key: 'bits', label: 'Bits', kind: 'number', min: 1, max: 16, default: 1, structural: true }
const widthOf = (p: Params) => Number(p.bits) || 1

/** The junction's value for one bit, from what its drivers put on that bit. */
function join(values: V[], pull: unknown): V {
  let value: V = Z
  let clash = false
  for (const v of values) {
    if (v === Z) continue
    if (value === Z) value = v
    else if (v !== value) clash = true
    if (v === X) clash = true
  }
  if (clash) return X
  if (value !== Z) return value
  return pull === '0' ? 0 : pull === '1' ? 1 : X
}

export const tristate: ComponentDef[] = [
  {
    type: 'tribuf',
    name: 'Tri-state buffer',
    category: 'routing',
    description:
      'Passes A to Y while EN is 1. While EN is 0 it lets go of the line (Z, high impedance) so another part can drive it. ' +
      'Join several of them with a Bus junction. With more than one bit it passes a whole bus.',
    params: [bitsParam],
    groups: (p) => (widthOf(p) > 1 ? [numbered('A', 'in', 'A', widthOf(p)), numbered('Y', 'out', 'Y', widthOf(p))] : []),
    title: (p) => (widthOf(p) > 1 ? 'TRI' : ''),
    layout: (p) => {
      const n = widthOf(p)
      if (n > 1) return box({ w: 60, left: names('A', n), bottom: [{ name: 'EN', def: 0 }], right: names('Y', n) })
      return {
        w: 30,
        h: 20,
        pins: [
          { name: 'A', dir: 'in', side: 'l', x: -10, y: 10 },
          { name: 'EN', label: 'EN', dir: 'in', side: 'b', x: 20, y: 30, def: 0 },
          { name: 'Y', dir: 'out', side: 'r', x: 40, y: 10 },
        ],
      }
    },
    evaluate(inst) {
      const n = widthOf(inst.params)
      const en = inst.ins[n]
      for (let i = 0; i < n; i++) inst.outs[i] = en === 1 ? inst.ins[i] : en === 0 ? Z : X
    },
  },
  {
    type: 'busjoin',
    name: 'Bus junction',
    category: 'routing',
    description:
      'Joins the outputs of several tri-state buffers into one shared line. Y is the value of the one driver that is not Z. ' +
      'Two drivers that disagree (contention) give X. With no driver the line floats (X) unless a pull-up or pull-down is set. ' +
      'With more than one bit every bit of the bus is joined on its own.',
    params: [
      { key: 'drivers', label: 'Drivers', kind: 'number', min: 2, max: 8, default: 3, structural: true },
      bitsParam,
      {
        key: 'pull',
        label: 'When nothing drives it',
        kind: 'select',
        default: 'none',
        options: [
          { value: 'none', label: 'floats (X)' },
          { value: '0', label: 'pulled down to 0' },
          { value: '1', label: 'pulled up to 1' },
        ],
      },
    ],
    title: () => 'BUS',
    acceptsZ: true,
    live: true,
    groups: (p): PinGroup[] => {
      const n = widthOf(p)
      if (n === 1) return []
      return [...Array.from({ length: Number(p.drivers) }, (_, i) => numbered(driverName(i), 'in', driverName(i), n)), numbered('Y', 'out', 'Y', n)]
    },
    layout: (p) => {
      const d = Number(p.drivers)
      const n = widthOf(p)
      if (n === 1) {
        const left = Array.from({ length: d }, (_, i) => ({ name: driverName(i), def: Z }))
        return box({ w: 60, left, right: ['Y'], minRows: d })
      }
      const left = Array.from({ length: d }, (_, i) => names(driverName(i), n).map((name) => ({ name, def: Z }))).flat()
      return box({ w: 60, left, right: names('Y', n), minRows: d })
    },
    evaluate(inst) {
      const d = Number(inst.params.drivers)
      const n = widthOf(inst.params)
      for (let bit = 0; bit < n; bit++) inst.outs[bit] = join(Array.from({ length: d }, (_, i) => inst.ins[i * n + bit]), inst.params.pull)
    },
  },
]
