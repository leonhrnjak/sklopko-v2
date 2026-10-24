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
  pins: ComponentDef['pins'],
): ComponentDef {
  const single = shape === 'buf'
  return {
    type,
    name,
    category: 'gates',
    description,
    pins,
    params: single ? [] : [inputsParam],
    layout: (p) => gateLayout(single ? 1 : Number(p.inputs), shape, inverted),
    evaluate(inst: Instance) {
      const v = fn(inst.ins)
      inst.outs[0] = inverted ? inv(v) : v
    },
  }
}

export const gates: ComponentDef[] = [
  gate('and', 'AND', 'and', false, and, 'Output is 1 only when every input is 1, and 0 as soon as any input is 0. Unknown inputs give an unknown output unless another input is 0.',
    { 'A|B|C|D|E|F|G|H': 'One input of the gate (2 to 8, set with Inputs); the output depends on all of them.', Y: '1 only while every input is 1; 0 if any input is 0.' },
  ),
  gate('or', 'OR', 'or', false, or, 'Output is 1 as soon as any input is 1, and 0 only when every input is 0. Unknown inputs give an unknown output unless another input is 1.',
    { 'A|B|C|D|E|F|G|H': 'One input of the gate (2 to 8, set with Inputs); the output depends on all of them.', Y: '1 if any input is 1; 0 only while every input is 0.' },
  ),
  gate('not', 'NOT', 'buf', true, (ins) => ins[0], 'Inverter: the output is the opposite of the input (0 gives 1, 1 gives 0). An unknown input gives an unknown output.',
    { A: 'The signal to invert.', Y: 'The opposite of A: 1 while A is 0, 0 while A is 1.' },
  ),
  gate('nand', 'NAND', 'and', true, and, 'Inverted AND: the output is 0 only when every input is 1, otherwise 1.',
    { 'A|B|C|D|E|F|G|H': 'One input of the gate (2 to 8, set with Inputs); the output depends on all of them.', Y: '0 only while every input is 1; 1 if any input is 0.' },
  ),
  gate('nor', 'NOR', 'or', true, or, 'Inverted OR: the output is 1 only when every input is 0, otherwise 0.',
    { 'A|B|C|D|E|F|G|H': 'One input of the gate (2 to 8, set with Inputs); the output depends on all of them.', Y: '1 only while every input is 0; 0 if any input is 1.' },
  ),
  gate('xor', 'XOR', 'xor', false, xor, 'Exclusive OR: the output is 1 when an odd number of inputs are 1. With two inputs: 1 when they differ. Any unknown input makes the output unknown.',
    { 'A|B|C|D|E|F|G|H': 'One input of the gate (2 to 8, set with Inputs); the output depends on all of them.', Y: '1 while an odd number of inputs are 1 (with two inputs: while they differ).' },
  ),
  gate('xnor', 'XNOR', 'xor', true, xor, 'Inverted XOR: the output is 1 when an even number of inputs are 1. With two inputs: 1 when they are equal.',
    { 'A|B|C|D|E|F|G|H': 'One input of the gate (2 to 8, set with Inputs); the output depends on all of them.', Y: '1 while an even number of inputs are 1 (with two inputs: while they are equal).' },
  ),
  gate('buf', 'Buffer', 'buf', false, (ins) => ins[0], 'Buffer: copies the input to the output unchanged, one gate delay later.',
    { A: 'The signal to pass on.', Y: 'Same level as A, one gate delay later.' },
  ),
]
