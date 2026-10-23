# Toward a 3D raycaster: plan

> **Status:** planned. Each sub-milestone is one PR from its own feature branch per `CLAUDE.md` (version bump, scoped tests, CI).
> Tick each box when it ships.
>
> - [x] M1a Index register and a 256-byte RAM
> - [x] M1b Subroutines: CALL and RET
> - [x] M1c Table ROM: constants in the program (`.byte`, `LDT`)
> - [x] M1d A readable screen
> - [ ] M1e The spike: a raycaster on the reference interpreter, to size M2
> - [ ] M2 (decided after the spike, see below)
> - [ ] M3 The raycaster example

## Where this is going
The long-term joke is "can it run Doom". It cannot, honestly: Doom needs a 32-bit CPU, megabytes of RAM and tens of millions of
instructions per second, and the simulator evaluates gates in JavaScript. The road there goes through a *behavioural* CPU part
(an RV32 interpreter in a worker with a big RAM and a colour framebuffer), which is a project of its own and not planned here.
This plan covers the part that is fun and fits the educational machine: a Wolfenstein-style raycaster running on a computer built
from gates. Everything here keeps the rule "one assembly language for every computer" (`docs/plan-skasm.md`): new instructions
go into the SKASM table, the reference interpreter, the control ROM and the language reference together, and the existing
programs keep working unchanged.

## What a raycaster needs
For each screen column: a ray from the player at some angle, stepped through a grid map (DDA) until it hits a wall; the distance
gives the wall's height; a vertical bar of that height is drawn. That needs (1) a **map and tables** (map cells, sine/reciprocal
tables) that do not cost program words, (2) **indexed memory** (the map is read by a computed address), (3) **subroutines** (the
same step and draw code is used by every column), (4) **multiplication** by shift-and-add or a table, (5) a **screen with enough
columns** to look like something, (6) enough **program space**. Today the computer has 16 bytes of RAM addressed directly, no
subroutines, no way to read constants, a write-only 16×16 screen and 256 instruction words.

## M1: SKASM 1.1, a computer for real programs (8-bit, backwards compatible)
New instructions take unused slots: bit 0–3 sub-opcodes 3–15 of the immediate group (opcode 14, 13 free) and sub-opcodes 11–15
of the address group (opcode 15, 5 free). An instruction with no operand ignores the bits it does not use, so it fits either
group. Existing encodings never change.

### M1a Index register and a 256-byte RAM
- A new register **X** (8 bits). New instructions: `TAX` (X = ACC), `TXA` (ACC = X), `INX` and `DEX` (X ± 1, set Z), `LDX`
  (ACC = RAM[X]) and `STX` (RAM[X] = ACC). `LDXI n` loads X with a constant.
- The data RAM grows to 256 bytes. A direct address (4 bits) still reaches bytes 0–15, so no program changes meaning.
- Hardware: the RAM address is a mux of the instruction's 4-bit field (zero-extended) and X.
- Reference interpreter, control ROM, language reference (a new "Indexed" category), example program (fill and sum an array),
  tests of every instruction against the reference.

### M1b Subroutines
- `CALL t` pushes the address of the next instruction on a return stack; `RET` pops it and jumps. The stack is a small RAM
  (8 entries) with a stack-pointer counter, separate from the data RAM (so there is no pushing of data, only return addresses).
  Calling deeper than 8 wraps and is the programmer's problem; the language reference says so.
- `CALL` is a main-group jump, so it takes the same 8-bit target as `JMP`.
- Tests: nested calls, a recursion that fits, RET in the middle of a loop.

### M1c Table ROM
- The program ROM part gets an optional second output: a table of 256 bytes with its own address pins (`TA`) and data pins
  (`TD`), switched on by a `Table` parameter (off by default, so nothing old changes). `LDT` (ACC = TABLE[X]) reads it at X.
- The assembler learns `.byte 1, 2, 3` (numbers, names, negative numbers; up to 256 bytes). A label in front of `.byte` names a
  place in the table. The bytes are kept in the same ROM part as the program (`tdata`), so editing the program in the
  inspector updates both, and the inspector shows the table under the listing.
- This is how sine tables, maps and sprites get in without spending instructions.

### M1d A readable screen
- A new `OUT PIXEL_AT` port sets a read address (x in the low nibble, y in the high nibble, like `PIXEL_ON`); `IN PIXEL` gives
  0 or 1 for that pixel. The framebuffer part gets a read port.
- Enables collision tests ("is the pixel ahead lit?") without keeping a copy of the screen in RAM.

### M1e The spike
Before spending time on M2, write the raycaster as an SKASM program on the reference interpreter (not on the circuit), 16
columns on the existing 16×16 screen: the map in the table ROM, DDA stepping with subroutines. Measure instruction count and
words. The answer decides M2:
- **fits in 256 words**: M2 is only "a bigger screen" (see below).
- **does not**: M2 also widens the program counter to 12 bits (jump targets use bits 12–15 of the main-group word, which jumps do
  not use today; the extension-group jumps `JNZ` and `JC` stay 8-bit and get long forms or a note).

## M2: a screen worth looking at (scope fixed after the spike)
- The framebuffer part gets a size (16×16, 32×32, 64×64) and colour depth (2, 4 or 16 shades) instead of the fixed 16×16
  (`FB_SIZE` in `devices.ts`; the inspector and symbol follow). The computer builder passes the size, and `PIXEL_ON` and
  `PIXEL_OFF` take wider coordinates: a new `OUT PIXEL_X`, `OUT PIXEL_Y`, `OUT PIXEL_COLOR` trio (or one packed port) for screens
  larger than 16×16, because ACC is 8 bits and one byte cannot hold both coordinates of a 64×64 screen.
- If the spike says so: a hardware multiplier port (`OUT MUL_A`, `OUT MUL_B`, `IN MUL_LO`, `IN MUL_HI`) using the existing `mul`
  part, so distance times height is one instruction sequence, and the 12-bit program counter.
- Not planned: a 16-bit ISA. 16-bit arithmetic is already possible with `ADC`/`SBC` in software, and a second ISA means a second
  control ROM, a second builder and a second reference interpreter.

## M3 The raycaster example
- `computer-raycaster`: a map (a small maze) in the table ROM, the player's position and angle in RAM, the gamepad turns and
  walks, and the screen shows the view in front of the player, one column per ray. Shades by wall side and distance.
- Tested against the reference interpreter (frame equal to the reference at several positions and angles) and on the circuit
  for one frame.

## Risks
- **Simulation speed.** One frame of a raycaster is thousands of instructions; the circuit runs about a thousand per second at
  best. The example sets a fast clock and says plainly that it draws a frame in seconds on the circuit and faster on the
  reference interpreter (the app could run the interpreter for a "turbo" mode; not planned).
- **The control ROM has 16 control bits and they are nearly all used.** M1a to M1d need roughly ten more signals. The control
  ROM words may need a third ROM (it is a build-time table, so this costs parts on the canvas but no new mechanism).
- **Layout.** The computer's canvas is already large; every new block should join the existing column layout in
  `computer2.ts` rather than start a new one.
