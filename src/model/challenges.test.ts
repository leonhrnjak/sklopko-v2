import { describe, expect, it } from 'vitest'
import { CHALLENGES, challengeGroups, getChallenge, goalTable } from './challenges'
import { checkChallenge, ruleProblems } from './challengecheck'
import { circuitPorts } from './analyze'
import type { Circuit } from './circuit'

/** The circuit without one of its wires. */
const without = (c: Circuit, wireId: string): Circuit => {
  const wires = { ...c.wires }
  delete wires[wireId]
  return { ...c, wires }
}

describe('challenges', () => {
  it('have unique ids and every one belongs to a group', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length)
    expect(challengeGroups().flatMap((g) => g.challenges)).toHaveLength(CHALLENGES.length)
    expect(getChallenge('wire')?.title).toBeTruthy()
    expect(getChallenge('nope')).toBeUndefined()
  })

  for (const ch of CHALLENGES) {
    describe(ch.id, () => {
      it('starts with its labelled switches and LEDs and nothing else', () => {
        const start = ch.starter()
        const ports = circuitPorts(start)
        expect(ports.inputs.map((p) => p.name)).toEqual(ch.inputs)
        expect(ports.outputs.map((p) => p.name)).toEqual(ch.outputs)
        expect(Object.keys(start.comps)).toHaveLength(ch.inputs.length + ch.outputs.length)
        expect(Object.keys(start.wires)).toHaveLength(0)
      })

      it('is not solved by the starting circuit', () => {
        expect(checkChallenge(ch, ch.starter()).passed).toBe(false)
      })

      it('is solved by its solution, which follows its own rules', () => {
        const sol = ch.solution()
        expect(ruleProblems(sol, ch.rules)).toEqual([])
        const r = checkChallenge(ch, sol)
        expect(r.problems).toEqual([])
        expect(r.comparison?.mismatches ?? r.failures).toEqual([])
        expect(r.passed).toBe(true)
      })

      it('is not solved when a wire of the solution is missing', () => {
        const sol = ch.solution()
        for (const id of Object.keys(sol.wires)) expect(checkChallenge(ch, without(sol, id)).passed, `without ${id}`).toBe(false)
      })
    })
  }

  it('describes the goal of a combinational challenge as a table', () => {
    const t = goalTable(getChallenge('half-adder') as Parameters<typeof goalTable>[0])
    expect(t.inputs).toEqual(['A', 'B'])
    expect(t.outputs).toEqual(['Sum', 'Carry'])
    expect(t.values).toEqual([
      [0, 1, 1, 0],
      [0, 0, 0, 1],
    ])
  })

  it('asks for a part that is missing, by its label', () => {
    const ch = getChallenge('and')!
    const sol = ch.solution()
    const sw = Object.values(sol.comps).find((k) => k.label === 'B')!
    const r = checkChallenge(ch, { ...sol, comps: { ...sol.comps, [sw.id]: { ...sw, label: 'X' } } })
    expect(r.passed).toBe(false)
    expect(r.problems[0]).toContain('no switch labelled “B”')
  })

  it('rejects a correct circuit that breaks the rules', () => {
    const ch = getChallenge('xor-basics')!
    const sol = ch.solution()
    const gate = Object.values(sol.comps).find((k) => k.type === 'or')!
    const cheat = { ...sol, comps: { ...sol.comps, [gate.id]: { ...gate, type: 'xor' } } } // an XOR in place of the OR gives the same answer
    const r = checkChallenge(ch, cheat)
    expect(r.passed).toBe(false)
    expect(r.problems[0]).toMatch(/only allows AND, OR, NOT/)
    expect(r.problems[0]).toContain('XOR')
  })

  it('limits the number of parts', () => {
    const ch = getChallenge('parity')!
    const sol = ch.solution()
    expect(ruleProblems(sol, ch.rules)).toEqual([])
    const extra = { ...sol, comps: { ...sol.comps, extra: { ...Object.values(sol.comps).find((k) => k.type === 'xnor')!, id: 'extra' }, extra2: { ...Object.values(sol.comps).find((k) => k.type === 'xnor')!, id: 'extra2' } } }
    expect(ruleProblems(extra, ch.rules)[0]).toContain('at most 2')
  })

  it('reports which step of a memory challenge failed', () => {
    const ch = getChallenge('sr-latch')!
    const sol = ch.solution()
    // Cut the feedback: it no longer remembers, so the "hold" steps fail.
    const feedback = Object.values(sol.wires).find((w) => sol.comps[w.from.comp].type === 'nor' && sol.comps[w.to.comp].type === 'nor')!
    const r = checkChallenge(ch, without(sol, feedback.id))
    expect(r.passed).toBe(false)
    expect(r.failures?.length).toBeGreaterThan(0)
    expect(r.failures![0].step).toBeGreaterThan(0)
  })
})
