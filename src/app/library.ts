/**
 * The library: every circuit (and, from 11c, state machine) the visitor has, kept in the browser. IndexedDB holds them; where it
 * is missing or fails (some private windows) the library lives in memory for this visit.
 *
 * The record is JSON data (a `SavedCircuit`), so this file knows nothing about circuits and can be tested without a browser.
 */

export type DocKind = 'circuit' | 'fsm'

export interface DocMeta {
  id: string
  kind: DocKind
  name: string
  created: number
  updated: number
  /** Where it came from, when that matters (an example it is a copy of, the challenge or the step of the learning path it is work on). */
  origin?: { example?: string; challenge?: string; path?: string }
  /** A small picture of a circuit, as SVG text (see `thumbnailSvg`); the list shows it without reading the data. */
  thumb?: string
}

export interface DocRecord extends DocMeta {
  data: unknown
}

export interface LibraryBackend {
  /** Does it survive closing the browser? */
  readonly persistent: boolean
  /** Everything but the data, in no particular order. */
  list(): Promise<DocMeta[]>
  get(id: string): Promise<DocRecord | undefined>
  put(rec: DocRecord): Promise<void>
  remove(id: string): Promise<void>
}

export const metaOf = ({ id, kind, name, created, updated, origin, thumb }: DocRecord): DocMeta => ({
  id,
  kind,
  name,
  created,
  updated,
  ...(origin ? { origin } : {}),
  ...(thumb ? { thumb } : {}),
})

export function memoryBackend(): LibraryBackend {
  const docs = new Map<string, DocRecord>()
  return {
    persistent: false,
    list: async () => [...docs.values()].map(metaOf),
    get: async (id) => {
      const r = docs.get(id)
      return r && structuredClone(r)
    },
    put: async (rec) => {
      docs.set(rec.id, structuredClone(rec))
    },
    remove: async (id) => {
      docs.delete(id)
    },
  }
}

const DB_NAME = 'sklopko'
const DOCS = 'docs'
const META = 'meta'

/** Records in `docs`, and their metadata alone in `meta`, so the list doesn't read every circuit. */
export function idbBackend(factory: IDBFactory): LibraryBackend {
  let opening: Promise<IDBDatabase> | null = null
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DOCS, { keyPath: 'id' })
        req.result.createObjectStore(META, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        // Someone deletes or upgrades the database (another tab, a test): let go, and open again next time.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        db.onclose = () => {
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => {
        opening = null
        reject(req.error)
      }
    }))

  /** Run `work` in a transaction; resolves with the result of the request it returns, once the transaction is complete. */
  async function run<T>(mode: IDBTransactionMode, work: (docs: IDBObjectStore, meta: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([DOCS, META], mode)
      const req = work(tx.objectStore(DOCS), tx.objectStore(META))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error)
    })
  }

  return {
    persistent: true,
    list: () => run('readonly', (_docs, meta) => meta.getAll() as IDBRequest<DocMeta[]>),
    get: (id) => run('readonly', (docs) => docs.get(id) as IDBRequest<DocRecord | undefined>),
    put: async (rec) => {
      await run('readwrite', (docs, meta) => {
        docs.put(rec)
        return meta.put(metaOf(rec))
      })
    },
    remove: async (id) => {
      await run('readwrite', (docs, meta) => {
        docs.delete(id)
        return meta.delete(id)
      })
    },
  }
}

let backend: LibraryBackend = memoryBackend()

/** Use this backend (tests). */
export function setBackend(b: LibraryBackend) {
  backend = b
  active.circuit = active.fsm = null
  saving = Promise.resolve()
}

/** Does the library survive closing the browser? False when it is only in memory. */
export const isPersistent = () => backend.persistent

/** Open the browser's database. Returns false when the library is only in memory, so nothing will be kept. */
export async function openLibrary(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB')
    const b = idbBackend(indexedDB)
    await b.list() // opens it, which is where a browser that won't allow it fails
    setBackend(b)
    return true
  } catch {
    setBackend(memoryBackend())
    return false
  }
}

// ---- Documents ----------------------------------------------------------------------------------

/**
 * Changes to the library are made one after the other, so a save, a rename and a delete never overtake each other (a delete
 * must not be followed by an older save putting the document back).
 */
let saving: Promise<void> = Promise.resolve()

function queued<T>(work: () => Promise<T>): Promise<T> {
  const job = saving.then(work)
  saving = job.then(
    () => {},
    () => {}, // the next change goes ahead whatever became of this one
  )
  return job
}

/** The records of a kind (or all), newest first. */
export async function listDocs(kind?: DocKind): Promise<DocMeta[]> {
  const all = await backend.list()
  return all.filter((d) => !kind || d.kind === kind).sort((a, b) => b.updated - a.updated)
}

export const getDoc = (id: string) => backend.get(id)

/** Write a record as it is, and tell other tabs. Part of a queued change: use `saveActive` and the like from elsewhere. */
export async function putDoc(rec: DocRecord) {
  await backend.put(rec)
  announce(rec.id)
}

/** Put a record in the library (a deleted one coming back). */
export const restoreDoc = (rec: DocRecord) => queued(() => putDoc(rec))

export function deleteDoc(id: string): Promise<void> {
  return queued(async () => {
    await backend.remove(id)
    for (const kind of KINDS) if (active[kind]?.id === id) setActive(null, kind)
    announce(id)
  })
}

export function renameDoc(id: string, name: string): Promise<void> {
  for (const kind of KINDS) {
    const a = active[kind]
    if (a?.id === id) {
      active[kind] = { ...a, name }
      notify(kind)
    }
  }
  return queued(async () => {
    const rec = await backend.get(id)
    if (rec) await putDoc({ ...rec, name })
  })
}

/** A copy under a new name; resolves to its id, or undefined when there is no such document. */
export function duplicateDoc(id: string, name: string): Promise<string | undefined> {
  return queued(async () => {
    const rec = await backend.get(id)
    if (!rec) return undefined
    const now = Date.now()
    const copy: DocRecord = { ...rec, id: newDocId(), name, created: now, updated: now }
    delete copy.origin
    await putDoc(copy)
    return copy.id
  })
}

export function newDocId(): string {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `d${Date.now().toString(36)}${random}`
}

// ---- The active documents -----------------------------------------------------------------------

const KINDS: DocKind[] = ['circuit', 'fsm']
const TAB_KEY = (kind: DocKind) => `sklopko.library.active.${kind}`
const LAST_KEY = (kind: DocKind) => `sklopko.library.last.${kind}`

/** What the canvas shows, and what the state machine editor shows. Null until something is opened or saved. */
const active: Record<DocKind, DocMeta | null> = { circuit: null, fsm: null }

export const activeDoc = (kind: DocKind = 'circuit') => active[kind]

const listeners = new Set<(kind: DocKind, meta: DocMeta | null) => void>()

/** Call `fn` when the active document of a kind changes (is opened, saved for the first time, renamed). */
export function onActiveChange(fn: (kind: DocKind, meta: DocMeta | null) => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function notify(kind: DocKind) {
  for (const fn of listeners) fn(kind, active[kind])
}

/** Remember it for a reload of this tab (sessionStorage) and for a new tab (localStorage). */
export function setActive(meta: DocMeta | null, kind: DocKind = meta?.kind ?? 'circuit') {
  active[kind] = meta
  notify(kind)
  if (!meta) return
  try {
    sessionStorage.setItem(TAB_KEY(kind), meta.id)
    localStorage.setItem(LAST_KEY(kind), meta.id)
  } catch {
    // Storage blocked: the next visit opens the most recent document instead.
  }
}

function pointer(kind: DocKind): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY(kind)) ?? localStorage.getItem(LAST_KEY(kind))
  } catch {
    return null
  }
}

/**
 * Open the document this tab had (of the kind), else the last one used, else the most recently saved, and make it the active
 * one. Undefined when there is none.
 */
export async function openLastDoc(kind: DocKind): Promise<DocRecord | undefined> {
  const id = pointer(kind)
  let rec = id ? await backend.get(id) : undefined
  if (rec?.kind !== kind) {
    const [latest] = await listDocs(kind)
    rec = latest ? await backend.get(latest.id) : undefined
  }
  if (rec) setActive(metaOf(rec))
  return rec
}

/** What a new document is called, and where it came from. The name may be worked out when it is saved. */
export interface NewDoc {
  name: string | (() => Promise<string>)
  origin?: DocMeta['origin']
}

/**
 * Save the data as the active document of its kind. When nothing is active, a new document is made from `create` (called "My
 * circuit" when that is left out); otherwise the document keeps its name and origin.
 */
export function saveActive(kind: DocKind, data: unknown, create: NewDoc = { name: 'My circuit' }, thumb?: string): Promise<void> {
  const now = Date.now()
  const prev = active[kind]
  const name = prev ? null : create.name
  const meta: DocMeta = prev
    ? { ...prev, updated: now, ...(thumb ? { thumb } : {}) }
    : { id: newDocId(), kind, name: typeof create.name === 'string' ? create.name : '', created: now, updated: now, ...(create.origin ? { origin: create.origin } : {}), ...(thumb ? { thumb } : {}) }
  setActive(meta)
  return queued(async () => {
    if (name && typeof name !== 'string') {
      meta.name = await name()
      if (active[kind]?.id === meta.id) {
        active[kind] = { ...meta }
        notify(kind)
      }
    }
    // A document that was renamed since keeps its new name.
    const current = active[kind]?.id === meta.id ? active[kind]! : meta
    await putDoc({ ...meta, name: current.name, data })
  })
}

/** "Untitled 1", "Untitled 2", …: the first number no document of the kind has used. */
export async function nextUntitled(kind: DocKind = 'circuit'): Promise<string> {
  const used = new Set((await listDocs(kind)).map((d) => /^Untitled (\d+)$/.exec(d.name)?.[1]).filter(Boolean))
  let n = 1
  while (used.has(String(n))) n++
  return `Untitled ${n}`
}

// ---- Backup -------------------------------------------------------------------------------------

export interface Backup {
  app: 'sklopko-library'
  version: 1
  docs: DocRecord[]
}

/** Every document with its data, for a file the visitor keeps. */
export async function exportAll(): Promise<Backup> {
  const docs: DocRecord[] = []
  for (const meta of await listDocs()) {
    const rec = await backend.get(meta.id)
    if (rec) docs.push(rec)
  }
  return { app: 'sklopko-library', version: 1, docs }
}

/** The longest thumbnail a backup file may bring in. */
export const MAX_THUMB = 60_000

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Add the documents of a backup file. Nothing is overwritten: a document whose id is already in the library (or twice in the
 * file) comes in as a new one. A document `valid` turns down is skipped. Throws when it is not a backup at all.
 */
export function importDocs(data: unknown, valid: (rec: DocRecord) => boolean): Promise<{ added: number; skipped: number }> {
  const file = data as Partial<Backup> | null
  if (!file || file.app !== 'sklopko-library' || !Array.isArray(file.docs)) throw new Error('This is not a Sklopko library file.')
  const docs = file.docs
  return queued(async () => {
    const taken = new Set((await backend.list()).map((d) => d.id))
    let added = 0
    let skipped = 0
    for (const raw of docs as Partial<DocRecord>[]) {
      const ok = raw && typeof raw === 'object' && (raw.kind === 'circuit' || raw.kind === 'fsm') && typeof raw.name === 'string' && raw.data !== undefined
      if (!ok) {
        skipped++
        continue
      }
      const now = Date.now()
      const thumb = typeof raw.thumb === 'string' && raw.thumb.startsWith('<svg') && raw.thumb.length <= MAX_THUMB ? raw.thumb : undefined
      const origin = raw.origin && typeof raw.origin === 'object' ? raw.origin : undefined
      const rec: DocRecord = {
        id: typeof raw.id === 'string' && raw.id && !taken.has(raw.id) ? raw.id : newDocId(),
        kind: raw.kind!,
        name: raw.name!.slice(0, 100) || 'Imported',
        created: isNum(raw.created) ? raw.created : now,
        updated: isNum(raw.updated) ? raw.updated : now,
        data: raw.data,
        ...(thumb ? { thumb } : {}),
        ...(origin ? { origin: { ...(typeof origin.example === 'string' ? { example: origin.example } : {}), ...(typeof origin.challenge === 'string' ? { challenge: origin.challenge } : {}), ...(typeof origin.path === 'string' ? { path: origin.path } : {}) } } : {}),
      }
      if (!valid(rec)) {
        skipped++
        continue
      }
      taken.add(rec.id)
      await putDoc(rec)
      added++
    }
    return { added, skipped }
  })
}

// ---- Other tabs ---------------------------------------------------------------------------------

let channel: BroadcastChannel | null | undefined

function announce(id: string) {
  try {
    channel?.postMessage({ id })
  } catch {
    // A closed channel: nobody to tell.
  }
}

/** Call `onChange` when another tab saves or deletes a document this tab has open. */
export function watchLibrary(onChange: () => void) {
  if (typeof BroadcastChannel === 'undefined') return
  channel ??= new BroadcastChannel('sklopko-library')
  channel.onmessage = (e: MessageEvent<{ id?: string }>) => {
    if (KINDS.some((k) => active[k] && e.data?.id === active[k]!.id)) onChange()
  }
}
