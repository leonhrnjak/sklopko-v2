# Toward a 3D raycaster: plan

> **Status:** done. Each sub-milestone is one PR from its own feature branch per `CLAUDE.md` (version bump, scoped tests, CI).
> Tick each box when it ships.
>
> - [x] M1a Index register and a 256-byte RAM
> - [x] M1b Subroutines: CALL and RET
> - [x] M1c Table ROM: constants in the program (`.byte`, `LDT`)
> - [x] M1d A readable screen
> - [x] M1e The spike: a raycaster on the reference interpreter, to size M2
> - [x] M2 Shades of grey for the LCD
> - [x] M3 The raycaster example

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

### M1e The spike (done)
The raycaster was written as an SKASM program (`src/model/raycaster.ts`) and run on the reference interpreter, 16 columns on the
existing 16×16 screen: an 8×8 map, tables of 64 angles and wall heights in the table ROM, a ray marched in half-cell steps,
`CALL probe` shared by the rays and the walking code. Its picture is tested against an independent TypeScript raycaster. Results:
- **144 words** of the 256 program words, and 213 of the 256 table bytes. Nothing needs a wider program counter.
- **About 6,300 instructions a picture.** When this was measured the app did at most about two thousand instructions a second
  (a cap of 64 clock edges per animation frame, and a simulator that evaluated every part at every gate delay). Both were
  improved afterwards (a time budget per frame and event-driven evaluation, about three times faster), and clocks of 2 and 4 kHz
  were added, so a picture now takes a second or two: fine for a program that waits for a button, not for animation.
- **No multiplier is needed.** Distance is a step count and the wall height is a table lookup.
- A bigger screen would not help: 32 columns would double the rays and need a 128-angle table, and the picture would take
  half a minute. The limit is the simulator, not the machine.

## M2: shades of grey for the LCD (fixed after the spike)
The spike shows the 16×16 screen is enough, but a wall of one brightness looks flat. The screen part already has a four-colour
mode, so:
- The computer's LCD becomes four shades. A new port `OUT PIXEL_COLOR` (port 8) sets the shade (0–3) that `PIXEL_ON` paints;
  `PIXEL_OFF` still paints 0. The register starts at 1 (so every program that exists keeps drawing white on black).
- `IN PIXEL` returns the shade (0–3), and `PIXEL_AT` works as before.
- Not planned any more: a bigger screen, a hardware multiplier, a 12-bit program counter, a 16-bit ISA (see the spike).

## M3 The raycaster example
- `computer-raycaster`: the program of the spike, with the gamepad turning and walking, plus shades by distance (and by which
  side of the wall was hit) from M2. It waits for a button, draws, and waits again.
- Tested against the reference interpreter (frame equal to the reference at several positions and angles) and on the circuit
  for one frame.

## Risks
- **Simulation speed.** One picture is about 6,300 instructions and the circuit runs about two thousand a second at best. The example sets a fast clock and says plainly that it draws a frame in seconds on the circuit and faster on the
  reference interpreter (the app could run the interpreter for a "turbo" mode; not planned).
- **The control ROM has 16 control bits and they are nearly all used.** M1a to M1d need roughly ten more signals. The control
  ROM words may need a third ROM (it is a build-time table, so this costs parts on the canvas but no new mechanism).
- **Layout.** The computer's canvas is already large; every new block should join the existing column layout in
  `computer2.ts` rather than start a new one.
