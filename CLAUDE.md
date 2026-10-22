# Sklopko: project rules

## Versioning

- **Every push bumps the version.** Before each push, increase the version in `package.json` (and
  `package-lock.json`) as part of the pushed commit.
- **Bump the smallest number** unless told otherwise: `0.0.1-1` → `0.0.1-2` → `0.0.1-3`, using
  `npm version prerelease --no-git-tag-version`. Change the other parts only when explicitly asked.
- The version is shown in the app (top-right corner of the canvas) via `__APP_VERSION__`, injected by
  `vite.config.ts`. Hovering it shows the build's commit hash.
- The e2e test reads the expected version from `package.json`, so it needs no edit on a bump.

## Before pushing

Run and make sure everything passes:

```sh
npm test          # unit tests (Vitest)
npm run lint      # oxlint
npm run build     # type-check + production build
npm run e2e       # Playwright, desktop + emulated phone
```

Pushing to `main` deploys to Cloudflare Pages.

## Current work

The roadmap is in `docs/plan-next-features.md` (milestones 0–10, in order; tick each box when it ships).
`docs/plan-stretch-features.md` holds the earlier plan; its custom ICs milestone is postponed.
