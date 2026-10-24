import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  activeDoc,
  deleteDoc,
  getDoc,
  idbBackend,
  listDocs,
  memoryBackend,
  openLastDoc,
  putDoc,
  saveActive,
  setActive,
  setBackend,
  type DocRecord,
  type LibraryBackend,
} from './library'

const rec = (id: string, updated: number, extra: Partial<DocRecord> = {}): DocRecord => ({
  id,
  kind: 'circuit',
  name: id,
  created: 1,
  updated,
  data: { comps: [id] },
  ...extra,
})

// Both backends must behave the same: the memory one stands in for the browser's database in the other tests.
const backends: [string, () => LibraryBackend][] = [
  ['memory', () => memoryBackend()],
  ['IndexedDB', () => idbBackend(new IDBFactory())],
]

describe.each(backends)('%s backend', (_name, make) => {
  let b: LibraryBackend
  beforeEach(() => {
    b = make()
  })

  test('put, get, list and remove', async () => {
    expect(await b.list()).toEqual([])
    await b.put(rec('a', 5, { origin: { example: 'gates' } }))
    await b.put(rec('b', 7))
    expect(await b.get('a')).toEqual(rec('a', 5, { origin: { example: 'gates' } }))
    expect(await b.get('nope')).toBeUndefined()
    // The list leaves the data out.
    const list = await b.list()
    expect(list.map((m) => m.id).sort()).toEqual(['a', 'b'])
    expect(list.every((m) => !('data' in m))).toBe(true)
    await b.remove('a')
    expect((await b.list()).map((m) => m.id)).toEqual(['b'])
    expect(await b.get('a')).toBeUndefined()
  })

  test('put replaces a record, in the list too', async () => {
    await b.put(rec('a', 5))
    await b.put(rec('a', 9, { name: 'renamed', data: { comps: [] } }))
    expect((await b.list()).map((m) => [m.name, m.updated])).toEqual([['renamed', 9]])
    expect((await b.get('a'))?.data).toEqual({ comps: [] })
  })

  test('what comes back is a copy', async () => {
    const r = rec('a', 5)
    await b.put(r)
    ;(r.data as { comps: string[] }).comps.push('changed after saving')
    expect(((await b.get('a'))!.data as { comps: string[] }).comps).toEqual(['a'])
  })
})

describe('IndexedDB backend', () => {
  test('keeps records between openings, and opens again after the database was deleted', async () => {
    const factory = new IDBFactory()
    await idbBackend(factory).put(rec('a', 5))
    expect((await idbBackend(factory).get('a'))?.name).toBe('a')

    const b = idbBackend(factory)
    await b.put(rec('b', 6))
    await new Promise((resolve) => {
      const del = factory.deleteDatabase('sklopko')
      del.onsuccess = del.onerror = () => resolve(null)
    })
    expect(await b.list()).toEqual([]) // reopened, empty
    await b.put(rec('c', 7))
    expect((await b.list()).map((m) => m.id)).toEqual(['c'])
  })
})

describe('the library', () => {
  beforeEach(() => {
    setBackend(memoryBackend())
  })

  test('lists a kind, newest first', async () => {
    await putDoc(rec('old', 1))
    await putDoc(rec('new', 9))
    await putDoc(rec('fsm', 5, { kind: 'fsm' }))
    expect((await listDocs()).map((d) => d.id)).toEqual(['new', 'fsm', 'old'])
    expect((await listDocs('circuit')).map((d) => d.id)).toEqual(['new', 'old'])
    expect((await listDocs('fsm')).map((d) => d.id)).toEqual(['fsm'])
  })

  test('the first save makes a document, later ones update it', async () => {
    expect(activeDoc()).toBeNull()
    await saveActive('circuit', { n: 1 })
    const first = activeDoc()!
    expect(first.name).toBe('My circuit')
    await saveActive('circuit', { n: 2 })
    expect(activeDoc()!.id).toBe(first.id)
    const docs = await listDocs()
    expect(docs).toHaveLength(1)
    expect(docs[0].updated).toBeGreaterThanOrEqual(first.created)
    expect((await getDoc(first.id))?.data).toEqual({ n: 2 })
  })

  test('saves in quick succession make one document, not several', async () => {
    await Promise.all([saveActive('circuit', 1), saveActive('circuit', 2), saveActive('circuit', 3)])
    expect(await listDocs()).toHaveLength(1)
    expect((await getDoc(activeDoc()!.id))?.data).toBe(3)
  })

  test('a save keeps the name and origin the document has', async () => {
    await putDoc(rec('x', 1, { name: 'Counter', origin: { example: 'counter' } }))
    await openLastDoc('circuit')
    await saveActive('circuit', { n: 2 })
    expect(await getDoc('x')).toMatchObject({ name: 'Counter', origin: { example: 'counter' }, data: { n: 2 } })
  })

  test('opening the last document: the one pointed at, else the most recent, else nothing', async () => {
    expect(await openLastDoc('circuit')).toBeUndefined()
    await putDoc(rec('a', 1))
    await putDoc(rec('b', 2))
    await putDoc(rec('f', 3, { kind: 'fsm' }))
    // Nothing remembered (this runs in Node: no session or local storage): the most recent circuit.
    expect((await openLastDoc('circuit'))?.id).toBe('b')
    expect(activeDoc()?.id).toBe('b')
    expect((await openLastDoc('fsm'))?.id).toBe('f')
    expect(activeDoc()?.id).toBe('f')
  })

  test('deleting the active document leaves nothing active; the next save starts a new one', async () => {
    await saveActive('circuit', 1)
    const id = activeDoc()!.id
    await deleteDoc(id)
    expect(activeDoc()).toBeNull()
    expect(await getDoc(id)).toBeUndefined()
    await saveActive('circuit', 2)
    expect(activeDoc()!.id).not.toBe(id)
  })

  test('a circuit save does not overwrite an active state machine', async () => {
    await putDoc(rec('f', 1, { kind: 'fsm' }))
    await openLastDoc('fsm')
    await saveActive('circuit', 1)
    expect((await getDoc('f'))?.kind).toBe('fsm')
    expect((await listDocs('circuit')).length).toBe(1)
  })

  test('setActive(null) forgets the active document', async () => {
    await saveActive('circuit', 1)
    setActive(null)
    expect(activeDoc()).toBeNull()
  })
})
