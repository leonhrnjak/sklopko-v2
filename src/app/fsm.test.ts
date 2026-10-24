import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRAFFIC_LIGHT } from '../model/fsm-examples'
import { addState, parseFsmDocument, renameState } from '../model/fsm-edit'
import { checkpointFsm, codesFor, editFsm, flushFsm, loadFsm, openStoredFsm, redoFsm, restoreFsm, selectInFsm, startFromBlank, startFromExample, tryGenerate, undoFsm, useFsm } from './fsm'
import { activeDoc, getDoc, listDocs, memoryBackend, setBackend } from './library'

const reset = () => {
  startFromExample(1)
  useFsm.setState({ past: [], future: [], selected: null, encoding: 'binary', custom: {} })
}

describe('the state machine editor: undo and redo', () => {
  beforeEach(reset)

  it('each edit is one undo step; undo and redo walk through them', () => {
    const start = useFsm.getState().fsm
    editFsm((f) => addState(f, 500, 100).fsm)
    editFsm((f) => renameState(f, 'Start', 'Alpha'))
    expect(useFsm.getState().fsm.states).toHaveLength(start.states.length + 1)
    undoFsm()
    expect(useFsm.getState().fsm.states[0].name).toBe('Start')
    undoFsm()
    expect(useFsm.getState().fsm).toBe(start)
    undoFsm() // nothing left: no harm
    expect(useFsm.getState().fsm).toBe(start)
    redoFsm()
    redoFsm()
    expect(useFsm.getState().fsm.states[0].name).toBe('Alpha')
    expect(useFsm.getState().future).toHaveLength(0)
  })

  it('a new edit forgets what could have been redone', () => {
    editFsm((f) => addState(f, 500, 100).fsm)
    undoFsm()
    expect(useFsm.getState().future).toHaveLength(1)
    editFsm((f) => addState(f, 500, 300).fsm)
    expect(useFsm.getState().future).toHaveLength(0)
  })

  it('typing in one box is one step; a change that changes nothing is none', () => {
    editFsm((f) => ({ ...f, name: 'Dete' }), { merge: 'name' })
    editFsm((f) => ({ ...f, name: 'Detec' }), { merge: 'name' })
    editFsm((f) => ({ ...f, name: 'Detect' }), { merge: 'name' })
    expect(useFsm.getState().past).toHaveLength(1)
    editFsm((f) => ({ ...f, name: 'Other' }), { merge: 'other' })
    expect(useFsm.getState().past).toHaveLength(2)
    editFsm((f) => f)
    expect(useFsm.getState().past).toHaveLength(2)
  })

  it('a drag is one step: a checkpoint, then moves without steps', () => {
    checkpointFsm()
    for (let i = 1; i <= 5; i++) editFsm((f) => ({ ...f, states: f.states.map((s, k) => (k === 0 ? { ...s, x: i * 10 } : s)) }), { commit: false })
    expect(useFsm.getState().past).toHaveLength(1)
    expect(useFsm.getState().fsm.states[0].x).toBe(50)
    undoFsm()
    expect(useFsm.getState().fsm.states[0].x).not.toBe(50)
  })

  it('loading a machine replaces the current one, clears the selection and the undo history, and lays it out', () => {
    editFsm((f) => addState(f, 500, 100).fsm)
    selectInFsm({ kind: 'state', id: 'One' })
    loadFsm({ fsm: TRAFFIC_LIGHT, encoding: 'onehot' })
    const s = useFsm.getState()
    expect(s.fsm.name).toBe('Traffic light')
    expect(s.fsm.states.every((x) => x.x !== undefined)).toBe(true) // laid out
    expect([s.encoding, s.selected]).toEqual(['onehot', null])
    // The machine before is a document of its own in the library: there is nothing to undo back to.
    expect([s.past, s.future]).toEqual([[], []])
  })

  it('a blank machine is one you can edit and generate from', () => {
    startFromBlank()
    const { fsm, encoding, custom } = useFsm.getState()
    expect(tryGenerate(fsm, encoding, custom)).not.toBeInstanceOf(Error)
  })

  it('does not change the machines it started from', () => {
    startFromExample(0)
    editFsm((f) => renameState(f, 'Red', 'Stop'))
    expect(TRAFFIC_LIGHT.states[0].name).toBe('Red')
  })
})

describe('generating from the editor', () => {
  beforeEach(reset)

  it('says why a broken machine cannot be built', () => {
    editFsm((f) => ({ ...f, reset: 'nowhere' }))
    const { fsm, encoding, custom } = useFsm.getState()
    const made = tryGenerate(fsm, encoding, custom)
    expect(made).toBeInstanceOf(Error)
    expect((made as Error).message).toContain('reset state')
  })

  it('builds with the chosen encoding and codes', () => {
    useFsm.setState({ encoding: 'onehot' })
    const { fsm, encoding, custom } = useFsm.getState()
    expect(codesFor(fsm, encoding, custom).bits).toBe(4)
    const made = tryGenerate(fsm, encoding, custom)
    if (made instanceof Error) throw made
    expect(made.parts.flops).toHaveLength(4)
  })
})

describe('the state machine editor and the library', () => {
  beforeEach(async () => {
    flushFsm() // what the tests before left waiting goes to their library, not this one
    await new Promise((resolve) => setTimeout(resolve, 5)) // and is written before the library is swapped
    vi.useFakeTimers()
    setBackend(memoryBackend())
    startFromExample(1)
    await vi.advanceTimersByTimeAsync(500)
  })
  afterEach(async () => {
    await vi.advanceTimersByTimeAsync(500) // a save still waiting goes to this test's library, not the next one's
    vi.useRealTimers()
  })
  const settle = () => vi.advanceTimersByTimeAsync(500)

  it('a starting point is not kept until it is edited; then it is a document named after the machine', async () => {
    startFromExample(0)
    await settle()
    expect(await listDocs('fsm')).toEqual([])
    editFsm((f) => addState(f, 500, 100).fsm)
    await settle()
    const [doc] = await listDocs('fsm')
    expect(doc.name).toBe('Traffic light')
    expect(activeDoc('fsm')?.id).toBe(doc.id)
    // Later edits go into the same document, and what is stored reads back as the machine.
    editFsm((f) => ({ ...f, name: 'Renamed' }))
    await settle()
    expect(await listDocs('fsm')).toHaveLength(1)
    const stored = parseFsmDocument(JSON.stringify((await getDoc(doc.id))!.data))
    expect(stored.fsm.name).toBe('Renamed')
    expect(stored.fsm.states).toHaveLength(TRAFFIC_LIGHT.states.length + 1)
  })

  it('a blank machine is "Untitled N" once it is edited', async () => {
    startFromBlank()
    await settle()
    expect(await listDocs('fsm')).toEqual([])
    editFsm((f) => addState(f, 500, 100).fsm)
    await settle()
    expect((await listDocs('fsm')).map((d) => d.name)).toEqual(['Untitled 1'])
  })

  it('loading another machine keeps the edit that was waiting, in its own document', async () => {
    startFromExample(0)
    editFsm((f) => addState(f, 500, 100).fsm)
    startFromExample(1) // the delay has not passed
    await settle()
    const docs = await listDocs('fsm')
    expect(docs).toHaveLength(1)
    const stored = parseFsmDocument(JSON.stringify((await getDoc(docs[0].id))!.data))
    expect(stored.fsm.states).toHaveLength(TRAFFIC_LIGHT.states.length + 1)
    expect(useFsm.getState().fsm.name).toBe('Detect 1011') // and the new one is showing, with no document yet
    expect(activeDoc('fsm')).toBeNull()
  })

  it('a machine of the library opens again, as it was, and is saved into', async () => {
    startFromExample(0)
    editFsm((f) => ({ ...f, name: 'Mine' }))
    useFsm.setState({ encoding: 'gray' })
    await settle()
    const id = activeDoc('fsm')!.id
    startFromExample(1)
    await openStoredFsm(id)
    expect(useFsm.getState()).toMatchObject({ encoding: 'gray', open: true, past: [] })
    expect(useFsm.getState().fsm.name).toBe('Mine')
    editFsm((f) => ({ ...f, name: 'Mine, edited' }))
    await settle()
    expect(await listDocs('fsm')).toHaveLength(1)
    await expect(openStoredFsm('nope')).rejects.toThrow('no longer in your library')
  })

  it('restoring at startup shows the last machine used, or leaves the starting example alone', async () => {
    await restoreFsm()
    expect(useFsm.getState().fsm.name).toBe('Detect 1011')
    startFromExample(0)
    editFsm((f) => ({ ...f, name: 'Kept' }))
    await settle()
    startFromExample(1)
    await restoreFsm()
    expect(useFsm.getState().fsm.name).toBe('Kept')
  })
})
