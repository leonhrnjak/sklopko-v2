# B2: Auth (spec)

Status: **draft, waiting for approval.** No implementation until approved (see `docs/plan-backend.md`). Stacked on B1 (#161).

## Goal

People can create an account with **Google** or an **email and password**, sign in and out, reset a forgotten password, change
their password, and delete their account. Nothing else needs an account yet (B3 uses it). The app works exactly as before
for anyone who does not sign in. No magic links.

## Decisions to confirm

1. **Library: Better Auth** (`better-auth`), on Hono, with D1 through its Kysely adapter. It gives email + password, Google
   OAuth, sessions, email verification, reset flow and account linking, so we configure rather than hand-write the dangerous parts.
   Alternative: hand-rolled with Arctic (Google) and WebCrypto; more code to get wrong, so not proposed.
2. **Passwords are never stored, only hashes.** scrypt (Better Auth's default: N=16384, r=16, p=1, random 16-byte salt per
   password, 64-byte key), compared in constant time. Password rules: 10 to 128 characters, no composition rules, no truncation;
   rejected if on the Have I Been Pwned list, checked with the k-anonymity range API (only the first five hex characters of the
   SHA-1 are sent; if the service is down, the password is accepted and the miss is logged).
3. **Workers Paid plan is required** (about $5/month): scrypt costs tens of milliseconds of CPU per sign-in or sign-up, over
   the free plan's 10 ms limit. Everything else in B1 to B5 fits the free plan; this is the one reason to pay before real use.
   If you would rather stay free, the only way is Google-only sign-in; say so and the spec changes.
4. **Email verification is mandatory** for password accounts (a verified email is what account linking and trust rely on).
   Mail goes through **Resend** (free tier 3,000 mails/month, 100/day) from a domain with SPF/DKIM set up by the owner. Mails: verify
   address, reset password, password changed notice. Links are single use, 60 minutes for reset and 24 hours for verification,
   and only a hash of the token is stored.
5. **Google:** OAuth 2.0 authorization code flow with PKCE and `state`, scopes `openid email profile`; an account is created or
   linked only when Google says the email is verified. Linking rule: the same verified email signs in to the same account,
   whichever method made it; an unverified password account is never auto-linked to Google (it must verify first).
6. **Sessions:** random 256-bit token in a cookie `__Host-session` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no
   `Domain`), stored hashed in D1; 30 days, extended while used (sliding, refreshed at most daily); sign out and
   "sign out everywhere" delete rows; changing or resetting the password ends all other sessions.
7. **CSRF:** state-changing routes require `Content-Type: application/json` plus an `Origin` header that equals the app's
   origin (Better Auth's check); `SameSite=Lax` as a second layer; no state change on GET.
8. **Abuse limits (all return 429 with `Retry-After`):** sign-in 5 failures per account per 15 minutes and 20 per IP per 15
   minutes, with the same generic error for an unknown email and a wrong password and a similar response time; sign-up 5 per IP
   per hour; mails (verify or reset) 3 per address per hour. Counters in D1 (a `rate_limit` table with expiry) for now;
   Cloudflare WAF rate rules are the outer layer, set in the dashboard.
9. **Turnstile** (free) on sign-up and on "send reset mail": the widget loads only on those forms, the server verifies the token
   with Cloudflare's siteverify before doing anything. A disposable-email domain list (a small static file in `api/`) is refused at sign-up.
10. **Account deletion and data export:** `DELETE /api/v1/account` (asks for the password or a fresh Google sign-in) removes the
    user, sessions and, in later milestones, their documents; `GET /api/v1/account/export` returns everything held about them as
    JSON. Both exist from this milestone (the export holds only the profile for now).
11. **Age:** sign-up states that you are 13 or older (or have a parent's or teacher's permission) and records only that the box was
    ticked. Accounts for younger learners (teacher-created, no email) are B6. **Please confirm** this is acceptable for launch.
12. **Data kept:** user id, email, name, avatar URL from Google, created time, password hash (if any), hashed session tokens with
    last-used time and the user agent. IP addresses are used for rate limiting only and expire with the counters; they are not
    stored on the user.

## Database (migration `0002_auth.sql`)

`user(id, email UNIQUE COLLATE NOCASE, email_verified, name, image, created_at, role DEFAULT 'user')`, `account(id, user_id,
provider, provider_account_id, password_hash NULL, UNIQUE(provider, provider_account_id))`, `session(id_hash, user_id,
expires_at, last_used_at, user_agent)`, `verification(identifier, token_hash, expires_at, kind)`, `rate_limit(key, count,
reset_at)`. Exact columns follow Better Auth's schema; the migration is generated from it and reviewed in the PR.

## API (all under `/api/v1`, JSON)

`POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `GET /auth/sign-in/google` (redirect) and `/auth/callback/google`,
`POST /auth/sign-out`, `GET /auth/session`, `POST /auth/send-verification-email`, `GET /auth/verify-email`,
`POST /auth/request-password-reset`, `POST /auth/reset-password`, `POST /auth/change-password`, `GET/DELETE /account`,
`GET /account/export`, `POST /auth/sign-out-all`. Added to `api/openapi.yaml`. Errors keep the B1 shape; none reveal whether an
email has an account (sign-up of an existing email looks the same as a new one, and the owner gets a mail saying so).

## Client (lazy chunk, not in the startup bundle)

A small "Sign in" entry in the menu (a stub in the startup chunk that loads `auth.ts` + the dialog on click, and a
`GET /auth/session` check after startup, never blocking). The dialog: sign in, sign up (password strength hint, Turnstile),
Google button, forgot password, signed-in state with Sign out, Change password, Delete account, Download my data. Works on the phone
layout. The startup chunk budget (183 kB, now 182.1) must not grow beyond the stub; if it does, the PR says so and asks.
The app stays fully usable signed out, and offline the entry shows "offline".

## Security notes

- Secrets (`BETTER_AUTH_SECRET`, Google client secret, Resend key, Turnstile secret) only via `wrangler secret`; never logged.
- No password, token or email address in logs; request ids only.
- Cookies are not readable by scripts; the SPA never sees a token.
- Timing: sign-in always runs one hash (against a dummy hash for an unknown email).
- Tests cover each rule above, including the generic errors, expiry, single-use tokens, session fixation (a new session on sign-in)
  and CSRF origin checks.

## Tests

Unit (fake D1 via Node SQLite, mock Resend/Google/Turnstile/HIBP): sign-up, verification, sign-in, throttling, reset, change,
delete, link rules, cookie flags, CSRF. e2e (Playwright against `wrangler dev` with the third parties mocked): sign up,
verify through the mocked mail, sign in/out, forgot password, Google (mock), delete account, phone layout. A security checklist in the PR.

## Out of scope

Syncing data (B3), roles and moderation (B5), classroom accounts (B6), passkeys, two-factor sign-in (a candidate for later).

## Needed from the owner

A Google Cloud OAuth client (redirect `https://<domain>/api/v1/auth/callback/google`), a Resend account and verified sending
domain, a Turnstile site, the Workers Paid plan, and the secrets above. The README lists the steps; the code is tested without them.

## Questions for you

1. Workers Paid ($5/month) is needed for password hashing: OK?
2. Is "13 or older, or with permission" acceptable at launch, with younger learners coming in B6?
3. Resend for mail OK, or do you prefer another provider (Postmark, SES)?
