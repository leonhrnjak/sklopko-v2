import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Env } from './env.ts'

/** The largest request body any route takes. A route that needs more (circuit uploads, B3) sets its own, higher, limit. */
export const MAX_BODY_BYTES = 1024 * 1024

/** The error shape of every route: `{ error: { code, message } }`. */
function errorBody(code: string, message: string) {
  return { error: { code, message } }
}

/** The API, as a function of nothing but its `Env`, so a test can build it with a fake database. */
export function createApp() {
  const app = new Hono<{ Bindings: Env }>().basePath('/api/v1')

  // Every response: an id to find it in the logs, no sniffing, no framing, no caching unless a route says otherwise.
  app.use('*', async (c, next) => {
    const id = crypto.randomUUID()
    c.header('X-Request-Id', id)
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
  })

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(errorBody('payload_too_large', 'The request body is too large.'), 413),
    }),
  )

  app.get('/health', async (c) => {
    let schema: number | null = null
    try {
      const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first<{ value: string }>()
      schema = row ? Number(row.value) : null
    } catch {
      return c.json({ ok: false, version: c.env.APP_VERSION ?? 'dev', schema: null }, 503)
    }
    return c.json({ ok: true, version: c.env.APP_VERSION ?? 'dev', schema })
  })

  app.notFound((c) => c.json(errorBody('not_found', 'No such route.'), 404))

  // Never the stack, never the message of the error: a thrown error is logged and answered as a plain 500.
  app.onError((err, c) => {
    console.error(err)
    return c.json(errorBody('internal', 'Something went wrong.'), 500)
  })

  return app
}
