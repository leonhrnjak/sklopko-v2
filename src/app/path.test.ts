import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The learning path's app layer: opening, checking and showing steps, the kit and the progress it keeps. The modules read
 * `localStorage` and the address when they load, so each test loads fresh ones against a stand-in browser.
 */

let storage: Map<string, string>
let url: { pathname: string; search: string; hash: string }

beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  url = { pathname: '/', search: '', hash: '' }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  })
  vi.stubGlobal('location', url)
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, to: string) => void (url.pathname = to.split('?')[0]) })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('window', { setTimeout: () => 0, addEventListener: () => {} }) // the toasts, and the save when the page is left
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The modules, loaded fresh, with an empty library. */
async function load() {
  const library = await import('./library')
  library.setBackend(library.memoryBackend())
  const [path, work, kitStore, store, documents, challenges, chips, steps, check] = await Promise.all([
    import('./path'),
    import('./pathWork'),
    import('./pathKit'),
    import('./store'),
    import('./documents'),
    import('./challenges'),
    import('../model/path/chips'),
    import('../model/path/steps'),
    import('../model/challengecheck'),
  ])
  documents.startAutosave()
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { library, ...path, ...work, ...kitStore, ...store, ...documents, challenges, chips, steps, check, flush }
}

const done = (m: Awaited<ReturnType<typeof load>>, id: string) => m.usePath.getState().progress.done[id]

describe('opening a step', () => {
  it('puts the step’s starting circuit on the canvas as a document of its own, with its parts and chips in the palette', async () => {
    const m = await load()
    await m.startStep('and-from-nand')
    await m.flush()
    const s = m.usePath.getState()
    expect(s.step).toBe('and-from-nand')
    expect(s.palette).toEqual(['nand', 'switch', 'led'])
    expect(s.ours).toEqual(['not-from-nand']) // nothing built yet: the circuit has ours
    expect(Object.keys(m.useStore.getState().circuit.ics ?? {})).toEqual(['kit:not-from-nand'])
    expect(url.pathname).toBe('/learn/and-from-nand')
    expect(s.progress.current).toBe('and-from-nand')
    expect(JSON.parse(storage.get('sklopko.path.v1')!).current).toBe('and-from-nand')
    const [doc] = await m.library.listDocs('circuit')
    expect(doc).toMatchObject({ name: 'Learn: AND, from NAND and your NOT', origin: { path: 'and-from-nand' } })
  })

  it('brings back the work the second time, with the learner’s own chips in place of ours', async () => {
    const m = await load()
    await m.startStep('and-from-nand')
    await m.flush()
    m.addComp('nand', 200, 100)
    await new Promise((r) => setTimeout(r, 600)) // the autosave
    const parts = Object.keys(m.useStore.getState().circuit.comps).length
    // The learner builds a NOT (called something else here, so it can be told from ours) and comes back.
    const not = m.steps.getStep('not-from-nand')!
    m.putChip('not-from-nand', m.chips.snapshot('MY NOT', m.chips.solutionOf(not as never)))
    await m.startStep('and-from-nand')
    await m.flush()
    const c = m.useStore.getState().circuit
    expect(Object.keys(c.comps)).toHaveLength(parts)
    expect(c.ics!['kit:not-from-nand'].name).toBe('MY NOT')
    expect(m.usePath.getState().ours).toEqual([])
    expect(await m.library.listDocs('circuit')).toHaveLength(1)
  })

  it('a read step leaves the canvas as it is, and an unknown step opens the map', async () => {
    const m = await load()
    const before = m.useStore.getState().circuit
    await m.startStep('binary')
    expect(m.usePath.getState()).toMatchObject({ step: 'binary', palette: null })
    expect(m.useStore.getState().circuit).toBe(before)
    await m.startStep('no-such-step')
    expect(m.usePath.getState().mapOpen).toBe(true)
  })

  it('is ended by another document, and the palette is whole again', async () => {
    const m = await load()
    await m.startStep('not-from-nand')
    await m.flush()
    expect(m.usePath.getState().palette).not.toBeNull()
    m.openCircuit(new (await import('../model/builder')).CircuitBuilder().c, { mode: 'on-edit', name: 'Other' })
    expect(m.usePath.getState()).toMatchObject({ step: null, palette: null })
    expect(url.pathname).toBe('/')
  })

  it('is opened by an address, and the map by /learn', async () => {
    const m = await load()
    await m.openLearnRoute({ step: null })
    expect(m.usePath.getState().mapOpen).toBe(true)
    expect(url.pathname).toBe('/learn')
    m.closeMap()
    expect(url.pathname).toBe('/')
    await m.openLearnRoute({ step: 'wire' })
    expect(m.usePath.getState()).toMatchObject({ step: 'wire', mapOpen: false })
  })
})

describe('checking a step', () => {
  it('turns a passing circuit into a chip of the kit and remembers the step, also as the challenge it is', async () => {
    const m = await load()
    await m.startStep('or-from-nand')
    await m.flush()
    m.checkStep()
    expect(m.usePath.getState().result?.check.passed).toBe(false)
    expect(done(m, 'or-from-nand')).toBeUndefined()
    expect(m.useKit.getState().kit).toEqual({})

    m.loadCircuit(m.chips.solutionOf(m.steps.getStep('or-from-nand') as never))
    m.checkStep()
    expect(m.usePath.getState().result?.check.passed).toBe(true)
    expect(done(m, 'or-from-nand')).toMatchObject({ how: 'solved' })
    expect(Object.keys(m.useKit.getState().kit)).toEqual(['or-from-nand'])
    expect(m.useKit.getState().kit['or-from-nand'].name).toBe('OR')
    expect(JSON.parse(storage.get('sklopko.path.kit.v1')!)['or-from-nand'].name).toBe('OR')
    expect(JSON.parse(storage.get('sklopko.path.v1')!).done['or-from-nand'].how).toBe('solved')
    // The step is the challenge of the same name: its list ticks it too.
    expect(m.challenges.useChallenges.getState().solved).toContain('or-from-nand')
  })

  it('does not count the solution it showed, until the learner changes it', async () => {
    const m = await load()
    await m.startStep('not-from-nand')
    await m.flush()
    m.showStepSolution()
    expect(done(m, 'not-from-nand')).toMatchObject({ how: 'shown' })
    expect(m.useKit.getState().kit['not-from-nand'].name).toBe('NOT') // ours, so the next steps work
    m.checkStep()
    expect(m.usePath.getState().result?.check.passed).toBe(true)
    expect(done(m, 'not-from-nand')?.how).toBe('shown')
    expect(m.challenges.useChallenges.getState().solved).not.toContain('not-from-nand')

    // A change to the circuit, and the check is the learner's: solved.
    m.addComp('led', 300, 300)
    m.checkStep()
    expect(done(m, 'not-from-nand')?.how).toBe('solved')
  })

  it('keeps the learner’s own chip when a solution is shown afterwards', async () => {
    const m = await load()
    await m.startStep('not-from-nand')
    await m.flush()
    const step = m.steps.getStep('not-from-nand') as never
    m.loadCircuit(m.chips.solutionOf(step))
    m.checkStep()
    const mine = m.useKit.getState().kit['not-from-nand']
    expect(done(m, 'not-from-nand')?.how).toBe('solved')
    m.showStepSolution()
    expect(done(m, 'not-from-nand')?.how).toBe('solved')
    expect(m.useKit.getState().kit['not-from-nand']).toBe(mine)
  })

  it('gives the star for the par, and keeps it', async () => {
    const m = await load()
    await m.startStep('xor-from-kit')
    await m.flush()
    m.loadCircuit(m.chips.solutionOf(m.steps.getStep('xor-from-kit') as never))
    m.checkStep()
    expect(m.usePath.getState().result).toMatchObject({ star: false })
    expect(done(m, 'xor-from-kit')?.star).toBeUndefined()
  })

  it('starts over with the starting circuit', async () => {
    const m = await load()
    await m.startStep('not-from-nand')
    await m.flush()
    m.showStepSolution()
    expect(Object.keys(m.useStore.getState().circuit.wires).length).toBeGreaterThan(0)
    m.restartStep()
    expect(Object.keys(m.useStore.getState().circuit.wires)).toHaveLength(0)
    expect(m.usePath.getState().result).toBeNull()
  })
})

describe('going on', () => {
  it('a read step is done when read, and next goes to the step after it; at the end, back to the map', async () => {
    const m = await load()
    await m.startStep('binary')
    m.markRead()
    expect(done(m, 'binary')).toMatchObject({ how: 'read' })
    m.nextStep()
    await m.flush()
    expect(m.usePath.getState().step).toBe('show-nine')
    await m.startStep(m.steps.PATH_STEPS[m.steps.PATH_STEPS.length - 1])
    m.nextStep()
    expect(m.usePath.getState()).toMatchObject({ step: null, mapOpen: true })
  })

  it('keeps the answers to a quiz, and a read step with every answer right is read', async () => {
    const m = await load()
    const step = m.steps.getStep('binary')!
    const questions = step.lesson.flatMap((b) => ('quiz' in b ? b.quiz : []))
    expect(questions.length).toBeGreaterThan(1)
    await m.startStep('binary')
    m.answerQuiz('binary', 0, (questions[0].answer + 1) % questions[0].options.length, questions)
    expect(m.usePath.getState().progress.quiz.binary).toEqual([(questions[0].answer + 1) % questions[0].options.length, ...questions.slice(1).map(() => -1)])
    expect(done(m, 'binary')).toBeUndefined()
    questions.forEach((q, i) => m.answerQuiz('binary', i, q.answer, questions))
    expect(done(m, 'binary')).toMatchObject({ how: 'read' })
    // Remembered after a reload.
    vi.resetModules()
    const again = await load()
    expect(again.usePath.getState().progress.quiz.binary).toEqual(questions.map((q) => q.answer))
  })

  it('marking a build step as read does nothing', async () => {
    const m = await load()
    await m.startStep('wire')
    await m.flush()
    m.markRead()
    expect(done(m, 'wire')).toBeUndefined()
  })
})

describe('forgetting', () => {
  it('clears the progress and the kit from the store and from the browser, but not the documents', async () => {
    const m = await load()
    await m.startStep('not-from-nand')
    await m.flush()
    m.showStepSolution()
    expect(storage.has('sklopko.path.v1')).toBe(true)
    expect(storage.has('sklopko.path.kit.v1')).toBe(true)
    m.forgetAll()
    expect(m.usePath.getState().progress.done).toEqual({})
    expect(m.useKit.getState().kit).toEqual({})
    expect(storage.has('sklopko.path.v1')).toBe(false)
    expect(storage.has('sklopko.path.kit.v1')).toBe(false)
    expect(await m.library.listDocs('circuit')).toHaveLength(1)
  })
})

describe('what is stored', () => {
  it('is read again at the next start, and a broken value is ignored', async () => {
    storage.set('sklopko.path.v1', JSON.stringify({ v: 1, done: { wire: { at: 1, how: 'solved' }, junk: { at: 'x' } }, current: 'wire', quiz: {} }))
    storage.set('sklopko.path.kit.v1', 'not json')
    const m = await load()
    expect(Object.keys(m.usePath.getState().progress.done)).toEqual(['wire'])
    expect(m.useKit.getState().kit).toEqual({})
    vi.resetModules()
    storage.set('sklopko.path.v1', '{{{')
    const again = await load()
    expect(again.usePath.getState().progress.done).toEqual({})
  })
})
