# Milestone 9: timing view and state machine editor (detailed plan)

> **Status: 9a, 9b done and pushed; 9c done (not yet pushed); 9d–9e not started.** Read `CLAUDE.md` first (version bump and the full checklist on every push).
> Work sub-milestone by sub-milestone, in order. Each ends in a working, tested state; stop and report after each.
> Push to `main` only when asked.

## What exists today (and why it matters here)
- The simulator (`src/engine/simulator.ts`) is a **unit-delay, two-phase** model: each `tick()` every part reads the nets
  of the previous tick, then all outputs are committed at once. So every part has a delay of exactly 1 tick, and
  `settle()` ticks until no net changes (budget 1000).
- **Two time bases.** Clocks run in simulated *ms* (`advance`); between two clock edges the circuit settles instantly
  in *ticks*. Ticks have no relation to ms.
- **Probes only see settled values** (`sample()` runs after `settle()`), so a glitch that appears and disappears inside
  one settle can never be seen today.
- `ops`, `trace.ts` (ring highlighting of a signal) and the Logic panel (`synthesize()`, expression parser, QM
  minimiser with don't-cares, `insertCircuit` as one undo step) are reusable for both halves of this milestone.

## Decisions (defaults I will use unless you say otherwise)
1. **The unit of delay is abstract: one "gate delay".** The timing view reports gate delays, plus an optional
   "ns per gate delay" field to turn that into a maximum clock frequency. No attempt to model real ICs.
2. **Transport delay**, not inertial: a pulse is never swallowed, because showing hazards is the point.
3. **Delay is per part** (a `delay` field on the circuit part, default 1), set in the inspector, with a
   "Realistic delays" preset that sets it by part type (NOT 1, NAND/NOR 2, AND/OR 3, XOR 4, flip-flop clock→Q 3...).
   Default stays 1 everywhere, so every existing circuit and test behaves exactly as now.
4. **The clock is still assumed slow enough** for the circuit to settle between edges. The timing view *reports*
   when the clock is too fast for the critical path; it does not simulate a setup violation. (Possible later.)
5. **State machines are a generator, not a new kind of part.** The editor produces ordinary gates and flip-flops (like
   the Logic panel's *Build*), so everything else (probes, step back, analysis) works on the result. The state
   machine description is saved separately (see 9d), not inside the circuit file.

## 9a. Per-part propagation delay (engine, medium) — done
- `Comp.delay?: number` (1–16, default 1), carried through `SimComp`, serialisation (omitted when 1, so old files and
  share links are unchanged), copy/paste and the inspector (a *Delay* number field on every part with an output;
  multi-select edits all selected). Parts that never change on their own (switch, constant, notes, labels) do not
  show it. Net labels still add no delay.
- `Simulator`: a part with delay `d > 1` gets a small ring buffer of its last `d-1` computed outputs and commits the
  oldest one. Parts with delay 1 take the existing fast path, so there is **no cost for existing circuits**.
- `settle()` must not declare "stable" while a buffer still holds a different value from the net it will reach.
- Snapshots (`record`/`stepBack`) include the buffers; `reset()` clears them.
- Flip-flops: the delay is clock→Q (the part samples its inputs on the tick of the edge, then the output follows `d`
  ticks later).
- Inspector: *Realistic delays* button (selected parts, or everything), and *Reset delays to 1*.
- **Tests:** a chain of N buffers has latency exactly N·d; delay 1 reproduces all existing results (full suite);
  ring oscillator period = 2 × total delay; settle with pending outputs; clock→Q; step back across delayed parts;
  reset; serialise round trip (old files load, delay 1 is not written); copy/paste keeps delays.

## 9b. Static timing: critical path (small–medium) — done
- `src/model/timing.ts`, a pure function on a `Circuit` (like `analyze.ts`):
  - Start points: switches, constants, clocks, and the outputs of state-holding parts (flip-flops, latches, registers,
    counters, memories), launched at their own delay.
  - End points: inputs of those state-holding parts, plus LEDs, probes and displays.
  - Arrival time per output = max over inputs + the part's delay; walk the graph in topological order.
  - **Loops** (SCC detection): a combinational feedback loop (an SR latch built from gates, an oscillator) is
    reported as "feedback, not analysed", with its parts listed; paths through it are cut there.
  - Result: the critical path (parts and wires, in order), its total delay, the slowest few end points ("slack"),
    and the loops found.
- **Timing tab** (new, in the waveform drawer; a *Waveforms | Timing* switch): shows the longest path as a list
  ("A → XOR (4) → AND (3) → … = 14"), a **Show path** button that rings the parts and wires on the canvas (reusing
  the trace ring highlight), the *ns per gate delay* field and the resulting maximum clock frequency, and a warning when
  a clock in the circuit has a half-period shorter than the path (in the same units).
- Recomputed when the circuit's structure or a delay changes (memoised), not every frame.
- **Tests:** hand-made circuits with known paths (chain, reconvergent fan-out, register-to-register), feedback
  detection, a ripple-carry adder (critical path grows linearly with width), every example analysed without
  throwing, delays honoured.
- **e2e:** open an example, open Timing, press Show path, see rings; change a delay and see the number change.

## 9c. Glitches: tick-level capture (medium) — done
- `Simulator` gets an opt-in **capture**: while enabled, `settle()` records the value of every net after each tick for
  the most recent settle only (bounded: at most 256 ticks and about 1 MB). Nothing is recorded when the Timing tab is
  closed, so there is no cost otherwise.
- Triggered by what actually starts a settle: a clock edge, or flipping a switch. The Timing tab shows the last one.
- **Glitch detection** (pure, in `src/engine/glitch.ts`): from the capture, a net *glitches* if it changes more than
  needed to get from its first to its last value (0→1→0, or 0→1→0→1). Nets that start as X (power-up) are skipped. The
  report lists each glitching net with its tick range and a kind (static-0/static-1/dynamic).
- **Tick diagram**: x axis in gate delays, one row per signal. Rows are the probes, plus any wires you add
  (*Add selected wire*), plus a **Glitches only** filter. Glitch pulses are drawn in amber. Hover shows the tick
  and value. Clicking a glitching row selects its wire and traces it on the canvas.
- **Examples:** `/hazard` (the classic static-1 hazard `Y = A·B + ¬A·C` with B=C=1; flip A and watch Y dip; a second
  copy with the consensus term B·C that does not glitch), and `/ripple` (a 4-bit ripple adder with realistic delays
  where the sum bits flicker before settling). Each has a note explaining what to look at.
- **Tests:** capture records exactly one value per tick; the hazard circuit glitches with unequal delays and does not
  with equal ones; the consensus version never does; X-start nets are ignored; capture off costs nothing (tick count
  and results identical); the capture is bounded.
- **e2e:** open `/hazard`, flip A, the Timing tab lists a glitch on Y and the diagram shows an amber pulse.

## 9d. State machines: model, check, generate (no UI, medium)
- `src/model/fsm.ts`:
  - `Fsm { name, type: 'moore' | 'mealy', inputs: string[], outputs: string[], reset: stateId, states[], transitions[] }`.
    A Moore state carries its output bits; a Mealy transition carries them. A transition has a guard written in the
    existing expression language over the inputs (`A & !B`, empty = always).
  - **Validation**: unknown names; unreachable states; for each state, guards that overlap (two transitions can fire
    at once) or leave gaps (reported; a gap means "stay in this state", which we make explicit). Checked by sweeping
    the inputs (at most 8, as in the Logic panel).
  - **Encodings**: binary, Gray, one-hot (and *custom*: the user gives each state a code). Unused codes become
    don't-cares.
  - **Generation**: next-state and output functions as truth tables over (state bits, inputs), minimised with the
    existing Quine–McCluskey (don't-cares included), then built with `synthesize()`. Feedback from the flip-flops'
    outputs to the logic uses **net labels** (so the circuit has no long return wires). `synthesize()` gets an option
    for "inputs that come from labels / outputs that go to labels" instead of switches/LEDs. D flip-flops with a clock
    and a synchronous reset to the reset state; the inputs are switches, the outputs LEDs, the clock a clock part,
    all inside a titled frame. Inserted as one undo step, selected, like *Build*.
  - **Simulation check** (the key test): for each example machine and for random machines, simulate the generated
    circuit clock by clock against a direct interpreter of the machine over every input sequence up to a length,
    comparing state and outputs each cycle. For all four encodings.
- **Tests:** the above, plus validation messages, encodings, don't-cares actually shrinking the logic, one-hot
  matching binary behaviour, and a parser round trip for guards.

## 9e. State machine editor (UI, large)
- **State machines…** in the toolbar opens a modal (like Logic). Two views of the same machine:
  - **Diagram**: states are circles, transitions are arrows with the guard written on them (self-loops, curved arrows for
    pairs); click empty space to add a state, drag to move, drag from a state's edge to another to add a transition;
    double click to edit a name, guard or output bits; the reset state has an entry arrow. Keyboard and touch work.
  - **Table**: the state table (rows = state × input condition), the main way to edit on a phone, with the same
    validation messages inline.
- Side panel: type (Moore/Mealy), inputs, outputs, encoding (with the resulting codes shown), **Generate circuit**,
  the validation list, and the number of gates and flip-flops that would be built.
- **Save and load**: machines are kept in `localStorage` (`sklopko.fsm.v1`) and can be saved to / opened from a
  `.fsm.json` file. (Putting the description in the circuit file would need a format version bump and would carry
  into share links; deliberately left out of this round.)
- **Examples** built in: traffic light (Moore), sequence detector 1011 (Mealy), vending machine, up/down counter.
  *Example circuits* from the generator are also added as `/fsm-traffic` and `/fsm-detector`.
- **Not in the first version:** import a state machine back from an existing circuit; JK/T flip-flops; hierarchical
  states; animating the current state on the diagram (a good follow-up: read the state bits through the net labels
  and highlight the circle).
- **Tests:** diagram geometry helpers (arrow endpoints, self loops), editing operations in the store (add, move,
  delete state removes its transitions, rename updates references), validation, saving and loading; component tests
  for the table view.
- **e2e:** build the 1011 detector in the editor, validate, generate, feed it a bit sequence with the clock, check the
  LED; edit in the table view on an emulated phone; save and reopen.

## Order, size and what each step leaves you with
| Step | Size | Leaves you with |
|---|---|---|
| 9a Delays | medium | Per-part delays; nothing else changes |
| 9b Critical path | small–medium | A timing tab with the longest path, highlighted on the canvas |
| 9c Glitches | medium | See and find hazards; two teaching examples |
| 9d FSM core | medium | State machines as data → verified logic and flip-flops (testable without UI) |
| 9e FSM editor | large | The drawing and table editor, examples, save/load |

Timing (9a–9c) and state machines (9d–9e) are independent after 9a, so they can be reordered, or the FSM half moved
to its own milestone, if you prefer.

## Risks
- **Settle with delay buffers** is the one change to the hot loop. Mitigation: a separate code path only for parts
  with delay ≠ 1, a test that all current results are bit-identical, and a benchmark on the 8-bit computer.
- **Loops** (latches built from gates) make a "longest path" undefined. They are detected and reported, never hidden.
- **FSM layout of the generated circuit** uses the existing level layout, so a large machine may be hard to read; net
  labels and the frame keep it tolerable, and the machine itself stays in the editor.
- **Diagram editor** is the biggest UI piece in the project so far (arrows, hit-testing, touch). The table view is
  planned first within 9e so the feature is usable before the diagram is polished.
- Router: nothing here changes it; generated circuits go through the same routing as *Build*.

## Critical files
- **Engine**: `src/engine/simulator.ts` (delay buffers, capture), `src/engine/types.ts`, new `src/engine/glitch.ts`.
- **Model**: `src/model/circuit.ts` (`Comp.delay`), `serialize.ts`, `ops.ts`, new `timing.ts`, `fsm.ts`, `synth.ts`
  (label inputs/outputs), `examples.ts`.
- **App**: `src/app/waveform.ts` (Timing state), new `src/app/fsm.ts`, `src/app/store.ts` (insert).
- **UI**: `src/ui/WaveformPanel.tsx` (Timing tab), `Inspector.tsx` (Delay), `Toolbar.tsx` (State machines…), new
  `src/ui/fsm/*`.

## Verification
Per sub-milestone, the `CLAUDE.md` checklist: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` (desktop and
emulated phone; read the whole summary line). New symbols, panels and examples are also checked visually with
Playwright screenshots (light and dark, phone). The version is bumped on each push.
