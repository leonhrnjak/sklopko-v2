import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createApp, MAX_BODY_BYTES } from './app.ts'
import type { Env } from './env.ts'

/** A database that answers the one query the health route makes. */
function fakeDb(row: { value: string } | null | Error): D1Database {
  return {
    prepare: () => ({
      first: async () => {
        if (row instanceof Error) throw row
        return row
      },
    }),
  } as unknown as D1Database
}

function call(path: string, init: RequestInit = {}, env: Partial<Env> = {}) {
  return createApp().request(path, init, { DB: fakeDb({ value: '1' }), ...env })
}

describe('health', () => {
  it('reports the version and the schema version', async () => {
    const res = await call('/api/v1/health', {}, { APP_VERSION: '0.5.3' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: '0.5.3', schema: 1 })
  })

  it('says dev when no version is set, and null when the schema row is missing', async () => {
    const res = await call('/api/v1/health', {}, { DB: fakeDb(null) })
    expect(await res.json()).toEqual({ ok: true, version: 'dev', schema: null })
  })

  it('is a 503 when the database fails', async () => {
    const res = await call('/api/v1/health', {}, { DB: fakeDb(new Error('D1 down')) })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, schema: null })
  })
})

describe('every response', () => {
  it('has the security headers, a request id and no caching', async () => {
    const res = await call('/api/v1/health')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('gives each response its own request id', async () => {
    const a = (await call('/api/v1/health')).headers.get('X-Request-Id')
    const b = (await call('/api/v1/health')).headers.get('X-Request-Id')
    expect(a).not.toBe(b)
  })
})

describe('errors', () => {
  it('answers an unknown route with a JSON 404', async () => {
    for (const path of ['/api/v1/nope', '/api/nope', '/']) {
      const res = await call(path)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No such route.' } })
    }
  })

  it('refuses a body over the limit with a JSON 413', async () => {
    const body = 'x'.repeat(MAX_BODY_BYTES + 1)
    const res = await call('/api/v1/health', { method: 'POST', body, headers: { 'Content-Length': String(body.length) } })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: { code: 'payload_too_large', message: 'The request body is too large.' } })
  })

  it('answers a thrown error with a plain 500, without the message or the stack', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp()
    app.get('/boom', () => {
      throw new Error('secret detail')
    })
    const res = await app.request('/api/v1/boom', {}, { DB: fakeDb(null) })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('secret detail')
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Something went wrong.' } })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('migrations', () => {
  it('applied in order to an empty database give schema version 1', async () => {
    let sqlite: typeof import('node:sqlite')
    try {
      sqlite = await import('node:sqlite')
    } catch {
      return // this Node has no built-in SQLite; `wrangler d1 migrations apply` is the real check
    }
    const dir = join(import.meta.dirname, '..', 'migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    expect(files[0]).toBe('0001_init.sql')
    const db = new sqlite.DatabaseSync(':memory:')
    for (const f of files) db.exec(readFileSync(join(dir, f), 'utf8'))
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: '1' })
  })
})
