# SKASM: one assembly language for every computer (plan)

> **Status: done (S1, S2, S3 and the beginner computer).** Read `CLAUDE.md` first (version bump and the full checklist on every push).
> Work step by step, each ending in a working, tested state; stop and report after each; push only when asked.
> This comes before the rest of M9 (`plan-m9-timing-fsm.md`, 9b onward).

## Why
Today there is one assembler (`src/engine/isa.ts`) but two instruction sets: `SK8` (computer 1) and `SK82` (computer 2).
`SK82` is a binary-compatible superset of `SK8` (opcodes 0–7 and jump targets up to 15 encode to the same words), yet
the ROM inspector asks you to pick one, computer 1 cannot run what computer 2 can, and devices are reached through RAM
addresses that differ per computer (`STA 15` is the output register on one, the console on the other; `STA 14` is a
screen pixel or the speaker, and writing there also writes RAM).

Decisions made: **one instruction set that all hardware implements**; **devices are reached with `OUT` and `IN`
instructions and a separate port space, not through RAM**; the language is called **SKASM**.

## The language
- **SKASM** is today's `SK82` set, kept exactly as encoded, plus new instructions held in two **extension opcodes**. All
  16 fixed opcodes are used today, and the free bits differ by instruction kind (an immediate needs bits 8–15, a jump
  target needs bits 8–11), so there are two extension groups, each with 16 sub-opcodes:

  | Opcode | Group | Operand | Sub-opcode in |
  |---|---|---|---|
  | 0–13 | the existing instructions (unchanged) | as now | n/a |
  | 14 | **EXT-I**: with an 8-bit immediate (bits 8–15) | immediate | bits 0–3 |
  | 15 | **EXT-M**: with an address, port or jump target (bits 0–3, jump upper nibble 8–11) | address / port / target | bits 12–15 |

- **Instruction set** (new ones in bold):

  | Group | Instructions |
  |---|---|
  | Load / store | `LDI n`, `LDA addr`, `STA addr` |
  | Arithmetic | `ADD addr`, `SUB addr`, `ADDI n`, `SUBI n`, `CMPI n`, **`CMP addr`** (flags only), **`ADC addr`**, **`SBC addr`** (with carry) |
  | Logic | **`AND addr`**, **`OR addr`**, **`XOR addr`**, **`ANDI n`**, **`ORI n`**, **`XORI n`** |
  | Shifts | `SHL`, `SHR` (unchanged: they do not touch the flags) |
  | Jumps | `JMP t`, `JZ t`, `JNC t`, **`JNZ t`**, **`JC t`** |
  | I/O | **`OUT port`**, **`IN port`** |
  | Control | `HALT`, **`NOP`** |
  | Assembler aliases (no hardware) | `INC` = `ADDI 1`, `DEC` = `SUBI 1`, `CLR` = `LDI 0`, `NOT` = `XORI 255` |

  Logic instructions set the zero flag from the result and clear the carry. `ADC` adds the carry flag; `SBC` subtracts
  the borrow (the flag already means "borrowed" after a subtraction).
- **Left for later** (each is a bigger hardware change): `CALL`/`RET`, a sign flag with `JN`/`JP`, rotates and shifts that
  set the carry, indirect addressing. The extension groups have room for them (5 free EXT-M slots, 13 free EXT-I).
- **Flexible by design**: the instruction table in `isa.ts` describes each instruction as data (`group`, `sub-opcode`,
  `operand kind`), and the assembler, disassembler, listing and reference page are all generated from it. A new
  instruction is one table row plus one control-ROM row.
- `OUT port`: send the accumulator to a port. `IN port`: load the accumulator from a port (0 if nothing is there).
  Neither touches RAM, so **all 16 RAM words stay free**, and a computer without the device ignores `OUT` and reads 0
  from `IN`.
- One `Isa` entry (`id: 'skasm'`), no `SK8`/`SK82`. The ROM's *Contents are* offers *Hex words* and *A program in SKASM*.
- **Loading old files**: a ROM saved with `isa: 'sk8'` or `'sk82'` loads as `skasm` (a small legacy map in
  `deserialize`); words and source are untouched, so old programs still assemble to the same words.
- **Known limits**: (1) a circuit saved with the *old* computer-1 hardware (3-bit opcode) keeps that hardware, so a
  program with `JZ`, `ADDI`, `OUT`… would run wrongly on it; rebuilding from the example fixes it. (2) Old programs that
  talked to devices with `STA 14`/`STA 15` must be rewritten to `OUT`/`IN` (the shipped examples are).

## Ports (the same on every computer)
Predefined names in the assembler; they can't be redefined (an error says so).

| Name | Port | Instruction | Device |
|---|---|---|---|
| `NUMBER` | 0 | `OUT` | the decimal display (the accumulator, shown in decimal) |
| `CHAR` | 1 | `OUT` | the text console (the accumulator as an ASCII character) |
| `PIXEL_ON` | 2 | `OUT` | screen: light the pixel at x = low nibble, y = high nibble of the accumulator |
| `PIXEL_OFF` | 3 | `OUT` | screen: darken that pixel |
| `SPEAKER` | 4 | `OUT` | flip the speaker |
| `KEY` | 5 | `IN` | keypad: key in bits 0–3, bit 4 set while a press waits |
| `KEY_ACK` | 5 | `OUT` | tell the keypad the key was read |

Ports 6–15 are free for future devices. (To verify in S2: whether reading `KEY` can acknowledge by itself, which would
remove `KEY_ACK`; the keypad's sticky latch decides. The table keeps `KEY_ACK` until then.)

## Computer 1 becomes the shared computer
- `computer2Builder` is renamed `computerBuilder` and gains a `number` device: the output registers feeding the decimal
  display (the part of the old builder that is genuinely different). `console`, `lcd`, `speaker`, `keypad` remain. Any
  combination can coexist now (no more "the LCD and the speaker can't both exist").
- Hardware, all inside the one builder:
  - **Control ROM** addressed by 8 bits (256 words): the opcode plus a *sub-opcode* that is taken from bits 0–3 for opcode
    14, from bits 12–15 for opcode 15, and is 0 otherwise (about a dozen gates).
  - **Logic unit**: per bit an AND, an OR and an XOR of the accumulator and the second operand (the existing RAM-or-constant
    mux), chosen by two control bits; a mux per bit picks adder or logic result. The zero flag is read from that result.
  - **Carry in**: `ADC`/`SBC` take the carry flag into the adder's carry-in (a few gates around the existing subtract line).
  - **Jumps**: `JNZ` and `JC` are two more gates beside `JZ` and `JNC`.
  - **I/O**: a control bit "port write" (for `OUT`), an accumulator source "port input" (for `IN`), and the port number
    decoded from the address field. The old RAM-address decoding for 13–15 goes away; RAM is plain.
- The example `/computer` is the shared builder with `devices: ['number']`, the Fibonacci program, the probes (CLK,
  PC, ACC, Carry as grouped rows) and the teaching notes and frames. The old builder, its hand-placed layout
  (`COMPUTER_LAYOUT`, ~300 lines) and the 3-bit control ROM go away. One control ROM, one set of tests.
- Consequence: the first example is now the full machine (more parts than the 8-instruction one). Routing took about
  1 s for the second computer vs 2.2 s for the old first one, so it should open faster.

## Steps
### S1. The language (no hardware change): done
- `src/engine/isa.ts`: merge into one `SKASM`; make the table data-driven (groups and sub-opcodes); add the new
  instructions and the aliases; port operand kind (0–15) and predefined port names (with an error if redefined); the
  legacy id mapping; a one-line description per instruction.
- A **reference interpreter** (`src/engine/skasm-ref.ts`): runs SKASM words in plain TypeScript (registers, flags, RAM,
  ports). It defines what each instruction must do, and the hardware is tested against it in S2.
- ROM inspector: choose *Hex words* or *SKASM*; the listing and disassembler unchanged.
- A short **language reference** reachable from the ROM inspector, generated from the table (instruction, operand,
  effect, flags, number forms, labels, port names).
- Tests: every instruction round-trips through assemble and disassemble; encodings of the old instructions are
  byte-identical to before; no two instructions share an encoding; old ids load; port names resolve and cannot be
  redefined; aliases expand; the existing example programs (which still use `STA` for devices at this point) assemble to
  the same words as before.

### S2. The new instructions and ports in the hardware, and the programs: done (see also the beginner computer below)
- Control ROM, sub-opcode gating, logic unit, carry-in, `JNZ`/`JC`, `OUT`/`IN`; wire the five devices to their ports;
  remove the RAM-address device decoding. Several devices can coexist.
- Rewrite the programs (ball, siren, calculator, error console) with `OUT`/`IN` and the port names; use the new
  instructions where they simplify a program (for example `ANDI 15`, `JNZ` loops), and let the freed RAM words be used.
- **Tests, hardware against the interpreter**: for every instruction, run it on the circuit for a set of operand values
  (including all carry/zero combinations) and compare accumulator, flags, RAM, PC and port writes with the reference
  interpreter; then random programs of 20 instructions, compared step by step. Plus: each device reached at its port and
  only there; `OUT` to a missing device does nothing; `IN` from a missing one reads 0; `OUT`/`IN` never touch RAM; the
  existing program behaviour tests (ball reaches all four edges, siren gaps, calculator sums) pass unchanged in outcome.

### S2b. The beginner computer: done
- `src/model/beginner.ts`, example `/beginner`: a 4-bit machine with seven SKASM instructions (LDI, LDA, STA, ADD, SUB, JMP, HALT)
  and the same encodings as every computer. Few parts, each named, in three framed stages (fetch, decode, execute) with a note
  for each; control signals travel by name. Tested against the reference interpreter with numbers masked to 4 bits.

### S3. Fold computer 1 into the shared builder: done
- Add the `number` device; rebuild `/computer` on `computerBuilder`; delete the old builder, layout, control ROM and
  their tests; move the computer-specific tests (Fibonacci, reset, breakpoint at HALT, step back, decimal output) to the
  shared one. Fibonacci now ends with `OUT NUMBER`.
- e2e tests that use `/computer` (program editor, Back, breakpoints, waveform groups) are updated to the new part keys.
- **Portability test**: the same Fibonacci program runs on every computer configuration (number, console) and gives
  the same numbers.

## Not doing
Pseudo-instructions or macros, a second back-end for other word widths (a 4-bit or 16-bit computer would be its own
ISA in the same assembler, as it is already table-driven), and warnings that depend on what is wired to the ROM.

## Risks
- Rebuilding `/computer` touches many tests and the e2e flows; the order (S2 before S3) keeps each step small.
- The accumulator-source mux grows by two inputs (port input, logic result; there are 5 sources now, so 7 fit in the
  existing 8:1 mux). The control word gets wider: more control bits, still one ROM.
- A bigger first example: the logic unit is about 40 more gates. The 256-word control ROM is a single part.
- Keeping `isa` ids in saved files stable: only the mapping to `skasm` is added; hex words and sources never change.

## Verification
Per step, the `CLAUDE.md` checklist (`npm test`, `npm run lint`, `npm run build`, `npm run e2e`, reading the whole summary
line), plus a visual check of the rebuilt `/computer` and the language reference (light/dark, phone).
