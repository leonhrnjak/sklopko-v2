# Simulator speed, phase E: the fast engine in Rust, compiled to WebAssembly (spec)

Status: **for approval.** No code until approved. This follows the worker (`docs/spec-sim-worker.md`) and the evaluation cuts
(`docs/spec-sim-evals.md`, phase D). Phase D is cheap and in TypeScript; this is the expensive step, and it starts with a measurement
that can stop it.

## Why

The worker made the browser as fast as the engine is in Node: about 100,000 cycles a second on `/6502-parts-basic`. What is left is
the engine itself. Its profile is flat (no single hot spot), and its costs are the kind JavaScript is bad at:

- **One call site for every part type** (`cc.def.evaluate(cc.inst)`): V8 sees dozens of functions there and cannot inline any of them.
  In Rust it is a `match` on a small integer, which compiles to a jump table, and the small cases are inlined.
- **Pins as JavaScript arrays of numbers** (`inst.ins`, `inst.outs`), part state as objects: every access is checked and may be boxed.
  In Rust they are bytes in one block of memory, next to the nets.
- **Garbage collection**: none in WebAssembly linear memory.

## Honest estimate

**2x to 3x over the fast TypeScript engine** on the BASIC board, after phase D. Integer-heavy simulation code typically runs 1.5x to 3x
faster as WebAssembly than as well-written JavaScript. The megamorphic call is the biggest single cost here, and the port removes it,
so this board should be near the top of that range. That is an estimate, not a measurement: step E0 measures it before anything else is
built. A circuit made of one big part (the `cpu6502` board) gains less, since its time is in that part's own code.

## Step E0 (a gate)

A throw-away prototype on a branch, not merged: the fast engine's settle loop (`combPass`, `registeredRound`, `commitOuts`) and only
the part types `/6502-parts-basic` uses (about 20: gates, `mux`, `busmux`, `busadd`, `busreg`, `busctr`, `dff`, `rom`, `ram`, `buscmp`,
`busgate`, `xor`, `clock`, and a stub terminal), in Rust, built with `wasm-bindgen`, driven from Node with the same compiled circuit.
It is checked against the TypeScript engine for the first million cycles (every net after every edge) and timed.

**If it is not at least 1.8x faster than the TypeScript engine (after phase D), this spec stops there** and we say so. The result is
written into this file.

## Design

### What moves to Rust

Only the **fast engine** and the **parts it runs**:

- The settle loop, the plan's order, nets, pins, readers, and wake flags, all in linear memory.
- Each part type as a Rust function over its pins and a fixed-size state block.
- Memories (`ram`, `rom`, big ROM and RAM) as byte arrays in linear memory.

What stays in TypeScript:

- **The exact unit-delay engine.** It is the reference: the capture view, forces, the Step button and the "Exact gate timing" setting
  use it, and it is not where the time goes.
- **Loading and planning** (`load`, `buildPlan`): done once per circuit in TypeScript, and the result (the plan, the net and reader
  tables, each part's kind and parameters) is written into the WebAssembly memory. The Rust side never parses a circuit.
- **Everything the page does.** The worker's `SimHost` (#176) drives the engine and sends the same `ViewSnapshot`. The page's mirror is
  still a TypeScript `Simulator`, so the UI, the inspectors and the tests that read the simulator do not change.

### Parts not ported

About 75 part types exist, about 4,500 lines of TypeScript with the CPU, the ACIA, the VIA and the LCD. Porting all of them is not
needed for the gain, and some are large (the 6502 part is 660 lines and is already a single fast part). So:

- **A circuit runs on the WebAssembly engine only if every part in it has a Rust version.** Otherwise it runs on the TypeScript engines,
  exactly as today. The footer's engine label says which (`fast`, `fast (wasm)`, `exact`).
- The first set of Rust parts covers the BASIC board from parts (E2). The rest are added in batches by usefulness (E4), each batch one PR.
- A call from Rust back to a TypeScript part per evaluation was considered and rejected: crossing between WebAssembly and JavaScript
  on every evaluation would cost much of the gain.

### Handing over between engines

The WebAssembly engine and the TypeScript engines hold the same circuit in different memory. When the exact engine must take over
(the capture view is opened, a force is set, Step is pressed), the nets and every part's state are copied out to the TypeScript
`Simulator`, which goes on from there; when it hands back, they are copied in. Each part type has a `toJs` and `fromJs` for its state,
in the same shape its TypeScript `state` has today, so inspectors, step-back and saved files see no difference.

Step-back history on the WebAssembly engine is a copy of the nets and the state blocks: one `memcpy` of a contiguous region, much cheaper
than today's `cloneState` per part.

### Keeping the two in step

The lockstep tests (`src/engine/lockstep.test.ts`) gain a third engine: the WebAssembly engine, compared after every clock edge with
the frozen reference, on every example it accepts. Each Rust part also gets a test against its TypeScript `evaluate` on random inputs
and states, run from Vitest through the built module. These are what make two copies of each part safe.

### Build

- The Rust code lives in `engine-rs/` (a Cargo crate), built with `wasm-pack` (or `cargo` and `wasm-bindgen`) to a `.wasm` file and a
  small JavaScript glue file, loaded only by the worker. The startup chunk does not grow.
- **Where the `.wasm` gets built** is the main choice (below): Cloudflare Pages builds the site from the repository with `npm run build`,
  and its build image may not have Rust.

### Size

The module for the first set of parts should be about 50 to 150 kB (gzip about 30 to 60 kB), loaded by the worker after the page is up.
It goes into the service worker's list for offline use.

## Work, one PR each, stacked

1. **E0: prototype and measure** (above). Not merged; the numbers go into this file in its own small PR. Stops here if under 1.8x.
2. **E1: the crate and the build.** `engine-rs/`, the build step, the module loaded in the worker and in Vitest, a CI check. No engine yet.
3. **E2: the engine and the first parts.** The settle loop, nets, readers, wake flags, the parts of `/6502-parts-basic`, state handover,
   lockstep tests. Used automatically when a circuit qualifies; the in-page and in-worker TypeScript engines stay as fallbacks.
4. **E3: history and breakpoints** on the WebAssembly engine (step-back by memory copy, `sample` parts such as probes run in TypeScript
   after each edge, or ported).
5. **E4 and on: more parts**, in batches (registers and counters, decoders and ALUs, displays, the devices), until most examples qualify.
6. **E5: measure** in the browser and write the result here.

Each PR runs all unit tests, lint, type-check, the build with the bundle budget, and the e2e specs for `simulation` and `computers`.

## Risks

- **The gain is smaller than estimated.** E0 decides before anything is merged.
- **Two copies of every ported part.** The random-input tests and the lockstep tests are the guard; a mismatch fails CI.
- **A second language and toolchain** in a TypeScript project: `cargo`, `wasm-pack`, a CI job, and Rust for anyone who edits a ported
  part. Adding a new part type does not need Rust: it simply runs on the TypeScript engine until someone ports it.
- **Debugging WebAssembly** is harder. `?engine=ts` forces the TypeScript engine, as `?thread=main` does for the worker.

## Decisions for you

1. **Go on to E0?** (recommended: it is a few days of work, and it settles whether the rest is worth it)
2. **Rust, or AssemblyScript?** Rust (recommended) gives the better compiler, and is the same code a native app could use later.
   AssemblyScript is a TypeScript-like language that compiles to WebAssembly with only an npm package, no Rust toolchain, but its
   output is usually slower and it is a less common tool.
3. **Where the `.wasm` is built:** (a) **CI builds it and the built file is committed** (recommended): `npm run build` and Cloudflare
   need nothing new, and a CI job fails if the committed file does not match the Rust source; or (b) every build compiles the Rust
   (Cloudflare's build must install Rust, which makes deploys slower and adds a way for them to fail).

## E0 result: the gate is passed

A throw-away prototype (508 lines of Rust, no dependencies, with a Vitest harness; not merged: it is on the branch `wasm-e0` and in the
closed PR #187). It has the fast engine's settle loop, as it is on `main` with phase D (`settleFast`, `combPass`, `registeredRound`,
`commitOuts`, the wake rules of D1 and D2), and the 20 part types that the microcoded 6502 board (`micro6502()`, the LED board with its
demo program) uses: the gates, `mux`, `busmux`, `busadd`, `buscmp`, `busgate`, `busreg`, `busctr`, `dff`, `rom`, `ram` and the clock. The
parts that put nothing on a net (labels, displays, constants) are not evaluated, as in the TypeScript engine. The loader stays in
TypeScript: it exports the compiled circuit (nets, pins, readers, the plan, each part's state) to one array of integers that the Rust side
reads.

**Correct:** the Rust engine and the TypeScript fast engine agree on all 771 nets after each of the first 20,000 clock edges (the CPU
runs its program the whole time), and on every register, counter, flip-flop and all 2,048 RAM words at the end.

**Speed** (cycles a second, five runs of 100,000 cycles each, same process, Node; the same V8 as Chrome):

| | Runs | Median |
|---|---|---|
| TypeScript fast engine | 56,000 to 60,600 | 57,600 |
| Rust compiled to WebAssembly | 167,600 to 195,800 | 179,600 |

**3.1x**, over the 1.8x bar. The module is 47 kB (15.6 kB gzip) with every part not yet ported missing, so a full engine will be larger,
but well within the 50 to 150 kB the spec estimated.

What the prototype leaves out, and so what the estimate has to allow for: the terminal, the ACIA, the VIA, the LCD and the CPU parts; the
history for stepping back; the exact engine's handover; forces; and `sample` parts. None of them is in the inner loop (they are per edge or
per part type), but the first real number for the BASIC board comes with E2 and E5. The BASIC board's mix of parts is the same as this
board's apart from the ACIA (2 of 90 evaluations a cycle).

So E1 onward goes ahead.

## E1 result: the crate and the build

`engine-rs/` (no dependencies, toolchain pinned to Rust 1.97.0 in `rust-toolchain.toml`) builds with `npm run build:wasm` to
`src/engine/wasm/engine.wasm`, which is committed. It is 14 kB with the allocator and two functions; `src/engine/wasm.ts` loads it and
refuses a module whose interface number (`ABI_VERSION`) differs. The build is reproducible: the same source gave the same bytes in two
different directories (the machine's paths are mapped out of the file). The CI job `wasm` rebuilds the file and fails if it differs from the
committed one. `npm run build` and the Cloudflare deploy are unchanged.

## E2a result: the engine and the parts of the BASIC board

`engine-rs/` now has the engine (the tables, the settle loop, the wake rules of D1 and D2) and 21 part types: everything that the 6502
from parts (the LED board and the BASIC board) uses, including the terminal. `src/engine/wasmengine.ts` loads a compiled circuit
(`Simulator.compiled()`) into it, runs clock edges, and reads the nets, the parts' states and the RAM out of the module's memory. It is
not yet used by the `Simulator` (that is E2b), so nothing changes in the app.

- The terminal's registers and keyboard queue are in Rust; the screen stays on the page: what the program prints is logged as events
  (print a character, wipe the screen), which `syncOut` replays on the page's `AciaState` with `aciaPut` and `aciaWipe`. Typing, a key and
  a break go to the queue in Rust.
- `src/engine/wasmengine.test.ts` runs the TypeScript fast engine and the Rust one side by side: the same 771 nets after each of 6,000
  clock edges on the LED board; on the BASIC board the same nets for the first 4,000 edges, then the same screen text after every further
  4,000 edges until the interpreter says `OK`, and after typing a program and `RUN` (it prints 1, 4, 9).
- Speed on the BASIC board from parts (`VITE_BENCH=1 npx vitest run src/engine/bench -t WebAssembly`, five runs of 100,000 cycles, Node):
  TypeScript fast engine 58,970 to 69,430 (median 67,300), WebAssembly 190,000 to 250,800 (median 199,300): **2.96x**.

### Coverage after E2a (what makes the whole simulator faster)

The engine is for every circuit, not for the BASIC example: BASIC is the benchmark. A circuit takes the new engine only if **every part**
in it is ported. Of the 63 examples, 57 run on the TypeScript fast engine, and **7** consist of ported parts only. The parts that keep
the others out, with the number of examples using them: `hexdisp` 17, `breakpoint` 13, `cpu6502` 12, `counter` 9, `probe` 9, `framebuffer` 8,
`hexin` 6, `console` 6, `register` 5, `decoder` 5, `bin2bcd` 5, `bcdadd` 5, `busjoin` 5, `gamepad` 4, `add4` 3, `tff` 3, `tribuf` 3, `keypad` 3,
`via6522` 3. E4 ports them in that order, and the count is measured again after each batch.

## E3 and E4 result: every part is in the module (2026-11-01)

- **Parts.** All part types that reach the engine as a part are ported. The splitter, merger and custom IC are taken apart when the drawing is
  compiled; the parts that only look at the nets (probe, breakpoint, matrix, speaker) are run by the `Simulator` on the page's side after each
  settle, by design; displays and inputs do nothing in the engine. The last batches: E4b ROM table port, BCD parts, T flip-flop; E4c keypad,
  pixel screen, text console; E4d latches, counters, registers, shift register and the small combinational parts; E4e tri-state buffer and bus
  junction; E4f the 6522 and the HD44780; E4g the 6502 and 65C02 (the opcode tables stay in TypeScript and are sent in the image); E4h the rest.
- **Structure.** `engine-rs/src/engine.rs` is the core (tables, settle loop). `engine-rs/src/parts/` has one file per family of parts; a part
  is a function of its `Cell` (inputs, outputs, its state, its parameters) and, if it needs them, `Shared` (memories, screens, chips). How to add
  a part is at the top of `parts/mod.rs`.
- **Coverage.** Of the 63 examples, 45 run on Rust with the step-back history off (with it on, a circuit with a terminal or a text console stays
  on the TypeScript engine, because their screens are replayed from event logs) and match the TypeScript engine net for net after every
  clock edge. The other 18 have no clock (15: gates, adders, latches, `ripple`, `oscillator` and the like, which settle once and gain nothing),
  or two clocks (`uart`, `debounce`, `65c02-timer`). Two clocks in the fast engine, and the exact engine, are E6.
- **Tests.** A single-part test with unknown inputs and random switches for every part (16 seeds of 120 edges); the all-examples comparison;
  the Simulator-level tests (history, probes, breakpoints, terminal, screens); random opcodes on both CPU chips; Microsoft BASIC on the
  `cpu6502` board.
- **Not yet done:** E6 and E7.

## E5 result: measured in the browser

Headless Chromium in the build container, the built app (`vite preview`), 9 seconds after load, reading the footer's "actual" clock rate
(history off, as the examples ship). `?engine=ts` is the TypeScript fast engine.

| Example | Asked | Rust | TypeScript |
|---|---|---|---|
| `6502-basic` (the `cpu6502` part) | 1 MHz | 1 MHz (100%) | 753 kHz (75%) |
| `6502-parts-basic` (6502 from our own parts) | 1 MHz | 247 kHz (25%) | 109 kHz (11%) |
| `computer-pong`, `computer-raycaster` | 512 Hz, 4.1 kHz | keep up | keep up |

The parts-built 6502 runs about 2.3 times faster; the `cpu6502` board now reaches the full 1 MHz. Slower hardware will differ, so read these as
ratios. The examples that already keep up gain nothing visible, as expected.

## End state: one implementation, in Rust

Decided with Leon on 2026-10-31: the simulator should not stay a mix of TypeScript and Rust that is hard to maintain. The target is that
**what a part does is written once, in Rust**.

- **Rust:** the behaviour of every part (what `evaluate` does today), the fast engine, and the exact (unit-delay) engine, which the capture
  view, forces and the Step button use. The CPU, VIA, LCD and terminal parts too.
- **TypeScript stays** for what the editor needs at once and that is data, not behaviour: each part's name, pins, layout, parameters,
  description and symbol (`ComponentDef` without `evaluate`), the loader and compiler that turns a drawing into tables, the worker and the UI.
- **A frozen TypeScript reference** (the old simulator, as in `lockstep.test.ts`) stays in the tests only, as the oracle that the Rust
  engines are checked against. It is not shipped.

While the port is under way each ported part exists twice (the TypeScript `evaluate` and the Rust one), and the lockstep tests keep the two
equal. That is the price of doing it in steps; it ends with two more steps after E4:

- **E6: the exact engine in Rust.** Capture, forces and Step then use Rust too, so every circuit runs in Rust, whatever it contains.
- **E7: remove the TypeScript engines.** `evaluate` is deleted from the part definitions (the frozen reference keeps its own copy for the
  tests), together with `settleFast` and the TypeScript unit-delay engine.

Until E7 a circuit with a part that is not ported yet runs on the TypeScript engines, so nothing is worse than today at any step.
