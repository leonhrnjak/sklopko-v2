# A 6522 VIA and a character LCD (plan)

> **Status: V1 and V2 built, V3 not started.** Read `CLAUDE.md` first. Three PRs, stacked (`via-6522`, `lcd-hd44780`, `via-lcd-board`); V1 bumps the
> version to `0.3.0`. Tick each box when its PR merges and add a *What it did, and where it differs from the plan* note under it.
>
> - [x] V1 The 6522 VIA: ports, timers, interrupts, a board with it, and an example with its timer
> - [x] V2 The HD44780 character LCD (16 × 2): the part, its inspector and its tests
> - [ ] V3 The board with the terminal, the VIA and the LCD, Ben Eater's examples, and a BASIC variant

## Why
The BASIC computer is a 6502, RAM, ROM and one serial chip. Ben Eater's breadboard computer goes on to a 6522 VIA (the chip that gives a
6502 input and output pins and timers) and an LCD; with them a program can blink LEDs from a timer and write to a display, and BASIC can
`POKE` the LCD. The VIA is also the part that a real 6502 system has most often, so it teaches the most about how a CPU talks to the world.

## Memory map (Ben Eater's, with both chips)
`$0000–$3FFF` RAM, `$5000–$5003` the terminal, `$6000–$600F` the VIA, `$8000–$FFFF` ROM. The terminal answers when A15 = 0, A14 = 1, A13 = 0 and
the VIA when A15 = 0, A14 = 1, A13 = 1 (two gates; A13 is split off the address bus). Registers repeat through each chip's 8 KB.

## The VIA (V1)
- **Part** `via6522` (`engine/components/via.ts`) around a pure register model (`engine/via6522.ts`, tested on its own): sixteen registers, the two
  ports with their direction registers, **timer 1** (one-shot and free-running, PB7 output), **timer 2** (one-shot, and counting PB6 pulses), the flags
  and enables with `IRQB`, the handshake pins CA1, CA2, CB1, CB2 (edge flags, the independent modes, handshake and pulse outputs, port latching).
  **Not modelled:** the shift register (a byte of storage), the finer timing of handshake output, the analogue side.
- **Each port pin is two pins**, as the CPU's data bus is: `PAn` is what the chip drives (the output register's bit, or **Z** while the pin is an input) and
  `PAINn` what it reads. The outside is wired to the first, and, where something else drives the wire too (an LCD that is read), through a bus junction to the
  second. A port B output pin reads back its output register, port A reads the pins, as the real chip does.
- It acts at the rising edge of Φ2 like the terminal, a read keeps its value for D, not selected D is 0. The control inputs set their flags the moment they
  change (not at the clock). Timer 1 interrupts N + 1.5 cycles after the load, and free-running comes round every N + 2: **measured on the board**, PB7
  toggles every 1,024 cycles for a latch of 1,022.
- **Board:** `devices: ['via']` (with `viaLeds`: eight LEDs on port B); with `'terminal'` too the builder tells them apart by A13 and joins their interrupts.
  The example `6502-via`: timer 1 free-running interrupts the CPU once a second, the routine counts on port B, PB7 blinks by hardware.

## The LCD (V2)
An HD44780-style 16 × 2 display on the 8-bit bus: RS, R/W, E and D0–D7 (a bidirectional bus, as the VIA's port B: `D` driven when read, `DIN` read), the
instruction set (clear, home, entry mode, display and cursor on/off, shift, function set, CGRAM and DDRAM addresses, read the busy flag and the address,
write and read data), 4-bit mode (two nibbles), the busy flag timed in clock cycles of the board, eight custom characters (CGRAM), a 5 × 8 dot symbol with the
cursor and its blink, and an inspector with the contents. The font is written for this project (a plain 5 × 7 ASCII set), not copied from a data sheet.

## The board and the examples (V3)
The LCD on the VIA as in Ben Eater's videos (PB0–PB7 are D0–D7, PA7 RS, PA6 R/W, PA5 E), with the terminal beside it. Examples: *6502 + VIA + LCD: hello* (his
assembly program, with the busy-flag wait), and the BASIC computer with the VIA and the LCD, where `POKE 24578,255` sets the port and `POKE 24576,72` sends an
"H"; programs to type in for the LCD join the other four in the BASIC reference.

## Not doing
Backlight and contrast, 20 × 4 and graphic displays, the VIA's shift register, a real-time busy flag (it is counted in board cycles).

## What each milestone did
### V1 (0.3.0)
- As in the plan: `via6522` (a model in `engine/via6522.ts` with 17 tests of its own, the part in `engine/components/via.ts` with 10 pin-level tests), its
  inspector (*Registers of the VIA*: ports and directions, the timers, ACR and PCR in words, the flags), pin texts, a bus mode, and the board.
- **Differs from the plan / found on the way:**
  - The part is a tall box (37 rows: nine control pins, three input buses and the three output buses, with the data and port pins one per line in
    scalar mode); in bus mode, which the boards use, the buses are single pins.
  - Timer 1 as built: the counter reaches $FFFF N + 1 cycles after the load (the flag sets there), and a free-running timer reloads one cycle later, so
    it comes round every N + 2; checked on the gate-level board: PB7 toggles every 1,024 cycles for a latch of 1,022.
  - The board's data bus gets the VIA's `D` (0 while not selected, as the terminal's) through the multiplexer; with both chips a second multiplexer picks
    by A13, and an AND gate joins the two active-low interrupt lines. That combination is built and wired in V1 (a test checks it) and run in V3.
  - The startup bundle grew from 171.3 to 174.2 kB gzip (the part is registered at startup); V2 has to fit in the 180 kB budget, so its font and
    state machine go in a chunk of their own if they would not.
  - The palette icon of the VIA is a thin empty box (the generic symbol of a very tall part); a drawn symbol would be a nicety for V3.

### V2 (stacked on V1)
- As in the plan: `hd44780` (the model in `engine/hd44780.ts` with 16 tests: every instruction, the busy flag in cycles, 4-bit mode for writes and reads, the
  cursor in the window, the CGRAM; the part in `engine/components/lcd.ts` with 8 pin-level tests), the font (`engine/lcdfont.ts`, drawn for this project, with the
  ROM's yen sign at `\` and arrows at `~` and 0x7F, and a box above 0x7F), a symbol that draws the dots (one path for all lit dots, the cursor and a CSS-blinking block),
  and an inspector (the text, the modes, the address counter, the busy flag with what was ignored, the eight custom characters).
- **Pins:** `CLK` (Φ2, only to time the busy flag), `RS`, `RW`, `E`, `DIN0–7` (what it reads) and `D0–7` (what it drives, Z unless it is read), as the VIA's
  ports. A write is taken when E falls and a read starts when E rises, as on the chip.
- **Differs from the plan:** a *Busy time* setting (as in the data sheet taking the clock for 1 MHz, short, or never busy); a write whose D7–D4 are unknown is
  ignored and a pin below D4 that nothing drives reads 0 (the 4-bit interface leaves them unconnected). The busy time of a data read is the same as a write's.
- **Bundle:** the startup chunk is 177.6 kB gzip (174.2 at V1; budget 180): the part, the model and the font are registered at startup. V3 adds only lazy code.
- Not done yet, by design: nothing wires it to the VIA. V3 does that on the board; the busy-flag read through the shared port B is tested there.
