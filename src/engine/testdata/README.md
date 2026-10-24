# Test data

`6502-singlestep.json`: the first 20 cases of each documented opcode from
[SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) (`6502/v1`, the NMOS 6502), MIT licence, Copyright (c) 2024
Thomas Harte et al. Each entry is `[name, initial, final, cycles]`: the registers and the RAM words before and after one
instruction, and the bus cycle by cycle as `[address, value, "read" | "write"]`.
