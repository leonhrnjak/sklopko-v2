import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { EXAMPLES } from '../model/examples'
import { deserialize } from '../model/serialize'
import { newCircuit, openCircuit, startAutosave } from './documents'
import { setEmbed } from './embed'
import { activeDoc, getDoc, listDocs, memoryBackend, setActive, setBackend } from './library'
import { addComp, interact, undo, useStore } from './store'

const flush = async () => {
  await vi.advanceTimersByTimeAsync(500)
}
const circuit = () => useStore.getState().circuit
const withSwitch = () => {
  const b = new CircuitBuilder()
  b.add('switch', 0, 0)
  return b.c
}

beforeAll(() => {
  startAutosave()
})

beforeEach(async () => {
  vi.useFakeTimers()
  setBackend(memoryBackend())
  // Whatever an earlier test left unsaved is not this test's business.
  openCircuit(new CircuitBuilder().c, { mode: 'on-edit', name: 'scratch' })
  await flush()
})

afterEach(() => {
  setEmbed(false)
  vi.useRealTimers()
})

describe('opening a circuit', () => {
  it('an example has no document until it is edited; then it becomes "<name> (copy)"', async () => {
    const ex = EXAMPLES.find((e) => e.id === 'gates')!
    openCircuit(ex.build(), { mode: 'on-edit', name: `${ex.name} (copy)`, origin: { example: ex.id } })
    await flush()
    expect(await listDocs()).toEqual([])
    expect(activeDoc()).toBeNull()

    // Operating a switch is not editing.
    const sw = Object.values(circuit().comps).find((k) => k.type === 'switch')!
    interact(sw.id, false)
    await flush()
    expect(await listDocs()).toEqual([])

    addComp('and', 300, 300)
    await flush()
    const [doc] = await listDocs()
    expect(doc).toMatchObject({ name: 'Basic gates (copy)', origin: { example: 'gates' }, kind: 'circuit' })
    expect(activeDoc()?.id).toBe(doc.id)
    // What was saved is the edited circuit, with the switch as it was left.
    const saved = deserialize((await getDoc(doc.id))!.data)
    expect(Object.keys(saved.comps)).toHaveLength(Object.keys(circuit().comps).length)
    expect(saved.comps[sw.id].params.on).toBe(circuit().comps[sw.id].params.on)

    // Further edits go into the same document.
    addComp('or', 400, 300)
    await flush()
    expect(await listDocs()).toHaveLength(1)
  })

  it('a document opened "now" is saved at once, under its own name', async () => {
    openCircuit(withSwitch(), { mode: 'now', name: 'Shared circuit' })
    await flush()
    const [doc] = await listDocs()
    expect(doc.name).toBe('Shared circuit')
    expect(activeDoc()?.id).toBe(doc.id)
  })

  it('a stored document is saved into itself, however it is changed', async () => {
    openCircuit(withSwitch(), { mode: 'now', name: 'A' })
    await flush()
    const meta = activeDoc()!
    openCircuit(withSwitch(), { mode: 'on-edit', name: 'other' })
    openCircuit(deserialize((await getDoc(meta.id))!.data), { mode: 'stored', meta })
    expect(activeDoc()?.id).toBe(meta.id)
    const sw = Object.values(circuit().comps)[0]
    interact(sw.id, false) // switch positions are part of a stored document
    await flush()
    expect(await listDocs()).toHaveLength(1)
    expect(deserialize((await getDoc(meta.id))!.data).comps[sw.id].params.on).toBe(!!circuit().comps[sw.id].params.on)
  })

  it('switching documents keeps the edit that was waiting to be saved, in the document it was made in', async () => {
    openCircuit(withSwitch(), { mode: 'now', name: 'A' })
    await flush()
    const a = activeDoc()!
    addComp('and', 200, 200) // not yet saved: the delay has not passed
    openCircuit(withSwitch(), { mode: 'now', name: 'B' })
    await flush()
    const docs = await listDocs()
    expect(docs.map((d) => d.name).sort()).toEqual(['A', 'B'])
    expect(Object.keys(deserialize((await getDoc(a.id))!.data).comps)).toHaveLength(2)
    const b = docs.find((d) => d.name === 'B')!
    expect(Object.keys(deserialize((await getDoc(b.id))!.data).comps)).toHaveLength(1)
  })

  it('has no undo history from the document before', () => {
    addComp('and', 10, 10)
    expect(useStore.getState().past.length).toBeGreaterThan(0)
    openCircuit(withSwitch(), { mode: 'on-edit', name: 'x' })
    expect(useStore.getState().past).toEqual([])
    undo()
    expect(Object.keys(circuit().comps)).toHaveLength(1)
  })

  it('an embedded circuit never touches the library', async () => {
    setEmbed(true)
    openCircuit(withSwitch(), { mode: 'now', name: 'Shared circuit' })
    await flush()
    expect(await listDocs()).toEqual([])
    expect(Object.keys(circuit().comps)).toHaveLength(1)
  })
})

describe('New', () => {
  it('is "Untitled N" once something is in it, and a blank one that is left alone makes no document', async () => {
    newCircuit()
    await flush()
    expect(await listDocs()).toEqual([])
    addComp('and', 10, 10)
    await flush()
    expect((await listDocs()).map((d) => d.name)).toEqual(['Untitled 1'])

    newCircuit()
    newCircuit() // pressed again: still nothing new
    addComp('and', 10, 10)
    await flush()
    expect((await listDocs()).map((d) => d.name).sort()).toEqual(['Untitled 1', 'Untitled 2'])
  })

  it('what was open stays in the library', async () => {
    newCircuit()
    addComp('and', 10, 10)
    await flush()
    const first = activeDoc()!
    newCircuit()
    expect(Object.keys(circuit().comps)).toHaveLength(0)
    setActive(null)
    expect(Object.keys(deserialize((await getDoc(first.id))!.data).comps)).toHaveLength(1)
  })
})
