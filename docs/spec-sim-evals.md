# Simulator speed, phase D: fewer part evaluations per cycle (spec)

Status: **for approval.** No code until approved. This follows the worker (`docs/spec-sim-worker.md`, #174 to #176). The worker gives
the simulation a whole core, so the browser now runs about as fast as the engine does in Node, and the engine is the limit again.
A port of the engine to Rust and WebAssembly is a separate spec (`docs/spec-sim-wasm.md`); this one is the cheaper step, in TypeScript,
and everything it finds carries over to that port.

## Where we are

Measured on `/6502-parts-basic` (the 6502 built from our own parts, running BASIC), fast engine, history off, 20,000 clock edges after
a warm-up, under Vitest in Node (slower than a bundled build, so read the ratios, not the totals):

- **118.6 part evaluations per cycle.** 286 parts, 771 nets, 1,492 pin readers.
- **56% of those evaluations change no output.** The work was done and nothing came of it.

By part type (evaluations per cycle, and how many of them changed nothing):

| Part | Per cycle | Changed nothing | Why |
|---|---|---|---|
| `busreg` (9 of them) | 18.0 | 95% | Woken on both clock edges; only the rising one does anything. |
| `busmux` | 17.3 | 12% | Real work. |
| `dff` (7) | 14.0 | 100% | Both edges again, and these flip-flops rarely change. |
| `busadd` | 8.4 | 2% | Real work. |
| `mux` | 7.3 | 65% | An input changed that the select line does not pass through. |
| `busctr` | 6.5 | 74% | Both edges. |
| `and` | 6.4 | 55% | The other input is 0, so the output cannot change. |
| `netsend` | 5.5 | 100% | A send label: its `evaluate` is empty. The label is wired as a net already. |
| `busdisp` | 3.5 | 100% | A display with no outputs: its `evaluate` is empty, it is drawn from the nets. |
| `ram` | 2.9 | 87% | Read follows the address; most cycles the read value is the same. |
| `acia6551` | 2.0 | 100% | Woken on both edges; no register access on most cycles. |
| `led` | 0.8 | 100% | No outputs, drawn from the nets. |

Every evaluation also costs its share of the scheduling around it: flagging the part, the call through `def.evaluate` (one call site
for every part type, so the JIT cannot inline it), and comparing each output with its net. The engine's own time (not inside a part's
`evaluate`) is about 60% of the total, so an evaluation that is skipped saves more than its `evaluate`.

## What changes

Four changes, each small, each checked by the lockstep tests (`src/engine/lockstep.test.ts`: the fast engine against the frozen exact
reference, nets and part states compared after every clock edge, on every example the fast engine accepts).

### D1. Parts with nothing to do are never woken

A part that has **no outputs and an empty `evaluate`** (`netsend`, `busdisp`, `led`, `seg7`, `hexdisp`, `bar`, `dicedisp`, `note`,
`frame`) gets `readerWake = 0` on every input pin at load. Its pins are still written, so anything that reads
them (drawing, `inputValues`) sees the same values as now. A part type opts in with a flag in `timing.ts` (`idle`), checked by
`timing.test.ts` against the part (no outputs, and `evaluate` leaves `state` alone).

Saves about 10 evaluations a cycle on this board (8%), all of them pure waste.

### D2. Registered parts wake on their active edge only

Today a registered part is woken whenever its clock pin changes, and its `evaluate` finds out (with `rising` in `sequential.ts`)
that a falling edge does nothing. Instead, the planner records each registered part's **active edge** (rising for all of them today,
from a new `edge` field in the `REGISTERED` table, so a falling-edge part can be added later), and `commitOuts` wakes the part only
when the clock net goes to that level.

The catch: `rising()` keeps the last clock level in the part's state (`state.pc`), and the exact engine and step-back history rely on
it. So the part's `pc` is still brought up to date on the inactive edge, by the engine (one store, no call), not by skipping the
update. The part's `evaluate` is unchanged and still correct when the exact engine calls it on both edges.

Parts with more involved clocking (the CPU, `acia6551`, `via6522`, `hd44780`) are left as they are unless that test shows they qualify: the flag is per part type, set only where `evaluate` provably does nothing on the inactive edge, and
`timing.test.ts` checks it by driving each flagged part through both edges with random inputs.

Saves about 20 evaluations a cycle on this board (17%).

### D3. Inputs that cannot change the output do not wake the part

For a few common part types, a change on one input cannot change the output while another input holds a given value:

- `and`/`nand` with another input at 0, `or`/`nor` with another input at 1 (the controlling value);
- `mux` and `busmux` on a data input that the select lines do not choose.

These get a small `quiet(inst, pin)` function in their definition: "a change on this pin, with these other inputs, cannot change
the outputs". `commitOuts` asks it before waking the part. It must be cheap, so it is only added where the answer is one or two
comparisons, and only where measuring shows a gain (the extra call can cost more than the evaluation it saves on a 2-input gate; that
is measured first, and dropped if so). When the select line later changes, the part is woken by that change and reads all its
current pins, so nothing is missed: pins are always written, only the wake is skipped.

Saves up to about 8 evaluations a cycle (7%), if the check is cheaper than the work.

### D4. Cheaper calls for the commonest parts

The single `cc.def.evaluate(cc.inst)` call site sees every part type, so V8 treats it as megamorphic and cannot inline. For the
handful of types that make up most evaluations (`and`, `or`, `not`, `xor`, `mux`, `busmux`, `busadd`, `busreg`, `dff`), the
combinational pass gets a `switch` on a small integer kind, computed at load, with the work done inline on the pin array, and falls
back to `def.evaluate` for every other type. Each inline case is tested against its part's own `evaluate` on random inputs
(`parts.test.ts`), so the two cannot drift apart.

This is the riskiest of the four (two copies of the same logic) and is done last, only if D1 to D3 leave it worth more than 10%.

## What is not in this spec

- **Merging chains of gates into one generated function** (or word-wide nets): the "phase B" of `docs/spec-sim-speed-tier2.md`,
  estimated at about 1.3x and not built. It is the same idea as D4 taken much further, and it is what the WebAssembly port would do
  properly.
- Changes to the exact engine. It stays as it is: the reference for everything, used for the capture view, forces and stepping.

## Estimate

D1 and D2 remove about 30 of 119 evaluations a cycle (25%) and the scheduling around them, D3 a few more. With the engine's overhead
counted, **1.2x to 1.4x** on the BASIC board, more on circuits with many registers (each register's falling edge goes away). D4 might
add 1.1x to 1.2x. The 6502 *part* board (one big part) gains almost nothing, since it does few evaluations already.

## Work, one PR each, stacked

1. **D0: measure.** `src/engine/bench.test.ts` gets the per-type table above (evaluations, how many changed nothing) as a printed
   report, so each step below shows its effect. No change to the engine.
2. **D1: idle parts.** Table flag, test, the wake change.
3. **D2: active edges.** Table field, test with random inputs on both edges, the wake change.
4. **D3: quiet inputs.** Measured first on `and`/`or`/`mux`/`busmux`; only the types that gain are kept.
5. **D4: inline kinds**, only if worth it after D3 (decided by the numbers, written here).

Each PR runs all unit tests (the lockstep tests are the main check), lint, type-check, the e2e specs for `simulation` and
`computers`, and the build with the bundle budget, and reports cycles a second before and after (the Node bench and, for the last
one, the browser). The result is written into this file.

## Risks

- **A part that does something on an edge we call inactive.** Each flagged type is checked by a test that drives both edges; parts that
  are not flagged keep today's behaviour.
- **A wake skipped wrongly** (D3) leaves a stale output. The lockstep tests compare every net after every edge on every example, and the
  `quiet` functions are tested against `evaluate` on random inputs: if `quiet` says yes, evaluating anyway must give the same outputs.
- **Two copies of part logic** (D4). Kept to a few types, each tested against the original.

## Decisions for you

1. **Go ahead with D0 to D3?** (recommended: low risk, each step measured)
2. **D4 only if the numbers say so after D3** (recommended), or always, or never.

## Results

Measured with `VITE_BENCH=1 npx vitest run src/engine/bench` (Vitest in Node, this container; three runs each, the spread is wide):

| Step | Evaluations per cycle | Changed nothing | Cycles a second, fast engine |
|---|---|---|---|
| D0 (before) | 118.6 | 56% | 56,000 to 72,500 |
| D1 (idle parts) | 108.8 | 52% | 55,900 to 62,700 |
| D2 (rising edges only) | 89.8 | 41% | 65,100 to 70,000 |
| D3 (quiet inputs), all four kinds | 81.6 | 35% | 57,000 to 59,000 (slower) |

### D3 result: not kept

The wake check was built for `and`/`or`/`nand`/`nor`, `mux` and `busmux` (a `quiet(inst, pin)` per part type, with a random-input test
that a part says yes only when its outputs cannot change). It did what it should: evaluations per cycle went from 89.8 to 81.6. But the
speed went **down**, because asking costs more than the evaluation it saves: the call goes through `cc.def.quiet`, one call site for many
part types (the same problem as `def.evaluate`), and a 2-input gate is cheaper to evaluate than to ask about. Five runs each, alternating
(median cycles a second, Vitest in Node):

| Variant | Median | Runs |
|---|---|---|
| D2 (before) | 70,800 | 65,400 to 74,400 |
| gates, `mux` and `busmux` | 58,800 | 58,100 to 69,800 |
| gates and `mux` | 62,500 | 51,400 to 65,500 |
| gates only | 66,500 | 61,900 to 73,200 |

No variant is faster than D2, so D3 is dropped, as the spec said it would be if it did not pay. The code is not merged.
