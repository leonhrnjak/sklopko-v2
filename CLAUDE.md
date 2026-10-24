# Sklopko: project rules

## Versioning

- **The shown version is `MAJOR.MINOR.PATCH`** (top-right corner of the canvas), and **a PR does not bump it**. `package.json`'s version
  holds the first two numbers, set by hand; the third is built by `scripts/version.ts` (called from `vite.config.ts`): the number of
  commits on `main`'s first-parent line since the commit that last changed `package.json`'s `"version"` line. So every merged PR is the
  next patch number, and parallel PRs never conflict on `package.json`. It is injected as `__APP_VERSION__`; hovering it shows the
  build's commit hash. On a feature branch it counts that branch's commits, so it is only a preview.
- **When a larger feature starts** (a plan with milestones, a new area of the app), bump the **minor** number in `package.json` in
  the first PR of that feature (`0.1.0` → `0.2.0`): the merge of that PR is `0.2.0`, the next PR `0.2.1`, and so on. Change the **major**
  number only when explicitly asked. Never edit the patch number: it is not in `package.json`.
- Anything else in `package.json` (dependencies, scripts) may change without touching the version line, and does not reset the patch number.
- The e2e test checks only the shape of the shown version (`v1.2.3`); `src/version.test.ts` checks the counting.

## Workflow: feature branch → PR → CI → merge

**Every milestone, sub-milestone and feature gets its own branch and its own PR, opened as soon as it is finished.** Never pile
several milestones onto one branch, and never leave finished work without a PR. When a plan has milestones (`R1`, `R2`…, `C1`, `C2`…),
each is one PR, stacked: its branch starts from the previous milestone's branch and the PR targets that branch (retarget to `main`
when the one below merges), so each diff shows only its own work. A session's default branch, if it names one, does not change this:
make the milestone branches from it. Without a PR (description, screenshots, CI) the work is not done.

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

The `/ship` skill (`.claude/skills/ship/SKILL.md`) runs these steps: branch, scoped tests, push, PR, CI. When a
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
box when it merges. Milestone 11 (My circuits) is built (PRs #33 to #35); 12 (load speed: code splitting, prebuilt examples and thumbnails, rendering measured) is built; 13 (toolbar menus, collapsible help, e2e split, example gallery) is built; 14 (custom ICs: instances and expansion, make and place, edit, collapse, two examples) is built; 16 (small wins: keyboard control, a lookup table from an expression, a testbench, offline use) is built, so the roadmap is done apart from the dropped 15. Each sub-milestone's PR was stacked on the one before it (#36 onward, one branch each). All of these have merged. The control ROMs plan (`docs/plan-control-rom.md`: named signals and rows, edit by signal, the text form, ready-made ROMs) has C1 to C4 merged (v0.0.1-79 to -82); C5 (polish: reference page, example notes, e2e, README) is open.

**Milestones 0–10 are all done** (`docs/plan-next-features.md`). Milestone 10 (buses and tri-state) is recorded in
`docs/plan-m10-buses.md` (decisions, five sub-milestones 10a to 10e, what each did). Milestone 9 (timing view and state machine
editor) is done; `docs/plan-m9-timing-fsm.md` records its decisions.

**In progress: control ROMs you can read and edit** (`docs/plan-control-rom.md`): signal and row names on the ROM part, a decoded
listing (C1), editing a row by signal (C2), a text form (C3) and polish (C4); one PR per milestone, stacked (`c1-decoded-listing`, `c2-edit-row`, `c3-text-form`…), tick the boxes in the plan when each merges.

**Done: a real CPU part, the MOS 6502 and the 65C02** (`docs/plan-cpu6502.md`: PRs #66, #67, #69, #73, #75, #76, #77, #78 and #80; the shown version is `v0.1.0` from #79 on): a cycle-exact core
(R1), bigger RAM and ROM (R2), the part and a first board (R3), 6502 assembly with a listing and a reference page (R4), devices and
examples (R5) and the 65C02, its interrupt example and probes (R6). Not done: challenges where you write a program (they need a new kind of
challenge that runs the program on a board). SKASM stays on our own computers.

Finished plans, for background: `docs/plan-cpu6502.md` (the 6502 and 65C02 parts), `docs/plan-examples.md` (more examples: UART, games and so on) and `docs/plan-raycaster.md`
(index register, CALL/RET, table ROM, readable and shaded LCD, and a 3D raycaster on the 8-bit computer); `docs/plan-m9-timing-fsm.md`, `docs/plan-skasm.md` (one assembly language for every computer) and `docs/plan-stretch-features.md`
(the earlier plan; its custom ICs milestone is now milestone 14 of `docs/plan-next-milestones.md`).
