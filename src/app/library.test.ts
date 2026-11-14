import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  activeDoc,
  deleteDoc,
  describeBackup,
  duplicateDoc,
  exportAll,
  getDoc,
  importDocs,
  idbBackend,
  lastBackup,
  listDocs,
  MAX_THUMB,
  memoryBackend,
  nextUntitled,
  noteBackup,
  onActiveChange,
  openLastDoc,
  putDoc,
  renameDoc,
  resetPersistenceAsked,
  restoreDoc,
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
    // A state machine is active beside the circuit, not instead of it.
    expect((await openLastDoc('fsm'))?.id).toBe('f')
    expect(activeDoc('fsm')?.id).toBe('f')
    expect(activeDoc()?.id).toBe('b')
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

  test('a new document gets the name and origin it is made with, and a name can be worked out when it is saved', async () => {
    await saveActive('circuit', 1, { name: 'Counter (copy)', origin: { example: 'counter' } })
    expect(await getDoc(activeDoc()!.id)).toMatchObject({ name: 'Counter (copy)', origin: { example: 'counter' } })
    setActive(null)
    await saveActive('circuit', 2, { name: async () => 'Later' })
    expect(activeDoc()!.name).toBe('Later')
    expect(await getDoc(activeDoc()!.id)).toMatchObject({ name: 'Later' })
  })

  test('Untitled numbers: the first one not in use', async () => {
    expect(await nextUntitled()).toBe('Untitled 1')
    await putDoc(rec('a', 1, { name: 'Untitled 1' }))
    await putDoc(rec('b', 2, { name: 'Untitled 3' }))
    await putDoc(rec('c', 3, { name: 'Untitled 2', kind: 'fsm' })) // another kind has its own numbers
    expect(await nextUntitled()).toBe('Untitled 2')
    expect(await nextUntitled('fsm')).toBe('Untitled 1')
  })

  test('setActive(null) forgets the active document', async () => {
    await saveActive('circuit', 1)
    setActive(null)
    expect(activeDoc()).toBeNull()
  })

  test('rename: the document and the active one, and later saves keep the new name', async () => {
    await saveActive('circuit', 1)
    const id = activeDoc()!.id
    await renameDoc(id, 'Adder')
    expect(activeDoc()!.name).toBe('Adder')
    expect((await getDoc(id))?.name).toBe('Adder')
    await saveActive('circuit', 2)
    expect(await getDoc(id)).toMatchObject({ name: 'Adder', data: 2 })
    // A rename racing a save: whichever way round, the name is kept and the data is the newest.
    await Promise.all([saveActive('circuit', 3), renameDoc(id, 'Adder 2')])
    expect(await getDoc(id)).toMatchObject({ name: 'Adder 2', data: 3 })
  })

  test('duplicate: a new document with the same data, not active, without an origin', async () => {
    await putDoc(rec('a', 5, { origin: { example: 'gates' } }))
    const copy = (await duplicateDoc('a', 'A copy'))!
    expect(copy).not.toBe('a')
    expect(await getDoc(copy)).toMatchObject({ name: 'A copy', data: { comps: ['a'] }, kind: 'circuit' })
    expect((await getDoc(copy))!.origin).toBeUndefined()
    expect(await duplicateDoc('missing', 'x')).toBeUndefined()
    expect(activeDoc()).toBeNull()
  })

  test('a delete is not undone by a save that was waiting: saves, renames and deletes go in order', async () => {
    await saveActive('circuit', 1)
    const id = activeDoc()!.id
    const saves = saveActive('circuit', 2)
    const gone = deleteDoc(id)
    await Promise.all([saves, gone])
    expect(await getDoc(id)).toBeUndefined()
    expect(await listDocs()).toEqual([])
  })

  test('a deleted document can be put back', async () => {
    const r = rec('a', 5)
    await putDoc(r)
    await deleteDoc('a')
    await restoreDoc(r)
    expect(await getDoc('a')).toEqual(r)
  })

  test('listeners hear when the active document changes, per kind', async () => {
    const seen: string[] = []
    const off = onActiveChange((kind, meta) => seen.push(`${kind}:${meta?.name ?? '-'}`))
    await saveActive('circuit', 1, { name: 'One' })
    await renameDoc(activeDoc()!.id, 'Uno')
    await saveActive('fsm', 1, { name: 'Machine' })
    setActive(null)
    off()
    setActive(null)
    expect(seen).toEqual(['circuit:One', 'circuit:Uno', 'fsm:Machine', 'circuit:-'])
  })

  test('a backup holds every document, and importing adds them without overwriting', async () => {
    await putDoc(rec('a', 1))
    await putDoc(rec('f', 2, { kind: 'fsm', data: { fsm: {} } }))
    const backup = await exportAll()
    expect(backup).toMatchObject({ app: 'sklopko-library', version: 1 })
    expect(backup.docs.map((d) => d.id).sort()).toEqual(['a', 'f'])

    // Into an empty library: as they were.
    setBackend(memoryBackend())
    expect(await importDocs(JSON.parse(JSON.stringify(backup)), () => true)).toEqual({ added: 2, skipped: 0 })
    expect(await getDoc('a')).toMatchObject({ name: 'a', updated: 1 })

    // Into the library that has them: both come again under new ids, and the originals are untouched.
    await putDoc({ ...rec('a', 9), name: 'changed since' })
    expect(await importDocs(backup, () => true)).toEqual({ added: 2, skipped: 0 })
    expect(await listDocs()).toHaveLength(4)
    expect((await getDoc('a'))?.name).toBe('changed since')
  })

  test('importing skips what is broken or what the check turns down, and refuses what is not a backup', async () => {
    const good = rec('a', 1)
    const file = { app: 'sklopko-library', version: 1, docs: [good, { id: 'x' }, null, { ...rec('b', 1), kind: 'other' }, { ...rec('c', 1), data: undefined }, rec('d', 1)] }
    expect(await importDocs(file, (r) => r.id !== 'd')).toEqual({ added: 1, skipped: 5 })
    expect((await listDocs()).map((d) => d.id)).toEqual(['a'])
    expect(() => importDocs({ app: 'something else', docs: [] }, () => true)).toThrow('not a Sklopko library file')
    expect(() => importDocs('text', () => true)).toThrow('not a Sklopko library file')
    expect(() => importDocs({ app: 'sklopko-library', docs: 'no' }, () => true)).toThrow()
  })

  test('a thumbnail is kept with the document, in the list too, through renames and later saves without one', async () => {
    await saveActive('circuit', 1, { name: 'One' }, '<svg a/>')
    const id = activeDoc()!.id
    expect((await listDocs())[0].thumb).toBe('<svg a/>')
    await renameDoc(id, 'Uno')
    expect((await listDocs())[0]).toMatchObject({ name: 'Uno', thumb: '<svg a/>' })
    await saveActive('circuit', 2) // a save that made none keeps the last
    expect((await getDoc(id))?.thumb).toBe('<svg a/>')
    await saveActive('circuit', 3, undefined, '<svg b/>')
    expect((await listDocs())[0].thumb).toBe('<svg b/>')
  })

  test('a backup brings thumbnails along, and importing drops one that is not a small SVG', async () => {
    const file = {
      app: 'sklopko-library',
      version: 1,
      docs: [rec('a', 1, { thumb: '<svg ok/>' }), rec('b', 1, { thumb: '<script>x</script>' }), rec('c', 1, { thumb: `<svg>${'x'.repeat(MAX_THUMB)}</svg>` })],
    }
    expect(await importDocs(file, () => true)).toEqual({ added: 3, skipped: 0 })
    const thumbs = Object.fromEntries((await listDocs()).map((d) => [d.name, d.thumb]))
    expect(thumbs).toEqual({ a: '<svg ok/>', b: undefined, c: undefined })
  })
})

describe('asking the browser to keep the library', () => {
  const stubPersist = () => {
    const persist = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('navigator', { storage: { persist } })
    resetPersistenceAsked()
    return persist
  }

  test('not before something is saved, then once however many saves follow', async () => {
    const persist = stubPersist()
    setBackend(idbBackend(new IDBFactory()))
    expect(persist).not.toHaveBeenCalled()
    await putDoc(rec('a', 1))
    await putDoc(rec('b', 2))
    expect(persist).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  test('a library that is only in memory has nothing to keep', async () => {
    const persist = stubPersist()
    setBackend(memoryBackend())
    await putDoc(rec('a', 1))
    expect(persist).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('a refusal or a missing storage manager is ignored', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('no')) } })
    resetPersistenceAsked()
    setBackend(idbBackend(new IDBFactory()))
    await putDoc(rec('a', 1))
    vi.stubGlobal('navigator', {})
    resetPersistenceAsked()
    await putDoc(rec('b', 2))
    vi.unstubAllGlobals()
  })
})

describe('the date of the last backup', () => {
  const day = 86_400_000
  test('is remembered and described', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    expect(lastBackup()).toBeNull()
    expect(describeBackup(null)).toBe('Last backup: never')
    const now = Date.UTC(2026, 10, 11, 12)
    noteBackup(now)
    expect(lastBackup()).toBe(now)
    expect(describeBackup(now, now + 3_600_000)).toBe('Last backup: today')
    expect(describeBackup(now, now + day)).toBe('Last backup: yesterday')
    expect(describeBackup(now, now + 9 * day)).toBe('Last backup: 9 days ago')
    vi.unstubAllGlobals()
  })
})
