# Milestone 10: buses and tri-state — plan

> **Status:** planned, not started. No code has been written. Work goes in five PRs, 10a to 10e (see *Sub-milestones*), each
> from its own feature branch per `CLAUDE.md`. **Resume with 10a**, and wait for the user's go before starting it.
> Tick each sub-milestone here as it ships.
>
> - [x] 10a Z and tri-state (scalar), v0.0.1-34
> - [ ] 10b Bus plumbing
> - [ ] 10c Parts
> - [ ] 10d Rebuild the computer
> - [ ] 10e Docs and polish

## Context
Today a wire is one bit and a net is exactly one output pin (`simulator.ts:188-220`); wide parts are bundles of scalar pins
(`D0..D7`). The 8-bit computer therefore needs ~240 wires, routes in ~2 s and is hard to read. Milestone 10 adds multi-bit
wires, n-bit parts, tri-state buffers with a shared bus, and rebuilds the computer on them (≈40 wires).

Decisions already made with the user:
- **Shared bus = a "Bus junction" part**, not output→output wires (wires stay output→input, one per input).
- **Existing wide parts get a "Bus ports" toggle** (off for old files); a **new n-bit family** is added; old 4-bit parts stay.
- **The four computer examples are rebuilt in place** (same links, same part labels).

## Core design: buses are a front-end, the simulator stays 1-bit
A *bus pin* is a named group of scalar pins. The model/UI/router see one fat wire; before simulation a `flatten()` step
expands every bus wire into per-bit wires and removes the zero-delay parts (splitter, merger, bus labels). The engine keeps
its per-tick loop, history/step-back, glitch capture, VCD, timing and probes almost untouched, and no wire gets a stored width
(width is derived from its two pins, so the file format does not change).

1. **Pin groups.** `PinDef` gains `group?: string` and `ComponentDef` gains `groups?(p): Group[]` where
   `Group = { name, dir, pins: string[] }` (explicit scalar members, so `A..D`/`QA..QD` work too). Rule, enforced by a test over
   all defs: a group name never equals a scalar pin name of the same part (so `reg.D` can't mean two things).
2. **View layout.** `viewLayout(comp)` (in `src/model/circuit.ts`, next to `compLayout`): when the part is in bus mode, each group's
   members collapse to one `PinDef` `{ name: group, bus: n }` and each side is repacked with `box()`'s spacing so the body shrinks.
   `worldPins`, `findPin`, hit-testing, routing, bounds and symbols use the view layout; the simulator keeps the scalar layout
   (`ComponentDef.layout`) for `evaluate`. Bus mode = param `bus` (bool, structural) for old parts; the new family is bus-only.
3. **`ParamDef.legacy`**: value assumed when a param is missing from a saved file. `bus` has default `true` (palette placements)
   and `legacy: false` (old files), so no file migration and no version bump of the format. `serialize.ts:63-89` fills params
   already; it just needs to read `legacy` before `default`.
4. **Wire width** = width of its pins (scalar = 1). `connect()` (`store.ts:343-359`) refuses mismatches with a hint
   ("8-bit bus → 4-bit pin: use a splitter"); `pruneWires` (`ops.ts:81`) also drops wires whose two widths now differ (toggling
   `bus` or changing `bits` is already `structural` → `pruneWires` + `rerouteAround`, `store.ts:263-272`). `autoConnect` skips
   mismatched widths. Deserialize applies the same check.
5. **`flatten(circuit) → { comps, wires }`** (new `src/model/buses.ts`). Output uses only scalar pins and the existing
   `{ from, to }` shape, so `loadIntoSim` (`src/app/sim.ts`) just calls it, and so do the other places that rebuild a sim input from a
   circuit: `asSim` in `model/trace.ts:17`, `analyze.ts:16`, `challengecheck.ts`, `model/timing.ts`.
   - Bus-mode part with group `G`: wire `a.Q → b.D` becomes `a.Q[i] → b.D[i]` using the groups' member lists.
   - **Splitter / merger / bus labels are never simulated.** `bitSource(comp, pin, bit)` follows them back to a real driver pin
     (chains and loops → X, like `resolveLabels`, `engine/netlabels.ts`). Bus Send/Receive labels expand into scalar
     `netsend`/`netrecv` with derived names (`NAME[3]`), so the existing zero-delay alias mechanism does the rest.
   - Synthetic comps keep their ids stable (`id#bit`) and are filtered from UI results; real comps keep their ids, so probes,
     breakpoints, glitch rows (`comp:pin`) and VCD names keep working on scalar pins.
6. **Z and tri-state (engine).** `V` gains `Z = 3` (`types.ts:1`; nets are `Uint8Array`, so storage is fine).
   - Only `tribuf` outputs can produce Z. In `Simulator.tick()` (`simulator.ts:~266`), when a part's inputs are gathered, a Z is
     read as X unless the part has `def.acceptsZ` (one comparison per input, no load-time flags). Every existing part's X-handling
     stays exactly as is, and probes/LEDs see X on a floating net (wires and pin values still show Z). A test feeds Z into every
     part and asserts "same outputs as X". Helpers that test `v === X` (`inv`, `toNum`, `glitch.ts`) become `v > 1` / `v >= X`.
   - `tribuf` (param `bits`: 1 or bus; pins `A`/`Y` + `EN`): `Y = EN ? A : Z`; EN = X → X.
   - `busjoin` ("Bus junction", `acceptsZ`): params `bits`, `drivers` (2–8), `pull` (none / 0 / 1). Output per bit: all Z → pull value
     (or X if none); one non-Z driver → that value; several that agree → that value; disagree or any X → X (**contention**).
     Pins `A..H` in, `Y` out. Unit delay like a gate (flatten does not alias it, so clock/data timing stays honest).
   - `glitch.ts` and the tick diagram skip Z like X (check `X` comparisons); `vcd.ts` writes `z`; wire/pin colour class `vz`
     (grey dashed) added to `index.css` and `exportImage.ts`. Contention is shown as X plus a warning outline on the junction.
7. **UI for buses.**
   - Thick wire (≈5 px) with its own class; colour `vb` (all bits known), `vx` (any X), `vz` (all Z). `usePinValue` gets a bus
     sibling `useBusValue(comp, pin)` that reads the member pins and returns `{ value, known }`; bus wires show the value in hex on
     hover and optionally as a small label on the wire (setting).
   - Bus pins drawn with a thick stub, a slash and the width; `BoxSym` stays generic (`symbols.tsx:190`). Symbols that index pins
     positionally (`alu`, `seg7`, `MemSym`, `MuxSym`, `symbols.tsx:~700-757`, `MemoryInspector.tsx:94,209`) switch to name lookup via
     the scalar layout for values and the view layout for geometry — one pass, covered by e2e.
   - Inspector: `bus` checkbox appears automatically from `ParamDef`; wire inspector says "8-bit bus"; legend gets the new colours.
   - Delimiters: bus/pin names must not contain `.` or `:` (parsed in `serialize.ts:106`, `builder.ts:81`, `views.tsx:144`, etc.);
     tested for every def.
8. **Router.** No algorithm change: a bus is one wire with one `netKey`. Only clearance for the thick stroke (cells are 10 px) is
   checked. Expect the computer's routing time and the `router.test.ts:163-171` budget to drop sharply; tighten the budget in 10d.

## Parts
New category `Buses` (`Category` in `types.ts:69`, `registry.ts`):
- **Splitter** (`bits` 2–16, `split` text like `4,4` or `1,1,6`; outputs `Y0..` as bus or scalar by width) and **Merger** (mirror).
  Pure wiring, flattened away.
- **Bus Send / Receive** labels (`bits` param), same name rules and warnings as scalar labels (`model/labels.ts`).
- **Bus constant** (hex value), **Bus input** (hex entry / bit toggles), **Bus display** (hex/dec/bin readout + bits).
- n-bit family, `bits` 2–16 (bus-only, scalar pins `D0..`/`Q0..` internally): **Register** (LD, CLK, CLR), **Counter with load**,
  **Adder** (Ci/Co), **Subtractor/Adder-subtractor**, **Comparator**, **Bitwise gate** (and/or/xor/nand/nor/xnor/not over buses,
  same delay as the scalar gate), **Mux** (n bus inputs, bus select), **Shifter** if the computer needs it.
- `tribuf`, `busjoin` (above).
- **Bus toggle** (`bus` param) on: ROM, RAM, console, framebuffer, `hexin`, `hexdisp`, `bar`, `breakpoint`, `probe`, 4-bit
  `add4/sub4/addsub4/cmp4/alu`, `register`, `counterld`, `mux`. Implemented as one helper that declares `groups` per def.
- **Bus probe**: a `probe` in bus mode records a numeric trace (same shape as `groupTrace`'s `BusTrace`, `engine/groups.ts`) and
  shows as one waveform row with no extra work in `WaveformPanel`; existing grouped single-bit probes keep working.
- Tables to extend: `SEQUENTIAL` and `/^A\d/` in `model/timing.ts:70-140`, `BY_TYPE` in `model/delays.ts:21-42`, the `switch` in
  `symbols.tsx`, palette order.

## Sub-milestones (each a PR with a version bump, per CLAUDE.md)
**10a. Z and tri-state, scalar only (small–medium) — done** — `V.Z`, load-time Z→X read mapping, `tribuf`, `busjoin` (1 bit), colours,
glitch/VCD/waveform handling, contention warning, example `/tristate` (three registers on one line). No bus UI yet.
*What 10a did, and where it differs from the plan above:* `V` has `Z = 3`; `ComponentDef.acceptsZ`; the Z→X read mapping is in
`Simulator.tick()` and in `sample()` (probes and breakpoints see X), and `pinValue()` of an *input* applies it too, while an
*output* pin (a tribuf's `Y`) shows Z, which is what colours the wire (`.wire.vz`, dashed, `--wire-z`). New `src/engine/components/tristate.ts`:
`tribuf` (pins `A`, `EN` (default 0), `Y`) and `busjoin` (`drivers` 2–8, `pull`; unconnected driver pins read Z; contention outlines the
junction in red via `.sym-body.contention`). `busjoin` is 1 bit for now: 10c adds `bits` once pin groups exist (scalar `A..H` while
`bits` = 1; groups named so they never clash with them). Probes record X for a floating line, not Z (so the waveform panel needed only type
changes); showing Z in the waveform is a possible follow-up. Example `/tristate`. Tests: `src/engine/tristate.test.ts` (including a test that
every part gives the same outputs for a Z input and an X input) and an e2e test in `editor.spec.ts`.

**10b. Bus plumbing (large)** — groups, `viewLayout`, `legacy` params, width rules in `connect/prune/autoConnect/serialize`,
`flatten()` wired into every sim-input caller, thick wire + `useBusValue`, splitter, merger, bus labels, trace through
splitters/mergers/labels (`model/trace.ts`), `/buses` example (a bus-width demo using the 4-bit `register` + `add4` in bus mode).
**10c. Parts (large)** — n-bit family, bus constant/input/display, `bus` toggle on the existing parts, bus probe, bus `busjoin`/`tribuf`,
symbols pass, inspector/memory-inspector pin lookups, timing/delay tables, palette and help text.
**10d. Rebuild the computer (medium)** — `computer2Builder` (`src/model/computer2.ts`) uses `bus` helpers added to `CircuitBuilder`
(`wire` auto-detects bus pins; `split`, `merge`); keep every label the tests use (`PC low`, `ACC high`, `Flags`, `Halted`, `Data RAM`,
`Program`, `LCD`, `Keypad`, `Hundreds/Tens/Ones`…) or update `computer2.test.ts`, `examples.test.ts:437-470`, `beginner.test.ts`
and `e2e/editor.spec.ts:411,688,718` in the same PR. Keep `/computer`, `/computer-lcd`, `/computer-sound`, `/computer-calc`. Use a
shared data bus with `tribuf`/`busjoin` for ACC/RAM/input sources if it stays readable, otherwise muxes (muxes stay the default;
the shared bus gets its own `/databus` example). Tighten the router budget; the 4-bit beginner computer is left alone.
**10e. Docs and polish (small)** — `docs/plan-m10-buses.md` (decisions, as `plan-m9-timing-fsm.md`), tick the boxes in
`docs/plan-next-features.md`, update `CLAUDE.md` "Current work", README parts list, in-app help. Not in scope: output→output wires,
bus-width inference, bus-aware logic/FSM generators (they keep producing scalar gates), per-bit bus tracing in the tick diagram.

## Tests
- **Engine (10a):** Z→X read mapping for every def; `tribuf` truth table; `busjoin` (all Z, one driver, agreeing drivers,
  contention, X enable, pulls); step back / reset over a Z net; glitch capture ignores Z; VCD `z`.
- **Model (10b):** `flatten` equals the hand-wired scalar circuit tick for tick (counter→display, adder, RAM write/read) with
  identical results; splitter/merger chains, loops, widths 1…16, bus labels incl. unknown names and duplicate sends; a splitter or
  label adds zero ticks; width mismatch refused in `connect`/`autoConnect`/`deserialize`; toggling `bus` prunes only the affected
  wires; old files (no `bus`) load and simulate as before; the whole existing example set serializes and simulates unchanged;
  group-name/scalar-name clash and delimiter checks over all defs; round trip in `serialize.test.ts`; trace through
  splitters/labels.
- **Parts (10c):** each n-bit part against a reference model for random inputs at widths 2, 8, 16; bus-mode `rom/ram/console`
  behave like bit mode; bus probe trace equals the grouped-probe trace; symbols render for every def in both modes with no
  overlapping pins; every example still has no overlapping parts (`examples.test.ts:18-56`).
- **Computer (10d):** the existing end-to-end program results (Fibonacci, LCD, sound, calc) unchanged; wire count well below the
  old one; routing budget tightened.
- **e2e (touched specs only, per CLAUDE.md):** `editor.spec.ts` — draw a bus wire between two bus-mode parts, refused mismatch
  hint, splitter + merger round trip, tri-state contention turns the bus X, `/databus` runs, `/computer` still halts and prints;
  `mobile.spec.ts` — connect a bus wire by touch.

## Verification
1. `npm test -- --reporter=dot` (all unit tests) and `npx oxlint` on changed files; `npx tsc -b` (types/signatures change a lot).
2. `npx playwright test --reporter=line e2e/editor.spec.ts` (and `e2e/mobile.spec.ts` for 10b/10c), with `PW_CHROMIUM` if needed.
3. By hand in the dev server: place two bus-mode parts and wire them; split/merge; tri-state example with two drivers enabled
   (X, warning outline) and one enabled (clean value); open each computer link and run its program.
4. Per sub-milestone: feature branch → PR → `gh pr checks --watch` → ask before merging; bump the version once per PR
   (`npm version prerelease --no-git-tag-version`).

## Risks
- **Symbols indexing pins by position** (alu, seg7, MemSym, MemoryInspector) are the most likely source of bugs in 10c; do the
  name-lookup refactor first, behind the existing e2e, before adding any bus mode.
- **Z leaking** into a part that mishandles value 3: contained by the read-time Z→X map and the all-defs test.
- **Group/scalar name clashes** across modes silently re-meaning an old wire: contained by the clash test and `pruneWires`.
- **Layout repack** may look different from hand-tuned symbols; accept generic bodies for the old parts, polish only what the
  computer shows.
- **Rebuilding the computer** touches many labelled parts used by tests; do it last, in one PR, with the tests updated together.

## Critical files
`src/engine/types.ts` (V, PinDef, ParamDef.legacy, groups), `src/engine/simulator.ts` (Z flags, `acceptsZ`), `src/engine/layouts.ts`
(`box`, repack), `src/engine/components/*` (new parts, groups per def), `src/engine/registry.ts`, `src/model/circuit.ts`
(`viewLayout`), new `src/model/buses.ts` (`flatten`, `bitSource`), `src/model/{serialize,ops,builder,trace,timing,delays,analyze,
challengecheck,computer2,examples}.ts`, `src/app/{store,sim,hooks,waveform}.ts`, `src/ui/{symbols,Inspector,MemoryInspector,Palette}.tsx`,
`src/ui/canvas/{views,Canvas}.tsx`, `src/index.css`, `src/ui/canvas/exportImage.ts`.
