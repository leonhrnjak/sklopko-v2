# Sklopko v2: milestones 11–16

> **How to execute this plan**
> - Read `CLAUDE.md` first. Its rules apply: feature branch → PR → CI → merge, one version bump per PR, scoped tests.
> - Work milestone by milestone, in order. Each sub-milestone (11a, 11b, …) is one PR and ends in a working, tested state.
>   Tick its box below when it merges, and add a short *What it did, and where it differs from the plan* note under it, as
>   `plan-m10-buses.md` does.
> - After each sub-milestone, stop and report; merge only when the user says so.
>
> - [ ] 11a Library storage
> - [ ] 11b Nothing replaces your work
> - [ ] 11c My circuits panel, state machines, backup
> - [ ] 12a Code splitting
> - [ ] 12b Prebuilt examples and thumbnails
> - [ ] 12c Rendering, only if measurement says so
> - [ ] 13a Toolbar menus, collapsible help, e2e split
> - [ ] 13b Example gallery
> - [ ] 14a Engine groundwork
> - [ ] 14b ICs in the model and the simulation
> - [ ] 14c Make and place ICs
> - [ ] 14d Edit an IC
> - [ ] 14e Collapse a selection into an IC; examples
> - [ ] 15a Challenge links
> - [ ] 15b Clocked challenges
> - [ ] 15c Your own challenges
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
| 15 | Challenges for classrooms | medium | Links, clocked tasks, teachers' own challenges |
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

**11c. My circuits panel, state machines, backup (medium)**
- The document's name is shown in the toolbar; clicking it renames.
- *My circuits* dialog: newest first, with name, kind, date and (from 12b) a thumbnail; open, rename, duplicate, delete
  (a toast with Undo), New. A filter by kind.
- State machines become library records (`kind: 'fsm'`). The editor (`src/app/fsm.ts`) opens the active one, and
  `sklopko.fsm.v1` is imported once.
- Backup: *Download all* (one JSON file, `{ app: 'sklopko-library', docs: [...] }`) and *Import* (adds; never overwrites;
  a clashing id gets a new one). Browser storage can be cleared, so this matters.
- `navigator.storage.persist()` is requested after the first save.

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

**12c. Rendering, only if measurement says so (small)**
- Measure `sim.publish()` and React's commit on the raycaster at 4 kHz. Today every wire runs its own
  `useSyncExternalStore` check on every publish (`src/app/hooks.ts`).
- If it costs more than 2 ms a frame, add net-indexed subscriptions: the simulator keeps the nets that changed since the
  last publish and notifies only their subscribers.
- Otherwise record the numbers here and skip it.

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

**13b. Example gallery (small–medium)**
- *Examples* opens a dialog: the groups as sections, a card per example with its thumbnail (12b), name and a one-line
  blurb (a new `blurb` field, written for all 45), plus a search box. The dropdown goes away.
- Opening follows 11b. A card's short link can be copied.

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

**14b. ICs in the model and the simulation (medium)** — no UI.
- `ICDef` (`name`, `circuit`, derived pins), `expandICs`, serialize v2 and `migrate`, the recursion check, and
  `CircuitBuilder.ic()`.

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

## Milestone 15: Challenges for classrooms (medium)
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
  with the circuit, with *Run tests* and a list of failing steps. It reuses 15b's steps.

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
