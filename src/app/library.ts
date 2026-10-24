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
  /** Where it came from, when that matters (an example it is a copy of, the challenge it is work on). */
  origin?: { example?: string; challenge?: string }
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

const metaOf = ({ id, kind, name, created, updated, origin }: DocRecord): DocMeta => ({
  id,
  kind,
  name,
  created,
  updated,
  ...(origin ? { origin } : {}),
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
  active = null
  saving = Promise.resolve()
}

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

/** The records of a kind (or all), newest first. */
export async function listDocs(kind?: DocKind): Promise<DocMeta[]> {
  const all = await backend.list()
  return all.filter((d) => !kind || d.kind === kind).sort((a, b) => b.updated - a.updated)
}

export const getDoc = (id: string) => backend.get(id)

export async function putDoc(rec: DocRecord) {
  await backend.put(rec)
  announce(rec.id)
}

export async function deleteDoc(id: string) {
  await backend.remove(id)
  if (active?.id === id) setActive(null)
  announce(id)
}

export function newDocId(): string {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `d${Date.now().toString(36)}${random}`
}

// ---- The active document ------------------------------------------------------------------------

const TAB_KEY = 'sklopko.library.active'
const LAST_KEY = 'sklopko.library.last'

/** What the canvas shows. Null until something is opened or saved. */
let active: DocMeta | null = null

export const activeDoc = () => active

/** Remember it for a reload of this tab (sessionStorage) and for a new tab (localStorage). */
export function setActive(meta: DocMeta | null) {
  active = meta
  if (!meta) return
  try {
    sessionStorage.setItem(TAB_KEY, meta.id)
    localStorage.setItem(LAST_KEY, meta.id)
  } catch {
    // Storage blocked: the next visit opens the most recent document instead.
  }
}

function pointer(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY) ?? localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/**
 * Open the document this tab had, else the last one used, else the most recently saved of the kind, and make it the active
 * one. Undefined when there is none.
 */
export async function openLastDoc(kind: DocKind): Promise<DocRecord | undefined> {
  const id = pointer()
  let rec = id ? await backend.get(id) : undefined
  if (rec?.kind !== kind) {
    const [latest] = await listDocs(kind)
    rec = latest ? await backend.get(latest.id) : undefined
  }
  if (rec) setActive(metaOf(rec))
  return rec
}

let saving: Promise<void> = Promise.resolve()

/**
 * Save the data as the active document (a new one, named `name`, when nothing is active). Saves are done one after the other,
 * so two quick ones never make two documents.
 */
export function saveActive(kind: DocKind, data: unknown, name = 'My circuit'): Promise<void> {
  const now = Date.now()
  const prev = active?.kind === kind ? active : null
  const meta: DocMeta = prev ? { ...prev, updated: now } : { id: newDocId(), kind, name, created: now, updated: now }
  setActive(meta)
  const job = saving.then(() => putDoc({ ...meta, data }))
  saving = job.catch(() => {}) // the next save goes ahead whatever became of this one
  return job
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

/** Call `onChange` when another tab saves or deletes the active document. */
export function watchLibrary(onChange: () => void) {
  if (typeof BroadcastChannel === 'undefined') return
  channel ??= new BroadcastChannel('sklopko-library')
  channel.onmessage = (e: MessageEvent<{ id?: string }>) => {
    if (active && e.data?.id === active.id) onChange()
  }
}
