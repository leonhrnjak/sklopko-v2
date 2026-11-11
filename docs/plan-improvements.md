# Plan: improvements from the November review

> **Status: proposed, waiting for Leon's approval. No code before that.** Read `CLAUDE.md` first (feature branch, PR, CI, no
> attribution, commit identity). This plan comes from the review of 11 November 2026 (tech stack, examples, Learn path). Out of
> scope for now: **the backend** (short share links, accounts, synced progress, classrooms) and **translations**.

The work is split into **tracks** that separate agents can run at the same time. A track is a run of milestones; **each milestone is
one branch and one PR**. Inside a track the milestones are stacked in order, each branch starting from the one before (retarget to
`main` when the one below merges), as `CLAUDE.md` describes. Different tracks start from `main` and do not wait for each other unless
"Needs" says so.

## How an agent works on this plan

1. Take the first milestone in your track whose box is empty and whose "Needs" have merged.
2. Branch name: the one given (`a1-error-boundary` and so on). Commit under Leon's identity (`CLAUDE.md`, "Commit as Leon").
3. Stay inside the files your milestone lists. If you must touch a file another track owns, keep the change to a few lines and say so
   in the PR, so the other agent can merge it without surprise.
4. Done means: the milestone's **Done when** holds, the tests it names exist and pass, CI is green, and the PR has the five parts
   of the template (screenshots for anything visible, a phone view if the layout changed).
5. When the PR merges, tick its box here and add one line under it: what it did, and where it differs from this plan.
6. A decision marked **Leon** is not yours to make: build the recommended option and say in the PR that it waits on his answer.

**Version.** A1 bumps `package.json` from `0.5.0` to `0.6.0` (this is a new phase of work). No other milestone touches the version line.

## Waves

| Wave | Tracks | Runs | Why this order |
| --- | --- | --- | --- |
| 1 | A Robustness, B Startup, C Repository and site, D Examples, E Learn review, T Engine tests | All six in parallel | Small, independent, and the fixes users feel first |
| 2 | R Code layout | Alone, after D1 to D3 and E1 have merged | It moves files that wave 1 edits; running it alone avoids a week of conflicts |
| 3 | P Play mode, L Learn second pass, I Parts library, X Verilog export, G Doom-like round two | In parallel, after R | Larger features; they land in the new layout |

Track T does not move content files, so it may continue through wave 2. A wave-1 track that is not finished when R starts pauses
until R merges, then rebases onto it.

## Decisions for Leon

| # | Question | Recommendation |
| --- | --- | --- |
| L-B1 | B1 will show the real startup script is about 187 kB against a 188 kB budget. Keep 188 kB for the new measure? | Yes, keep it. B2 should make room |
| L-B3 | Offline: keep every example's file (3 MB) cached after one visit, or only the examples opened so far? | Only the app and the examples opened so far, plus a "Keep all examples offline" button in File |
| L-C4 | Error reports from users without a backend: none, a third-party service (Sentry's free tier), or a "Report a problem" button that opens a pre-filled GitHub issue? | The GitHub issue button: no service, no data leaves without the user's click |
| L-D2 | Examples that repeat others (`65c02`, two of the four generated state machines): remove them from the gallery? Their links would keep working | Keep everything for now; only regroup and reorder |
| L-L5 | A new optional chapter (state machines) between chapters 8 and 9 renumbers the chapters after it on the map. Acceptable? Step ids and links do not change | Yes |
| L-I1 | A part from your library placed in a circuit: a copy (the circuit keeps working if the library changes) or a link (edits reach every circuit)? | A copy, with "Update to the library's version" in the inspector |
| L-X1 | Export to Verilog only, or VHDL as well? | Verilog-2001 only |

---

## Track A: failures that are silent today

### A1 Error boundaries and a reload prompt (`a1-error-boundary`)
- [ ] A1

**Why.** One chunk that fails to load leaves `#root` empty. After a deploy, a tab that was open asks for chunk names that no longer
exist and gets `index.html` back.

**Tasks**
- An `ErrorBoundary` component in `src/ui/`. One at the root (in `src/App.tsx`) and one inside `OnDemand` (`src/ui/OnDemand.tsx`), so
  a panel that fails shows a small card ("This panel could not load" and a Reload button) and the canvas stays.
- Listen for `vite:preloadError`: save the circuit (`flushSave`), then show "A new version of Sklopko is available" with Reload.
- The root boundary's screen offers Reload and *Download all* (the library is in IndexedDB and still readable).
- Bump the version to `0.6.0`.

**Files:** `src/ui/ErrorBoundary.tsx` (new), `src/ui/OnDemand.tsx`, `src/App.tsx`, `src/index.css` (a few rules), `package.json`
(version line), `e2e/failures.spec.ts` (new).

**Done when:** an e2e test answers a lazy chunk (`LogicPanel-*.js`) with HTML, opens Tools → Logic, and finds the canvas still there
and the message shown; a second test fires `vite:preloadError` and finds the prompt.

### A2 The engine and the worker say when they fail (`a2-engine-failure`, stacked on A1)
- [ ] A2

**Why.** If `engine.wasm` does not load, the footer says "Running" and nothing is simulated. A crash in the worker freezes the
circuit with no message. The comments in `src/main.tsx` and `src/engine/sim.worker.ts` still say "the TypeScript engines run
instead"; they were removed in E7.

**Tasks**
- `installEngine` (`src/engine/wasm.ts`): check `response.ok`, use `WebAssembly.compileStreaming` (fall back to `arrayBuffer` when the
  server sends the wrong type), and throw a clear error.
- The worker posts `{ t: 'fatal', message }` when the engine fails to install or a command throws; `WorkerSim` (`src/engine/remote.ts`)
  also handles `worker.onerror`. The page keeps a `simFailed` state.
- The footer shows a red "Simulator stopped" pill instead of Running, and a banner explains it with Reload and *Restart simulator*
  (a new worker, loaded with the current circuit).
- Fix the two stale comments.

**Files:** `src/engine/wasm.ts`, `src/engine/sim.worker.ts`, `src/engine/remote.ts`, `src/app/sim.ts`, `src/main.tsx`,
`src/ui/RunFooter.tsx`, `e2e/failures.spec.ts`.

**Done when:** an e2e test that blocks the `.wasm` file sees the banner and no "Running"; a unit test in `remote.test.ts` sends a
fatal message through the `Port` and sees `simFailed`.

### A3 Keep the learner's work (`a3-persist-storage`)
- [ ] A3

**Why.** Circuits, the Learn kit and progress live only in this browser, and browsers may clear them (Safari after a few weeks
without a visit).

**Tasks**
- Call `navigator.storage.persist()` once, after the first save to the library. Ignore a refusal.
- Remember when *Download all* last ran (localStorage). *My circuits* shows "Last backup: never" or "N days ago".
- The done card of a finished Learn chapter offers *Download all* ("Keep a copy of your progress").

**Files:** `src/app/library.ts`, `src/app/documents.ts`, `src/ui/library/*`, `src/ui/path/*` (the chapter done card only).

**Done when:** unit tests cover the persist call (once, and only after a save) and the backup date; `e2e/library.spec.ts` checks the
"Last backup" line.

### A4 Share links that fit (`a4-share-length`)
- [ ] A4

**Why.** The median example makes a 5,400-character link and the large ones 26,000 to 77,000. Chat and mail tools cut them.

**Tasks**
- In `shareLink` and the embed code (`src/app/runtime.ts`): when the link is longer than `SHARE_LIMIT` (2,000 characters, one
  constant), show a dialog: "This circuit is too big for a link (N characters). Save it as a file to share it", with *Save file* and
  *Copy the long link anyway*. An untouched example keeps its short link.

**Files:** `src/app/runtime.ts`, a small dialog in `src/ui/`, `e2e/files.spec.ts`.

**Done when:** a unit test for the limit; an e2e test shares a large circuit and sees the dialog, and a small one is copied as before.

### A5 A smoke test of the built app (`a5-build-smoke`)
- [ ] A5

**Why.** The e2e suite runs on the dev server; only `offline.spec.ts` tests `dist/`. A bug that appears only after bundling passes CI.

**Tasks**
- `e2e/built.spec.ts`, run against `vite preview` the way `offline.spec.ts` is (share its server helper; move it to
  `e2e/helpers.ts`): open `/`, `/counter`, `/6502-basic`, `/learn`, `/6502-doomlike`; check the footer says "fast engine (Rust)" or
  "exact timing" and that no console error was logged.
- Move the failure tests of A1 and A2 into this file if they behave differently on the build (lazy chunk names only exist there).

**Files:** `e2e/built.spec.ts` (new), `e2e/offline.spec.ts`, `e2e/helpers.ts`.

**Done when:** the spec runs in CI's e2e shards (they already download `dist`) and passes.

---

## Track B: startup and bundle

### B1 The budget measures the real startup (`b1-bundle-budget`)
- [x] B1

**Why.** `scripts/check-bundle.mjs` counts only what `dist/index.html` asks for (69.6 kB). `src/main.tsx` loads the engine, the
runtime and `App` with `import()`, so 187.3 kB of script is loaded before the first draw and the check sees 70 kB of it.

**Tasks**
- Turn on `build.manifest` in `vite.config.ts`. The script starts at the entry, adds its static imports, and the dynamic imports of
  `src/main.tsx` (they run before the first render), each with their static imports.
- Report `engine.wasm`, the worker chunk and the stylesheet on their own lines, outside the budget.
- The budget stays 188 kB for the new total (decision L-B1). Later, with the other tracks' code added, Leon set it to 250 kB so it stops being a recurring bump.

**Files:** `scripts/check-bundle.mjs`, `vite.config.ts`, `CLAUDE.md` (the sentence on the budget).

**Done when:** the script prints about 187 kB for today's build; adding 2 kB to `App` in a scratch build makes it fail (described
in the PR, not committed).

### B2 A faster first draw (`b2-startup`, stacked on B1; needs A1 merged, both edit `src/main.tsx`)
- [x] B2

**Why.** Startup is a chain of fetches one after another: entry, simulator, engine glue, `engine.wasm`, runtime, `App`. First content
appears at 940 ms on localhost; on a real connection each link adds a round trip.

**Tasks**
- `src/main.tsx`: start the engine install, the runtime import and the `App` import together (`Promise.all`); keep the rule that the
  engine is installed before the first `Simulator` exists.
- A small Vite plugin adds `<link rel="modulepreload">` for the startup chunks (from the manifest of B1) and
  `<link rel="preload" as="fetch" crossorigin>` for `engine.wasm`.
- A static shell in `index.html`: the green toolbar strip and an empty canvas colour, replaced when React renders.

**Files:** `src/main.tsx`, `index.html`, `scripts/preload-plugin.ts` (new), `vite.config.ts`.

**Done when:** the PR shows first contentful paint before and after, measured on `vite preview` with Playwright's network emulation
(Fast 4G), and the budget check passes.

### B3 A service worker that does not refetch everything (`b3-service-worker`; needs A1 merged)
- [x] B3

**Why.** It precaches all of `dist` (4.5 MB) and names the cache after a hash of every file, so every deploy makes every visitor
download 4.5 MB again. It also calls `skipWaiting` and deletes the old cache under open tabs, which causes the failure A1 handles.

**Tasks**
- Hashed files under `/assets/` go into one long-lived cache, kept across versions; on activate, remove only entries that neither
  the new nor the previous build lists.
- Precache only the startup chain, `index.html`, the icons and the manifest. Examples (`/examples/*.json`, `.svg`) are cached when
  first fetched (stale-while-revalidate). File → *Keep all examples offline* fetches the rest (decision L-B3).
- No automatic `skipWaiting`: the page shows A1's "new version" prompt, and Reload tells the waiting worker to take over.
- README, "Offline": say what is kept.

**Files:** `scripts/sw-plugin.ts`, `src/app/offline.ts`, `src/ui/Toolbar.tsx` (one menu item), `e2e/offline.spec.ts`, `README.md`.

**Done when:** `e2e/offline.spec.ts` covers: offline after one visit opens the app and a visited example; a second build with one
changed chunk refetches only that chunk; the prompt appears instead of a silent switch.

---

## Track C: repository and site

### C1 Commit identity (PR #254)
- [x] C1 Sessions commit under Leon's git identity, so squash merges add no co-author line.
  Merged; its squash commit on `main` has no `Co-authored-by` line. The merge itself was authored with Leon's personal address:
  GitHub uses the no-reply one only once "Keep my email addresses private" is on in Settings → Emails (Leon's step).

### C2 Status docs (`c2-status-docs`)
- [x] C2

**Tasks**
- `CLAUDE.md`, "Current work": move finished plans to "Finished plans" (check each against `git log`: VIA and LCD, the Learn path,
  the Doom-like), add this plan as the current one.
- `docs/plan-doom-like.md`: the header still says "proposed, no code" and D1 is unticked.
- `src/model/examples-index.ts`: `/6502-parts` is named "(first steps)" but runs all 151 opcodes.
- `README.md`: check the counts it states (challenges, chapters, steps).

**Done when:** a reader of `CLAUDE.md` sees only work that is really open.

### C3 Link previews and a content security policy (`c3-site-meta`)
- [x] C3

**Tasks**
- `index.html`: a `description`, Open Graph and Twitter card tags, and `public/og.png` (1200×630, a screenshot of the app with the
  computer example; take it with `scripts/screenshot.mjs`).
- `public/_headers`: a `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'
  'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'; connect-src 'self'; frame-ancestors *`. Keep the other headers.

**Files:** `index.html`, `public/_headers`, `public/og.png` (new).

**Done when:** on the PR's Cloudflare preview, all 66 examples and `/learn` open with no CSP report in the console (a Playwright run
against the preview URL, its output in the PR), and a link pasted into a chat app shows the picture.

### C4 Analytics and "Report a problem" (`c4-analytics`, stacked on C3)
- [ ] C4

**Tasks**
- Leon turns on Cloudflare Web Analytics for the Pages project (no code; it injects its own script). Add its two hosts to the CSP
  (`script-src https://static.cloudflareinsights.com`, `connect-src https://cloudflareinsights.com`).
- Keep the last 20 errors in memory (`window.onerror`, `unhandledrejection`, the boundaries of A1). The **?** panel gets *Report a
  problem*: it opens a new GitHub issue with the version, the commit, the browser, the page and those errors filled in (decision L-C4).
  Nothing is sent without the user's click.

**Files:** `public/_headers`, `src/app/errors.ts` (new), the help panel in `src/ui/`.

**Done when:** a unit test builds the issue URL (and keeps it under 8,000 characters); an e2e test clicks the item and checks the
URL it would open.

---

## Track D: examples

### D1 Every beginner example explains itself (`d1-example-notes`)
- [x] D1
  Done in #264: `noteBelow` helper, notes on the 13 examples, and a test that every example has one (the exception list is empty).

**Tasks**
- A note on each of the 13 examples that have none: `adder`, `calculator`, `clock`, `d-latch`, `dice`, `gates`, `intersection`,
  `matrix`, `mux`, `oscillator`, `ripple-counter`, `shift-register`, `sr-latch`. Two or three sentences: what it shows, and one
  thing to try. The oscillator's note says to turn Enable on.

**Files:** `src/model/examples.ts` and the other builders of those examples only.

**Done when:** a test in `examples.test.ts` asserts that every example has a note, except a list of exceptions written in the test.

### D2 Regroup and reorder (`d2-example-groups`, stacked on D1)
- [x] D2
  Done in #266: as planned, except that the counter stays first in "Start here" (the app opens on the first example), so the order is counter, gates, shift register.

**Tasks**
- "Start here": basic gates, the counter, then a small sequential circuit (the shift register or the LFSR). `beginner` moves to the
  top of "Computers".
- `6502-echo` and `6502-echo-irq` move to "6502". `6502-video` and `6502-gameboard` move to the end of "6502" ("Doom-like" keeps
  only the game).
- `uart`'s blurb says it is drawn by hand, unlike the generated machines beside it.
- No example is removed (decision L-D2); every id keeps working.

**Files:** `src/model/examples-index.ts`, `src/model/examples-blurbs.ts`, `e2e/gallery.spec.ts` (counts).

**Done when:** the gallery shows the new groups; tests updated.

### D3 Large examples open where they can be read (`d3-example-fit`, stacked on D2)
- [x] D3
  Done: `fit` on `ExampleInfo` (the CPU frame of the 6502 boards and the Doom-like, the fetch stage of the computers, the sequencer of the 6502 from parts, the first stage of `beginner`); `fitToExample` in `view.ts` opens at most 80% so the note beside the frame stays in view, and fits again while a panel opens. A test checks every named frame exists, and a frame title over 40 characters (which loading would drop) fails a test.

**Why.** The large examples open fitted to the whole circuit, at 12 to 28%, where nothing can be read.

**Tasks**
- An example may name a frame to fit to on open (`fit: '<frame title>'`); `view.ts` fits to that frame's rectangle. Use it for the
  computers, the 6502 boards and the Doom-like (the CPU, or the screen). *Fit* still fits everything.

**Files:** `src/model/examples*.ts` (the field), `src/app/view.ts`, `src/app/runtime.ts` (where an example opens).

**Done when:** an e2e test opens `/6502-doomlike` and reads a zoom of at least 60%.

### D4 to D9 New examples (one PR each, stacked on D3 in this order)

Each adds one example with a note, a blurb, a thumbnail (the build makes it) and a test in `examples-more.test.ts` that it runs.
Together they put 13 of the 14 unused part types into an example.

- [x] **D4** `d4-adders` Half adder and full adder from gates, beside the `halfadd` and `fulladd` parts, so the learner can compare.
- [x] **D5** `d5-seg7-table` A seven-segment decoder made from a truth table with the Logic panel (its note says how), beside `bcddec`.
- [x] **D6** `d6-subtract` Two's complement: `addsub4` adding and subtracting with a sign shown, `halfsub`, `fullsub`, `sub4`, and the
  bus versions `bussub` and `busaddsub`.
- [x] **D7** `d7-sync-counter` A JK flip-flop (`jkff`) and a synchronous counter beside the ripple counter, with probes, so the waveform
  shows the ripple counter's glitches; and a `ringcounter`.
- [x] **D8** `d8-parity-gray` A parity bit over a line with a fault switch (`parity`), and a Gray counter beside a binary one (`gray`).
- [x] **D9** `d9-testbench` A comparator (or the ALU) with a testbench saved in it, a `lut` beside the gates it replaces, and a
  `demux`. Its note: Tools → Tests → Run tests.

D3 to D9 were built on stacked branches (`d3-example-fit` to `d9-testbench`) and opened as one PR, because of a limit on open PRs.
Where they differ from the text above: the examples are `adders`, `seg7-table`, `subtract`, `sync-counter`, `parity-gray` and
`testbench`; the unit tests are in `examples-more.test.ts` and an e2e test runs the testbench example's steps; and with them every
part type is in some example (a test now asks for that, with an empty list of exceptions).

Later, not in this plan: a shift-and-add multiplier, a stack in hardware, two computers talking over the UART.

---

## Track E: finish the Learn review

### E1 Items 13 to 25 of `docs/plan-learn-review.md`
- [ ] E1

That plan already describes each item, one PR per item, stacked `learn-fix-13-…` to `learn-fix-25-…`. Follow it; nothing here
changes it. When it is done, tick E1.

---

## Track T: engine tests in Rust

### T1 A Rust test harness, and the rule for new parts (`t1-rust-tests`)
- [ ] T1

**Why.** A new part today is written twice: in Rust, and as a TypeScript copy in the frozen oracle, which is then not frozen. The
crate has two Rust tests.

**Tasks**
- `cargo test` on the host target in `engine-rs/` (no wasm needed), with table tests for a few parts (a gate, the D flip-flop, the
  counter, the RAM) as the pattern to copy.
- The `wasm` CI job runs `cargo test` before the build.
- `docs/architecture-simulator.md`, "Adding a part": new parts get Rust table tests and a `CASES` entry only; the oracle in
  `src/engine/testdata/oracle/` takes no new parts.

**Files:** `engine-rs/src/**` (tests only), `.github/workflows/ci.yml` (one step), `docs/architecture-simulator.md`.

**Done when:** CI runs the Rust tests; the doc states the rule.

### T2 Retire the second reference copy (`t2-drop-reference`, stacked on T1)
- [ ] T2

`src/engine/testdata/reference/` is an older frozen copy beside the oracle. Move what `lockstep.test.ts` checks against it onto the
oracle (or the Rust tests), and delete the folder.

**Done when:** the folder is gone and every check it backed still runs.

### T3 Dormann's test on the Rust core, every night (`t3-dormann-nightly`, stacked on T2)
- [ ] T3

The test in `cpu6502.dormann.test.ts` runs the TypeScript oracle, not the Rust core, and only by hand (the file is GPL and not in the
repo). Run both Dormann programs on the Rust core (through `cargo test`, a host-target test that reads the binary from a path), and in
the nightly run download them at run time without committing them.

**Done when:** the nightly run passes both programs on the Rust core.

### T4 Why `65c02-timer` runs on exact timing (`t4-65c02-timer`)
- [ ] T4

Every other 6502 board runs on the fast engine. Find what in this circuit rules out the fast plan; fix it if it is a wrong guess, or
say in the example's note why it needs exact timing.

---

## Track R: code layout (wave 2, alone)

### R1 Content apart from the model (`r1-content-folder`)
- [ ] R1

Move the content out of `src/model/` into `src/content/`: the example builders and their index, the Learn path (`path/`), the
Doom-like (`doom/`), BASIC, the 6502 and SKASM programs, the generated FSM and timing examples, `computer2.ts`, the raycaster and the
games. `src/model/` keeps the circuit model: `circuit`, `serialize`, `ops`, `ic`, `buses`, `fsm`, `timing`, `testbench` and the like.
Split `computer2.ts` and `examples.ts` by example group while moving. Update the two build plugins that read these paths
(`scripts/examples-plugin.ts`, `scripts/pathStepCount.ts`).

**Done when:** no behaviour change (the whole CI suite passes unchanged); `src/model/` is about a third of today's size.

### R2 Assemblers in their own folder (`r2-asm-folder`, stacked on R1)
- [ ] R2

Move `asm6502`, `asmlex`, `isa`, `isalist`, `skasm-ref`, `disasm6502` and `mnemonics6502` from `src/engine/` to `src/asm/`.

### R3 The layering is checked (`r3-import-rules`, stacked on R2)
- [ ] R3

Lint rules (oxlint `no-restricted-imports`, per folder) for what holds today: `engine` imports nothing from `model`, `content`, `app`
or `ui`; `model` nothing from `content`, `app` or `ui`; `content` nothing from `app` or `ui`. If oxlint cannot express it, a small
unit test that reads the imports does. Fix the one exception (`src/app/pathSpot.ts` imports from `ui`).

### R4 The stylesheet split by feature (`r4-css-split`, stacked on R3)
- [ ] R4

`src/index.css` (4,400 lines) becomes a small base file and one stylesheet per feature, imported by its lazy component (Learn, the
FSM editor, the references, the inspectors, the gallery), so their styles load on demand. Colours become variables on `:root`.

**Done when:** the startup stylesheet is at most half of today's 13.7 kB gzip; screenshots of each main screen before and after match.

### R5 Dark mode (`r5-dark-mode`, stacked on R4; optional)
- [ ] R5

A dark set of the colour variables, chosen by the system setting and by a choice in Settings (System, Light, Dark). The canvas, wire
colours (both colour schemes) and every panel. Phone and desktop screenshots in the PR.

---

## Track P: play mode (wave 3)

**Why.** The best demos (the Doom-like, BASIC, the games on the 8-bit computer) open with their screen a few centimetres wide inside a
circuit at 12 to 28%, and on a phone smaller than a fingernail.

**What it is.** A view of the running circuit that shows its display large and its controls under it, with the circuit one click
away. The simulation is the same one; nothing is reloaded.

- A **Play** button in the toolbar appears when the circuit has a display part: `video`, `framebuffer`, `hd44780`, `console`,
  `acia6551`, `matrix`. `?play=1` on a link opens in it; an example can ask for it (`play: true` in its index entry).
- The display is scaled to fit the window (whole-number scales for pixel displays, crisp edges). Several displays: tabs.
- Under it, the circuit's input parts: the gamepad (on-screen buttons on a touch screen; arrow keys, X, Z and space on a keyboard),
  the keypad, the terminal's keyboard, and the circuit's labelled switches and buttons.
- A slim bar: Run/Pause, Reset, speed, the clock rate, and *Show circuit*.

### P1 The play view with the video display (`p1-play-view`)
- [ ] P1 The view, the Play button, `?play=1`, the `video` and `framebuffer` displays, the gamepad from the keyboard.

### P2 Text displays and keyboards (`p2-play-text`, stacked on P1)
- [ ] P2 The terminal (`acia6551`), the `console`, the character LCD (`hd44780`), the `matrix`, the keypad, labelled switches and
  buttons.

### P3 Touch (`p3-play-touch`, stacked on P2)
- [ ] P3 On-screen gamepad and keypad on touch screens; a landscape layout for the video display on a phone; the terminal's keyboard
  on a phone.

### P4 Examples open to play (`p4-play-examples`, stacked on P3)
- [ ] P4 `play: true` for the Doom-like, BASIC, the games and the 6502 screen examples; a "Play" badge on their gallery cards;
  `e2e/play.spec.ts` (desktop and phone); README.

**Done when (P4):** `/6502-doomlike` opens with the picture at least 640 pixels wide on a 1400-pixel window and fills the width of a
phone in landscape; the game can be played with the keyboard and with touch.

---

## Track L: the Learn path, second pass (wave 3; needs E1 and R1)

Steps keep their ids; new steps get new ids. The step count is generated, so no number is edited by hand.

### L1 Optional steps, and a lighter chapter 3 (`l1-optional-steps`)
- [ ] L1 A step can be `optional`: the map shows it as optional, "next" skips it, and a chapter is done without it. In chapter 3,
  `combine-terms`, `kmap`, `sop-bcd`, `nand-nand` and `sop-nand` become optional, so the main line is "every truth table is a
  circuit" and the majority build. The Karnaugh step gets the Logic panel to check the learner's groups.

### L2 The clock, seen in time (`l2-clock-step`, stacked on L1)
- [ ] L2 A new explore step in chapter 7 before `dff`: a Clock part, a probe on it, the waveform panel, and a D latch beside a
  D flip-flop on the same D and clock, so the difference is visible. Add a goal kind if needed (for example "the waveform panel is
  open").

### L3 From your kit to built-in parts, and a calmer chapter 9 (`l3-cpu-focus`, stacked on L2)
- [ ] L3 In `cpu-plan`, a table of the built-in parts the CPU uses and the kit chip each one is (REG4, the counter, the RAM, ADDSUB).
  Project steps get a `focus` (labels of the parts the step works on): the view fits to them and the finished parts are dimmed.

### L4 Bridges between the computers (`l4-bridges`, stacked on L3)
- [ ] L4 `meet-8bit` becomes an explore step on `/computer-blocks` (goals: open a block with Edit IC; the display reaches 13). A new
  explore step in chapter 12 on `/6502-parts`, the 6502 built from parts, showing why an instruction takes several cycles (a goal
  kind for the micro-6502 if the `cpu` goal does not fit).

### L5 An optional chapter: state machines (`l5-fsm-chapter`, stacked on L4; decision L-L5)
- [ ] L5 Between chapters 8 and 9: a traffic light by hand (a counter and a decoder), the same in the state machine editor, generated
  into gates, and a sequence detector to build. The control unit of chapter 9 is then named as a state machine.

### L6 Shift registers, timing and buses (`l6-more-hardware`, stacked on L5)
- [ ] L6 A shift register build in chapter 8 (from the kit's flip-flops). Two explore steps on glitches (the hazard example and the
  timing view) after the ripple-carry step. The tri-state step moves before the 8-bit computer is shown, with the bus wires
  introduced in the same place (it builds on review item 19).

### L7 Practice (`l7-practice-a`, `l7-practice-b`, stacked on L6)
- [ ] L7a Chapters 1 to 7: one optional build per chapter with no worked solution in the lesson (only a hint), and a three-question
  quiz for the chapters with none.
- [ ] L7b Chapters 8 to 14, the same. Program tasks count: "find the larger of two numbers", "count the 1 bits".

### L8 The ending (`l8-ending`, stacked on L7b)
- [ ] L8 After review item 25: a last step with an open end (change a small BASIC game: the program is given, the goal is any change
  that runs). The journey step links to the Doom-like as "what this board can do". The path's tools section: Back, breakpoints and
  the testbench are each used once somewhere in chapters 9 and 10 (add those uses here if L1 to L7 did not).

**Done when (L8):** `docs/plan-learn-path.md` lists the new steps; `e2e/learn.spec.ts` covers one new step of each kind.

---

## Track I: a library of your own parts (wave 3; decision L-I1)

### I1 Save a part to your library (`i1-parts-library`)
- [ ] I1 *Add to my parts* on a custom IC (inspector and parts list). The library is a new IndexedDB store beside the documents;
  the parts panel gets a "My parts" group. Placing one copies its definition into the circuit, with the library's version number.

### I2 Files and backup (`i2-parts-files`, stacked on I1)
- [ ] I2 Export a part as a file and import it; *Download all* and *Import* include the parts library.

### I3 Updates (`i3-parts-update`, stacked on I2)
- [ ] I3 When the library's copy is newer than the circuit's, the inspector offers *Update to the library's version*; it changes every
  instance in the circuit (one undo step). The Learn kit's chips can be added to the library from the map's kit list.

---

## Track X: Verilog export (wave 3; decision L-X1)

### X1 Gates and built-in parts (`x1-verilog`)
- [ ] X1 *File → Export Verilog*: one module for the circuit; labelled switches and buttons are inputs, labelled LEDs and displays
  outputs; built-in parts come from a small library of Verilog modules written once (`src/export/verilog/lib.v`), included in the
  file. Parts with no Verilog form (the 6502, the VIA, the terminal, the video chip) are refused with a clear message.

### X2 Buses, ICs and memories (`x2-verilog-more`, stacked on X1)
- [ ] X2 Bus wires as vectors, custom ICs as modules of their own, ROM and RAM contents with `$readmemh`.

### X3 Checked by a real simulator (`x3-verilog-check`, stacked on X2)
- [ ] X3 The testbench of Tools → Tests exports as a Verilog testbench. CI installs Icarus Verilog and runs the exported examples
  (the adders, the counters, the 8-bit computer for 100 cycles), comparing with our simulator.

**Done when (X3):** CI runs the comparison and it agrees.

---

## Track G: Doom-like, round two (wave 3)

Follow `docs/plan-doom-like.md` for the rules (the reference raycaster is the oracle; measure, and drop what falls under the frame
rate rule).

### G1 Real levels (`g1-doom-levels`)
- [ ] G1 Five new 16×16 maps with rooms, turns and doors, not one corridor turned five ways. The recorded test run becomes a list of
  inputs per level (written by a small route finder in the test, not by hand), and still reaches every exit.

### G2 Sound (`g2-doom-sound`, stacked on G1)
- [ ] G2 The board's speaker, driven by the VIA's second timer: a shot, a door, a hit and the exit. Measure the frame rate; it must
  stay at 8 pictures a second or more on average.

### G3 Textured walls at 120 columns (`g3-doom-textures`, stacked on G2; optional)
- [ ] G3 Only if D0's numbers hold: textures at 120 columns, measured against the same 8 fps rule, and dropped if under it.
