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
- [x] **Wider memories**, so the computer needs one program ROM and one data RAM: ROM data bits 4 / 8 / **16**, RAM data
      bits **4 / 8** (the old two-ROM, two-RAM version of the computer is gone; saved circuits still load).
- [x] **Assembler** in the ROM inspector. A ROM's *Contents are* picks hex words or a program for an instruction set
      (`src/engine/isa.ts`, table-driven: adding a computer means adding an entry to `ISAS`). Labels, `NAME = value`
      constants, `;` and `//` comments, decimal / `0x` / `$` / `0b` numbers, negative immediates, `.word` for raw data.
      Errors are listed by line while typing; the program is applied on blur (one undo step), and with errors the
      circuit keeps running the last program that assembled.
- [x] **Listing** under the editor: address, word and instruction for every word, with the word being read right now
      marked (follows the PC). It works for hex ROMs too (without the instruction column).
- [x] **RAM viewer/editor**: all words live (also when a write changes no pin), click a word to edit while paused,
      Escape cancels, *Clear all*. Edits live in the simulation, not the circuit: they survive steps and reloads of the
      circuit but not Reset.
- [x] **Open / Save** a program as `.asm` (or the hex words as `.hex`).
- [x] The `/computer` example's program is now real assembly with comments, and its ROM holds both the source and the
      assembled words (a test checks they agree).
- Not done: highlighting the executing *source line* inside the editor (the listing marks the instruction instead), and
  a live preview of the listing while typing (it updates when the program is applied).
- Tests: assembler (every opcode, every operand form, every error, round trip of all instructions through the
  disassembler), wide ROM/RAM, `writeWord`, serialization (old circuits, bad values), the computer end to end, e2e for
  the editor, the files, the RAM grid and switching a ROM to a program.
- **Status: done** (v0.0.1-12).

## Milestone 3: Debugging tools (medium)
- [x] **Pause on condition.** A new *Breakpoint* part (1, 4, 8 or 16 bits, wired like a probe) pauses the simulation at
      the exact clock edge where its signal becomes equal to a value, or changes. Done as a part, not a separate rule
      list, so it is saved, labelled, copied and deleted like everything else. It fires only when the condition
      *starts* to hold (Run carries on afterwards), the first look is only a baseline, and unknown inputs never fire
      it. `sample()` may now return true to ask for a stop; `Simulator.takeBreak()` hands it over, and the run loop
      pauses and says which breakpoint it was. `/computer` has one on HALT.
- [x] **Step back.** *◀ Back* goes to the previous clock edge: nets, every part's state (memories, counters, clocks),
      the time and the probes' recordings (probes trim themselves via the new `rewind` hook instead of being
      copied). A snapshot per edge, 1000 kept; changes since the last edge (time passing, a switch, a RAM edit) are
      undone first; after Back, running forward again replaces the history from that point. It pauses a running
      simulation. Cleared by Reset and by editing the circuit (a new netlist can't be restored into).
- [x] **Grouped probes.** A probe has an optional *group* and a *bit*; probes with the same group are one trace in the
      waveform panel, drawn as a bus with the number written in each segment (hex / decimal / binary toggle).
      Selecting several probes offers *Group N probes* (bits follow the natural order of their labels) and *Ungroup*;
      a probe warns when another in its group uses the same bit. `/computer` now has four rows (CLK, PC, ACC, Carry)
      instead of fourteen.
- [x] **Trace a signal.** Selecting a wire highlights its whole signal (also across net labels) with rings on every pin
      it reaches; *Also show what feeds it* adds the cone behind the source: through purely combinational parts, up to
      the nearest registers, memories, clocks and inputs, capped at 400 wires.
- [x] **Export waveforms** as PNG (the window as it is on screen) and VCD (everything recorded; groups become buses;
      microsecond timescale; opens in GTKWave and others).
- Not done: breakpoints on a *group* of probes (a multi-bit breakpoint is wired bit by bit instead), a "Forward"
  button (Clock step goes forward and reproduces the same history), and breakpoints on a source line or on
  an instruction (the part watches signals only; the computer's HALT is one such signal).
- Tests: stepping back (every edge reproduced exactly, the limits, the history cap, moved-since-the-edge cases),
  breakpoints (every condition, exact stop time, resume, X, step back, reset), group traces and number formats, VCD
  output, net and cone tracing (labels, feedback, the cap), grouping in the store, the computer's groups and HALT
  breakpoint, and e2e for Back, breakpoints, grouping, tracing and both exports.
- **Status: done** (v0.0.1-13).

## Milestone 4: Annotations, export and embed (small–medium)
- [x] **Notes and frames.** Two pin-less parts (category *Notes & frames*), so they get placing, dragging, copy/paste,
      undo and saving for free. A note wraps its text at a chosen width and has five colours. A frame is a titled
      tinted box drawn behind everything (own layer): only its border and title bar take clicks, so the inside can
      still be marquee-selected; dragging it moves everything inside (`withFrameContents`), a corner handle resizes it,
      and a marquee selects a frame only when it holds all of it. Neither rotates. Both are left out of the router
      (not obstacles, and they don't enlarge its grid) and out of wire re-routing after moves.
- [x] **Picture export.** *Picture…* saves SVG or PNG, of the whole circuit or of what is on screen. The canvas SVG is
      cloned with each shape's computed style baked in (so the file doesn't depend on our CSS), the editing marks
      (selection, pins, hit areas, trace rings, resize handle) are removed, and the viewBox is set; PNG is rendered
      from that at 2× (at most 8000px a side).
- [x] **Embed mode.** `?embed=1`: only the canvas and a small control bar; runs; switches work; pan and zoom; no editing
      (the store refuses edits, undo and redo, except operating a control); no autosave and no loading of the
      visitor's saved circuit (an example or a share link in the URL is shown, otherwise the welcome example).
      *Embed* in the toolbar copies an iframe snippet. `public/_headers` now allows framing from any site
      (`frame-ancestors *` instead of `X-Frame-Options: SAMEORIGIN`).
- [x] **Examples explain themselves.** The computer has a note and frames round the fetch unit and the decimal output
      (frames only where parts sit together: its decode and execute logic is spread over the layout, so a frame
      round it would cover unrelated parts); the counter and net label examples have notes.
- Not done: frames that follow a part moved *out* of them (a frame only takes along what is inside when dragged),
  nesting rules beyond "inside means wholly inside", notes with links or formatting, and a read-only mode for a
  circuit that is not embedded (a "view only" link).
- Tests: wrapping and sizing of notes, what a frame holds and what moves with it, router and re-routing ignore
  annotations, store (resize limits, marquee, rotation, embed gating), saving and loading, every example (no frame
  overlaps another, every frame holds something), and e2e for frames (drag with contents, resize, free inside),
  notes, embed (chrome, switches, no editing, no saved-circuit access), the embed code, and SVG/PNG export.
- **Status: done** (v0.0.1-14).

## Milestone 5: Truth tables and expressions (medium)
- [x] **Analyze**: *Logic…* in the toolbar. Pick input switches and output LEDs (default: all labelled ones, at most 8
      inputs); the circuit is swept in a separate simulator, so the canvas is untouched. The tab shows a truth table
      (a row is *unknown* if the outputs don't settle), a minimal Boolean expression per output (Quine–McCluskey,
      exact cover up to 22 candidates, greedy beyond) and a Karnaugh map for up to 4 inputs, with the groups drawn
      (wrap-around included). A circuit whose outputs depend on stored state is flagged, not analysed as if it were
      combinational.
- [x] **Build from expression**: type `Y = A·B + ¬C` (also `& | ^ ! ~ AND OR XOR NOT`, `0`/`1`, several lines, names
      defined by other lines) or fill in a truth table (0/1/don't care, with a *simplify* option). Gates are
      hash-consed (duplicates and constants folded, wide gates split at 8 inputs), laid out by logic level, wired by
      the router, and inserted below the existing circuit as one undo step, selected so it can be moved at once.
- [x] **Equivalence check**: the circuit vs an expression, or vs a circuit file; tables are aligned on the union of
      input names and outputs are matched by name. The verdict lists the differing rows.
- Not done: Karnaugh maps for 5–6 inputs, sequential analysis (state tables), more than 8 inputs for circuits (10 for
      expressions), checking circuits that contain sequential parts against each other.
- Tests: parser/printer round-trip over 500 random expressions; minimal covers checked against brute force; K-map
  groups; compare cases; generated circuits simulated gate by gate against their tables for random expressions;
  analysis of the examples; insertion as one undo step; 7 e2e tests (analyze, empty canvas, build and analyze round
  trip, flipping switches, undo, truth-table builder with don't-care, compare).
- **Status: done** (v0.0.1-15).

## Milestone 6: Challenges mode (medium–large)
- [x] **Challenge list.** *Challenges* in the toolbar: 17 challenges in four groups (getting started, combining gates,
      arithmetic and selection, memory), each with a short lesson and one task. Picking one replaces the canvas with
      a starting circuit (the labelled switches and LEDs, unwired; undo brings the old circuit back) and opens a panel
      under the canvas. Solved challenges are ticked; progress is kept in `localStorage` (`sklopko.challenges.v1`).
- [x] **Checking.** Switches and LEDs are found by their labels (as in the Logic panel). *Combinational* challenges
      sweep the switches in a separate simulator (`analyzeCircuit`) and compare with the goal's truth table
      (`compareTables`), listing the wrong rows. *Memory* challenges run steps in order from everything off (set
      some switches, settle, read the LEDs) and list the steps that failed. A missing label is named in the
      message.
- [x] **Rules.** A challenge may limit the parts (only NAND; only AND/OR/NOT; at most two gates) so that it can teach
      a method (XOR from basics, everything from NAND, using a many-input gate) and so that a ready-made latch part
      can't stand in for the gates. Switches, LEDs, constants, labels, displays and notes are never counted.
- [x] **Help.** *Hint* (one sentence) and *Show a solution* (replaces the canvas with a reference circuit; undoable).
      A result is hidden once the circuit's structure changes (flipping a switch doesn't), with a note to check again.
- Decisions: goals are written as expressions (`src/model/challenges.ts`), so the Build tab's synthesiser also makes
  the reference solutions of unrestricted challenges; restricted and memory ones are hand-built. Panel reuses the
  waveform panel's look (a bottom sheet on phones). Not available in embed mode.
- Not done: challenges that need a clock or a counter (the memory steps only toggle switches), a score or limit on
  gates beyond a hard maximum, challenges shared as links (`/challenge/<id>`), authoring your own challenges,
  more than a one-sentence hint.
- Tests: for every challenge, the starter has exactly its labelled parts and fails, the solution follows the rules
  and passes, and removing any one wire of the solution makes it fail; rule and label messages; step failures;
  2 e2e tests (start, fail, wire, solve, next, progress after reload; rule violation, solution, memory steps).
- **Status: done** (v0.0.1-16).

## Milestone 7: New parts and I/O (medium)
- [x] **Speaker**: one input; a tone while it keeps changing. The pitch comes from the time between the last few
      changes (`sample` records them, `rewind` drops them when stepping back), scaled by the speed setting, and
      drives a WebAudio square-wave oscillator (`src/app/audio.ts`). Audio starts after the first click or key
      (browser rule); clicking the speaker mutes it. Clock options now go up to 1024 Hz so a clock can be a note.
- [x] **Text console** (`console`): D0–D7, WE, CLK; prints ASCII (10 new line, 8 backspace, 12 clear), 28 columns,
      100 lines kept. The symbol shows the last six lines; the inspector shows all of it, with Clear and Copy.
- [x] **Pixel screen** (`framebuffer`): 16×16, one bit or four colours, written by X, Y, D, WE and CLK, blanked by CLR.
- [x] **Hex keypad** (`keypad`): sixteen keys, K0–K3 hold the last key, P is 1 while one is held (or until RST,
      with *Sticky*). Pressing a key on the canvas sets the part's state like a push button does. The existing
      *4-bit input* stays the "switch bank".
- [x] **Lookup table** (`lut`): 2–8 inputs, 1–8 outputs, edited as a truth table in the inspector (A is the most
      significant bit, like the Logic panel's tables); **RAM and ROM with up to 8 address bits** (a memory over 32
      words is not drawn as a table in its symbol; read it in the inspector). A RAM whose size is changed keeps
      what fits.
- [x] **Computer 2** (`src/model/computer2.ts`, instruction set `SK82`): four opcode bits, `JZ`, `ADDI`, `SUBI`,
      `CMPI`, `SHL`, `SHR`; the first computer's opcodes are unchanged. A jump target has seven bits (the upper
      four in bits 8–11), the program counter is two counters, so programs are 256 instructions. It is built
      with only the devices an example asks for (`computer2Builder({ devices })`), so no example has a part that
      does nothing; address decoding is built only for the addresses used: 13 and 14 for the LCD (light, darken),
      14 for the speaker (flips a T flip-flop), 15 for the console (write) and the keypad (read, with 14 as its
      acknowledge). Three examples: LCD with a bouncing ball (`/computer-lcd`), speaker with a siren
      (`/computer-sound`, the speaker plays four octaves up because a 1 kHz computer is slow), keypad with a
      calculator (`/computer-calc`: whole numbers up to 255, + − × ÷, negative results, E for overflow or
      division by zero, clear). The keypad has two layouts, hex digits and calculator keys. The first computer is untouched.
      A sticky keypad now latches each new press (and quick taps), so a held key counts once.
- Not done: a multi-channel or waveform-selectable speaker, sampled sound; keypad keys from the computer's keyboard;
  a "fill from expression" button for the lookup table; 4-colour use in the computer (the part supports it);
  nesting subroutines (`CALL`/`RET`) and a stack for the computer.
- Tests: console codes and wrapping, screen writes, speaker pitch and tone, keypad and sticky, LUT rows, 8-bit RAM
  and ROM; the assembler for `SK82` (encodings, 5-bit targets, round trip); the whole computer simulated: every new
  instruction, each device, and each of the three programs (the ball reaches all four edges with a pixel always
  lit, the siren's flip gaps shrink then grow, the calculator on a dozen sums including negatives and a held key);
  e2e tests for the calculator by mouse, the LCD and sound examples (and that they have only their own devices),
  LUT editing, muting a speaker, 8-bit RAM.
- **Status: done** (v0.0.1-20).

## Milestone 8: Router performance (medium)
- [x] **Faster search, same results.** Measured first, on every example (`routeWires` through the builders): the
      8-bit computer took 2.2 s, the second computer 2.2–2.6 s, the calculator 1.5 s, in all 11.3 s. Allocating the
      search buffers was only about 10% of it (so reusing them, with stamps instead of clearing, gained little on its
      own): the time is in expanding about 10 million search states, each with a dozen array reads. What helped:
      costs in whole tenths of a step, which lets a bucket queue (a list of states per cost) replace the binary
      heap; "no wire touches this cell or its neighbour" flags, so open space skips every occupancy lookup; one
      precomputed extra cost per cell; and no divisions in the inner loop. Total over the examples 11.3 s → 5.3 s;
      the second computer 2.5 s → 1.1 s. Paths are unchanged where costs do not tie; where they do, ties now go to the
      state pushed last, which gave equal or better length, bends and crossings in every example.
- [x] **A layout fix that mattered more.** A third of the second computer's searches (73 of 263) ended with the
      cost of about twenty clashes: wires forced to run over other wires. All of them ended at the select pins
      on the bottom of the stacked multiplexers, where the 20px between parts left no room for three lanes. Spacing
      those columns 60px apart took shared wire edges from 486 to 24, and bends and crossings fell by a fifth to a
      third, for a few percent more routing time (a bigger grid). The router cannot fix a layout that leaves no room: a search
      that must clash explores the whole grid before it finds the least bad way.
- Tried and dropped: a first attempt confined to a box round the two pins (more expansions in total, since most
  wires that need more room then search twice); weighted A* when a search runs long (quality fell, bends +40%, for
  hardly fewer expansions, because the cost is dominated by clash penalties the estimate cannot see); a tie-break
  towards deeper states in the old heap (no change at all).
- Not done: routing in a Web Worker with provisional wires (opening the computers now takes about a second, which
  did not seem worth the plumbing: race with edits, bundling a worker, merging results), a bend-aware estimate,
  and respacing the first computer's layout (it has 626 shared edges, mostly the same narrow gaps), which the
  roadmap leaves alone.
- Tests: the router's existing invariants; the same paths however much was routed before (the reused buffers
  carry nothing over); the first computer within a budget of search steps (a count, not a time, so it cannot be
  flaky) with every wire attached; and the second computer's wires staying apart.
- **Status: done** (v0.0.1-21).

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
