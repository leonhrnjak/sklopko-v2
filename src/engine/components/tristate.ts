import { box } from '../layouts'
import { X, Z, type ComponentDef, type V } from '../types'

/** Name of the i-th driver pin of a bus junction: A, B, C... */
const driverName = (i: number) => String.fromCharCode(65 + i)

export const tristate: ComponentDef[] = [
  {
    type: 'tribuf',
    name: 'Tri-state buffer',
    category: 'routing',
    description:
      'Passes A to Y while EN is 1. While EN is 0 it lets go of the line (Z, high impedance) so another part can drive it. ' +
      'Join several of them with a Bus junction.',
    layout: () => ({
      w: 30,
      h: 20,
      pins: [
        { name: 'A', dir: 'in', side: 'l', x: -10, y: 10 },
        { name: 'EN', label: 'EN', dir: 'in', side: 'b', x: 20, y: 30, def: 0 },
        { name: 'Y', dir: 'out', side: 'r', x: 40, y: 10 },
      ],
    }),
    evaluate(inst) {
      const [a, en] = inst.ins
      inst.outs[0] = en === 1 ? a : en === 0 ? Z : X
    },
  },
  {
    type: 'busjoin',
    name: 'Bus junction',
    category: 'routing',
    description:
      'Joins the outputs of several tri-state buffers into one shared line. Y is the value of the one driver that is not Z. ' +
      'Two drivers that disagree (contention) give X. With no driver the line floats (X) unless a pull-up or pull-down is set.',
    params: [
      { key: 'drivers', label: 'Drivers', kind: 'number', min: 2, max: 8, default: 3, structural: true },
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
    layout: (p) => {
      const n = Number(p.drivers)
      const left = Array.from({ length: n }, (_, i) => ({ name: driverName(i), def: Z }))
      return box({ w: 60, left, right: ['Y'], minRows: n })
    },
    evaluate(inst) {
      const n = Number(inst.params.drivers)
      let value: V = Z
      let clash = false
      for (let i = 0; i < n; i++) {
        const v = inst.ins[i]
        if (v === Z) continue
        if (value === Z) value = v
        else if (v !== value) clash = true
        if (v === X) clash = true
      }
      if (clash) inst.outs[0] = X
      else if (value !== Z) inst.outs[0] = value
      else inst.outs[0] = inst.params.pull === '0' ? 0 : inst.params.pull === '1' ? 1 : X
    },
  },
]
