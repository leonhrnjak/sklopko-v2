# Sklopko v2: next features plan

> **How to execute this plan**
> - Read `CLAUDE.md` first. Its rules apply: run the full checklist before every push, and bump the version
>   (smallest number) with every push.
> - Work milestone by milestone, in order. Each milestone ends in a working, tested state; tick its box here when it
>   ships.
> - After each milestone, run the checklist and stop to report. Push (to `main`) only when asked.
> - Reusable parts / custom ICs (milestone 5 of `plan-stretch-features.md`) stay postponed. Nothing here depends on them.

## Context
v0.0.1-9: ~60 parts, router, waveform panel, ROM/RAM, an 8-bit computer example that prints Fibonacci in decimal. Building
that computer showed what hurts next: 240 wires make it hard to read and slow to route (2 s), programs are typed as hex,
and debugging means staring at waveforms. This plan goes from the cheapest, highest-impact items to the largest.

Out of scope for now: reusable parts, Croatian UI, real-time collaboration.

## Order at a glance
| # | Milestone | Size | Why now |
|---|---|---|---|
| 0 | Dev housekeeping | tiny | e2e runs here need a hand-made config |
| 1 | Net labels (tunnels) | small | Declutters circuits with far-apart connections |
| 2 | Assembler and memory tools | medium | Makes the computer programmable |
| 3 | Debugging tools | medium | Breakpoints, step back, bus-value traces |
| 4 | Annotations, export, embed | small–medium | Examples explain themselves; sharing |
| 5 | Truth tables and expressions | medium | Teaching tool; feeds challenges |
| 6 | Challenges mode | medium–large | Already planned; uses 5 |
| 7 | New parts and I/O | medium | Speaker, console, framebuffer, keypad, LUT |
| 8 | Router performance | medium | Larger circuits without a freeze |
| 9 | Timing view and state machine editor | large | Delays, glitches, FSM → circuit |
| 10 | Buses and tri-state | large | Multi-bit wires, shared data bus |

## Milestone 0: Dev housekeeping (tiny)
- [x] `playwright.config.ts` reads the browser path from an env var (`PW_CHROMIUM`), so `npm run e2e` works when the
      installed Playwright wants a different Chromium build than the machine has. Default behaviour is unchanged.
- [x] Noted in `CLAUDE.md` ("Before pushing").

## Milestone 1: Net labels (small)
A wireless connection: wires that share a name are one signal, without drawing the line between them.

**Parts.** Two new I/O parts with a `name` text param (same `text` ParamDef as ROM contents), drawn as small flags:
- *Label out* ("send"): one input pin `A`. Whatever drives it is published under `name`.
- *Label in* ("receive"): one output pin `Y`. It carries the signal published under `name`.
One send can feed any number of receives. A receive with no matching send reads X. Two sends with the same name:
the first (by position) wins and both get a warning outline in the UI.

**Simulation: zero delay, no extra parts.** A tunnel must not add a gate delay, or a clock sent through one would
race the data it clocks. So the labels never reach the simulator as components:
- `loadIntoSim()` (`src/app/sim.ts`) finds each send's driver (the wire ending on its `A` pin) and re-sources every
  wire that leaves a receive with the same name to that driver. Labels are dropped from the sim's component list.
- `Simulator.load()` takes an optional alias map (`"recv:Y"` → `"driver:pin"`), and `pinValue()` follows it. That keeps
  wire colours, waveform probes and `usePinValue` working on the label pins. The same mechanism is what the postponed
  custom-IC milestone needs, so it is not wasted work.

**UI.** Palette entries under I/O. The label text shows on the flag. Selecting a label highlights every label with the
same name; the inspector lists them and has a "go to" button. Autocomplete of existing names in the `name` field.

**Builder helpers.** `CircuitBuilder.tap(pin, name)` and `.tag(pin, name)` put a Send / Receive label next to a pin,
turned to face it. They add nothing (and return `undefined`) when the label would run into another part, so a caller
falls back to a plain wire.

**Examples.** A new `/labels` example (a counter read by a display and four LEDs with no wires between them).
*Reworking `/computer` to use labels was tried and not done:* its layout is packed around long wires, so labels fit
beside only a handful of pins (2 sends and 6 receives of about 40 wanted), and even with the layout spread out 1.4×
routing time did not improve (2.4 s vs 2.5 s). Doing it properly means re-spacing the whole layout; that belongs with
the buses rework (milestone 10), which would remove most of those wires anyway.

**Tests.** Unit: a send/receive pair equals a plain wire (same values, same tick count) over a clocked circuit; unknown
name → X; duplicate sends; chains and loops; state survives reload and `reset()`. Builder helpers on pins facing every
way. Serialize round-trip. Every example has no overlapping parts. e2e: place a pair, name it, wire, operate, rename.

**Status: done** (v0.0.1-11).

## Milestone 2: Assembler and memory tools (medium)
- [ ] **Assembler** in the ROM inspector for ROMs marked as program memory: type `LDI 5`, `ADD 3`, `JNC loop` with
      labels and comments; shows the hex it produces and reports errors by line. The instruction set is a per-example
      table (`OPCODES`, already in `examples.ts`), so the assembler is table-driven. The 8-bit computer's two ROMs
      (instruction + constant) are filled from one source.
- [ ] **Disassembly column** next to the hex table, with the currently executing line highlighted (follows the PC).
- [ ] **RAM viewer/editor**: hex grid of the RAM contents, live while running, click a cell to edit while paused.
- [ ] **Load/save a program** as a text file (`.asm`) and as hex.
- Tests: assembler round-trips every opcode; the Fibonacci example is regenerated from its source text and equals the
  current ROM words; RAM edits survive a step but not a reset.

## Milestone 3: Debugging tools (medium)
- [ ] **Pause on condition**: "break when" rules on a signal (`= 1`, rising edge, equals value for a group). Typical
      use: pause at HALT, or when the output port changes.
- [ ] **Step back**: the simulator keeps ring-buffered snapshots (state + values) per clock cycle; "Back" restores one.
- [ ] **Grouped probes**: select several probes and group them as one trace that shows a number (hex/decimal toggle) in
      the waveform panel.
- [ ] **Trace a signal**: click a wire to highlight its source and every pin it feeds (and optionally its fan-in cone).
- [ ] **Export waveforms** as PNG and as VCD.
- Tests: break rules trigger on the exact tick; back-then-forward reproduces the same values; VCD output is valid.

## Milestone 4: Annotations, export and embed (small–medium)
- [ ] **Text notes** and **group frames** on the canvas (no simulation effect; saved with the circuit).
- [ ] **PNG / SVG export** of the circuit, current view or whole circuit.
- [ ] **Embed mode**: `?embed=1` hides the editor chrome, read-only, runs the circuit; for iframes in blogs and courses.
- [ ] Examples gain notes that explain what to watch.

## Milestone 5: Truth tables and expressions (medium)
- [ ] **Analyze**: pick input switches and output LEDs; the sweep shows a truth table, a Boolean expression and a
      Karnaugh map (up to 4 inputs).
- [ ] **Build from expression**: type `Y = A·B + ¬C` (or a truth table) and get the gates, wired and laid out.
- [ ] **Equivalence check**: two circuits (or a circuit and an expression) over all inputs.
- Tests: expression parser/printer round-trip; generated circuits match their table for random expressions.

## Milestone 6: Challenges mode (medium–large)
As described at the end of `plan-stretch-features.md`: lessons plus "build a circuit matching this truth table",
checked automatically by sweeping labelled switches and comparing labelled LEDs. Reuses the sweep and the expression
tools from milestone 5. Needs its own detailed plan before starting.

## Milestone 7: New parts and I/O (medium)
- [ ] **Speaker**: a clock-driven square wave through WebAudio, with a mute toggle.
- [ ] **Text console**: memory-mapped output that prints characters to a small terminal panel.
- [ ] **Pixel framebuffer** (e.g. 16×16, 1 bit or 4 colours) written through a RAM-like port.
- [ ] **Keypad / switch bank input** for programs to read (an input port for the computer).
- [ ] **Lookup table (LUT)** part with editable contents, and **RAM/ROM with 8 address bits**.
- [ ] **Computer v2 example**: input port, jump-if-zero, shifts, and a program that uses the new devices
      (a counter, a multiplication table, a bouncing pixel).

## Milestone 8: Router performance (medium)
Routing time grows with wires × area (about 25 ms per wire on the 8-bit computer). Options, in order of risk:
- [ ] Reuse search buffers across searches and cap the area a first attempt may explore (identical results).
- [ ] Weighted A* for the crossing-reduction pass only.
- [ ] Route in a Web Worker and show the circuit with provisional wires while it finishes.
- Measure first with the computer example; keep the existing router tests green and the paths of the small examples
  unchanged unless a change is an improvement.
- Measured at milestone 1: on the 8-bit computer the median routed wire is 1.4× its straight-line distance, but the
  90th percentile is 4.6× (long detours around congestion), and the search is spread evenly over ~240 wires at 7–25 ms
  each. The detours are probably both a quality problem and the reason searches explore so much.

## Milestone 9: Timing view and state machine editor (large)
- [ ] **Per-part propagation delay** (default 1) and a **timing view** that highlights the longest path and shows
      glitches/hazards in the waveform panel.
- [ ] **State machine editor**: draw states and transitions, choose an encoding, generate flip-flops and logic.
- Needs its own detailed plan before starting.

## Milestone 10: Buses and tri-state (large)
- [ ] Multi-bit wires with split/merge parts and width-parameterised register, adder, RAM, mux.
- [ ] Tri-state buffers and a shared-bus net with contention (X) detection.
- [ ] Rebuild the 8-bit computer on buses (≈40 wires instead of ≈240).
- This changes the net model in the engine, so it comes last and needs its own detailed plan.

## Critical files
- **Simulation glue**: `src/app/sim.ts` (`loadIntoSim`), `src/engine/simulator.ts` (`load`, `pinValue`, alias map).
- **Parts**: `src/engine/components/*`, `src/engine/types.ts` (ParamDef kinds), `src/engine/registry.ts`.
- **UI**: `src/ui/symbols.tsx`, `Palette.tsx`, `Inspector.tsx`, `WaveformPanel.tsx`, `src/ui/canvas/*`.
- **Model and files**: `src/model/*` (circuit, serialize, examples, builder), `src/routing/*`.
