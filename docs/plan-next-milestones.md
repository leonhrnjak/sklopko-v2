# Sklopko v2: milestones 11–16 (15 dropped)

> **How to execute this plan**
> - Read `CLAUDE.md` first. Its rules apply: feature branch → PR → CI → merge, one version bump per PR, scoped tests.
> - Work milestone by milestone, in order. Each sub-milestone (11a, 11b, …) is one PR and ends in a working, tested state.
>   Tick its box below when it merges, and add a short *What it did, and where it differs from the plan* note under it, as
>   `plan-m10-buses.md` does.
> - Within a milestone, carry on from one sub-milestone to the next as soon as its PR is up and its CI is green; merge only
>   when the user says so.
> - **Stacked PRs.** Each sub-milestone is a branch based on the previous one (`m11a-…` on the plan branch, `m11b-…` on
>   `m11a-…`, and so on) and its PR targets the previous branch, so each diff shows only its own work. When the one below
>   merges, retarget the next to `main`. After each *milestone* (11, 12, …) stop, so the user can clear the conversation: this
>   file is the memory, so keep the boxes ticked and the "What it did" notes current.
>
> - [x] 11a Library storage, v0.0.1-59
> - [x] 11b Nothing replaces your work, v0.0.1-60
> - [x] 11c My circuits panel, state machines, backup, v0.0.1-61
> - [x] 12a Code splitting, v0.0.1-62
> - [x] 12b Prebuilt examples and thumbnails, v0.0.1-63
> - [x] 12c Rendering, measured and skipped, v0.0.1-64
> - [x] 13a Toolbar menus, collapsible help, e2e split, v0.0.1-65
> - [x] 13b Example gallery, v0.0.1-66
> - [x] 14a Engine groundwork, v0.0.1-67
> - [x] 14b ICs in the model and the simulation, v0.0.1-68
> - [ ] 14c Make and place ICs
> - [ ] 14d Edit an IC
> - [ ] 14e Collapse a selection into an IC; examples
> - ~~15 Challenges for classrooms~~ (dropped for now, see below)
> - [ ] 16 Small wins

## Context
Milestones 0–10 are done (v0.0.1-57): 70 part types, buses and tri-state, the timing view, the state machine editor,
SKASM, challenges and 45 examples up to a 3D raycaster. A review of the app and its code (October 2026) found that the
product around it now matters more than another feature:

- **Work gets lost.** There is one autosave slot (`sklopko.circuit.v1`, `src/app/runtime.ts:10`). Opening an example, a
  share link, a file or a challenge replaces the canvas (`loadCircuit`, `src/app/store.ts:413`). Undo brings it back, a
  reload does not. The state machine editor has its own single slot (`sklopko.fsm.v1`, `src/app/fsm.ts`).
- **Big circuits are hard to read.** On buses the 8-bit computer has 148 wires instead of 240, but at "fit" it is still
  a mesh. Custom ICs (postponed since `plan-stretch-features.md` M5) are what lets it be shown as fetch / ALU /
  registers / control.
- **It loads slowly.** One 655 KB chunk (208 KB gzipped; Vite warns above 500 KB). The 45 examples' builder code ships in
  it, and every example is built and routed when opened: 6 s for all of them in Node, 0.25–0.7 s for each computer, about
  1.8 s to open `/computer` in the dev server.
- **The toolbar has grown** to two rows: six panel buttons, six file buttons and three dropdowns (speed, examples,
  picture); the examples are a 45-item dropdown.
- **Challenges are a fixed list in code**: no links a teacher can hand out, nothing with a clock, no way to write one's own.

Out of scope: Croatian UI (not needed), accounts, server storage, real-time collaboration.

## Order at a glance
| # | Milestone | Size | Why now |
|---|---|---|---|
| 11 | My circuits | medium | Stop losing work; every later milestone opens and keeps documents |
| 12 | Load speed | small–medium | Halve the bundle, open examples without routing; thumbnails for 13 |
| 13 | Toolbar and example gallery | small–medium | Room for 14's UI; show off the examples |
| 14 | Custom ICs | large | Readable big circuits; build in layers, as it is taught |
| 15 | ~~Challenges for classrooms~~ | medium | **Dropped for now** (kept below for later) |
| 16 | Small wins | small | Offline, keyboard, LUT from expression, testbench |

## Milestone 11: My circuits (medium)
A library of documents in the browser. Opening something new never replaces what you had: it opens a new document, and the
old one stays in the library.

**11a. Library storage (medium)** — no visible change except that work is now kept in the library.
- `src/app/library.ts`: a `LibraryBackend` interface (`list`, `get`, `put`, `remove`) with an IndexedDB implementation
  (database `sklopko`, a `docs` store and a `meta` store so the list doesn't load every circuit) and an in-memory one. Unit
  tests (Vitest runs in Node, no IndexedDB) use the memory one, and so does a browser where IndexedDB throws (some private
  windows), with a one-time toast that work won't be kept.
- Record: `{ id, kind: 'circuit', name, created, updated, data: SavedCircuit, origin?: { example?: string; challenge?: string } }`.
- The active document's id is kept per tab in `sessionStorage`, and the last one used in `localStorage`, so a new tab opens
  it.
- Autosave (`runtime.ts:69-80`) writes the active record instead of `sklopko.circuit.v1`; the 400 ms debounce stays.
- First run imports `sklopko.circuit.v1` as "My circuit". The old key is left alone (removed in a later version).
- Startup becomes async: `main.tsx` awaits the library's first read before the first render (a few ms).
- Embed mode never opens the library (as today with autosave).
- Two tabs on one document: a `BroadcastChannel` tells the other tab, which shows "Changed in another tab: Reload". Last
  write wins otherwise.
- *What 11a did, and where it differs from the plan:* `src/app/library.ts` is as planned (`LibraryBackend`, `idbBackend`,
  `memoryBackend`, `openLibrary`, `listDocs` / `getDoc` / `putDoc` / `deleteDoc`, `openLastDoc`, `saveActive`, `watchLibrary`).
  - The IndexedDB backend lets go of the database when another tab or a test deletes it (`versionchange`) and opens it again on
    the next call.
  - `saveActive` queues its saves, so two quick ones never make two documents. It keeps the name and origin a document has.
  - A tab remembers its document in `sessionStorage` and the last one used in `localStorage` (as planned). When neither points
    at a record, the most recently saved circuit opens.
  - **Behaviour is deliberately unchanged:** opening an example, a link or a file still replaces what the active document holds
    (11b is what stops that). The stored document is the same one the old single slot was.
  - The "this browser won't keep your circuits" toast shows 0.6 s after startup, so it isn't gone before the page appears. A
    save that fails shows one toast ("could not be saved") per visit.
  - e2e files that cleared `localStorage` now call `clearStorage(page)` (`e2e/storage.ts`), which also clears the session
    storage and deletes the database.
  - New dev dependency: `fake-indexeddb`, so the IndexedDB backend is unit-tested like the memory one.
  - Tests: `src/app/library.test.ts` (both backends alike; reopening; the library's list, save, queue, delete) and
    `e2e/library.spec.ts` (kept and restored, v1 import, a new tab, embed, no database).

**11b. Nothing replaces your work (medium)**
- **Example**: opens as an unsaved document showing the example (short link in the address bar, as now). The first real
  edit, at the hook in `runtime.ts` that already drops the short link, creates a record named "<example> (copy)".
- **Share link, file**: a new record at once ("Shared circuit", the file name).
- **Challenge**: one record per challenge (`origin.challenge`), reopened when the challenge is started again, so work on
  each challenge is kept. A *Start over* button in the challenge panel. *Show a solution* stays undoable. The "Undo brings
  your circuit back" toast in `startChallenge` (`src/app/challenges.ts`) goes.
- **New**: a new record, "Untitled N".
- Switching documents clears undo and redo and resets the simulator: the previous document is safe in the library.
- All `loadCircuit` callers go through one `openDocument()`: `openExample`, `initialCircuit`, `openJSON`, `startChallenge`.
- *What 11b did, and where it differs from the plan:* the one entry point is `openCircuit(circuit, how)` in the new
  `src/app/documents.ts`, which also owns the autosave that used to be in `runtime.ts`. `how` is `stored` (the document the
  library has), `now` (a new document, saved at once) or `on-edit` (shown without a document; the first edit makes one).
  - "The first real edit" is the first undo step (`past` changing), the same moment the example's short link is dropped, so
    flipping a switch in an example saves nothing. In a stored document a switch is still saved, as before.
  - The pending edit of the document being left is saved first (`flushSave`; also on `pagehide`), so a quick switch never
    loses it or writes it into the other document. Putting a circuit on the canvas must not look like an edit to the
    autosave: that was the one bug found while testing.
  - New is `newCircuit()`: an empty circuit that is "Untitled N" (the first number not used) once something is in it, so
    pressing New twice makes nothing. It is not undoable any more (the old circuit is in the library); `clearAll` stays for
    tests. `replaceCircuit` in the store shows another document and clears the undo history.
  - Visiting an example link no longer touches the saved circuit (before, it was overwritten). A first-time visitor's
    welcome example is called "My circuit" when it is edited.
  - Challenges: the record is found by `origin.challenge`, so *Start* reopens the work; *Start over* is an undoable edit.
    Opening something else while a challenge is open leaves its panel open, as before.
  - Tests: `src/app/documents.test.ts` (unsaved until edited, switches, now/stored, switching with an edit waiting, no undo
    history, embed, New) and four more e2e tests in `e2e/library.spec.ts`.

**11c. My circuits panel, state machines, backup (medium)**
- The document's name is shown in the toolbar; clicking it renames.
- *My circuits* dialog: newest first, with name, kind, date and (from 12b) a thumbnail; open, rename, duplicate, delete
  (a toast with Undo), New. A filter by kind.
- State machines become library records (`kind: 'fsm'`). The editor (`src/app/fsm.ts`) opens the active one, and
  `sklopko.fsm.v1` is imported once.
- Backup: *Download all* (one JSON file, `{ app: 'sklopko-library', docs: [...] }`) and *Import* (adds; never overwrites;
  a clashing id gets a new one). Browser storage can be cleared, so this matters.
- `navigator.storage.persist()` is requested after the first save.

- *What 11c did, and where it differs from the plan:*
  - **The library keeps one active document per kind** (`activeDoc('circuit')`, `activeDoc('fsm')`), so a circuit and a state machine
    are open side by side. Changes (save, rename, duplicate, delete, import) go through one queue, so a delete is never undone by a
    save that was waiting. `exportAll` / `importDocs` do the backup (no data format knowledge: the app passes the check).
  - **The open circuit's name is over the canvas** (next to the Paused badge), not in the toolbar: the toolbar was already two
    rows, and the file row grew a third with the name. Click it to rename; an unsaved circuit (an example, a blank one) is shown
    in italics and takes the name it will be saved under ("Untitled" until the first edit makes it "Untitled N").
  - **State machines work like circuits** (`src/app/fsm.ts`): a starting point, a blank machine or a file replaces the machine in
    the editor as another document, with no undo history from the one before (the old `loadFsm` was one undo step); it is
    kept at its first edit (a file at once). `restoreFsm()` runs at startup before the first render and imports
    `sklopko.fsm.v1` once.
  - **My circuits** (`src/ui/library/LibraryDialog.tsx`, state in `src/app/libraryUi.ts`): a filter (All / Circuits / State
    machines), Open (the whole row), Rename (inline), Duplicate ("<name> copy"), Delete with an Undo toast (which, for the open
    document, first puts a blank one on the canvas and, on Undo, opens it again), New circuit, Download all, Import…. A warning
    shows when the library is only in memory. No thumbnails yet: 12b adds them.
  - The toast takes an action button; with one it is fixed to the window and above dialogs, so Undo can be clicked over My circuits.
  - `navigator.storage.persist()` is asked once, after the first save that worked.
  - Existing e2e tests changed: the new name button is also found by a `name: 'Run'` locator when an example's name contains
    "runs", so they use the run button's test id; the state machine test waits out the autosave delay before reloading (the
    machine used to be saved synchronously).
  - Tests: `src/app/library.test.ts` (rename, duplicate, ordering, restore, listeners, backup, import), `src/app/fsm.test.ts`
    (the library parts), seven more tests in `e2e/library.spec.ts` and one in `e2e/mobile.spec.ts`.

**Tests.** Unit, on the memory backend: create, list order, rename, duplicate, delete; v1 import (circuit and FSM);
example copy-on-first-edit; one record per challenge, reused; backup round trip and import of clashing ids. e2e: edit,
open an example, come back through My circuits; reload keeps the active document; challenge work survives opening
something else; delete and undo; embed mode never touches the library.

## Milestone 12: Load speed (small–medium)
**12a. Code splitting (small)**
- `React.lazy` for the Logic panel, State machines, SKASM reference, challenge list and panel, Timing view and tick
  diagram, and the exporters (`exportImage`, `vcd`).
- The examples' builders load on demand. A small `src/model/examples-index.ts` (id, name, group, blurb) stays in the main
  chunk, so the menu and short links resolve without loading builders. The welcome example stays in the main chunk.
- A budget check: `scripts/check-bundle.mjs`, run in CI after `npm run build`, fails when the main chunk is over 350 KB
  (from 655 KB).

*What it did, and where it differs from the plan.*
- The panels (Logic, State machines, SKASM reference, challenge list and panel, waveforms with the timing view and tick
  diagram) are `React.lazy` chunks, mounted by `ui/OnDemand.tsx` from the first time their open flag is set. The ROM/RAM/LUT/console
  editors of the inspector and the picture and VCD exporters are chunks too. The "first probe opens the waveform panel" rule moved
  out of the panel into `useOpenOnFirstProbe` (`app/waveform.ts`), since the panel no longer exists until it is open.
- `src/model/examples-index.ts` has the ids, names, groups and `exampleFromPath` (no blurbs yet: 13b adds them with the gallery).
  `examples.ts` holds only the builders and loads on first use; the welcome example (`example-counter.ts`) stays in the main
  chunk. `openExample` is now async (of two quick clicks the later wins). A unit test keeps the index and the builders in step.
- **Result: 483 kB of JavaScript at startup (was 669 kB; gzip 156 kB, was 213 kB), not 350 kB.** React DOM alone is about 203 kB of
  it, and the state machine and challenge modules are wired into the toolbar and startup (`app/fsm.ts` restores the machine,
  `app/challenges.ts` reads the challenge list), so they could not leave without a redesign. `scripts/check-bundle.mjs`
  (`npm run check:bundle`, a CI step after the build) sums what `dist/index.html` loads at startup, entry plus preloads, and
  fails over 500 kB. The 350 kB target could still be met by moving the state machine and challenge stores behind `import()`.
- Not preloaded: the first open of a panel waits for its chunk (10–25 kB each). e2e waits for the panel where it matters.

**12b. Prebuilt examples and thumbnails (medium)**
- A Vite plugin (`scripts/examples-plugin.ts`, used in `vite.config.ts`) runs the builders at build time (they are DOM-free:
  the unit tests already build them in Node) and emits `examples/<id>.json`, the saved circuit with its routed wires. In
  dev, the plugin serves the same files from middleware. Nothing generated is checked in, so the files can't go stale.
- The app fetches `/examples/<id>.json` and deserializes it, with no routing. Sizes: 693 KB for all 45, 40–63 KB per
  computer, before gzip. Target: `/computer` open in under 300 ms (from about 1.8 s).
- The slug `examples` is reserved (no example may use it). Cloudflare serves the static files before its index.html
  fallback.
- `src/model/thumbnail.ts`: `thumbnailSvg(circuit)`, a pure function that draws parts as boxes and wires as thin lines,
  with displays dark. The plugin emits `examples/<id>.svg`; My circuits stores one per record on save (small, debounced).
- Unit tests keep building from code; one test checks the plugin's `exampleJson(id)` deserializes to the same circuit as
  `build()`.

*What it did, and where it differs from the plan.*
- `scripts/examples-plugin.ts` writes `examples/<id>.json` and `.svg` for all 45 examples (1.2 MB in `dist/examples`, 90 files).
  It does not import the app's code into `vite.config.ts` (that needs file extensions and triggers a warning about Vite's
  future config loader); it loads `src/model/example-files.ts` through Vite itself (`ssrLoadModule`, on the dev server or on a
  throw-away server during the build). The build takes about 6 s longer. In dev the same files are made on request.
- The builders no longer ship: the 90 kB `examples` chunk is gone, and the app has no fallback that builds an example in the
  browser. A fetch that fails shows the toast "That example could not be loaded."
- `/computer-raycaster` is on the canvas in about 0.3 s on the production build (headless Chromium, localhost), from about 1.8 s.
- `thumbnailSvg` (`src/model/thumbnail.ts`) draws boxes, wires and dark displays on a fixed light background, no text; 17–23 kB for
  the computers. `DocMeta.thumb` holds it, so the list needs no data read; autosave makes it with the save (a thumbnail over 60 kB
  is not stored, the old one stays). A backup keeps it, and an import takes only an `<svg…` string up to that size. My circuits
  shows it left of each circuit. State machines have none yet.
- Tests: `thumbnail.test.ts`, `example-files.test.ts` (each file opens as the same circuit as `build()`, no example called
  `examples`), two in `library.test.ts`, two in `e2e/library.spec.ts`.

**12c. Rendering, only if measurement says so (small)**
- Measure `sim.publish()` and React's commit on the raycaster at 4 kHz. Today every wire runs its own
  `useSyncExternalStore` check on every publish (`src/app/hooks.ts`).
- If it costs more than 2 ms a frame, add net-indexed subscriptions: the simulator keeps the nets that changed since the
  last publish and notifies only their subscribers.
- Otherwise record the numbers here and skip it.

*What it did, and where it differs from the plan.* Measured, and skipped. The numbers (production build with minification off, headless
Chromium with the CPU profiler on, `/computer-raycaster` running at its 4096 Hz for 6 s, 362 frames):
- `sim.frame` (the simulation itself, up to its 10 ms budget): 3.6 ms a frame.
- `sim.publish`: 0.37 ms a frame, of which `checkIfSnapshotChanged` (every `useSyncExternalStore` asking whether its value changed,
  the cost net-indexed subscriptions would remove) is 0.31 ms.
- React render and commit for what did change: 2.4 ms a frame (render 1.5, commit 0.9), mostly `WireView` and `ComponentView` of the
  wires and parts whose value really moved. Net-indexed subscriptions would not make that smaller.
- The main thread was idle 31% of the time and the page kept 60 frames a second.
So the part the optimization could save is 0.3 ms, well under the 2 ms bar. Revisit if a larger circuit than the raycaster shows
`checkIfSnapshotChanged` over 2 ms: the first step then is `useSyncExternalStore` subscriptions keyed by net, as described above.

## Milestone 13: Toolbar and example gallery (small–medium)
**13a. Toolbar menus, collapsible help, e2e split (small–medium)**
- One row on desktop: `Run/Pause · Step · Back · Clock step · Reset · speed | Undo · Redo · Fit | <document name> |
  Examples · Tools ▾ · File ▾ · Share · ⚙`.
  - **Tools**: Logic, State machines, SKASM reference, Challenges, Waveforms, Timing.
  - **File**: New, My circuits, Open file, Save file, Picture (four options), Embed code, Clear wires.
  - The phone ☰ menu becomes the same two menus.
- The *How to* sidebar can be collapsed; a `?` button reopens it. It is open on the first visit and the choice is
  remembered (a per-viewer convenience in `localStorage`).
- Keep the `data-testid`s and button titles that e2e uses where possible. Split `e2e/editor.spec.ts` (71 tests) into specs by
  area (editing, simulation, logic, fsm, challenges, buses, computers, files) in this PR, since it touches most of them anyway.

*What it did, and where it differs from the plan.*
- The desktop toolbar is one row from about 1200 px: Run/Pause, the simulation controls, Undo, Redo, Fit, `?`, ⚙, then Examples (the
  dropdown stays until 13b), **Tools ▾**, **File ▾** and Share. The menus are `DropMenu` in `Toolbar.tsx`: `role="menu"` with
  `menuitem` entries (Waveforms and Timing are `menuitemcheckbox`), closed by a choice, Escape or a click elsewhere, Up and Down
  move between entries. File also has the four picture exports (the Picture dropdown is gone); *Open* and *Save* are *Open file* and
  *Save file*, *Embed* is *Embed code*. The phone ☰ menu lists the same entries flat under *Tools* and *File*, next to Examples and
  Share. Between 760 and 1200 px the row wraps onto a second line, as before.
- **Not moved:** the document name stays over the canvas (it works on phones too, and one row fits without it).
- The help panel (*How to*, the right panel while nothing is selected) has a Hide button; the new `?` toolbar button shows it again
  (and deselects). `helpOpen` is in `app/settings.ts`, so it is remembered in `localStorage` with the other display settings. With
  the help hidden and nothing selected, the right column is gone; selecting a part brings the panel back for its settings. On
  phones the help is still opened from ☰ Help.
- `e2e/editor.spec.ts` (71 tests) is split into `editing`, `simulation`, `buses`, `computers`, `logic`, `fsm`, `challenges` and
  `files` specs, with the shared helpers in `e2e/helpers.ts`; `chooseTool(page, name)` and `chooseFile(page, name)` open a menu
  and pick an entry. Two new tests (the menus, the help panel). Test ids are kept.

**13b. Example gallery (small–medium)**
- *Examples* opens a dialog: the groups as sections, a card per example with its thumbnail (12b), name and a one-line
  blurb (a new `blurb` field, written for all 45), plus a search box. The dropdown goes away.
- Opening follows 11b. A card's short link can be copied.

*What it did, and where it differs from the plan.*
- *Examples* is a button (toolbar and phone ☰ menu) that opens `ExampleGallery`, a lazy chunk like the other dialogs: the nine groups
  as sections, a card per example with its thumbnail (`/examples/<id>.svg`, lazily loaded), name and blurb, and a search box
  (focused on opening; every word has to match the name, blurb, group or id, `searchExamples` in `examples-index.ts`). The
  dropdown is gone.
- `ExampleInfo.blurb` is written for all 45 examples (one sentence each, under 110 characters; a unit test checks the shape).
- A card opens the example through `openExample`, so nothing replaces your work (11b), and closes the gallery. Each card has a
  *Copy link* button that copies `/<id>` and leaves the gallery open.
- The dev server keeps the files it made for an example (`exampleFiles` caches per id), since the gallery asks for 45 pictures.
- e2e: `e2e/gallery.spec.ts` (cards, search, opening, copying a link), the phone test in `mobile.spec.ts`, and `chooseExample` in
  `e2e/helpers.ts` replaces `selectOption` on the old dropdown everywhere.

## Milestone 14: Custom ICs (large)
Build a part from a circuit, use it like any other, nest it, and collapse part of a big circuit into a block.

**Decisions**
- **ICs live in the circuit document** (`Circuit.ics: Record<id, ICDef>`), so files, share links and embeds stay
  self-contained. To reuse one elsewhere, *Copy IC from…* (a My circuits document) copies the definition by value.
- **The interface is the labelled parts inside.** Switches and bus inputs (`busin`) become input pins; LEDs and bus
  displays (`busdisp`) become output pins. A bus part becomes a bus pin of its width, and the label is the pin name.
  - Inputs go on the left and outputs on the right, each ordered top to bottom as placed inside.
  - A clock inside stays internal.
- **Expansion happens in the flatten stage, before buses.** `expandICs(circuit)` produces a plain circuit with inner ids
  `inst/inner` (`/` is not used in ids today). Everything that already goes through `busModel` / `flatten` gets ICs for free:
  simulation, trace, analyze, challenge checks, timing.
  - Inner switches are dropped and their wires re-sourced to whatever drives the instance's pin (X if nothing does).
  - Wires leaving an instance's output are re-sourced to the inner LED's driver.
  - Top-level wires keep their ids, so wire colours (`busModel(c).bits`) work unchanged.
- **Inside an instance:**
  - Net labels are scoped to the instance (names prefixed).
  - Probes, breakpoints, speakers and displays are dropped: they can't be seen, and four instances would give four trace
    rows.
  - Memories keep per-instance state through their ids.
- **No recursion**: checked when placing, when editing and when loading.
- **Challenge rules count the expanded parts**, so an IC built of NANDs passes an only-NAND rule.
- **Save format v2** adds `ics`, with a `migrate()` chain in `src/model/serialize.ts` (v1 → v2 adds an empty library). The
  app opening a v1 file is unchanged.

**14a. Engine groundwork (small–medium)** — no behaviour change; every existing test stays green.
- Net labels are resolved in the flatten stage instead of inside `Simulator.load()` (`simulator.ts:170`). The simulator
  gets plain nets and an alias list, which is the mechanism 14b reuses.
- An active-part worklist in `tick()`: today every part is visited (stale ones skipped) and every net compared on every
  tick. Visit only parts marked stale and compare only nets written.
  - A test: tick counts and values are identical over every example.
  - A benchmark: the raycaster, and a synthetic 2,000-gate circuit (what flattened ICs will produce).
- Typed hooks replace the field-name checks: `ComponentDef.memory` (`size`, `read`, `write`) for `writeWord`
  (`simulator.ts:594`) and `revision()` for `signature` (`simulator.ts:572`).
- `layoutOf` moves from `simulator.ts` to `engine/layouts.ts`. `src/app/challenges.ts` stops importing `ui/canvas/viewport`:
  fitting the view becomes a callback the UI registers.

*What it did, and where it differs from the plan.*
- **Net labels in the flatten stage.** `flatten` (the `BusModel.sim`) now carries `SimCircuit.aliases`, the output pin that drives
  each Receive label (`resolveLabels`, unchanged). `Simulator.load` uses it, and still works it out itself for a `SimCircuit`
  that has none (the simulator tests build their own). 14b's `expandICs` runs before `flatten`, so labels are resolved on the
  expanded circuit.
- **Worklist in `tick()`.** A part flagged stale goes into a queue (a typed array, once per part); a tick evaluates the queued parts
  and the slow ones (delay pipelines), writes every output as a (net, value) pair into a preallocated array, and then commits
  the pairs, flagging the readers of each net that changed. The per-tick copy of all nets (`next.set(values)`) and the scan of all
  nets are gone, and so is the second buffer. Timings (`VITE_BENCH=1 npx vitest run src/engine/bench --reporter=verbose`, before
  → after): raycaster 349 → 248 ms for one simulated second, prime sieve 225 → 178 ms, a 1,600-part shift register (every part
  busy) 907 → 865 ms. A first version with plain arrays was slower than before on that last case; the typed arrays fixed it.
- **Pinned by a test.** `src/model/sim-golden.test.ts` fingerprints every net after each of the first 40 ticks, after settling,
  after four stretches of 25 ms and after a reset, for all 45 examples (`sim-golden.json`, made with the old simulator). It passes
  unchanged. `npx vitest run src/model/sim-golden -u` rebuilds it after a change that is meant to change behaviour.
- **Typed hooks.** `ComponentDef.memory` (`size`, `read`, `write`; RAM has it) replaces the `state.mem` and `dbits` guess in
  `writeWord`, and `ComponentDef.revision()` (console, pixel screen, speaker) replaces the `state.rev` guess in `signature`.
- **`layoutOf`** moved out of `simulator.ts` into `engine/layoutcache.ts`, not `layouts.ts` as planned: the part definitions import
  `layouts.ts` (for `box`) and the registry imports them, so a registry import there is a cycle that breaks at load time.
- **`app/challenges.ts` and `app/gallery.ts`** no longer import `ui/canvas/viewport`: `app/view.ts` has `fitToScreen()`, and the
  viewport module registers `fitView` with it. No `app/` file imports from `ui/` now.

**14b. ICs in the model and the simulation (medium)** — no UI.
- `ICDef` (`name`, `circuit`, derived pins), `expandICs`, serialize v2 and `migrate`, the recursion check, and
  `CircuitBuilder.ic()`.

*What it did, and where it differs from the plan.*
- **An instance is an ordinary part** (`ic`, `engine/components/ic.ts`, category `ic`, so the palette's list leaves it out). Its params
  hold the definition's id and name and its pins as text (`ins` = `A:1,B:4`, `outs` = `S:1`), so its layout comes from its params like
  any other part's: the router, canvas and `viewLayoutOf` need no knowledge of ICs. A bus pin is a group over scalar pins `NAME[0]` …
  (always on, like a part with no `bus` param). `Circuit.ics` is optional (`undefined` when there are none, so every circuit literal
  and round-trip test stays as it was).
- **Interface** (`model/ic.ts`, `deriveInterface`): switches and `busin` are inputs, LEDs and `busdisp` outputs, each from top to bottom
  as placed; the label is the pin name (letters, digits, underscore; `_2` for a clash; `in1`, `out1` when unlabelled). `icParams(def)`
  gives an instance's params.
- **Expansion joins instance and inside with net labels, not by re-sourcing wires** as the plan said. The wire into an input goes to a
  Send label and a Receive label of the same name stands where the switch was; an LED inside becomes a Send label and the wires out of
  the output come from a Receive label. Labels add no delay and the label machinery (`resolveLabels`, bus labels, `busModel.bits`) already
  follows them to the real driver, so wires of the top-level circuit keep their ids *and* their `bits`, nothing about unconnected
  inputs needs a special case (a Receive label nobody publishes reads X), and no part of `flatten` knows about ICs. Names are
  `inst/in:PIN`, `inst/out:PIN` for the connectors and `inst/l:NAME` for labels inside, so they can't meet.
- `expandICs(circuit)` returns the plain circuit (the same object when there is no instance) and `connectors` (`inst:PIN` → label part).
  `busModel(c).circuit` is the expanded circuit, and `busModel` runs on it; the analysis code that walks parts and wires
  (`analyzeTiming`, `dependsOnState`, `ruleProblems`) uses it, so a path, a state dependency or a gate count goes through an IC.
  Parts and wires inside have ids `inst/inner`; displays, notes, probes, breakpoints and speakers inside are dropped.
- **Saving**: version 2 (`FORMAT_VERSION`) adds `ics` (only when there are some); `migrate()` is a table of steps (1 → 2 adds an empty
  list). A file whose IC contains itself is refused with an error; an instance whose IC is not in the file goes, with its wires, and
  every other instance takes the pins its definition has now. `findCycle` and `wouldLoop` (for refusing a placement in 14c) are in
  `model/ic.ts`, with `icProblems` (no inputs, no outputs) for 14c's validation.
- `CircuitBuilder.defineIC(name, circuit, id?)` and `.ic(id, x, y)`.
- Not done here: tracing a signal into an IC (`traceNet`, `traceCone` stop at an instance), and the timing list shows inner parts by id.
- Tests: `model/ic.test.ts` (interface, equivalence of an IC half adder and of a full adder of ICs against the built-in part, three levels,
  bus pins, X on undriven pins, scoped labels, per-instance state, step back, rules and state through an IC, timing, saving, loops).

**14c. Make and place ICs (medium)**
- *Make IC* from the whole circuit, or from a selection that holds labelled inputs and outputs. It asks for a name and adds
  the definition to `ics`. The canvas is unchanged.
- A palette section "ICs in this circuit".
- The instance symbol: a box with the name, pin labels and bus stubs.
- The inspector shows the IC's name, *Edit IC* and *Expand into parts*, which inlines the instance as one undo step.
- Validation: no inputs or outputs, duplicate pin names, recursion. A warning for operable parts inside (keypad, button):
  they can't be reached.

**14d. Edit an IC (medium–large)**
- A breadcrumb "Main › Full adder › Half adder" with Back. The store edits the active level (`editing: string[]`). Undo
  snapshots the whole document, so it works across levels.
- While editing, the simulator runs the IC alone with its own switches.
- On return, instances pick up the new definition, and wires to pins that no longer exist are pruned (`pruneWires`), with a
  toast saying how many.
- Rename, and delete when unused, from the palette.

**14e. Collapse a selection into an IC; examples (large)**
- *Collapse into IC* (selection bar):
  - Every wire crossing the selection's boundary becomes a pin: an input where it enters, an output where it leaves.
  - Pin names come from the driving part's label, or `in1` / `out1`; bus widths are kept.
  - The selection is replaced by one instance, wired in its place, as one undo step.
- Examples:
  - `/ic-adder`: half adder → full adder → 4-bit adder, nested.
  - The 8-bit computer shown as blocks (fetch, ALU, registers, control, output).
- Decide when building whether the computer is rebuilt in place or added as a new example: the computer tests read parts by
  label, and those parts would move inside ICs (`inst/inner` ids). Rebuild in place only if the tests can follow cleanly.

**Tests (14).**
- Equivalence: an IC full adder against the built-in one over all inputs; nesting three deep; bus pins; scoped labels;
  per-instance memory; step back; the timing path through an IC; analyze and a challenge check through ICs.
- Saving: v1 files load, v2 round trip, recursion refused on load.
- Expand ∘ make is the identity on wiring.
- Collapse keeps behaviour (the computer's programs give the same output before and after).
- e2e: make, place, wire, run; edit, back, instances updated; collapse; expand; undo across levels.

## Milestone 15: Challenges for classrooms (medium) — dropped for now
> Not scheduled: nothing in 11–14 or 16 depends on it, except that the testbench in 16 now brings its own `pulse` step. The design
> stays here for later. Milestone numbers are kept so references don't change.

**15a. Challenge links (small)**
- `/challenge/<id>` opens a challenge (its 11b record), resolved in `runtime.ts` like `exampleFromPath`; *Copy link* in the
  challenge panel.

**15b. Clocked challenges (medium)**
- The step checker (`src/model/challengecheck.ts`) gets a `pulse` step: one rising and falling edge on a labelled input
  (`CLK`).
- A new group, *Counting and sequences*: T flip-flop toggle, 2-bit counter, 4-bit shift register, up/down counter, and a
  1011 detector (its hint points at the State machines panel).
- Each gets the usual three tests: the starter fails, the solution passes, and removing any one wire of the solution makes
  it fail.

**15c. Your own challenges (medium)**
- *Make a challenge from this circuit*:
  - The ports are the current circuit's labelled switches and LEDs.
  - The goal is its truth table (combinational, through `analyze`), or a step list the author edits, with expected values
    filled in from the circuit (sequential).
  - Plus a title, the lesson text, a hint, and rules (only these parts; at most N parts).
  - The starter is the ports, unwired.
- The challenge travels as a link (`/challenge#<lz-string>`), with no backend. Solved state is keyed by a hash of the
  challenge.
- *Copy my answer* makes a link carrying the challenge and the student's circuit. Opening it re-checks the circuit and shows
  the verdict, so the teacher sees the check itself, not a claim.
- Not: accounts, class lists, a grading server.

## Milestone 16: Small wins (small)
Each is its own small PR, in any order.
- **Works offline**: a web app manifest and a service worker that caches the app shell and `/examples/*` (classrooms with
  bad Wi-Fi). The cache is updated on deploy; the version label already says which build is running.
- **Keyboard control**: switches get an optional *Key* param (1–9, A–Z) that toggles them while the canvas has focus; the
  keypad reads hex digits and calculator keys from the keyboard (the gamepad already does, `src/app/gamepad.ts`).
- **Lookup table from an expression**: a *Fill from expression* button in the LUT inspector, using the Logic panel's
  parser.
- **Testbench for any circuit**: the challenge checker opened up. A list of steps (set inputs, pulse, expect outputs) saved
  with the circuit, with *Run tests* and a list of failing steps. It needs a `pulse` step (one rising and falling edge on a labelled input such as `CLK`) added to the step checker in
  `src/model/challengecheck.ts`, which challenges don't have today.

## Considered and not planned
- **Croatian UI**: not needed.
- **Moving switch positions out of the document.** They are params (`interact`, `store.ts:327`) while the keypad's value is
  simulator state. That is inconsistent, but saved circuits remembering their inputs is useful, and changing it would change
  what undo does.
- **Routing in a Web Worker.** After 12b no example routes when opened; revisit only if editing a large circuit stutters.
- **Logisim `.circ` import.** Useful for teachers with existing files, but medium–large (Logisim's part library and wiring
  model). A candidate after milestone 16.
- **A per-viewer "view only" link, notes with formatting, frames that follow moved parts**: left as listed in M4.

## Risks
- **IndexedDB edge cases** (private windows, quota, Safari evicting storage): the memory fallback, the persist request and
  *Download all* contain them; the e2e tests run in Chromium only.
- **Async startup** could flash the wrong circuit; the first render waits for the library.
- **Expansion ids and every `comp:pin` string**: a delimiter test over all defs (like M10's) checks that `/` cannot appear
  in a part id or pin name.
- **The worklist (14a) changing tick counts** would break glitch capture and timing; the identical-ticks test over every
  example guards it.
- **Collapsing the computer** touches labels many tests read; decide in 14e, and update tests in the same PR.
- **Bundle budget creep**: the CI check from 12a.

## Critical files
- **Storage and startup**: `src/app/runtime.ts` (`initialCircuit`, autosave, `openExample`, `openJSON`), `src/app/store.ts`
  (`loadCircuit`, `checkpoint`), `src/app/fsm.ts`, `src/app/challenges.ts`, `src/main.tsx`, new `src/app/library.ts`.
- **Load speed**: `vite.config.ts`, `src/model/examples.ts` (`EXAMPLES`), new `src/model/examples-index.ts`,
  `src/model/thumbnail.ts`, `scripts/`.
- **UI**: `src/ui/Toolbar.tsx`, `src/App.tsx`, `src/ui/Inspector.tsx`, `src/ui/Palette.tsx`, `src/ui/SelectionBar.tsx`.
- **ICs**: `src/model/buses.ts` (`busModel`, `flatten`), `src/engine/netlabels.ts`, `src/engine/simulator.ts`,
  `src/model/serialize.ts`, `src/model/circuit.ts`, `src/model/builder.ts`, `src/model/ops.ts` (`pruneWires`).
- **Challenges**: `src/model/challenges.ts`, `src/model/challengecheck.ts`, `src/ui/challenges/*`.
