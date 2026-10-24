# A real CPU part: the MOS 6502 (plan)

> **Status: in progress.** Read `CLAUDE.md` first (feature branch → PR → CI → merge; scoped tests; a PR does not bump the version).
> One PR per milestone, each stacked on the one before it (`r1-6502-core`, `r2-big-memory`, `r3-6502-part`…); tick each box when
> its PR merges and add a short *What it did, and where it differs from the plan* note under it.
>
> - [x] R1 The 6502 core: an opcode table and a cycle-exact model, no UI
> - [ ] R2 Memory that is big enough, and cheap to snapshot
> - [ ] R3 The part: a 40-pin 6502 on the canvas, and a first board
> - [ ] R4 6502 assembly: assembler, disassembler, reference page
> - [ ] R5 The board with devices, and 6502 example programs
> - [ ] R6 Polish: 65C02, interrupts, timing-view presets

## Why
Every computer so far is *invented*: SKASM is ours, and its 16-bit words exist in no chip. This adds a part you could buy: place
it, wire an address bus, a data bus, RAM and ROM around it as on a breadboard, and run code written for the real chip.

**Decision: the 6502 part runs 6502 machine code and 6502 assembly, nothing else.** SKASM stays exactly as it is on our own
computers (the gate-built ones teach how a CPU is made from gates, and a 6502 cannot be rebuilt from those parts). There is no
SKASM-to-6502 compiler, and the "one assembly language for every computer" promise of `docs/plan-skasm.md` is about the
computers built from gates. If it is ever wanted, a compiler can be added later without touching the part.

## Which chip: the 6502
- **Small and regular**: 56 mnemonics, 151 documented opcodes, **one bus access per clock cycle** (so a cycle-exact model is cheap,
  and the address and data buses do something visible on every clock).
- **Real and buildable**: Apple I/II, C64, NES (2A03), Atari. The WDC W65C02S is still made and is what breadboard builders use
  (Ben Eater's 6502 computer), so its memory map and pins are familiar to many.
- **Testable**: SingleStepTests/65x02 has about 10,000 per-opcode cases with the cycle-by-cycle bus trace, and Klaus Dormann's
  functional test is the standard whole-chip check.
- Rejected: **Z80/8080** (prefix opcodes, 16-bit pairs, many undocumented behaviours: a much larger core for the same lesson),
  **4004** (4-bit, multiplexed bus, needs its support chips), **RV32I** (the base for the separate "can it run Doom" idea in
  `plan-raycaster.md`), **a gate- or transistor-level 6502** (Visual6502 has 3,510 transistors with pass-gate logic this engine can't
  express, and a gate-built copy would be unreadable).

## The part: behavioural, bus-accurate
A `cpu6502` part whose logic is plain TypeScript (like the console and the framebuffer), not a mesh of gates. What is exact is what
you can see from outside: the pins, and what is on them in every clock cycle.

- **Pins** as on the 40-pin package (real pin numbers in the symbol): `A0–A15` out, `D0–D7`, `RWB` out, `PHI2` in, `RESB`, `IRQB`,
  `NMIB`, `RDY` in, `SYNC` out. (`SO`, `PHI1O`, `PHI2O` are left out; the 65C02's `VPB`, `MLB`, `BE` come in R6.) Bus mode (`groups`)
  shows `A` and `D` as 16- and 8-bit bus pins.
- **Data bus.** The engine has no bidirectional pins, so `D0–D7` are outputs that go **Z while the CPU reads**, and `DI0–DI7` are
  inputs; on a shared bus the user joins them with the existing *Bus junction*. A `Tri-state data bus` parameter, **off by default**,
  makes `D` drive always, so a beginner can wire RAM straight to the CPU without a junction.
- **Timing.** The CPU puts a cycle's address and `RWB` on the pins right after `PHI2` falls, and reads the data (or has it written)
  by the *next* falling edge; memory parts that capture on the rising edge (our RAM does) see stable address and data. One clock =
  one cycle = one bus access, including the dummy reads and writes the real chip does. `SYNC` is high during opcode fetch. `RDY` low
  stalls on a read cycle. `RESB` low for two cycles then high runs the 7-cycle reset sequence and loads the vector at `$FFFC`.
- **Inside**: the part's inspector shows `A X Y SP PC P`, the instruction now executing and the cycle within it, with *Step one cycle
  / Step one instruction* (run to the next `SYNC`) and a breakpoint on a PC value.
- **Not modelled**: analog timing, the two-phase clock's non-overlap, bus contention, undocumented opcodes (they act as 2-cycle
  `NOP`s, shown as `?`). The NMOS `JMP ($xxFF)` bug is kept (it is documented and real) until the 65C02 variant fixes it.
- **Speed.** A gate-built computer simulates about 4,000–6,000 clock edges per real second (measured with `bench.test.ts`: the
  raycaster does 1,000 ms of simulated time at 1 kHz in 240 ms). One behavioural part plus a RAM, a ROM and a decoder should be much
  faster per edge; R3 measures it and writes the number in its note.

## Memory map of the first board
After Ben Eater's, so builders of the real thing recognise it: `$0000–$07FF` RAM (zero page and stack inside), `$4000–$400F`
devices, `$F000–$FFFF` ROM (4 KB, vectors at the top). A tiny address decoder (existing parts) selects them.

## Steps
### R1. The core (`src/engine/opcodes6502.ts`, `src/engine/cpu6502.ts`; no UI)
- **One table is the source of truth**: for each documented opcode its mnemonic, addressing mode, byte length, base cycles,
  page-cross penalty and kind. The core, the assembler, the disassembler and the reference page are all generated from it (as
  `isa.ts` does for SKASM).
- The core is a state `{ a, x, y, sp, pc, p, … }` and `cycle(bus)`: one clock, given the byte the memory returned, saying what to put
  on the bus next (`{ addr, rw, data }`). Reset, IRQ, NMI, BRK/RTI, decimal mode, read-modify-write double writes, indexed
  page-crossing dummy reads, branch timing. No DOM and no simulator, so it runs in tests.
- **Tests**: table checks (no two opcodes share an encoding, 151 documented opcodes, lengths and cycles by mode), hand-written
  instruction tests with cycle-by-cycle bus traces, and a vendored sample of SingleStepTests if its size and licence allow
  (otherwise an opt-in run), plus Dormann's functional test as an opt-in run.

**What R1 did, and where it differs from the plan.** `src/engine/opcodes6502.ts` (the 151 documented opcodes as data, plus a
disassembler) and `src/engine/cpu6502.ts` (the core). Each opcode is a short list of steps, one per clock, each saying what is on the
bus and what happens when the cycle ends; indexed reads skip a step when no page is crossed. The pins are `addr`, `read`, `out` and
`sync`, and the reset/IRQ/NMI/BRK sequences are 7 cycles each. Checked by a vendored sample of SingleStepTests (20 cases of each of
the 151 opcodes, 3,020 cases, address/value/read-or-write on every cycle, `src/engine/testdata/`: all pass) and, opt-in,
Dormann's functional test (`VITE_DORMANN=…`, passes after 96,241,367 cycles in about 3 s, so the core runs at roughly 30 million
cycles per second on its own). Differences: P keeps bit 5 set and bit 4 clear (B exists only in pushed copies); interrupt lines
are looked at when the next fetch is set up, not in the last cycle of an instruction. Not yet done from the list: a pin-level
`RDY` (it belongs to the part, R3).

### R2. Memory that is big enough
- The RAM part stops at 256 words and the ROM's hex text at 1,400 characters. Needed: RAM to 2 KB (`abits` 9–11), an 8-bit ROM to
  4 KB, and the memory inspector paging through them.
- **Snapshots.** Stepping back copies every part's state each clock edge (`cloneState`), and it walks objects key by key, so a 2 KB
  array would be copied a hundred thousand times a second. RAM state becomes a `Uint8Array` (a `slice()` is a memory copy) and
  `cloneState` learns typed arrays. Measure before and after with `bench.test.ts`.
- Saved files and share links grow with the ROM, so `data` is stored without trailing zero bytes.

### R3. The part, and a first board
- Layout with a 40-pin symbol, bus-mode groups, the parameter above, the register panel and stepping.
- A board example `/6502`: clock, reset button, CPU, RAM, ROM, an address decoder, LEDs on a latch, a hand-assembled blink program
  as hex, with notes (what the address bus is doing, what `SYNC` means).
- **Tests**: the part in a circuit against the core, cycle for cycle; `RDY` stall; reset sequence; tri-state read/write with a bus
  junction; a program that fills RAM. Measure clock edges per second.

### R4. 6502 assembly
- `src/engine/asm6502.ts`, sharing the number, label, constant and error handling of the SKASM assembler (pull the lexer out of
  `assemble` rather than copying it). Real syntax: `LDA #$01`, `LDA $10,X`, `LDA ($20),Y`, `JMP ($FFFC)`, `<label`/`>label`, `.org`,
  `*=`, `.byte`, `.word`, `.res`. Errors: branch out of range, wrong addressing mode for the mnemonic, value too big.
- Variable-length instructions break the one-word-per-address assumption of `assemble`/`lineOf`: a byte ROM gets its own listing
  in the ROM inspector (address, bytes, disassembly, source line); the ROM's *Contents are* offers *A program in 6502 assembly*.
- A 6502 language reference page generated from the table (mnemonic, modes, bytes, cycles, flags), like `SkasmReference`.

### R5. The board with devices, and examples
- The console, LCD, speaker, keypad and gamepad sit at memory-mapped addresses behind the decoder. Examples in 6502 assembly: counter
  on the LEDs, "Hello" on the console, a keypad echo, a bouncing ball.

### R6. Polish
- The **65C02** variant (W65C02S): `BRA`, `STZ`, `PHX/PHY/PLX/PLY`, `INC A`, `DEC A`, `(zp)`, `TSB/TRB`, `BIT #`, fixed `JMP ($xxFF)`,
  decimal-mode flags, `VPB`/`MLB`/`BE` pins. SingleStepTests has a `wdc65c02` set.
- An interrupt example (NMI from a timer), timing-view presets (`PHI2`, `A`, `D`, `RWB`, `SYNC`), a challenge or two.

## Open choices (my pick in bold)
1. **NMOS first, 65C02 in R6.** The table carries both, so the order can swap.
2. **Behavioural part with a peek-inside panel**, not gates.
3. **Pins: `D` out plus `DI` in, joined with the existing bus junction**, rather than a bidirectional pin type in the engine
   (which touches the compiler, router and every symbol).

## Not doing
SKASM on the 6502; undocumented opcodes and exact analog timing; other CPUs (the core's `cycle(bus)` shape would take a Z80 or an
RV32 core later); a C compiler; the `SO` pin; a cartridge or disk model.

## Risks
- **Snapshots of bigger memories** (R2) could slow every circuit if `cloneState` is changed carelessly; benchmark first.
- **Test data**: size and licence of the vendored vectors, and whether anything can be downloaded. Fall back to an opt-in run.
- The ROM inspector and `lineOf` assume fixed-width words; R4 touches both. Keep the SKASM path untouched and tested.

## Verification
Per step, the `CLAUDE.md` checklist (`npm test`, `npm run lint`, `npm run build`, the e2e specs for the area), plus screenshots in
every PR (the board at desktop and phone width, the register panel, the listing with its bytes) and a visual check in light and dark.
