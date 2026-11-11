# Test data

`6502-singlestep.json`: the first 20 cases of each documented opcode from
[SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) (`6502/v1`, the NMOS 6502), MIT licence, Copyright (c) 2024
Thomas Harte et al. Each entry is `[name, initial, final, cycles]`: the registers and the RAM words before and after one
instruction, and the bus cycle by cycle as `[address, value, "read" | "write"]`.

`65c02-singlestep.json`: the same for the WDC 65C02 (`wdc65c02/v1`, MIT licence, the same authors): the first 20 cases of each opcode but
`CB` (WAI) and `DB` (STP), which the set does not have. The format is the same.

`oracle/`: a frozen copy of the TypeScript simulator, part definitions and chip cores, from before the engine moved to Rust. It takes no
new parts. `src/engine/lockstep.test.ts` runs the real simulator against it (every net after every clock edge on every example, exact and
fast), and the `CASES` of `src/engine/wasmengine.test.ts` run each part with random 0/1/X/Z inputs. Do not edit these files to follow a
change in the real ones: a difference is what the test is there to show. Change them only when a behaviour is meant to change.
