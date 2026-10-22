# Sklopko v2: stretch features plan

> **How to execute this plan**
> - Read `CLAUDE.md` first. Its rules apply: run the full checklist before every push, and bump the version
>   (smallest number) with every push.
> - Work milestone by milestone, in order. Each milestone should end in a working, tested state.
> - After each milestone, run the checklist and stop to report. Commit or push only when asked.
> - Dev server: `npm run dev`. Unit tests: `npm test`. Browser tests: `npm run e2e`. The first run needs
>   `npx playwright install chromium`.

## Context
The core simulator is live (v0.0.1-4): 44 parts, router, examples with short links, mobile support. This plan covers the stretch list from the original plan, scoped by the user to:

- **Custom ICs** (subcircuits)
- **Waveform / logic analyzer**
- **More complex parts** (ALU, multiplier, BCD adder, ROM, RAM)
- **Dot-matrix display**
- **IEC gate symbols**
- **Wire hops at crossings**

Explicitly *not* now: buses/tri-state, Croatian UI, short share links. **Challenges mode** (tutorial and "check your knowledge", like the original) is the *next iteration*. It is listed at the end but not built in this round.

Project rules (`CLAUDE.md`) apply: every push bumps the smallest version number and runs the full checklist. Work is split into milestones that each end in a working, tested state; I check in for a push after each.

## Milestone 1: Settings, IEC symbols, wire hops (small)
- **Settings popover**: a ⚙ button in the toolbar (inside the ☰ menu on phones).
  - Gate style: US (curved) or IEC (rectangles).
  - Wire hops: on (default) or off.
  - Stored per viewer in `localStorage`, wrapped in try/catch, in a new `src/app/settings.ts` (small zustand store).
- **IEC symbols**: `GateSym` in `src/ui/symbols.tsx` gets an IEC branch.
  - Rectangle with `&`, `≥1`, `=1` or `1`, keeping the existing inversion bubble.
  - Layouts are unchanged (same pins), so circuits and routing are unaffected.
  - Palette thumbnails follow the setting.
- **Wire hops**: purely rendering.
  - A memoised pass over all wires (like `junctions()` in `src/routing/path.ts`) finds right-angle crossings between *different* nets at interior points.
  - The horizontal segment gets a small semicircle (r≈4) at each crossing. `WireView` builds its path with arcs.
  - Junction dots (same net) never hop.
- Tests: unit test for crossing detection. e2e: the setting toggles the gate symbol class and the hop path.

## Milestone 2: More complex parts (small–medium)
All are new `ComponentDef`s in `src/engine/components/combinational.ts` and `sequential.ts`, using the `box()` layout and `comb()` helpers. They render as generic boxes unless noted.

- **4-bit ALU**: inputs A0–3, B0–3, op S2 S1 S0.
  - Ops: ADD, SUB, AND, OR, XOR, NOT A, A+1, A−1.
  - Outputs F0–3, Co, Z (zero).
  - The title shows the current operation name, live.
- **Multiplier**: param 2×2 or 4×4, giving a 4- or 8-bit product.
- **BCD adder**: two BCD digits + Ci, giving a BCD digit + Co (with the +6 correction).
- **ROM**:
  - Params: address bits (2–5) and data bits (4 or 8).
  - Contents are a hex text param (one word per hex group), validated.
  - The symbol shows a tiny live table with the addressed word highlighted.
- **RAM 16×4**:
  - Pins: A0–3, D0–3, WE, CLK. A rising CLK with WE=1 writes.
  - Q0–3 read the addressed word continuously.
  - State is 16 nibbles. Same live table symbol as ROM.
- Engine/UI support needed:
  - New `ParamDef` kind `'text'` (pattern + maxLength) in `src/engine/types.ts`, rendered by `Inspector.tsx`. `deserialize` already type-checks strings.
  - Clock frequency options extended up to 256 Hz, which the dot-matrix scanning needs. `Simulator.advance` already caps edges per frame.
- Tests: exhaustive ALU / multiplier / BCD-adder tables (as in `simulator.test.ts`), ROM lookup, RAM write/read/hold.

## Milestone 3: Dot-matrix display (small–medium)
- **8×8 LED matrix** part: inputs R0–7 (rows) and C0–7 (columns), both active-high. Pixel (r,c) is lit when row r and column c are 1.
- **Persistence** so scanned images look steady. It is UI-only, since the display has no outputs.
  - The symbol keeps a per-pixel "last lit" time (`performance.now()`) in a ref.
  - Pixels fade over about 250 ms using rAF while anything is still fading.
- **Example `/matrix`**: a smiley drawn by scanning.
  - A 3-bit counter on a fast clock feeds a 3:8 decoder for the rows.
  - The same count addresses an 8×8-bit ROM holding the image, which drives the columns.
  - It showcases counter, decoder and ROM working together.
- Tests: the example's ROM/row/column logic per row (unit). A screenshot check of the rendered matrix.

## Milestone 4: Waveform / logic analyzer (medium)
- **Probe part** (I/O category): one input, its label is the trace name, small scope-flag symbol.
- **Simulated time**: `Simulator` gets a `time` (ms) counter, advanced in `advance()` / `stepClock()` and reset in `reset()`.
- **Recorder** in `src/app/recorder.ts`.
  - After each frame's `sim.publish()`, it appends value transitions `(time, v)` per probe, keyed by probe id.
  - It keeps the last ~60 s and is cleared on reset or load.
- **Waveform panel** in `src/ui/WaveformPanel.tsx`, a collapsible drawer under the canvas.
  - Toggled from the toolbar and opened automatically when the first probe is placed.
  - One row per probe: its label plus a step trace in the wire colours (1 green, 0 red, X grey).
  - A time axis and a window of 2/5/10/30 s.
  - Follows live while running; while paused, drag to scroll back.
  - "Clear" button.
  - On phones it's a bottom sheet.
- Examples: add probes to the shift-register and clock examples (CLK, Q0–Q3, carry).
- Tests: recorder unit tests (transitions only, trimming). e2e: place a probe on a clock, run, and check the panel shows a trace with several edges.

## Milestone 5: Custom ICs (medium–large)
> **Postponed.** Milestones 1–4 are built first; this one is planned for later.

**Model.** The circuit document gains a library: `Circuit.ics: Record<id, ICDef>`. Each `ICDef` has:
- `name`
- `circuit`: its inner comps/wires
- `inputs`: names from the inner **switches**' labels, ordered top to bottom
- `outputs`: names from the inner **LEDs**' labels

Switches and LEDs are the interface, so an IC can be tested on its own, exactly as it will behave.

**Dynamic parts.**
- A new `registerIC()` / `unregisterIC()` in `src/engine/registry.ts` registers type `ic:<id>`:
  - category `custom` (palette section "My ICs")
  - `box()` layout: inputs left, outputs right, title = name
- A store subscription keeps the registry in sync with `doc.ics`.
- `layoutOf()` (`src/engine/simulator.ts`) gets cache invalidation per type.
- `deserialize` registers ICs before reading comps.

**Simulation by flattening.**
- `loadIntoSim()` (`src/app/sim.ts`) expands IC instances recursively into plain parts with ids like `inst/inner`.
- Inner switches are dropped; wires from them are re-sourced to whatever drives the instance's input pin (X if unconnected).
- Wires leaving the instance's output pins are re-sourced to the inner LED's driver.
- `Simulator.load()` takes an alias map, so `pinValue('inst', 'Y')` and `signature()` still work for the IC box and its wires on the canvas.
- No engine changes beyond aliases. Speed is the same as hand-built circuits.

**Creating ICs: "Make IC".**
- Selection bar / inspector / toolbar action.
- Takes the selection (or the whole circuit if nothing is selected), asks for a name, and copies the parts into the library.
- The canvas is unchanged; the new IC appears in the palette under "My ICs".
- Validation: needs at least one labelled switch and one labelled LED, unique pin names, and no recursion.

**Editing ICs.**
- Inspector "Open IC" or a palette item menu switches the canvas to the IC's inner circuit.
- A breadcrumb shows "Main › Half adder" with a Back button.
- The store gets `editing: icId | null`. All `edit()` actions operate on the active circuit. Undo history snapshots the whole document, so undo works across both levels.
- While editing, the simulator runs the IC standalone.
- On return, instances pick up the new definition. Wires to pins that no longer exist are pruned via `pruneWires()` in `src/model/ops.ts`.
- Rename and delete (only when unused) from the palette.

**Saving.**
- `SavedCircuit` version 2 adds `ics` (each saved like a circuit).
- v1 files still load. Share links and example links carry the library automatically.

**Example `/ic-adder`.** Builds a half adder IC, then a full adder IC made of two half adders + OR, then a 4-bit ripple adder from four full-adder ICs (nested ICs), driven by 4-bit inputs and a hex display.

**Tests.**
- Flattening equivalence: IC full adder vs the built-in full adder over all inputs, with nesting.
- Recursion guard.
- Pin pruning after an edit.
- v2 round-trip and v1 compatibility.
- e2e: select → Make IC → place from palette → wire → works → open, edit, back → instance updated.

## Next iteration (not this round): Challenges mode
Lessons plus challenges such as "build a circuit matching this truth table". The simulator checks the circuit automatically by sweeping its labelled switches and comparing its labelled LEDs, then marks it solved. This mirrors the original's TUTORIAL / PROVJERI SVOJE ZNANJE pages. To be planned separately after this round.

## Critical files
- **Engine**:
  - `src/engine/types.ts` (text param)
  - `src/engine/components/*` (new parts)
  - `src/engine/registry.ts` (dynamic IC defs)
  - `src/engine/simulator.ts` (time, aliases, layout cache invalidation)
- **App**: `src/app/sim.ts` (flattening), `src/app/store.ts` (document + `editing`), `src/app/recorder.ts`, `src/app/settings.ts`.
- **Model**: `src/model/serialize.ts` (v2), `src/model/examples.ts` (`/matrix`, `/ic-adder`, probes).
- **UI**:
  - `src/ui/symbols.tsx` (IEC, ROM/RAM tables, matrix, probe, IC box)
  - `src/ui/canvas/views.tsx` (hops)
  - `src/ui/Palette.tsx` ("My ICs")
  - `src/ui/Inspector.tsx` (text param, Open IC)
  - `src/ui/Toolbar.tsx` (settings, waveforms, Make IC, breadcrumb)
  - new `src/ui/WaveformPanel.tsx`

## Verification
Per milestone, the `CLAUDE.md` checklist:
- `npm test`
- `npm run lint`
- `npm run build` (confirm the version string is in the bundle)
- `npm run e2e` (desktop + emulated phone), reading the full summary line, not just the last line

Also check new symbols and examples visually: take Playwright screenshots (light/dark, rotated parts, an
emulated phone) with a small throwaway script outside the repo. Check new example links against the production
preview (`npm run build && npx vite preview`). Bump the version on each push.
