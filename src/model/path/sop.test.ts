import { describe, expect, it } from 'vitest'
import { checkChallenge, logicParts } from '../challengecheck'
import { comb } from '../challenges'
import { nandNandSolution } from './sop'

const goal = (inputs: string[], expr: string) => comb({ id: 't', group: 't', title: 't', lesson: [], task: 't', hint: 't', inputs, outputs: ['Y'], goal: `Y = ${expr}`, rules: { only: ['nand'] } })

describe('nandNandSolution', () => {
  const cases: [string, string[], string, string[][], number][] = [
    ['majority', ['A', 'B', 'C'], 'A·B + A·C + B·C', [['A', 'B'], ['A', 'C'], ['B', 'C']], 4],
    ['XOR, an inverter for each input', ['A', 'B'], 'A ⊕ B', [['A', '¬B'], ['¬A', 'B']], 5],
    ['A·B + C, one term of a single input', ['A', 'B', 'C'], 'A·B + C', [['A', 'B'], ['C']], 3],
    ['a single product', ['A', 'B'], 'A·B', [['A', 'B']], 2],
  ]
  for (const [name, inputs, expr, terms, parts] of cases) {
    it(`builds ${name} out of NAND gates only`, () => {
      const c = nandNandSolution(inputs, 'Y', terms)
      const r = checkChallenge(goal(inputs, expr), c)
      expect(r.problems).toEqual([])
      expect(r.passed).toBe(true)
      expect(logicParts(c)).toBe(parts)
    })
  }
})
