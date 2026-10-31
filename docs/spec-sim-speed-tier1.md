# Simulator speed, tier 1: cheap changes in the current engine (spec)

Status: **for approval.** No code until approved. This is tier 1 of the speed plan; tiers 2 and 3 (a compiled netlist, a worker,
WASM) are outside this spec and are only mentioned where tier 1 should not make them harder.

## Goal

Raise the clock rate the engine reaches without changing what it simulates. Same unit-delay semantics, same results tick for tick,
same file format, no visible change. Target: **at least 1.6x on the 6502-from-parts BASIC board (`/6502-parts-basic`)**, which runs at
about 25,000 to 28,000 cycles a second today; stretch 2.2x. Anything that does not move this number by itself is dropped.

## Where the time goes today

Measured on `/6502-parts-basic` (history off, Node 22; the browser gives about the same), with `node --cpu-prof` over 350,000 cycles:

- 286 parts, mostly word-wide (`busmux` 22, `busreg` 9, `busadd` 11, `busctr` 3, `busgate` 4...). 10 ticks and about 104 part
  evaluations per clock edge (of 286: the "only evaluate what changed" queue already works). 18 µs per edge, so about 170 ns per
  evaluation. 1 MHz needs 0.5 µs an edge.
- Self time: `Simulator.tick` 36% (this includes `evaluate` inlined into it), `bitsOf` 17%, `settle` 8.5%, small helpers (`maskOf`,
  `log2`, the `pure()` wrapper) about 6%, and the part functions themselves the rest. Building and flattening the circuit
  (`search` in the wire router, 9% of that run, 1.6 s once) is not part of the loop; it is item 8.

## Changes, in order of expected gain

Each is one commit, and the benchmark (below) is run before and after each, with the number written in the PR.

### 1. No allocation in the word-wide parts (est. 1.2x to 1.3x)

Today (`src/engine/components/nbit.ts`, `combinational.ts`):

- `bitsOf(n, count)` is `Array.from({ length }, ...)`: an array and a closure per call, on every `busadd`, `bussub`, `busaddsub`,
  `busmul` and so on. It is the second-biggest line in the profile.
- `pure(fn)` / `comb(fn)` call `inst.ins.includes(X)` (a scan), call `fn`, which returns a fresh array, then copy it into `outs`.
- `busctr` does `ins.slice(n)` and destructures it, an allocation per evaluation.
- `GATES.*.fn` calls `and([a, b])` with a new array for each bit of a `busgate`.
- `widthOf(p)`, `maskOf(p)` (`2 ** n`), `Number(p.n)`, `log2(n)` (`Math.log2`) and `GATES[String(op)]` are recomputed on every
  evaluation from the `params` record.

Change:

- Add `writeBits(outs, start, count, value)` (a loop, no array) and use it where `bitsOf` is used. Keep `bitsOf` only for cold paths.
- Rewrite the word parts (`busreg`, `busctr`, `busadd`, `bussub`, `busaddsub`, `buscmp`, `busgate`, `busmux`, `busdisp` and the
  `ram`/`rom` read paths) to read `ins` and write `outs` directly. The X rule stays exactly as it is: any X in the inputs that matter gives
  X on the outputs; `toNum` already returns -1 for that.
- Give `ComponentDef` an optional `prepare?(p: Params): unknown`, called once when a part is compiled and cached on the instance
  (`inst.cfg`): the width, the mask, the select width, the gate function. `evaluate` then reads `inst.cfg`. Parts without
  `prepare` are unchanged. `prepare` is called again when params change (`setParams`, `load`), so editing a size still works.
- The two-input gate table becomes small functions on `V` values (a lookup array of 16 entries per gate, indexed by `a * 4 + b`), with
  no array allocation. `and`/`or`/`xor` (the n-ary helpers in `types.ts`) stay for the parts that need n inputs.

Not changed: part behaviour, pin names, layouts.

### 2. A cheaper evaluate path in the simulator (est. 1.2x to 1.4x)

`Simulator.evaluate` (`simulator.ts`) copies every input net into `inst.ins`, calls `cc.def.evaluate(cc.inst)` (a call through a property
of an object whose shape varies with the part: about 40 different functions through one call site, so the engine cannot inline or
predict it), then copies `outs` into a `writes` buffer, and `tick` later reads that buffer back to commit.

Change, in this order, keeping each if it measures better and dropping it if not:

- **Skip the copy when nothing changed**: compare the inputs to the last values seen while copying, and return before `evaluate` if
  they are all equal and the part has no hidden clock-like state. Most evaluations of registers and counters in this circuit are the
  ones where the clock input did not change. A part declares this safe with `pureInputs: true` (set on the gates, muxes, adders,
  registers and counters; not on anything that reads the time or has a side effect: the ACIA, the clock, the probes).
- **Split the evaluation loop by kind**: sort the queue by part kind (or keep one list per kind) so a run of the same function is
  called back to back, which lets the engine keep it hot. The hot kinds (`and`, `or`, `not`, `xor`, `mux`, `dff`, `buf`, and the
  `bus*` listed above) get a `switch` on a small integer `kind` in `Simulator.evaluate`, with the generic call as the default.
- **Write outputs straight into a second `Uint8Array` (`next`)**, and commit by comparing `next` to `values` only for the nets of
  parts evaluated this tick, instead of a `writes` array of (net, value) pairs that is walked a second time. Forcing (`forced`) and
  delay pipes (`pipe`) keep their behaviour and have their own tests.
- **`inst.ins` and `inst.outs` become `Uint8Array`s** instead of arrays of numbers. Parts that call `.includes`, `.slice`, spread or
  `.fill` on them are updated (a search finds them: `ins.slice`, `[...bitsOf(`); typed arrays have all of these except spread of a
  result into a new array.

### 3. A leaner clock edge (est. 1.05x to 1.1x)

`advance` (per edge): `clockHalfPeriod(params)` is called for each clock twice (the minimum, then the toggle test), `Math.min` over
a `for...of`, `performance.now()` every fourth edge, `edgeHook?.()`; `settle` allocates the `rec` capture object only when
capturing, but checks `this.capturing` and the loop-exit condition per tick.

Change: cache each clock's half period when its params change (`setParams`, `load`), keep the clocks in an array of plain structs,
and hoist the capture and `rec` branches out of the tick loop into a separate method used only when capturing is on.

### 4. Settling in fewer ticks (est. up to 1.1x, only if free)

The circuit takes 10 ticks to settle per edge because the logic is about 10 gate delays deep. That depth is **part of the model**
(the glitch view and the delay setting show it), so it is not changed. What can be cheaper is a tick in which only a few parts run:
the loop exit and the pending-slow-part check at the end of `tick` run every tick even with no slow parts; make them skip when
`slow.length === 0`.

### 5. Do less work per frame in the app (est. up to 1.15x in the browser, none in Node)

`runtime.ts` gives the simulation `workMs` (10 ms at least) of each 16.7 ms frame, with `publish()` and React drawing in the rest. Measure
(with `performance.mark` in a dev build) how long `publish` plus drawing take per frame on the BASIC board, and if it is over
3 ms, look at what is redrawn that did not change (the `signature` strings, the wire colours). A change here is made only if the
measurement shows it; it is not planned in advance. Moving the sim to a worker is tier 2.

### 6. History off for any circuit that runs a fast clock (no speedup for the BASIC board, which has it off already)

Not new work: noted so nobody counts it. `setHistory(false)` is already saved with that example.

### 7. Not in this spec, and why

- **Typed-array part state** (replacing `inst.state` objects and `cloneState`): large, and it only helps with history on. Tier 2.
- **Skipping unconnected inputs, merging buffers and constants at compile time**: small here (the example has few of them), but cheap:
  a `buf` or a `const` whose consumers could read its source net directly. Revisit after item 2 if the profile shows them.

### 8. Load time of the example (not a speed item, same PR series)

`micro6502Basic()` plus `flatten` takes 1.6 s, nearly all of it in the wire router (`routeWires` / `search`). The simulator never needs
routes. Check whether the router runs for the simulation path at all (`build(0)` and `flatten` should not need it), and if it does,
skip it there or cache the routes on the circuit. Separate commit, separate number, easily dropped from this spec if it turns out to
be something else.

## How we measure

- **The benchmark.** `src/engine/bench.test.ts` already prints timings (`VITE_BENCH=1 npx vitest run src/engine/bench`). Add
  `micro6502 BASIC` (the `/6502-parts-basic` circuit, history off, a warm-up of 3,000 edges, then 100,000 edges timed) and the
  existing cpu6502 board with the BASIC ROM. They print cycles a second, ticks an edge and evaluations an edge. Never asserted
  (machines differ); the PR text carries before and after, run twice, on the same machine, with the median.
- **A profile** (`node --cpu-prof` on a bundled script, as used for this spec) before and after, to see the next biggest line.
- **Correctness, which is the real risk:**
  - All existing unit tests, unchanged. They include the cycle-for-cycle comparison of the parts-built 6502 against the `cpu6502` core
    (`micro6502.test.ts`, `micro6502-basic.test.ts`) and the glitch, capture, delay, force and history tests.
  - A new **lockstep test**: the current `Simulator` and part definitions are copied into `src/engine/testdata/` as a frozen
    reference (kept after the work is done, so later changes are checked against it too): run a set of
    circuits (the examples: `6502-parts-basic`, the 8-bit computer, a counter, an SR latch pair, a tri-state bus, a ring oscillator)
    for a few thousand ticks on both and compare **every net after every tick**. Any difference fails.
  - A **random-input test** for each rewritten part: random 0/1/X/Z inputs against the old `evaluate` kept as a reference, all
    widths 2 to 16, all gate types. This catches the X rule mistakes, which are the likely bugs.

## Risks

- **X and Z handling** in rewritten parts: covered by the random test above.
- **Skipping evaluation when inputs are unchanged** (item 2): a part with hidden state that changes with time (a clock, the ACIA's
  timer, a probe) would stop updating. The `pureInputs` flag is opt-in per part type for that reason, and a test lists which types
  have it so it is a visible choice in review.
- **Typed arrays for `ins`/`outs`** truncate values to 0..255 silently, where arrays keep any number: a part that stores a value
  other than 0..3 in `outs` was already wrong, and the lockstep test shows it.
- **Browser versus Node**: the numbers are from Node. They are rechecked in Chromium (the `Running at N cycles a second` readout in the CPU
  inspector) before the PR is described as done.

## Order of work and PRs

One PR per numbered item above, stacked, each with its before and after number: 1, 2, 3 and 4 together if small, 8 on its own. The
lockstep and random-input tests come first, in the first PR, against the unchanged engine (they pass trivially), so every later change
is checked by them. The version number does not change (it counts commits). If a PR does not give at least 1.05x on its own
and is not needed for the next one, it is dropped rather than merged.

## What I need from you

1. A yes on the target (1.6x; stretch 2.2x) and on the scope above, or what to cut.
2. Whether to include item 8 (load time) here or leave it for later.
3. Whether I may add the reference copy of the old `Simulator` to `src/engine/testdata/` (about 800 lines, used only by the lockstep test).
