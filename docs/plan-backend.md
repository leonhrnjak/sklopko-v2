# Backend: accounts, cloud save, public library

Optional accounts so circuits and Learn progress follow the user, then a public library (publish, browse, rate, duplicate).
Anonymous use stays fully working: the app is local-first, the server is an extra.

## Rule: spec first

**Every milestone starts with a detailed spec** (`docs/spec-backend-mN-….md`: decisions, API and data shapes, security notes,
tests, what is out of scope). Open a PR with only the spec and **wait for explicit approval** before any implementation
(no code branch, no new dependencies). Then the implementation is its own PR.

## Decisions

- **Stack:** TypeScript on Cloudflare Workers with Hono, D1 (SQLite) for data, R2 for large blobs and thumbnails, in this repo.
  The server imports `src/model/serialize.ts`, so circuits are validated by the same code as in the client.
  Kept portable (plain SQL, Hono runs on Node/Bun/Deno) so a move to Postgres or to Kotlin/Spring stays a contained job.
- **Cost:** about $0 up to ~1k monthly users, $5/month to ~10k, ~$10 at 100k (Workers Paid; prices to be re-checked).
- **Auth:** Google sign-in and email + password, no magic links. Better Auth. Only salted scrypt/PBKDF2 hashes are stored;
  breached-password check (HIBP k-anonymity), verified email, single-use hashed expiring reset tokens, throttling per account
  and IP, generic errors, hashed session tokens, same-site HttpOnly cookies, CSRF protection, verified-email account linking.
- **Anti-abuse:** Turnstile on signup and publish, rate limits, quotas, a trust ladder for publishing and rating, server-side
  schema validation, user SVG never served as-is (thumbnails regenerated or sanitized, strict CSP), reports with auto-hide.
- **Client:** IndexedDB stays the source of truth; a second `LibraryBackend` syncs when signed in. Auth, sync and the
  public-library UI are lazy chunks (the startup chunk is nearly at its budget).

## Milestones

Each is a spec PR, approval, then an implementation PR; stacked. The first implementation PR bumps the minor version.

- [ ] B1 API skeleton and deploy (built, in review) (`docs/spec-backend-m1-api-skeleton.md`)
- [ ] B2 Auth (Google + password, sessions, Turnstile, account deletion)
- [ ] B3 Cloud sync of My circuits and Learn progress
- [ ] B4 Public library: publish, browse, search, duplicate
- [ ] B5 Ratings, reports, moderation, quotas and rate limits
- [ ] B6 Classroom groundwork (optional): teacher classes, join codes

## Open questions

- Moderate before publish (safer, costs time) or after (reports)? Decide in the B4 spec.
- Are under-13 students a target? Changes auth and legal needs; decide before B2 is built.
