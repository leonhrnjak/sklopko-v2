import { gateLayout, type GateShape } from '../layouts'
import { X, inv, type ComponentDef, type Instance, type ParamDef, type V } from '../types'

const inputsParam: ParamDef = {
  key: 'inputs',
  label: 'Inputs',
  kind: 'number',
  min: 2,
  max: 8,
  default: 2,
  structural: true,
}

export function and(ins: V[]): V {
  let r: V = 1
  for (const v of ins) {
    if (v === 0) return 0
    if (v === X) r = X
  }
  return r
}

export function or(ins: V[]): V {
  let r: V = 0
  for (const v of ins) {
    if (v === 1) return 1
    if (v === X) r = X
  }
  return r
}

export function xor(ins: V[]): V {
  let r = 0
  for (const v of ins) {
    if (v === X) return X
    r ^= v
  }
  return r as V
}

function gate(
  type: string,
  name: string,
  shape: GateShape,
  inverted: boolean,
  fn: (ins: V[]) => V,
  description: string,
): ComponentDef {
  const single = shape === 'buf'
  return {
    type,
    name,
    category: 'gates',
    description,
    params: single ? [] : [inputsParam],
    layout: (p) => gateLayout(single ? 1 : Number(p.inputs), shape, inverted),
    evaluate(inst: Instance) {
      const v = fn(inst.ins)
      inst.outs[0] = inverted ? inv(v) : v
    },
  }
}

export const gates: ComponentDef[] = [
  gate('and', 'AND', 'and', false, and, 'Output is 1 only when every input is 1.'),
  gate('or', 'OR', 'or', false, or, 'Output is 1 when any input is 1.'),
  gate('not', 'NOT', 'buf', true, (ins) => ins[0], 'Inverter: output is the opposite of the input.'),
  gate('nand', 'NAND', 'and', true, and, 'Inverted AND: output is 0 only when every input is 1.'),
  gate('nor', 'NOR', 'or', true, or, 'Inverted OR: output is 1 only when every input is 0.'),
  gate('xor', 'XOR', 'xor', false, xor, 'Output is 1 when an odd number of inputs are 1.'),
  gate('xnor', 'XNOR', 'xor', true, xor, 'Output is 1 when an even number of inputs are 1.'),
  gate('buf', 'Buffer', 'buf', false, (ins) => ins[0], 'Passes the input through unchanged (one gate delay).'),
]
