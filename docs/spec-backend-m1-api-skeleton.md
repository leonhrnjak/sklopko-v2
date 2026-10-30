# B1: API skeleton and deploy (spec)

Status: **approved** (Worker, decided with the user). No implementation until approved (see `docs/plan-backend.md`).

## Goal

A deployed, tested, empty-but-real API at `/api/*` on the same domain as the app, with a database, migrations, CI and local
development, so B2 (auth) and later milestones only add routes. No user-visible change.

## Decisions to confirm

1. **Layout.** A new `api/` directory in this repo with its own `tsconfig`, importing shared code from `src/model/` (validation) by
   relative path. No monorepo tooling; one `package.json` (new devDependencies: `wrangler`, `hono`, `@cloudflare/vitest-pool-workers`).
   Client bundle must not import anything from `api/`.
2. **Routing on one origin (decided: a standalone Worker).** The Pages project stays for the static app. The API is its own Worker
   (`api/wrangler.toml`, one Hono app) with a route `<app domain>/api/*`, so the browser sees one origin: no CORS, no
   third-party cookies. A Worker (not Pages Functions) because it keeps Cron Triggers, Queues and Durable Objects available,
   and Cloudflare's newer features land there. Deploy with `wrangler deploy`; PR previews are `wrangler versions upload`
   (preview URL, not on the production route).
3. **Database.** D1 (SQLite). Migrations as numbered SQL files in `api/migrations/`, applied with `wrangler d1 migrations apply`.
   B1 creates one table (`meta(key, value)`, for a schema-version check) so the migration path is proven; real tables come with
   the milestone that needs them.
4. **Environments.** `local` (wrangler dev, local D1), `preview` (each PR deploy, separate preview D1), `production`.
   Secrets only through Cloudflare, never in the repo; `.dev.vars` is git-ignored.
5. **API conventions.** JSON only, `/api/v1/…`, errors as `{ "error": { "code", "message" } }`, request size limit (1 MB default),
   security headers on every response, `Cache-Control: no-store` unless a route says otherwise, request id in a response header.
6. **Service worker.** `public/sw.js` (via `scripts/sw-plugin.ts`) must never cache or intercept `/api/*`; the offline e2e test
   asserts it.
7. **Documented contract.** Routes are described with an OpenAPI file (`api/openapi.yaml`) kept by hand, so the server stays swappable.

## Scope

- `GET /api/v1/health` → `{ ok: true, version, schema }` (version from `__APP_VERSION__` logic in `scripts/version.ts`, schema from `meta`).
- App skeleton: Hono app factory taking an `Env` (D1, R2, secrets) so tests inject fakes; error handler; the headers and
  limits above.
- D1 migration `0001_init.sql` and the `meta` table.
- Local development: `npm run api:dev`, `npm run api:migrate`; README section.
- CI: a job that type-checks `api/` and runs its tests; deploy of the Worker by `wrangler deploy` on merge to `main` (needs a `CLOUDFLARE_API_TOKEN` secret, set by the owner), migrations
  for production applied by a documented manual step in B1, automated later.
- No client code, no UI, no auth, no real data.

## Out of scope

Auth, users, sync, publishing, rate limits (B2 and later), analytics, email.

## Security notes

- No endpoint reads user input in B1 beyond headers. The error handler never returns stack traces.
- Strict `Content-Security-Policy` is not changed for the app in B1; API responses are JSON with `X-Content-Type-Options: nosniff`.
- Production resources (D1, R2) are created once by hand and named in the README; no wrangler `--remote` writes from CI.

## Tests

- Unit (vitest-pool-workers): health route returns the shape; unknown route is a JSON 404; oversize body is a 413; errors
  are JSON without stack; headers present.
- Migration test: applying all migrations to an empty D1 yields the expected schema version.
- Existing e2e `offline` spec: add a check that `/api/v1/health` is not served from the service-worker cache.
- Lint (oxlint) and `tsc -b` cover `api/`.

## Bundle and version

No change to the client bundle or its budget. First implementation PR for B1 bumps `package.json` to the next minor version.

## Still needed from the owner (not blocking the code)

Creating the production D1 database and R2 bucket, the API token, and the `/api/*` route needs Cloudflare dashboard access; the
README documents the exact steps. Until then everything runs and is tested locally and in CI.
