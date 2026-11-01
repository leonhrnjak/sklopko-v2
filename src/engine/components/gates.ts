import { gateLayout, type GateShape } from '../layouts'
import type { ComponentDef, ParamDef } from '../types'

const inputsParam: ParamDef = {
  key: 'inputs',
  label: 'Inputs',
  kind: 'number',
  min: 2,
  max: 8,
  default: 2,
  structural: true,
}

function gate(
  type: string,
  name: string,
  shape: GateShape,
  inverted: boolean,
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
  }
}

export const gates: ComponentDef[] = [
  gate('and', 'AND', 'and', false, 'Output is 1 only when every input is 1, and 0 as soon as any input is 0. Unknown inputs give an unknown output unless another input is 0.'
  ),
  gate('or', 'OR', 'or', false, 'Output is 1 as soon as any input is 1, and 0 only when every input is 0. Unknown inputs give an unknown output unless another input is 1.'
  ),
  gate('not', 'NOT', 'buf', true, 'Inverter: the output is the opposite of the input (0 gives 1, 1 gives 0). An unknown input gives an unknown output.'
  ),
  gate('nand', 'NAND', 'and', true, 'Inverted AND: the output is 0 only when every input is 1, otherwise 1.'
  ),
  gate('nor', 'NOR', 'or', true, 'Inverted OR: the output is 1 only when every input is 0, otherwise 0.'
  ),
  gate('xor', 'XOR', 'xor', false, 'Exclusive OR: the output is 1 when an odd number of inputs are 1. With two inputs: 1 when they differ. Any unknown input makes the output unknown.'
  ),
  gate('xnor', 'XNOR', 'xor', true, 'Inverted XOR: the output is 1 when an even number of inputs are 1. With two inputs: 1 when they are equal.'
  ),
  gate('buf', 'Buffer', 'buf', false, 'Buffer: copies the input to the output unchanged, one gate delay later.'
  ),
]
