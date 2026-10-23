# Sklopko: project rules

## Versioning

- **Every PR bumps the version.** On the feature branch, increase the version in `package.json` (and
  `package-lock.json`) once per PR, not on every push to the branch. If `main` reached that version
  first, bump again past it before merging.
- **Bump the smallest number** unless told otherwise: `0.0.1-1` → `0.0.1-2` → `0.0.1-3`, using
  `npm version prerelease --no-git-tag-version`. Change the other parts only when explicitly asked.
- The version is shown in the app (top-right corner of the canvas) via `__APP_VERSION__`, injected by
  `vite.config.ts`. Hovering it shows the build's commit hash.
- The e2e test reads the expected version from `package.json`, so it needs no edit on a bump.

## Workflow: feature branch → PR → CI → merge

1. Work on a feature branch (never commit to `main` directly), push it, and open a PR with `gh pr create`.
2. GitHub Actions (`.github/workflows/ci.yml`) runs the full suite on every PR: unit tests, lint, build, e2e.
   Wait for it with `gh pr checks --watch`.
3. **Green:** ask the user whether to merge. Merge only on their yes.
4. **Red:** read the failing job's log (`gh run view --log-failed`), fix the cause, re-run **only the failed
   tests** locally (`-g`), push, and wait for CI again. Repeat until green, then go back to step 3.

Merging to `main` deploys to Cloudflare Pages.

## Testing while making changes

Run only what the change touches; CI runs the full suite. Don't run the full suite locally. Use quiet
reporters so passing runs print almost nothing.

```sh
npx vitest related --run --reporter=dot src/path/changed.ts ...   # unit tests that import the changed files
npx oxlint src/path/changed.ts ...                                # lint only the changed files
npx tsc -b                                                        # type-check, when types or signatures changed
npx playwright test --reporter=line e2e/editor.spec.ts            # the whole e2e spec file for the changed area
```

Before pushing, run the related unit tests and the e2e spec file(s) for the area you changed (whole files,
not single tests picked with `-g`), so most regressions show up before CI. Use `-g` only to re-run a
specific failed test while fixing it.

Full suite (what CI runs), for reference: `npm test`, `npm run lint`, `npm run build`, `npm run e2e`
(Playwright, desktop + emulated phone).

If Playwright says its Chromium build is missing, point it at an installed one instead of downloading:
`PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test ...`.

## Current work

The roadmap is in `docs/plan-next-features.md` (milestones 0–10, in order; tick each box when it ships).
`docs/plan-stretch-features.md` holds the earlier plan; its custom ICs milestone is postponed.
