# The simulator: architecture, performance and how it got there

The editor, the wires, the inspectors and every screen are TypeScript and React. **What the parts do and how a circuit is settled is
Rust compiled to WebAssembly**, running in a Web Worker. This page says how the pieces fit, what each step of the speed work bought,
and how to add a part.

## The pieces

```
 page (React, SVG)                       worker (src/engine/sim.worker.ts)
 ┌──────────────────────┐   messages    ┌───────────────────────────────────────────┐
 │ store, canvas, panels│ ◄───────────► │ Simulator (TypeScript)                     │
 │ SimApi (remote.ts)   │  snapshots    │   loader: drawing → nets, readers, plan    │
 └──────────────────────┘               │   clocks, time, history, probes, forces    │
                                        │        │ image (one Int32Array)            │
                                        │        ▼                                   │
                                        │ WasmEngine (wasmengine.ts)                 │
                                        │   engine.wasm (engine-rs/): nets, pins,    │
                                        │   every part's behaviour, fast + exact     │
                                        │   settle, step-back copies                 │
                                        └───────────────────────────────────────────┘
```

| Layer | Language | Where | Does |
|---|---|---|---|
| Part definitions | TypeScript | `src/engine/components/*` | name, pins, layout, parameters, symbol, text; `evaluate` (see "Still two copies" below) |
| Loader and compiler | TypeScript | `src/engine/simulator.ts`, `src/model/*` | turns a drawing into nets, readers, the plan (levelised order) |
| Simulator | TypeScript | `src/engine/simulator.ts` | clocks and time, step-back history, probes and breakpoints (`sample`), forces, capture, handing the circuit to the module |
| Engine | Rust | `engine-rs/src/engine.rs` | the tables, the fast settle (one ordered pass plus registered rounds), the exact unit-delay `tick`, delay pipes, forces |
| Parts | Rust | `engine-rs/src/parts/*.rs` | what every part type does, by family: gates, bus, seq, arith, coding, memory, io, terminal, tristate, via, lcd, cpu6502, acia |
| Glue | TypeScript | `src/engine/wasmengine.ts`, `src/engine/wasm.ts` | builds the image, reads nets and part state out of the module's memory, `KIND` table (part type to Rust number) |
| Worker | TypeScript | `src/engine/sim.worker.ts`, `src/engine/remote.ts` | runs the Simulator off the page's thread; the page sees snapshots |

**The module's memory is the circuit.** The page side builds one `Int32Array` image (nets, pins, a row per part, tables, ROM and RAM
contents, chip states, delay pipes, the 6502 opcode table), `init` reads it, and from then on the nets are the module's own memory:
`values` is a view, not a copy. Part state (registers, counters, flip-flops, RAM, VIA/LCD/CPU structs) is read back by `syncOut` only
when something needs it (an inspector, a save, leaving the module). Anything that changes the circuit from outside (a switch, a
parameter, an edit) leaves the module first and the next settle hands the circuit back.

**Two engines inside the module.**

- *Fast*: for circuits without loops, delays or races. One ordered pass over the combinational parts, then a round for the registered
  parts, which all read before any writes. Parts wake only when an input changed (a clocked part only on a rising edge).
- *Exact*: one gate delay per `tick`, used for loops, parts with a delay, forced wires, the capture view and the Step button.
  Same results tick for tick as the original unit-delay engine.

The Simulator picks one per circuit and per moment; `mark_all(fast)` re-flags every part when it switches.

**Pluggable parts in Rust.** A part is a `Cell` (its input pins, output buffer, small state, three parameters) and a `Shared` bag for the
big things (ROM, RAM, framebuffer, chips). `parts::eval(kind, cell, shared)` dispatches by number range to a family file. **Part
numbers never change once given; new ones are appended.** The page's `KIND` table in `wasmengine.ts` must list the same numbers.

## Adding a part

1. TypeScript: an entry in `src/engine/components/*` (pins, layout, parameters, description) and its text in `src/engine/pindata.ts`.
2. Rust: a number in `engine-rs/src/parts/mod.rs` (`kind` module, appended), its behaviour in the family file, the dispatch range.
3. `KIND` in `src/engine/wasmengine.ts`; if the part has state or settings the module needs, send them in the constructor and read them
   back in `syncOut`.
4. Add the part to `CASES` in `src/engine/wasmengine.test.ts`: it is run against the TypeScript `evaluate` with unknown inputs and random
   switches, so the two copies cannot drift.
5. `npm run build:wasm` and commit `src/engine/wasm/engine.wasm` with the source (CI runs `build:wasm -- --check`).

## How the speed was won

All numbers are cycles a second of the BASIC board built from our own parts (`/6502-parts-basic`, a 6502 made of registers, an adder
and ROMs, about 90 part evaluations a cycle), unless the row says otherwise. A real 6502 does 1,000,000. Node numbers are the engine
alone; browser numbers are headless Chromium in a container with software drawing, so read them as ratios.

| Step | PRs | Where | Before | After |
|---|---|---|---|---|
| Tier 1: cheap changes in the unit-delay engine (flat arrays, no allocation per tick, history off for fast clocks) | #164 to #166 | Node | ~30,000 | ~60,000 |
| Tier 2: the fast engine (levelised plan, one pass per edge) | #169 to #171 | Node | ~60,000 | ~103,000 |
| Phase D: idle parts never woken, clocked parts only on a rising edge (118.6 to 89.8 evaluations a cycle) | #183, #184 | Node | 56,000 to 72,500 | 65,000 to 74,400 |
| Web Worker for the simulation (the page draws while the engine runs) | #174 to #176 | browser | 52.6 kHz (11.6 frames/s) | 107 kHz (26.6 frames/s) |
| Rust prototype of the fast engine (E0) | #187 (not merged) | Node | 57,600 (TS fast) | 179,600 (**3.1x**) |
| Rust engine for the 6502-from-parts board (E1 to E5) | #189 to #207 | browser | 109 kHz (TS fast) | 247 kHz (**2.3x**) |
| Rust engine for the `cpu6502` board with BASIC | same | browser | 753 kHz | 1 MHz (full speed) |

The raw prototype table and each step's method are in `docs/spec-sim-speed-tier1.md`, `-tier2.md`, `-worker.md` and `-wasm.md`.
Overall, the BASIC board from parts went from about 25 kHz at the start to about 250 kHz in the browser, and the board with the
`cpu6502` part reaches the real 1 MHz.

### What did not pay

Phase D steps D3 (quiet inputs do not wake a part) and D4 (cheaper calls for the commonest parts) were measured and dropped (#185); a
call from Rust back into a TypeScript part per evaluation was rejected before it was built, because crossing the boundary costs more
than the evaluation. Details and numbers: `docs/spec-sim-evals.md`, `docs/spec-sim-wasm.md`.

### The Rust migration, in order

- E1 the crate and the reproducible build (the `.wasm` is committed, so deploys need no Rust).
- E2 the engine and the parts of the BASIC board; E3 step-back history as one memory copy; E4a to E4h every other part type
  (63 in all) with a per-part random lockstep test against the TypeScript copy; the code split into `parts/<family>.rs` (#201).
- E5 the measurement above. E6 several clocks and the exact engine in Rust (#209). E7 circuits without a clock and wide receive labels,
  then removing the TypeScript engines.

## Still two copies (until E7 finishes)

Each part's TypeScript `evaluate` and the TypeScript `settleFast` and unit-delay `tick` still exist: they run when the module is not
loaded yet, with `?engine=ts`, and as the oracle the lockstep tests compare Rust against. E7 moves them into a test-only reference and
removes them from the shipped app; this page changes when that lands.

## Debugging

- `?engine=ts` runs the TypeScript engines; `?thread=main` runs the simulation on the page's thread instead of the worker.
- The footer says which engine runs (`fast engine (Rust)`, `fast engine`, `exact`).
- `VITE_BENCH=1 npx vitest run src/engine/bench` prints cycles a second per engine.
