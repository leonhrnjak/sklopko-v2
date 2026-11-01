# Doom on the 6502: where we stand (assessment)

> **Status: assessment, not a spec.** Nothing here is built. If Leon wants it, the next step is a spec with milestones (the project
> process), approved before any code. Written 2026-11-01, after the Rust/WebAssembly engine (E1 to E7) merged.
>
> **Short answer.** The real Doom cannot run on a 6502, and no port of it exists. A *Doom-like* (a raycaster with enemies, doors and
> sprites, in the style of the VIC-20 and C64 demakes) can. The CPU is not what is missing: the `cpu6502` part already runs at the real
> 1 MHz in the browser. What is missing is **a screen** (ours is 16×16), **room for the program** (16 KB ROM, no bank switching, no
> second device on the big board) and **a way to load a big program**. The recommended path is to write our own small engine on top of
> those, after a measuring spike. Estimated 8 to 15 frames a second on the `cpu6502` board, 2 to 4 on the circuit-built 6502. These
> frame rates are my estimates, not measurements; milestone D0 exists to replace them.

## What we have today (checked in the repo)

| Area | Today | Where |
|---|---|---|
| CPU speed | `cpu6502` part: full 1 MHz in the browser (BASIC board, 753 kHz before the Rust engine). Circuit-built 6502: about 250 kHz, so 4 times slower than real | `docs/architecture-simulator.md`, speed table |
| CPU model | MOS 6502 and WDC 65C02, cycle exact, all 151 documented opcodes plus the 65C02's (BRA, STZ, PHX/PHY, RMB/SMB, BBR/BBS, WAI, STP). Undocumented NMOS opcodes act as NOPs | `docs/plan-cpu6502.md` |
| RAM | up to 2^15 = 32 KB per RAM part; the big board uses 16 KB at `$0000` | `sequential.ts`, `board6502.ts` |
| ROM | up to 16 KB (`abits` 14), held as hex text with a character cap; the big board maps it at `$8000` and `$C000` | `combinational.ts`, `board6502.ts` |
| Bank switching | **none** (no mapper, no bank register) | grep of `src` and `docs` |
| Display | `Pixel screen 16×16`, 1 or 4 colours, set one pixel at a time (two register writes: `XY` then `PLOT`). Also a 16×2 HD44780 LCD, an 8×8 dot matrix, a text console and the 6551 terminal | `devices.ts`, `lcd.ts`, `terminal.ts` |
| Input | Gamepad part (up, down, left, right, A, B; keyboard keys or touch), keypad, and the terminal's keyboard. The gamepad exists only on the small board | `devices.ts`, `programs6502.ts` |
| Timing | Clocks to 1 MHz; a 6522 VIA with timers and interrupts; IRQ and NMI at the CPU | `via.ts`, `plan-via-lcd.md` |
| Devices per board | On the big board, the terminal, the VIA and the LCD can only be combined with each other. The pixel screen and the gamepad need the small board (2 KB RAM, 4 KB ROM) | `board6502.ts` line 125 |
| Assembler | `asm6502` (6502 and 65C02), listings, labels. No C compiler | `plan-cpu6502.md` R4 |
| Prior art in the repo | A raycaster on our own 8-bit computer (`raycaster.ts`): 6,300 instructions a picture on a 16×16 screen, written as a spike and then shipped as an example. Its conclusion was that the simulator, not the machine, was the limit; that limit has since moved by more than 100 times | `docs/plan-raycaster.md` |

## What "Doom" can mean

1. **The real Doom** needs a 32-bit CPU, a few megabytes of RAM and tens of millions of instructions a second. On a 6502 it is out of
   reach by three orders of magnitude, even with a software emulator of a bigger CPU inside the 6502. Not a goal.
2. **A Doom-like**: textured or flat-shaded walls by raycasting, doors, a few enemy types drawn as scaled sprites, a gun, a map of a
   few rooms. This is what 8-bit machines actually run, and what this document is about.

## Candidates, ranked for our simulator

The projects below are real; what I could read about them is thin (I read their repository or news pages, not their source), so
details marked "unchecked" need a look before any of them is relied on.

| # | Option | What it is | Fit for us | Licence | Verdict |
|---|---|---|---|---|---|
| 1 | **Our own raycaster** in 6502 assembly ("Sklopko Doom-like"), built on the existing raycaster's ideas (grid map, DDA, tables) | Written for our board, our screen and our assembler | Best: we choose the resolution, memory and the display, and can keep it small and testable against a TypeScript reference, as the BASIC ROM and the raycaster were | Ours, MIT | **Recommended** |
| 2 | **[VIC Doom](https://github.com/Kweepa/vicdoom)** (Kweepa) | A Doom-like for the fully expanded VIC-20: C (cc65) and 6502 assembly, angled textured walls, enemies. The repo has `.c`, `.h`, `.s` files | The closest thing to "Doom on a 6502". Its display layer is the VIC chip's (unchecked) and it needs cc65, which we do not have | Not stated on the page I read | **Reference only** until the author is asked for a licence; port its ideas, not its files |
| 3 | **[Wolf64](https://www.indieretronews.com/2026/08/wolf64-wolfenstein-3d-comes-over-to-c64.html)** (Kweepa, itch.io) | Wolfenstein-style raycaster, pure 6502 assembly, textured walls and directional enemies, C64 | Pure assembly is good for our assembler; it is C64-specific (VIC-II bitmap) | "Free, strictly non-commercial": **cannot go into an MIT repo** | Reference only |
| 4 | **Text-mode raycasters** for the PET and C64 ([setsideb article](https://setsideb.com/?p=10521)): about 12 to 15 fps by the author's estimate, drawing with character graphics | Cheapest possible picture | Shows the CPU can do it; no source mentioned | unknown | Interesting for the lower bound only |
| 5 | **Real Doom through an emulated bigger CPU** (65816 or RISC-V inside a 6502) | Joke-grade | Hours per frame | n/a | Rejected |

A port of an existing project is a poor fit anyway: all of them assume a particular video chip, and ours would be a new one. The
licensing matters too, because the repo is going public under MIT. So the recommendation is to write the engine ourselves and use the
projects above as published techniques (column drawing, sprite scaling, tables) to compare against.

## What the engine needs

These are my estimates for a Wolfenstein-class engine with Doom-like extras, sized for our display; D0 turns them into numbers.

| Need | Estimate | Notes |
|---|---|---|
| Screen | 80 to 160 columns by 50 to 100 rows, 16 colours (4 bits a pixel: 4 to 8 KB) | 16×16 gives a picture you can read but not enemies. 160×100 is the C64's multicolour mode |
| Program ROM | 12 to 24 KB code and tables (sine, reciprocal, wall-height, sprite scale) | Wall textures add 2 to 8 KB if wanted. Flat shading by distance and side needs none |
| RAM | 4 to 8 KB: map, enemy state, zero-page temporaries, stack; plus the framebuffer if it is not separate | |
| Per frame | Rays: 80 columns at about 200 to 400 cycles (DDA through a 16×16 map, table lookups) = 16,000 to 32,000. Walls drawn: about 50 rows at 8 to 9 cycles a pixel through a plain STA loop, or about 30 cycles a column with a column-fill command. Sprites: 5,000 to 15,000 | **About 40,000 to 100,000 cycles a frame** with per-pixel writes, 25,000 to 50,000 with a column fill |
| Multiply and divide | Quarter-square tables (two 512-byte tables, about 25 cycles a multiply) or a small hardware multiplier | The 6502 has neither instruction; a shift-and-add multiply costs 100 to 200 cycles |
| Input | Turn left and right, forward and back, strafe, fire, use (6 to 8 buttons) | The gamepad part has 6 |
| Timing | A frame interrupt or a VIA timer, to pace the game and the animation | Exists |

## Expected frame rate in our simulator

Cycles a frame divided by cycles a second (the browser runs the `cpu6502` board at 1 MHz; the circuit-built 6502 at about 250 kHz):

| Variant | Cycles a frame | `cpu6502` board, 1 MHz | Circuit-built 6502, 250 kHz |
|---|---|---|---|
| Per-pixel writes, 80 columns | 40,000 to 100,000 | 10 to 25 fps | 2.5 to 6 fps |
| Column-fill command, 80 columns | 25,000 to 50,000 | 20 to 40 fps | 5 to 10 fps |
| Same, with enemies and sprites on screen | add 10,000 to 30,000 | 8 to 15 fps | 2 to 4 fps |

Two cautions. These are *simulated* frames a second: the page must keep up (it does for the `cpu6502` board in the measured
headless browser; a phone may not), and a slower page simply runs the game in slow motion without breaking it. And drawing the
screen is the page's job, not the engine's: the framebuffer must be drawn from a canvas in one pass, not as one SVG node a pixel.

## Gaps in the simulator

In order of how much each blocks the game.

1. **The screen (blocking).** The only pixel screen is 16×16 and takes two writes a pixel. Needed: a framebuffer part, 4 bits a pixel,
   at least 80×50 and preferably 160×100. **Do not map it into the 6502's address space** (it would eat 4 to 8 KB of 64 KB): use a
   video-chip-style port (an address register that counts up on every access, and a data register), as the Commander X16's VERA and
   the TMS9918 do. Optional but valuable: a **column-fill command** (x, top, bottom, colour), which halves the frame time and is
   what makes a 4 times slower circuit-built CPU workable. The part's memory lives in the Rust module's `Shared` bag (the way ROM and
   RAM do) and the page reads it for the canvas.
2. **Program size (blocking for the full game, not for a spike).** ROM is capped at 16 KB and held as hex text with a character cap
   (the BASIC work raised it once). A game of 24 KB or more needs either a **bank register** (a write-only register at, say, `$6000`
   that picks which 16 KB of a larger ROM is seen in the window at `$8000`) or a flat 32 KB ROM with the device block squeezed. The
   bank register is two gates and a latch, in the spirit of the other boards, and teaches something; a mapper chip would be a black
   box. A big program also cannot be typed in: it must load from a file (the BASIC computer ships the ROM as built data).
3. **One device per big board.** The pixel screen, gamepad, VIA and terminal cannot share the big board today (`board6502.ts`, the
   check at line 125). The game board needs: 32 KB RAM, 32 to 64 KB banked ROM, the video port, a gamepad register, a VIA for the
   frame timer. This is a decode change in the board builder, not a new part.
4. **Gamepad on the big board** (small): a register at a fixed address, or the gamepad wired to a VIA port, which is closer to a real build.
5. **Multiply** (small, a choice): tables in ROM (authentic, costs 1 KB) or a memory-mapped hardware multiplier part (a black box, but
   a common one: the NES and the X16 have them). I would start with tables and measure.
6. **The assembler** (small): `asm6502` has labels, `.org`, `.byte`, `.word`; a big engine wants macros, `.include`, and table
   generation from a script. Tables can be built by a TypeScript script at build time, as `scripts/basic/` does for BASIC, so this is
   not blocking.
7. **Step-back history** must be off for this board (the BASIC board already has the switch); a framebuffer of 8 KB per snapshot at
   1 MHz would be too much otherwise. With history off it costs nothing.
8. **65C02 opcodes, cycle accuracy, interrupts**: no gap; they are done and tested.

## Recommended path

Per the project process, this is a proposal; each step beyond D0 starts only with an approved spec.

| Milestone | Done when | Changes the sim? |
|---|---|---|
| **D0 Spike** | A raycaster in 6502 assembly, on the bare core (as BASIC's B1 did), draws a frame into a byte array; a TypeScript reference raycaster gives the identical picture; cycles a frame measured for 3 column counts, with per-pixel writes and with a column fill. Gate: if it is over 120,000 cycles a frame, stop and rethink | No (tests and a doc only) |
| **D1 Video** | A framebuffer part with an auto-increment port, 16 colours, at least 80×50 (size fixed by D0), drawn on a canvas; Rust behaviour, `KIND` entry, `CASES` entry; an example that draws a pattern | Yes: Rust part, TypeScript definition |
| **D1b Column fill** (only if D0 says it pays) | A command register; same picture, measured fewer cycles | Yes, small |
| **D2 Memory** | A bank register and a ROM of at least 32 KB, a file-loaded ROM, the game board builder with video, gamepad and VIA together on 32 KB RAM | Yes: board builder, ROM loading |
| **D3 Engine** | The raycaster runs on the board in the browser: walls, doors, movement, collision, shading; matches the reference picture | No (program) |
| **D4 Game** | Enemies and sprites, a gun, a level; an example `6502-doomlike`, a short reference page, README line | No (program) |
| **D5 Circuit-built variant** (optional) | The same ROM on the 6502 built from parts, at whatever speed it reaches | Possibly: video port on that board |

One PR per milestone, stacked, with the version bump (minor) in the first PR of the feature, as `CLAUDE.md` says. The first PR after
approval would be D0, which needs no engine change and answers the one unknown that matters, the cycles a frame.

## Risks

- **The estimates may be off by 2 times either way**; D0 exists for that, and its gate stops the project before any part is built.
- **The 16 KB ROM cap and the "one device" rule** touch the board builder that BASIC, the VIA and the LCD examples use; the change must keep every saved circuit and example working.
- **The page's drawing speed** for a 160×100 canvas, 30 times a second, in a worker design (snapshots cross a message boundary): measure in D1 before D3 depends on it.
- **Licences**: no code from Wolf64 or VIC Doom goes in without the authors' written licence. Doom's own assets and name are not used; the game gets its own name and art.
- **Scope**: a game is an open-ended thing; the spec should fix the level count (one) and the enemy types (two) so the milestone has an end.
