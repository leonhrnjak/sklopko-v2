# Simulator speed, tier 2: a compiled engine for clocked circuits (spec)

Status: **approved** (all three decisions as recommended: automatic choice with the footer word and the setting; Phases A and B now;
the race check at load). Tier 1 (`docs/spec-sim-speed-tier1.md`, PRs #164 to #166) is merged: the
6502-from-parts BASIC board went from about 30,000 to about 60,000 cycles a second (bundled, in Node), the board with the
`cpu6502` part from about 375,000 to about 630,000. A real 6502 does 1,000,000.

## Goal

A second engine, used automatically for circuits it can run, that settles a clock edge in **one ordered pass** over the parts
instead of ticks of gate delays. Targets on `/6502-parts-basic` (bundled Node benchmark, history off):

| Phase | What | Target | Stretch |
|---|---|---|---|
| A | Levelized engine, the parts' own `evaluate` | 120,000 (2x) | 180,000 |
| B | Word-wide nets and generated code for the common parts | 300,000 (5x) | 500,000 |
| C | The simulation in a Web Worker | decided after B, from measurements in the browser | |

Everything the app shows must stay the same: after every clock edge, every net, every memory and every part's state must equal
what today's engine gives. Only the in-between ticks of a settle (the glitch view, the timing view, the per-part delays) need
today's engine, which stays and takes over whenever they are used.

## Why a second engine (what tier 1 measured)

Per clock edge on the 6502-from-parts board: **10 ticks, 104 part evaluations, 59 distinct parts.** The unit-delay engine
evaluates a part again each time one of its inputs changes on its way to settling, so 43% of the evaluations are repeats. About
half of the remaining time is the engine itself: queueing parts, and copying every changed bit of every 8- or 16-bit bus into
every pin that reads it. Neither goes away while time moves in gate delays and nets are single bits.

Survey of the 63 examples (flattened, with every part that keeps state counted as breaking a loop):

- **59 have no loop of logic gates and no per-part delay.** All the computers, the 6502 boards and the BASIC boards are among them.
- **4 do:** `sr-latch` (two NORs), `d-latch` (two NANDs), `oscillator` (a ring of gates), and `ripple` (4 parts with a delay).
  They are teaching circuits about exactly what the compiled engine leaves out, and they stay on today's engine.

## Design

### Which engine runs a circuit

`Simulator` keeps its public interface (`load`, `advance`, `frame`, `stepClock`, `settle`, `pinValue`, `signature`, `state`,
`netOf`, `force`, `setParams`, `setState`, `writeWord`, history and `stepBack`, `takeBreak`, `publish`...), so the app does not
change. Inside, it runs one of two engines:

- **Exact** (today's unit-delay engine, unchanged).
- **Fast** (new), chosen when **all** of these hold:
  - the circuit's combinational parts form no loop (see Levelizing);
  - every part has a delay of 1 (no `delay` set);
  - no capture is on (`setCapture`: the glitch and timing views);
  - no signal is forced (`force`);
  - every part type in it has a timing class (below).

The choice is made again at each `load` and whenever one of the above changes (opening the glitch view switches to Exact at the
next edge, closing it switches back). Switching is cheap: both engines keep the same `values`, part states and pins, so the
other engine just continues from where this one stopped.

A **setting**, saved with the circuit like the history switch, forces Exact ("Exact gate timing"); the footer says which engine
runs ("fast engine" / "exact timing") next to the clock rate. Decision 1 below.

### Timing class of each part type

A new optional field on `ComponentDef`:

```ts
/**
 * How the outputs follow the inputs, for the fast engine.
 * 'comb':       a function of the inputs now (gates, mux, adder, decoder, ROM, bus junction, tri-state buffer...).
 * 'registered': a function of the state only; the state changes only when a clock input changes (dff, register, counter,
 *               cpu6502, via6522...). Breaks loops.
 * 'mixed':      reads some inputs at once and keeps state too (RAM: the read is combinational, the write is clocked; ACIA).
 *               Placed like 'comb'; its state changes when it is evaluated.
 */
timing?: 'comb' | 'registered' | 'mixed'
```

Types with no class keep a circuit on Exact. The classes are checked by a unit test, not trusted: for each `registered` type,
random states and inputs, then every input but the clock changed while the clock holds still, and the outputs must not change.

Today's part types (about 75): the gates, routing, arithmetic, coding, word-wide (`bus*`) parts and the bus junction are `comb`;
`dff`, `tff`, `register`, `counter`, `counterld`, `shiftreg`, `busreg`, `busctr`, `srlatch`, `dlatch` (as parts: their state is
explicit), `cpu6502` and `via6522` are `registered` (to be confirmed by the test, part by part); `ram`, `acia6551`, `hd44780`,
`console`, `keypad`, `gamepad`, `framebuffer`, `matrix`, `speaker` are `mixed`; `clock`, `button`, `switch` and the other inputs
are sources; probes and breakpoints keep using `sample` after each edge as today.

### Levelizing

At `load`, the fast engine builds a graph of parts: an edge from a part to every part that reads one of its outputs, except into a
`registered` part (it only looks at its inputs at a clock change, so it is where a loop is cut). It sorts the graph
topologically. A loop left in the graph means the circuit stays on Exact.

The result: one array `order` of the `comb` and `mixed` parts, a list of `registered` parts, and for each net the position of its
readers in `order` (so a change only flags parts later in the order).

### One clock edge

The settle after a clock edge (or after a switch is flipped, a key pressed...) becomes:

1. **Combinational pass.** Walk `order` from the first flagged part. Evaluate a flagged part, write its changed outputs to the nets
   and the pins that read them, flag those readers. Each part is evaluated **at most once** per pass, because all its inputs come
   from earlier in the order or from registered parts.
2. **Registered parts.** Every registered part whose clock pin changed in the pass is evaluated. All of them read their pins
   before any of them writes an output (their outputs go to a small buffer first), which is what the unit delay gives today: a
   flip-flop clocked by an edge sees the data from before that edge.
3. If any registered output changed, flag its readers and go to 1. A clock made from logic (a divider, a ripple counter) is handled
   by these rounds. More than 64 rounds means the circuit oscillates: it is `unstable`, as today.

`ticks` keeps counting (one per pass), so the readouts that use it still move, but its value differs from Exact's; nothing shows
the exact number.

### What can differ from today, and how it is caught

In today's engine an edge reaches different parts at different times (one gate delay per gate). A circuit whose behaviour depends
on that (a race: data that changes in the same gate delay as the clock, a clock gated by logic of different depth than its data)
can settle to different values in the two engines. The examples show none so far (to be confirmed by the lockstep test); a
user's circuit might. Three guards:

- **The lockstep test** (from #164) gains a second run per example: the fast engine against the frozen reference, every net and
  every part state after every clock edge, for every example the fast engine accepts. An example that differs fails the test.
- **A race check at load** for the common case: a `registered` part whose clock input and one of its data inputs both depend on the
  same changing source in the same edge (found from the levelized graph) keeps the circuit on Exact. Cheap, conservative, and
  written so it can be turned off in the test to see whether it was needed.
- **The setting** "Exact gate timing", for anything else.

### Phase B: word-wide nets and generated code

- **Nets of words.** `flatten` keeps the bit pins, but the fast engine groups the bits that a part's bus groups (`groups`, which
  the word-wide parts already declare) put out together into one **word net**: a value (`Int32Array`) and an unknown mask (bits
  that are X) and a Z mask. A reader whose bus input takes exactly that group reads the word in one load; any other reader (a
  splitter, a single bit) reads its bit from the word. `values` (the bit nets the UI reads) is filled from the words once per
  `publish`, not on every pass.
- **Generated code.** For the common `comb` kinds (and, or, not, xor, mux, `busmux`, `busadd`, `busgate`, `buscmp`, decoder, ROM
  read, bus junction), the engine generates one JavaScript function per circuit with `new Function`: straight-line code over the
  word arrays, in `order`. Other parts are called through their `evaluate` from the generated code. A part type opts in with a
  `compile?(ctx): string` beside its `evaluate`, so this grows one part at a time, and each is checked against its own
  `evaluate` with random 0/1/X/Z inputs (the test from #164).
- **X and Z.** Each word op works on value and mask: an adder with any unknown input bit gives all unknown (as today), a gate gives
  the per-bit result. The random-input test covers this; it is where the bugs will be.
- **CSP.** `new Function` would need `'unsafe-eval'` if the site ever restricted scripts in its Content Security Policy; today
  `public/_headers` sets only `frame-ancestors`, which does not. If one is added later, the engine falls back to Phase A (no generated code) when `new Function` throws.

### Phase C: Web Worker (decision after B)

Measured first, with B done: in the browser, how much of each frame the simulation gets at 1 MHz (`workBudget`) and how much
drawing takes. If the simulation is held back by drawing, move it into a worker. That is a large change (the UI reads the
simulator synchronously: pin values, part states, the inspector, the memory editor, breakpoints, history) and gets its own spec.

## Work, one PR each, stacked

1. **Timing classes and their test.** `timing` on every part type, the "registered means outputs from state only" test. No
   behaviour change.
2. **Phase A engine, off by default.** `src/engine/fast.ts`: levelizing, the race check, one edge as above. `Simulator` uses it
   when a flag is set. Lockstep test: fast against the reference on every eligible example. Benchmark numbers.
3. **Turn it on.** The automatic choice, switching for capture and forces, the setting and the footer word, e2e for both (a
   counter on fast; the glitch view switching to exact and back). Screenshots of the footer and the setting.
4. **Phase B, word nets.** Lockstep test unchanged; numbers.
5. **Phase B, generated code** for the common parts, one commit per group of parts; numbers per commit, and any that is not
   faster is left out.
6. **Measure in the browser** (the BASIC board at 1 MHz: cycles a second in the CPU inspector, frame time), and write the result
   here with a recommendation on Phase C.

Each PR runs the unit tests, lint, type-check and the e2e specs for the area (`simulation`, `computers`, `buses`, `logic`), with
the benchmark before and after in its description. The startup chunk must not grow by more than 1 kB: the fast engine is loaded
with the simulator, so its size is watched; the generated code is not in the bundle.

## Risks

- **Races** (above): the most likely real problem. The lockstep test, the race check and the setting.
- **A wrong timing class** makes a registered part miss or take an input: the class test catches the "registered" ones; "mixed"
  parts are evaluated like combinational ones, which is always safe for them.
- **Two engines to keep in step.** The part code is shared; only the scheduling differs. The lockstep test runs in CI on every PR,
  so a part change that breaks one engine shows.
- **X/Z in word ops** (Phase B): the random-input tests per part.
- **Estimates.** Phase A's 2x comes from the 43% repeated evaluations and the per-tick work going away; Phase B's from not copying
  bits and not calling through `evaluate`. Neither is measured yet. Each PR reports the real number, and Phase B is dropped if A
  plus the first word-net PR do not show at least 1.5x more.

## Decisions for you

1. **Engine choice:** automatic, with the footer word and an "Exact gate timing" setting per circuit (recommended), or fast only
   when switched on.
2. **Scope now:** Phases A and B (recommended), or A only and decide on B after its numbers.
3. **The race check at load:** keep it (recommended: a user's circuit may race even if no example does), or rely on the setting.
