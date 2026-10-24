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
   **Every PR description has five parts** (the template is `.github/pull_request_template.md`): what it adds (short, for a
   reader who has not seen the code), how it works (short, technical), how to test it (numbered steps), screenshots, and the
   checks that were run. Anything that can be seen needs **screenshots** (before and after for a change; a phone view if the
   layout changed); if nothing can be seen, say "No visible change." The pictures live on the `pr-assets` branch, never on the
   feature branch or `main`: `.claude/skills/ship/SKILL.md` has the commands, and `scripts/screenshot.mjs` takes them.
2. GitHub Actions (`.github/workflows/ci.yml`) runs on every PR as parallel jobs: unit tests, lint, build (with the bundle budget),
   and the e2e tests in four shards; the last job, `test`, needs them all and is the one to require. Wait for it with
   `gh pr checks --watch`.
3. **Green:** ask the user whether to merge. Merge only on their yes.
4. **Red:** read the failing job's log (`gh run view --log-failed`), fix the cause, re-run **only the failed
   tests** locally (`-g`), push, and wait for CI again. Repeat until green, then go back to step 3.

The `/ship` skill (`.claude/skills/ship/SKILL.md`) runs these steps: branch, version bump, scoped tests, push, PR, CI. When a
feature or fix the user asked for is finished, use it. Don't use it for plans, questions or exploration, or when the user
said not to push. It still stops and asks before merging.

Merging to `main` deploys to Cloudflare Pages.

## Testing while making changes

Run **all unit tests** locally (they take about 15 seconds), but only the **e2e** specs the change touches;
CI runs the full e2e suite. Use quiet reporters so passing runs print almost nothing.

```sh
npm test -- --reporter=dot                                        # all unit tests (quick)
npx oxlint src/path/changed.ts ...                                # lint only the changed files
npx tsc -b                                                        # type-check, when types or signatures changed
npx playwright test --reporter=line e2e/editing.spec.ts           # the whole e2e spec file for the changed area
```

The e2e specs are by area (`e2e/editing`, `simulation`, `buses`, `computers`, `logic`, `fsm`, `challenges`, `files`, `library`, `gallery`,
`ics`, `keyboard`, `testbench`, `mobile`; `offline` needs `npm run build` first, since it tests the built app; shared helpers in `e2e/helpers.ts`, including `chooseTool` and `chooseFile` for the toolbar's Tools and File menus).
Before pushing, run all the unit tests and the e2e spec file(s) for the area you changed (whole files,
not single tests picked with `-g`), so most regressions show up before CI. Use `-g` only to re-run a
specific failed test while fixing it. Don't run the whole e2e suite locally.

Full suite (what CI runs), for reference: `npm test`, `npm run lint`, `npm run build`, `npm run e2e`
(Playwright, desktop + emulated phone).

If Playwright says its Chromium build is missing, point it at an installed one instead of downloading:
`PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test ...`.

## Current work

The roadmap is in `docs/plan-next-milestones.md`: milestones 11–16 (My circuits, load speed, toolbar and example gallery,
custom ICs, small wins; milestone 15, challenges for classrooms, is dropped for now), in order, one PR per sub-milestone; tick each
box when it merges. Milestone 11 (My circuits) is built (PRs #33 to #35); 12 (load speed: code splitting, prebuilt examples and thumbnails, rendering measured) is built; 13 (toolbar menus, collapsible help, e2e split, example gallery) is built; 14 (custom ICs: instances and expansion, make and place, edit, collapse, two examples) is built; 16 (small wins: keyboard control, a lookup table from an expression, a testbench, offline use) is built, so the roadmap is done apart from the dropped 15. Each sub-milestone's PR is stacked on the one before it (#36 onward, one branch each), so the boxes are ticked when they merge.

**Milestones 0–10 are all done** (`docs/plan-next-features.md`). Milestone 10 (buses and tri-state) is recorded in
`docs/plan-m10-buses.md` (decisions, five sub-milestones 10a to 10e, what each did). Milestone 9 (timing view and state machine
editor) is done; `docs/plan-m9-timing-fsm.md` records its decisions.

**In progress: control ROMs you can read and edit** (`docs/plan-control-rom.md`): signal and row names on the ROM part, a decoded
listing (C1), editing a row by signal (C2), a text form (C3) and polish (C4); one PR per milestone, stacked (`c1-decoded-listing`, `c2-edit-row`, `c3-text-form`…), tick the boxes in the plan when each merges.

Finished plans, for background: `docs/plan-examples.md` (more examples: UART, games and so on) and `docs/plan-raycaster.md`
(index register, CALL/RET, table ROM, readable and shaded LCD, and a 3D raycaster on the 8-bit computer); `docs/plan-m9-timing-fsm.md`, `docs/plan-skasm.md` (one assembly language for every computer) and `docs/plan-stretch-features.md`
(the earlier plan; its custom ICs milestone is now milestone 14 of `docs/plan-next-milestones.md`).
