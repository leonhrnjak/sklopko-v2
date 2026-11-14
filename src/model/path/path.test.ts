import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../builder'
import { goalTable, type CombChallenge } from '../challenges'
import { checkChallenge, circuitShape, logicParts, ruleProblems } from '../challengecheck'
import type { Circuit } from '../circuit'
import { expandICs, icParams } from '../ic'
import { CHAPTERS } from './chapters'
import { computer2Builder } from '../computer2'
import { cutWires } from './board'
import { EXAMPLES } from '../examples'
import { cpuStage } from './cpu4'
import { checkStepCircuit, stepStarter } from './build'
import { challengeOf, chipId, chipTable, notBuilt, parseKit, refreshChips, snapshot, solutionOf, type Kit } from './chips'
import { PATH_STEP_COUNT, learnFromPath, learnUrl } from './index'
import { countDone, emptyProgress, markDone, mergeProgress, parseProgress } from './progress'
import { hasDef } from '../../engine/registry'
import { PATH_STEPS, STEPS, chapterDone, chaptersUnlockedBy, getStep, hasStep, isBehind, mapChapter, recommended, stepAfter, stepBefore, stepIdsOf, stepsOf, unlockedParts } from './steps'
import type { BuildStep } from './types'

const builds = STEPS.filter((s): s is BuildStep => s.kind === 'build')

const without = (c: Circuit, wireId: string): Circuit => {
  const wires = { ...c.wires }
  delete wires[wireId]
  return { ...c, wires }
}

describe('the path and its index', () => {
  it('has unique step ids, and the main chunk counts exactly the steps there are', () => {
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length)
    expect(PATH_STEPS).toEqual(STEPS.map((s) => s.id))
    expect(PATH_STEP_COUNT).toBe(STEPS.length)
    for (const c of CHAPTERS) expect(stepIdsOf(c.id)).toEqual(stepsOf(c.id).map((s) => s.id))
  })

  it('puts every step in a chapter that exists, and the chapters in the order of the plan', () => {
    const ids = CHAPTERS.map((c) => c.id)
    expect(ids).toHaveLength(14)
    expect(new Set(ids).size).toBe(14)
    for (const s of STEPS) expect(ids, s.id).toContain(s.chapter)
    // Steps are in chapter order.
    const order = STEPS.map((s) => ids.indexOf(s.chapter))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('gives every step a title, a summary and a lesson, and no unfinished markup', () => {
    for (const s of STEPS) {
      expect(s.title, s.id).toBeTruthy()
      expect(s.summary, s.id).toBeTruthy()
      expect(s.lesson.length, s.id).toBeGreaterThan(0)
      for (const b of s.lesson) if ('p' in b) expect(b.p, s.id).not.toMatch(/TODO|\[\[(?![^\]]+\]\])/)
    }
  })

  it('walks from step to step', () => {
    expect(stepAfter(PATH_STEPS[0])).toBe(PATH_STEPS[1])
    expect(stepBefore(PATH_STEPS[0])).toBeUndefined()
    expect(stepAfter(PATH_STEPS[PATH_STEPS.length - 1])).toBeUndefined()
    expect(stepBefore(PATH_STEPS[1])).toBe(PATH_STEPS[0])
  })

  it('reads the addresses of the map and of a step', () => {
    expect(learnFromPath('/learn')).toEqual({ step: null })
    expect(learnFromPath('/learn/')).toEqual({ step: null })
    expect(learnFromPath('/Learn/and-from-nand')).toEqual({ step: 'and-from-nand' })
    expect(learnFromPath('/learn/and-from-nand/')).toEqual({ step: 'and-from-nand' })
    expect(learnFromPath('/learn/no-such-step')).toEqual({ step: 'no-such-step' })
    expect(learnFromPath('/learning')).toBeUndefined()
    expect(learnFromPath('/')).toBeUndefined()
    expect(learnFromPath('/counter')).toBeUndefined()
    expect(learnUrl()).toBe('/learn')
    expect(learnUrl('wire')).toBe('/learn/wire')
    expect(hasStep('wire')).toBe(true)
    expect(hasStep('nope')).toBe(false)
  })
})

describe('build steps', () => {
  it('only use chips of steps before them, that make chips', () => {
    for (const s of builds) {
      for (const u of s.uses ?? []) {
        expect(PATH_STEPS.indexOf(u), `${s.id} uses ${u}`).toBeLessThan(PATH_STEPS.indexOf(s.id))
        expect((getStep(u) as BuildStep | undefined)?.chip, u).toBeTruthy()
      }
    }
  })

  for (const s of builds) {
    describe(s.id, () => {
      const ch = challengeOf(s)

      it('starts with its labelled switches and LEDs and the chips it uses, and nothing is wired', () => {
        const start = stepStarter(s, {})
        expect(Object.keys(start.comps)).toHaveLength(ch.inputs.length + ch.outputs.length)
        expect(Object.keys(start.wires)).toHaveLength(0)
        expect(Object.keys(start.ics ?? {}).sort()).toEqual(Object.keys(chipTable(s.uses ?? [], {})).sort())
        expect(checkStepCircuit(s, start).check.passed).toBe(false)
      })

      it('is solved by its solution, which follows the rules and is made of the chips it uses', () => {
        const sol = solutionOf(s)
        expect(ruleProblems(sol, ch.rules)).toEqual([])
        const { check } = checkStepCircuit(s, sol)
        expect(check.problems).toEqual([])
        expect(check.passed).toBe(true)
        for (const id of Object.keys(sol.ics ?? {})) expect(id.startsWith('kit:')).toBe(true)
      })

      it('is not solved when a wire of the solution is missing', () => {
        const sol = solutionOf(s)
        for (const id of Object.keys(sol.wires)) expect(checkStepCircuit(s, without(sol, id)).check.passed, `without ${id}`).toBe(false)
      }, 30_000) // the ALU has 64 wires and 1024 rows

      it('offers only parts that its solution can be built from', () => {
        if (!s.palette) return
        const sol = solutionOf(s)
        for (const k of Object.values(sol.comps)) if (k.type !== 'ic') expect(s.palette, `${s.id}: ${k.type}`).toContain(k.type)
      })
    })
  }
})

describe('the kit', () => {
  const chipSteps = builds.filter((s) => s.chip)

  it('turns each chip step’s solution into a chip that the next steps accept, whoever built the chips before', () => {
    const kit: Kit = {}
    for (const s of builds) {
      // The learner's chips and ours give the same answer.
      for (const k of [kit, {}] as Kit[]) {
        const sol = { ...solutionOf(s), ics: chipTable(s.uses ?? [], k) }
        const r = checkStepCircuit(s, sol)
        expect(r.check.problems, `${s.id}`).toEqual([])
        expect(r.check.passed, `${s.id} with ${Object.keys(k).length} chips of the kit`).toBe(true)
      }
      if (s.chip) kit[s.id] = snapshot(s.chip, solutionOf(s))
    }
    expect(Object.keys(kit)).toEqual(chipSteps.map((s) => s.id))
  }, 60_000) // every build step is solved twice, and there are more of them each chapter

  it('stores a chip with just the chips it needs, and finds the chips inside it by id', () => {
    const and = getStep('and-from-nand') as BuildStep
    const entry = snapshot('AND', solutionOf(and))
    expect(Object.keys((entry.circuit as { ics?: { id: string }[] }).ics ?? []).length).toBe(1)
    const table = chipTable(['and-from-nand'], { 'and-from-nand': entry })
    // The AND is made of a NOT, which comes from ours, since the kit does not have one.
    expect(Object.keys(table).sort()).toEqual([chipId('and-from-nand'), chipId('not-from-nand')])
    expect(table[chipId('and-from-nand')].name).toBe('AND')
  })

  it('counts a chip as the NANDs it is made of', () => {
    const xor = getStep('xor-from-kit') as BuildStep
    const sol = solutionOf(xor)
    expect(Object.values(sol.comps).filter((k) => k.type === 'nand')).toHaveLength(0)
    expect(logicParts(sol)).toBeGreaterThan(4)
    const flat = expandICs(sol).circuit
    expect(Object.values(flat.comps).filter((k) => k.type === 'nand').length).toBe(logicParts(sol))
  })

  it('says which chips the learner has not built, and gives them the new one when they have', () => {
    const and = getStep('and-from-nand') as BuildStep
    expect(notBuilt(['not-from-nand', 'or-from-nand'], { 'not-from-nand': snapshot('NOT', solutionOf(getStep('not-from-nand') as BuildStep)) })).toEqual(['or-from-nand'])
    // A circuit made with our NOT gets the learner’s NOT when they have built it.
    const mine = snapshot('NOT', solutionOf(getStep('not-from-nand') as BuildStep))
    const old = stepStarter(and, {})
    const fresh = refreshChips(old, and.uses!, { 'not-from-nand': mine })
    expect(fresh.ics![chipId('not-from-nand')].circuit).toEqual(expect.objectContaining({ comps: expect.any(Object) }))
    expect(refreshChips(old, [], {})).toBe(old)
  })

  it('leaves out an entry that is broken', () => {
    const good = snapshot('NOT', solutionOf(getStep('not-from-nand') as BuildStep))
    const kit = parseKit({ a: good, b: { name: 'X' }, c: { name: '', circuit: good.circuit }, d: { name: 'Y', circuit: { nope: 1 } }, e: 5, f: null })
    expect(Object.keys(kit)).toEqual(['a'])
    expect(parseKit(null)).toEqual({})
    expect(parseKit('x')).toEqual({})
    expect(parseKit([])).toEqual({})
  })
})

describe('the star', () => {
  const xor = getStep('xor-from-kit') as BuildStep

  /** XOR from four NAND gates, sharing the first one. */
  function fourNands(): Circuit {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const bb = b.add('switch', 0, 70, { label: 'B' })
    const y = b.add('led', 460, 0, { label: 'Y' })
    const n1 = b.add('nand', 120, 30)
    const n2 = b.add('nand', 240, 0)
    const n3 = b.add('nand', 240, 80)
    const n4 = b.add('nand', 360, 40)
    b.wire(`${a}.Q`, `${n1}.A`)
    b.wire(`${bb}.Q`, `${n1}.B`)
    b.wire(`${a}.Q`, `${n2}.A`)
    b.wire(`${n1}.Y`, `${n2}.B`)
    b.wire(`${bb}.Q`, `${n3}.A`)
    b.wire(`${n1}.Y`, `${n3}.B`)
    b.wire(`${n2}.Y`, `${n4}.A`)
    b.wire(`${n3}.Y`, `${n4}.B`)
    b.wire(`${n4}.Y`, `${y}.A`)
    return b.build()
  }

  it('goes to a circuit with four NANDs, and not to the one built from the kit', () => {
    const small = checkStepCircuit(xor, fourNands())
    expect(small.check.passed).toBe(true)
    expect(small.parts).toBe(4)
    expect(small.star).toBe(true)
    const big = checkStepCircuit(xor, solutionOf(xor))
    expect(big.check.passed).toBe(true)
    expect(big.star).toBe(false)
  })

  it('is never given to a circuit that fails, or to a step without a par', () => {
    expect(checkStepCircuit(xor, stepStarter(xor, {})).star).toBe(false)
    const not = getStep('not-from-nand') as BuildStep
    expect(checkStepCircuit(not, solutionOf(not)).star).toBe(false)
  })

  it('is checked by the same rules: the challenge also passes', () => {
    expect(checkChallenge(challengeOf(xor), fourNands()).passed).toBe(true)
  })
})

describe('circuitShape', () => {
  it('ignores the position of a switch and notices a new wire', () => {
    const not = getStep('not-from-nand') as BuildStep
    const sol = solutionOf(not)
    const sw = Object.values(sol.comps).find((k) => k.type === 'switch')!
    const flipped = { ...sol, comps: { ...sol.comps, [sw.id]: { ...sw, params: { ...sw.params, on: 1 } } } }
    expect(circuitShape(flipped)).toBe(circuitShape(sol))
    expect(circuitShape(without(sol, Object.keys(sol.wires)[0]))).not.toBe(circuitShape(sol))
  })
})

describe('progress', () => {
  it('starts empty and ignores a value it cannot read', () => {
    expect(parseProgress(undefined)).toEqual(emptyProgress())
    expect(parseProgress(null)).toEqual(emptyProgress())
    expect(parseProgress('x')).toEqual(emptyProgress())
    expect(parseProgress([])).toEqual(emptyProgress())
    expect(parseProgress({ v: 2, done: { a: { at: 1, how: 'solved' } } })).toEqual(emptyProgress())
  })

  it('keeps the entries that are fine and drops the ones that are not', () => {
    const p = parseProgress({
      v: 1,
      done: { a: { at: 5, how: 'solved', star: true }, b: { at: 'x', how: 'solved' }, c: { at: 1, how: 'cheated' }, d: 7, e: { at: 2, how: 'read', star: 'yes' } },
      current: 'a',
      quiz: { q: [1, 2], r: 'no', s: [1.5] },
    })
    expect(p).toEqual({ v: 1, done: { a: { at: 5, how: 'solved', star: true }, e: { at: 2, how: 'read' } }, current: 'a', quiz: { q: [1, 2] } })
    expect(parseProgress({ v: 1, done: 5, current: 3, quiz: 1 })).toEqual(emptyProgress())
  })

  it('marks a step done, solving beats being shown, and a star stays', () => {
    let p = markDone(emptyProgress(), 'x', 'shown', 10)
    expect(p.done.x).toEqual({ at: 10, how: 'shown' })
    p = markDone(p, 'x', 'solved', 20, true)
    expect(p.done.x).toEqual({ at: 10, how: 'solved', star: true })
    p = markDone(p, 'x', 'shown', 30)
    expect(p.done.x).toEqual({ at: 10, how: 'solved', star: true })
    p = markDone(p, 'x', 'solved', 40)
    expect(p.done.x.star).toBe(true)
    expect(countDone(p, ['x', 'y'])).toBe(1)
  })

  it('recommends the step the learner was on, then the next one not done, going round', () => {
    const [a, b, c] = PATH_STEPS
    expect(recommended(emptyProgress())).toBe(a)
    let p = markDone(emptyProgress(), a, 'solved', 1)
    expect(recommended(p)).toBe(b)
    p = { ...markDone(p, b, 'read', 2), current: c }
    expect(recommended(p)).toBe(c)
    p = markDone(p, c, 'solved', 3)
    expect(recommended(p)).toBe(PATH_STEPS[3])
    // Back at the beginning, a step skipped earlier is found.
    const skipped = PATH_STEPS.slice(1).reduce((q, id) => markDone(q, id, 'solved', 1), emptyProgress())
    expect(recommended({ ...skipped, current: PATH_STEPS[PATH_STEPS.length - 1] })).toBe(a)
    expect(recommended(PATH_STEPS.reduce((q, id) => markDone(q, id, 'solved', 1), emptyProgress()))).toBeUndefined()
    expect(recommended({ ...emptyProgress(), current: 'gone' })).toBe(a)
  })
})

describe('where the map opens', () => {
  const last = PATH_STEPS[PATH_STEPS.length - 1]

  it('is the chapter of the step the learner was last on, also when an earlier step was skipped', () => {
    // Everything but the second step done, and the learner ended on the last one: the map shows its chapter, not the skipped step's.
    const skipped = PATH_STEPS.filter((id) => id !== PATH_STEPS[1]).reduce((q, id) => markDone(q, id, 'solved', 1), emptyProgress())
    const p = { ...skipped, current: last }
    expect(recommended(p)).toBe(PATH_STEPS[1])
    expect(isBehind(p, PATH_STEPS[1])).toBe(true)
    expect(mapChapter(p)).toBe(getStep(last)!.chapter)
    expect(getStep(last)!.chapter).not.toBe(getStep(PATH_STEPS[1])!.chapter)
  })

  it('is not behind when the way on is ahead, and falls back to the recommended step with nothing remembered', () => {
    expect(isBehind(emptyProgress(), PATH_STEPS[0])).toBe(false)
    const p = { ...markDone(emptyProgress(), PATH_STEPS[0], 'solved', 1), current: PATH_STEPS[0] }
    expect(recommended(p)).toBe(PATH_STEPS[1])
    expect(isBehind(p, PATH_STEPS[1])).toBe(false)
    expect(mapChapter(emptyProgress())).toBe(getStep(PATH_STEPS[0])!.chapter)
    expect(mapChapter({ ...emptyProgress(), current: 'gone' })).toBe(getStep(PATH_STEPS[0])!.chapter)
  })
})

describe('chips drawn as gates', () => {
  const chipSteps = builds.filter((s) => s.chip)

  it('every chip of the kit says which gate it is, and its pins fit', () => {
    // The chips that are gates have their symbol; the others (a multiplexer, a decoder) are boxes.
    expect(chipSteps.filter((s) => s.symbol).map((s) => [s.chip, s.symbol])).toEqual([['NOT', 'not'], ['AND', 'and'], ['OR', 'or'], ['NOR', 'nor'], ['XOR', 'xor']])
    const table = chipTable(chipSteps.map((s) => s.id), {})
    for (const s of chipSteps) {
      const def = table[chipId(s.id)]
      expect(def.symbol, s.id).toBe(s.symbol)
      expect(icParams(def).symbol || undefined, `${s.id} pins fit`).toBe(s.symbol)
    }
  })

  it('also when the chip is the learner’s own, kept before the symbols came in', () => {
    const not = getStep('not-from-nand') as BuildStep
    const mine = snapshot('NOT', solutionOf(not))
    expect(chipTable(['not-from-nand'], { 'not-from-nand': mine })[chipId('not-from-nand')].symbol).toBe('not')
  })

  it('an older circuit, whose instances were boxes, is drawn with the symbols when its chips are brought up to date', () => {
    const and = getStep('and-from-nand') as BuildStep
    const sol = solutionOf(and)
    // As a document of the version before: no symbol on the chips or on their instances.
    const old: Circuit = {
      ...sol,
      ics: Object.fromEntries(Object.entries(sol.ics!).map(([id, d]) => [id, { id: d.id, name: d.name, circuit: d.circuit }])),
      comps: Object.fromEntries(Object.entries(sol.comps).map(([id, k]) => [id, k.type === 'ic' ? { ...k, params: { ...k.params, symbol: '' } } : k])),
    }
    const inst = (c: Circuit) => Object.values(c.comps).find((k) => k.type === 'ic')!
    expect(inst(old).params.symbol).toBe('')
    const fresh = refreshChips(old, and.uses!, {})
    expect(inst(fresh).params.symbol).toBe('not')
    expect(checkStepCircuit(and, fresh).check.passed).toBe(true)
  })
})

describe('chapter 3 and the lessons that came with it', () => {
  const lessonsOf = (s: (typeof STEPS)[number]) => s.lesson
  const quizzes = STEPS.flatMap((s) => lessonsOf(s).flatMap((b) => ('quiz' in b ? b.quiz.map((q) => ({ id: s.id, q })) : [])))

  it('has a question with a right answer to point at in every quiz, and a step 3 in the chapters', () => {
    expect(quizzes.length).toBeGreaterThan(8)
    for (const { id, q } of quizzes) {
      expect(q.options.length, id).toBeGreaterThan(1)
      expect(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, `${id}: ${q.q}`).toBe(true)
      expect(q.why, id).toBeTruthy()
    }
    expect(CHAPTERS[2].id).toBe('tables')
    expect(stepIdsOf('tables')).toEqual(['table-to-sop', 'sop-majority', 'combine-terms', 'kmap', 'sop-bcd', 'nand-nand', 'sop-nand'])
  })

  it('marks real rows of its tables and gives its maps rows that exist', () => {
    for (const s of STEPS)
      for (const b of lessonsOf(s)) {
        if ('table' in b) for (const r of b.table.highlight ?? []) expect(r, s.id).toBeLessThan(b.table.rows.length)
        if ('kmap' in b) for (const r of b.kmap.ones) expect(r, s.id).toBeLessThan(2 ** b.kmap.inputs.length)
      }
  })

  it('sends a done-card link to a step that exists', () => {
    for (const s of builds) if (s.after) expect(hasStep(s.after.step), s.id).toBe(true)
    expect((getStep('sop-nand') as BuildStep).after?.step).toBe('xor-from-kit')
  })

  it('makes an existing challenge NAND-only for a step without changing the challenge', () => {
    const step = getStep('sop-nand') as BuildStep
    expect(challengeOf(step).rules).toEqual({ only: ['nand'] })
    expect(challengeOf(step).id).toBe('majority')
    // The challenge as the Challenges list has it still takes any gates.
    const plain = { ...step, rules: undefined } as BuildStep
    expect(challengeOf(plain).rules).toBeUndefined()
    const andOr = new CircuitBuilder()
    const [a, b, c, y] = ['A', 'B', 'C'].map((l, i) => andOr.add('switch', 0, i * 70, { label: l })).concat(andOr.add('led', 460, 0, { label: 'Y' }))
    const ab = andOr.add('and', 120, 0)
    const ac = andOr.add('and', 120, 80)
    const bc = andOr.add('and', 120, 160)
    const any = andOr.add('or', 260, 70, { params: { inputs: 3 } })
    for (const [g, p, q] of [[ab, a, b], [ac, a, c], [bc, b, c]] as const) {
      andOr.wire(`${p}.Q`, `${g}.A`)
      andOr.wire(`${q}.Q`, `${g}.B`)
    }
    andOr.wire(`${ab}.Y`, `${any}.A`)
    andOr.wire(`${ac}.Y`, `${any}.B`)
    andOr.wire(`${bc}.Y`, `${any}.C`)
    andOr.wire(`${any}.Y`, `${y}.A`)
    const circuit = andOr.build()
    expect(checkStepCircuit(plain, circuit).check.passed).toBe(true)
    const nandOnly = checkStepCircuit(step, circuit).check
    expect(nandOnly.passed).toBe(false)
    expect(nandOnly.problems.length).toBeGreaterThan(0)
  })

  it('earns the star of the two 4-gate steps, while the circuit read straight off the table is a correct, big one', () => {
    for (const id of ['sop-bcd', 'sop-nand']) {
      const s = getStep(id) as BuildStep
      const r = checkStepCircuit(s, solutionOf(s))
      expect(r.check.passed, id).toBe(true)
      expect(r.parts, id).toBe(4)
      expect(r.star, id).toBe(true)
    }
    // The big version from the truth table is a correct circuit, only not a small one.
    const big = getStep('sop-majority') as BuildStep
    const r = checkStepCircuit(big, solutionOf(big))
    expect(r.check.passed).toBe(true)
    expect(r.parts).toBeGreaterThan(20)
  })
})

describe('part names in lessons ([[label]])', () => {
  const namesIn = (s: (typeof STEPS)[number]) => s.lesson.flatMap((b) => ('p' in b ? [...b.p.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]) : []))
  const circuitOf = (s: (typeof STEPS)[number]) => {
    if (s.kind === 'explore') return 'build' in s.open ? s.open.build() : EXAMPLES.find((e) => e.id === (s.open as { example: string }).example)!.build()
    if (s.kind === 'build') return stepStarter(s, {})
    if (s.kind === 'program') {
      if (s.computer === 'board6502') return EXAMPLES.find((e) => e.id === s.example)!.build()
      return s.computer === 'cpu8' ? computer2Builder({ source: 'HALT', hz: 16, devices: ['console'] }).b.c : cpuStage(8)
    }
    if (s.kind !== 'project') return undefined
    if (s.board) return cutWires(EXAMPLES.find((e) => e.id === s.board!.example)!.build(), s.board.cut)
    const c = structuredClone(cpuStage(s.stage - 1))
    s.give?.(c)
    return c
  }

  it('only name parts that the step’s circuit has, and only in steps that have a circuit', () => {
    let named = 0
    for (const s of STEPS) {
      const names = namesIn(s)
      if (!names.length) continue
      const c = circuitOf(s)
      expect(c, `${s.id} names parts but has no circuit`).toBeDefined()
      for (const n of names) {
        expect(Object.values(c!.comps).some((k) => k.label === n), `${s.id}: [[${n}]]`).toBe(true)
        named++
      }
    }
    expect(named).toBeGreaterThan(4)
  }, 60_000) // the circuits of the board steps are routed here, which takes seconds
})

describe('chapter 5, adding numbers', () => {
  const rows = (id: string) => {
    const ch = challengeOf(getStep(id) as BuildStep)
    return goalTable(ch as CombChallenge)
  }
  /** The value of a table's outputs (S3..S0, Cout) in the row where the inputs, in order, are these bits. */
  const outputsAt = (id: string, inputs: number[]) => {
    const t = rows(id)
    const row = inputs.reduce((n, b) => n * 2 + b, 0)
    return Object.fromEntries(t.outputs.map((o, i) => [o, t.values[i][row]]))
  }
  const bitsOf = (n: number, w: number) => Array.from({ length: w }, (_, i) => (n >> (w - 1 - i)) & 1)

  it('has the seven steps, in the order of the plan, and the chips each one makes', () => {
    expect(stepIdsOf('adding')).toEqual(['binary-add', 'half-adder', 'full-adder', 'adder4', 'ripple-tour', 'negative', 'addsub'])
    expect(['half-adder', 'full-adder', 'adder4', 'addsub'].map((id) => (getStep(id) as BuildStep).chip)).toEqual(['HA', 'FA', 'ADD4', 'ADDSUB'])
  })

  it('asks of the 4-bit adder every sum, carry in included', () => {
    for (const [a, b, cin] of [[15, 1, 0], [7, 8, 1], [9, 9, 0], [0, 0, 1]]) {
      const sum = a + b + cin
      expect(outputsAt('adder4', [...bitsOf(a, 4), ...bitsOf(b, 4), cin]), `${a} + ${b} + ${cin}`).toEqual({ S3: (sum >> 3) & 1, S2: (sum >> 2) & 1, S1: (sum >> 1) & 1, S0: sum & 1, Cout: sum >> 4 })
    }
  })

  it('asks of the adder/subtractor A + B, or A − B with SUB on (Cout is 1 when nothing was borrowed)', () => {
    for (const [a, b, sub] of [[5, 3, 1], [3, 5, 1], [5, 3, 0], [15, 15, 0], [0, 1, 1]]) {
      const r = (sub ? a - b : a + b) & 31 // 5 bits: Cout is bit 4 of A + (¬B & 15) + 1
      const full = sub ? a + (~b & 15) + 1 : a + b
      const out = outputsAt('addsub', [...bitsOf(a, 4), ...bitsOf(b, 4), sub])
      expect(out.S3 * 8 + out.S2 * 4 + out.S1 * 2 + out.S0, `${a} ${sub ? '−' : '+'} ${b}`).toBe(r & 15)
      expect(out.Cout, `${a} ${sub ? '−' : '+'} ${b}: Cout`).toBe(full >> 4)
    }
  })
})

describe('chapter 7, memory', () => {
  it('has the six steps, in the order of the plan, and the chips each build makes', () => {
    expect(stepIdsOf('memory')).toEqual(['feedback', 'sr-latch', 'd-latch', 'dff', 'reg1', 'reg4'])
    expect(['sr-latch', 'd-latch', 'dff', 'reg1', 'reg4'].map((id) => (getStep(id) as BuildStep).chip)).toEqual(['SR', 'DLATCH', 'DFF', 'REG1', 'REG4'])
  })

  it('has a gate-level flip-flop that holds its bit through sixteen changes of D without a clock edge, and takes the next one on a pulse', () => {
    const dff = getStep('dff') as BuildStep
    const ch = challengeOf(dff)
    if (ch.kind !== 'seq') throw new Error('a seq challenge was expected')
    const steps = [
      { set: { D: 1 as const }, pulse: 'CLK', expect: { Q: 1 as const } },
      ...Array.from({ length: 16 }, (_, i) => ({ set: { D: (i % 2) as 0 | 1 }, expect: { Q: 1 as const } })),
      { set: { D: 0 as const }, pulse: 'CLK', expect: { Q: 0 as const } },
    ]
    expect(checkChallenge({ ...ch, steps }, solutionOf(dff)).passed).toBe(true)
  })

  it('shows a flip-flop that is only a latch up: it follows D while CLK stays up', () => {
    const dff = getStep('dff') as BuildStep
    const ch = challengeOf(dff)
    if (ch.kind !== 'seq') throw new Error('a seq challenge was expected')
    const sol = solutionOf(dff)
    // A D latch alone, wired to D and CLK.
    const latch = ((): Circuit => {
      const b = new CircuitBuilder()
      const d = b.add('switch', 0, 0, { label: 'D' })
      const clk = b.add('switch', 0, 70, { label: 'CLK' })
      const l = b.add('dlatch', 150, 0)
      const q = b.add('led', 300, 0, { label: 'Q' })
      b.wire(`${d}.Q`, `${l}.D`)
      b.wire(`${clk}.Q`, `${l}.E`)
      b.wire(`${l}.Q`, `${q}.A`)
      return b.build()
    })()
    expect(checkChallenge(ch, sol).passed).toBe(true)
    expect(checkChallenge({ ...ch, rules: undefined }, latch).passed).toBe(false)
  })
})

describe('chapter 8, counting and memories, and what a chapter unlocks', () => {
  it('has the six steps, in the order of the plan, and the chips each build makes', () => {
    expect(stepIdsOf('counting')).toEqual(['tff', 'counter4', 'pc', 'rom-gates', 'ram4x4', 'rom-ram-tour'])
    expect(['tff', 'counter4', 'pc', 'ram4x4'].map((id) => (getStep(id) as BuildStep).chip)).toEqual(['TFF', 'COUNT4', 'PC', 'RAM4'])
  })

  it('counts 17 ticks and wraps: the counter asked for goes 1…15, 0, 1', () => {
    const ch = challengeOf(getStep('counter4') as BuildStep)
    if (ch.kind !== 'seq') throw new Error('a seq challenge was expected')
    const outs = ch.steps.filter((s) => s.pulse).map((s) => ['Q3', 'Q2', 'Q1', 'Q0'].reduce((n, k) => n * 2 + (s.expect[k] ?? 0), 0))
    expect(outs.slice(2, 19)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1])
  })

  it('unlocks built-in parts that exist, for chapters that exist', () => {
    for (const c of CHAPTERS.filter((x) => x.unlocks)) {
      expect(stepIdsOf(c.id).length, c.id).toBeGreaterThan(0)
      for (const t of c.unlocks!) expect(hasDef(t), `${c.id}: ${t}`).toBe(true)
    }
  })

  it('unlocks a chapter’s parts when every one of its steps is done, however it was done, and not before', () => {
    let p = emptyProgress()
    const ids = stepIdsOf('memory')
    expect(unlockedParts(p)).toEqual([])
    for (const id of ids.slice(0, -1)) p = markDone(p, id, 'shown', 1)
    expect(chapterDone(p, 'memory')).toBe(false)
    const done = markDone(p, ids[ids.length - 1], 'solved', 2)
    expect(chaptersUnlockedBy(p, done).map((c) => c.id)).toEqual(['memory'])
    expect(unlockedParts(done)).toEqual(['srlatch', 'dlatch', 'dff', 'register'])
    expect(chaptersUnlockedBy(done, markDone(done, ids[0], 'solved', 3))).toEqual([])
  })
})

describe('the whole path, read through', () => {
  const paragraphs = (s: (typeof STEPS)[number]) => s.lesson.flatMap((b) => ('p' in b ? [b.p] : []))

  it('has steps in all 14 chapters', () => {
    expect(CHAPTERS.length).toBe(14)
    for (const c of CHAPTERS) expect(stepsOf(c.id).length, c.id).toBeGreaterThan(0)
  })

  it('keeps each lesson short enough to read beside the circuit: at most five paragraphs and 1,500 characters', () => {
    for (const s of STEPS) {
      expect(paragraphs(s).length, s.id).toBeLessThanOrEqual(5)
      expect(paragraphs(s).join('').length, s.id).toBeLessThanOrEqual(1500)
    }
  })

  it('keeps titles and summaries short, and the text clean: no double spaces, whole sentences, backticks and [[ ]] in pairs', () => {
    for (const s of STEPS) {
      expect(s.title.length, `${s.id}: title`).toBeLessThanOrEqual(40)
      expect(s.summary.length, `${s.id}: summary`).toBeLessThanOrEqual(130)
      const texts = [s.summary, ...paragraphs(s), ...(s.kind === 'build' || s.kind === 'explore' || s.kind === 'project' || s.kind === 'program' ? [s.task ?? ''] : [])]
      for (const t of texts) {
        expect(t, `${s.id}: ${t.slice(0, 30)}`).not.toMatch(/ {2}|\s$|^\s/)
        expect((t.match(/`/g) ?? []).length % 2, `${s.id}: backticks`).toBe(0)
        expect((t.match(/\[\[/g) ?? []).length, `${s.id}: [[ ]]`).toBe((t.match(/\]\]/g) ?? []).length)
      }
      for (const p of paragraphs(s)) expect(p, `${s.id}: ${p.slice(0, 30)}`).toMatch(/[.?!:)”"…`]$/)
    }
  })
})

describe('merging progress', () => {
  it('adds what a backup has: done in either is done, solving beats being shown, a star stays, and the answers of a quiz come along', () => {
    let mine = emptyProgress()
    mine = markDone(mine, 'a', 'shown', 5)
    mine = markDone(mine, 'b', 'solved', 6)
    mine = { ...mine, current: 'b', quiz: { q1: [1, 2] } }
    let theirs = emptyProgress()
    theirs = markDone(theirs, 'a', 'solved', 9, true)
    theirs = markDone(theirs, 'b', 'shown', 9)
    theirs = markDone(theirs, 'c', 'read', 9)
    theirs = { ...theirs, current: 'c', quiz: { q1: [0, 0], q2: [3] } }
    const merged = mergeProgress(mine, JSON.parse(JSON.stringify(theirs)))
    expect(merged.done.a).toEqual({ at: 5, how: 'solved', star: true })
    expect(merged.done.b).toMatchObject({ how: 'solved' })
    expect(merged.done.c).toMatchObject({ how: 'read' })
    expect(merged.current).toBe('b')
    expect(merged.quiz).toEqual({ q1: [1, 2], q2: [3] })
  })

  it('takes nothing from a value that is not progress', () => {
    const mine = markDone(emptyProgress(), 'a', 'solved', 1)
    for (const junk of [null, 5, 'x', [], { v: 2, done: { z: { how: 'solved', at: 1 } } }]) expect(mergeProgress(mine, junk)).toEqual(mine)
  })
})
