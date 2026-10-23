# Milestone 9: state machine editor

> **Status:** done. 9a (per-part delay), 9b (timing tab, critical path), 9c (tick capture, glitches, `/hazard` and `/ripple`),
> 9d (state machine core) and 9e (the editor, below) have shipped.

## What 9d and 9e build on
- The Logic panel's pieces: the expression language (`src/logic/expr.ts`: `parseExpr`, `print`, `evaluate`), truth tables and the
  Quine–McCluskey minimiser with don't-cares (`src/logic/table.ts`, `minimize.ts`), `synthesize()` (`src/model/synth.ts`) which turns
  expressions into gates laid out left to right, and `insertCircuit` (`src/app/store.ts`) which adds a built circuit as one undo step.
- Net labels (a Send and a Receive label with the same name are one wire, with no delay).
- The `dff` part: D, CLK, asynchronous S (set) and R (reset), outputs Q and NQ; it starts at 0.

## Decisions
1. **A state machine is a generator, not a new part.** The editor produces ordinary gates and D flip-flops (like *Build*), so probes,
   step back, the timing view and analysis all work on the result.
2. **The description is saved separately from the circuit** (`localStorage` and `.fsm.json` files, in 9e), so no circuit-format change.
3. **Reset uses the flip-flops' asynchronous set/reset pins**, driven by a `Reset` switch that starts on (the machine is held in its
   reset state until you turn it off). It costs no logic and works for every encoding: a reset-code bit of 1 goes to `S`, of 0 to `R`.
4. **Transitions are tried in order; the first whose guard holds is taken.** A state where no guard holds stays where it is. Guards that
   can hold together are reported as an error (the machine is ambiguous), though the order still decides.
5. **Moore** outputs depend on the state only. **Mealy** outputs depend on the state and the inputs: an output is 1 when the transition
   that fires lists it (0 when none fires).

## 9d. State machines: model, check, generate (no UI, medium) — done
- `src/model/fsm.ts`:
  - `Fsm { name, type: 'moore' | 'mealy', inputs, outputs, reset, states[], transitions[] }`. A state has an id, a name and (Moore) the
    outputs that are 1 in it; a transition has `from`, `to`, a `guard` (an expression over the inputs, empty = always) and (Mealy) the
    outputs it sets. States may carry `x`, `y` for the editor.
  - `validateFsm(fsm)`: errors and warnings with the state or transition they concern: bad or clashing names (inputs, outputs, states;
    `Q0…` is reserved for the state bits), no states or no reset state, unknown states or inputs in a transition, guards that do not parse,
    guards of one state that can hold together (with an example input), states that cannot be reached, limits (inputs, states, outputs).
    A state with inputs under which no guard holds is reported as information (it stays).
  - `stepFsm`, `outputsOf`: the machine run directly, for tests (and, later, for showing the current state).
  - **Encodings**: binary, Gray, one-hot, custom (the user gives every state a code). Codes of unused combinations are don't-cares.
  - **Generation** `generateFsm(fsm, encoding)`: next-state and output functions over (inputs, state bits). For binary, Gray and custom
    codes they are minimised from truth tables (don't-cares included) while the table is small, and written directly (state decode
    AND guard) otherwise; one-hot is always written directly (`Q_j` is the state). The logic is built with `synthesize()`, extended
    so that some inputs are Receive labels and some outputs Send labels. The state bits come back through net labels (`Q0…`), the next
    state goes to the flip-flops through `D0…`. Around it: the clock, the `Reset` switch, a D flip-flop per state bit, a frame and a note
    that lists the state codes. It can be returned routed, or unrouted for simulation.
- **Examples** (`src/model/fsm-examples.ts`, data only): traffic light (Moore), sequence detector 1011 (Mealy), vending machine (Moore),
  up/down counter. 9e puts them in the editor and as circuit examples.
- **Tests:**
  - the generated circuit simulated clock by clock against `stepFsm` / `outputsOf`: every example, all four encodings, every input
    sequence up to a length (random sequences for wide inputs);
  - validation messages; encodings; don't-cares making the logic smaller; one-hot behaving like binary; a machine that stays in a
    state when no guard holds; reset to a non-zero code; generation refusing an invalid machine;
  - the `synthesize()` label options (receive labels in place of switches, send labels in place of LEDs) and that the plain
    `synthesize()` result is unchanged.

## 9e. State machine editor (UI, large) — done
- **State machines…** in the toolbar opens a modal (like Logic): a side panel and two views of the same machine.
  - **Diagram** (`src/ui/fsm/DiagramView.tsx`, geometry in `geometry.ts`): states are circles, transitions arrows with their guard (loops above a
    state, bent arrows for pairs, fanned arrows for several between the same two); the reset state has an entry arrow. Drag a state to move it;
    drag from its rim to another state to join them; **+ State** and **+ Transition** (click the state it leaves, then the state it goes to) for
    touch screens and keyboards; double-click empty space adds a state. States and arrows are focusable: Enter edits, arrow keys move a state,
    Delete removes. The selected state or transition is edited under the picture (name, reset, outputs, from/to, guard, order, delete).
    *Differs from the plan:* a single click on empty space deselects (it does not add a state).
  - **Table** (`TableView.tsx`): the states (reset, name, Moore outputs), the transitions grouped by the state they leave (guard, target, Mealy
    outputs, earlier/later, delete) with the checker's messages under the row, and a read-only **state table** (every state × every setting of
    up to 4 inputs: next state and outputs).
- **Side panel** (`SidePanel.tsx`): *Generate circuit* with the number of gates and flip-flops it would build, undo/redo, start from a blank
  machine or one of the four examples, save and open files, name, Moore/Mealy, inputs, outputs (names are applied on Enter or leaving the box,
  and renaming rewrites the guards and output lists), encoding with the resulting codes (custom codes are typed in binary), and the checks
  (errors and warnings; the information notes are folded away). A message selects the state or transition it is about.
- **Editing** (`src/model/fsm-edit.ts`, pure: each operation returns a new machine) and the editor state (`src/app/fsm.ts`, a zustand store with
  an undo history: typing in one box is one step, a drag is one step). Ids of states and transitions never change when they are renamed.
- **Saving:** the machine, encoding and custom codes are kept in `localStorage` (`sklopko.fsm.v1`) on every change, and saved or opened as
  `.fsm.json` (`{ format: 'sklopko-fsm', version: 1, fsm, encoding, custom }`; files are checked and refused with a reason).
- **Examples:** `/fsm-traffic` and `/fsm-detector` are circuit examples (the generated circuits, routed).
- **Not in this version:** reading a state machine back from a circuit; JK/T flip-flops; hierarchical states; showing the current state on the
  diagram while the circuit runs (a good follow-up: read the state bits through the `Q0…` labels).
- **Tests:** `fsm-edit.test.ts` (every edit operation, layout, state table, saving and loading), `ui/fsm/geometry.test.ts` (arrow ends, loops,
  hit-testing), `app/fsm.test.ts` (undo and redo, merged typing, drag as one step, loading, generating); e2e in `editor.spec.ts` (build the 1011
  detector in the diagram, generate it, feed it bits; drag, join, keyboard, undo; checks; keeping and saving; the examples) and `mobile.spec.ts`
  (table editing and tap-to-join on a phone).
- **Good to know:** while paused, a changed switch spreads through the gates one gate delay at a time, so a test that flips an input and then
  steps the clock must press *Step* a few times in between.

## Risks
- **The diagram editor** is the biggest UI piece so far (arrows, hit-testing, touch). The table view comes first within 9e, so the feature is
  usable before the diagram is polished.
- **Generated layout** uses the existing level layout, so a large machine may be hard to read; the net labels keep the feedback out of the
  picture, and the machine itself stays in the editor.
- **Minimiser size:** Quine–McCluskey over many variables is slow, so the minimised path is only used while inputs + state bits stay within
  `MAX_INPUTS`; beyond that the logic is written directly.
- Nothing here changes the router; generated circuits are routed like *Build*'s.

## Critical files
- **Model**: new `src/model/fsm.ts`, `src/model/fsm-examples.ts`; `src/model/synth.ts` (label options, build into an existing builder).
- **9e**: `src/model/fsm-edit.ts` (editing, saving), `src/app/fsm.ts` (editor state), `src/ui/fsm/*`, `src/ui/Toolbar.tsx` (State machines…).
