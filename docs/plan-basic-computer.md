# A BASIC computer on the 6502 (plan)

> **Status: not started.** Read `CLAUDE.md` first (feature branch → PR → CI → merge; scoped tests; a PR does not bump the version, but the
> first PR of a larger feature bumps the *minor* number in `package.json`: B1 does, `0.1.0` → `0.2.0`).
> One PR per milestone, each stacked on the one before it (`b1-big-memory`, `b2-terminal`, `b3-basic`…); tick each box when its PR merges
> and add a short *What it did, and where it differs from the plan* note under it, as `plan-cpu6502.md` does.
>
> - [ ] B1 Measure, then memory that is big enough and cheap to snapshot (32 KB RAM, 16 KB ROM)
> - [ ] B2 A terminal part (a screen and a keyboard on one 6551-style chip) and a first board that echoes what you type
> - [ ] B3 BASIC in the ROM: the board boots to `READY.` and runs your programs
> - [ ] B4 Polish: speed setting, typing and pasting programs, example programs, reference notes, e2e, README

## Why
After Ben Eater's 6502 computer: a CPU, RAM, ROM and one serial chip on a breadboard, running Microsoft BASIC, so that you type
`10 PRINT "HELLO"` and `RUN` on a computer you wired yourself. It fits what Sklopko is for (every wire and every address decode is
visible) and it reuses the 6502 work: the part, the assembler, the board builder. It is the small answer to "can we have a C64?":
a C64 is mostly four custom chips (VIC-II, SID, two CIAs) that would be black boxes here, and its ROMs cannot be shipped.
This board has one black box, the terminal, and BASIC itself is free to ship (see *Licences*).

## What was measured
`src/engine/bench.test.ts` has two new cases (run with `VITE_BENCH=1 npx vitest run src/engine/bench --reporter=verbose --disable-console-intercept`),
on a desktop-class machine, with the simulator's history on, as in the app:

| What | Result |
|---|---|
| 6502 board, LEDs only (counter program) | 87,700 clock edges/s = **43,800 CPU cycles/s** |
| 6502 board with screen, gamepad, console, keypad | 63,100 edges/s = **31,500 cycles/s** |
| copying a 64 KB `Uint8Array` (`slice()`) | 57,300 copies/s |
| the bare core (R1's Dormann run) | about 30,000,000 cycles/s |

Reading the numbers:
- **The circuit around the core costs several hundred times more than the core (30 million cycles/s against 44,000).** The simulator settles the decoder, the multiplexer and
  the memory parts at every edge. The app gives a frame at most 10 ms of simulation work (`sim.frame(dt * speed, 10)` in `runtime.ts`), so the
  board really runs at about **26,000 cycles a second** whatever its clock says: 2.6% of a 1 MHz 6502.
- **A big RAM would double the cost again if copied per edge.** The history keeps 1,000 snapshots (`HISTORY_EDGES`), and today a RAM
  snapshot is a copy of the whole array. At 64 KB that alone is 17 µs per edge against 11 µs for the whole board; at 32 KB I expect about half
  of that (an estimate from the 64 KB figure; B1 measures it). It also holds 1,000 × 32 KB = 32 MB of history.
- **What BASIC needs** (estimates, to be confirmed by B3's test on the bare core): the cold start is a few hundred thousand cycles if it
  tests memory (it can be told the size instead and skip the test), a `PRINT` is a few thousand, a `FOR` loop of 1,000 turns with a short body
  is about 100,000–200,000. At 26,000 cycles/s that is "READY. after ten seconds or so, and a loop of 1,000 takes five". Usable but slow;
  about four times faster would feel good. That is the target of B1's speed work.

## The computer
**Memory map** (decoded from A15 and A14 with the existing parts, as on the first board):

| Address | What |
|---|---|
| `$0000–$7FFF` | RAM, 32 KB (zero page and stack inside) |
| `$8000–$8003` | the terminal (four registers; the block repeats up to `$BFFF`) |
| `$C000–$FFFF` | ROM, 16 KB (BASIC, the start-up code, the vectors at the top) |

**The terminal part** (`acia6551`, new, B2): a behavioural part that stands for a 6551 serial chip with a screen and a keyboard attached.
- Pins as the chip: `Φ2`, `CS`, `RS0–1`, `R/W`, `D0–7` out, `DI0–7` in, `IRQ`, `RES`. Registers as the 6551: data, status, command, control.
  Status bit 3 is "a character has arrived" and bit 4 is "ready to send", which is what Ben Eater's BASIC port polls, so his programs and
  articles carry over. Baud rate and the command bits are accepted and ignored: a character takes no time on the wire.
- **The screen** is a text grid (80 × 24, scrolling) drawn from the existing console's code (`devices.ts`: `consolePut`, which already
  knows `\n`, `\r` and backspace). **The keyboard** is the browser's: click the terminal (or select it) and type; Enter sends CR, Backspace sends
  `$08`; letters can be sent as capitals (a setting, on by default, since this BASIC wants capitals).
- **Pasting** a program feeds one character at a time, each only when the one before has been read, as a real receiver would. The BASIC
  program itself decides when to take the next character, so nothing is lost.
- **IRQ** goes low while a character waits, if the command register says so (so the same part serves an interrupt-driven echo example).
- Not modelled: framing errors, overrun, handshake lines, baud timing.

## Steps
### B1. Measure, then memory that is big enough and cheap to snapshot
- **Memory sizes.** RAM `abits` up to 15 (32 KB), ROM up to 14 (16 KB), the memory inspector's *Page* drop-down already steps in
  256-word pages, so check that it still works at that size.
- **Paged, copy-on-write RAM state.** A RAM's words become 256-byte pages; a snapshot copies the list of pages (128 pointers), not the bytes,
  and a write that touches a page shared with a snapshot copies that one page first. `cloneState` learns the type. The ROM is never written, so
  its state should not be copied at all: check how its parsed words are held and share them.
- **ROM images.** The ROM's hex text is capped at 14,000 characters. A 16 KB image is 49,000 characters as hex, and it travels in saved files
  and share links. Choose a denser stored form (base64 of the bytes, perhaps compressed), keep reading the old hex, and check the share-link size.
- **Speed.** Profile one edge of the board (where do the 11 µs go: the decoder's gates, the memory parts, the CPU part, snapshotting?) and take the
  cheap wins; measure again. **Decision gate:** if the board still runs under about 50,000 cycles/s, either raise the per-frame work cap with a
  *Speed* setting (B4 has the control for it), or fold the address decoder into one behavioural part; the CPU, RAM and ROM stay separate parts
  either way, so the wiring lesson stays. Write the numbers in this note.
- **Tests.** RAM paging (a write after a snapshot, step back over it, a page shared by many snapshots), the old hex still loads, a 32 KB RAM and
  16 KB ROM on a board running a program that fills and checks all of it. Bump the minor version in `package.json` (`0.2.0`).

### B2. The terminal and a first board
- The `acia6551` part with its symbol, pin descriptions (`pindata.ts`), bus mode, inspector (the four registers, what is waiting in the
  receive buffer) and the typing/pasting described above.
- `board6502Builder` gains a `terminal` device at `$8000` and a `bigmemory` option for the map above (the existing boards keep theirs, so no
  saved circuit changes).
- Example **6502 + terminal: echo**, in 6502 assembly: wait for a character, write it back, and print `HELLO` at start-up; a second program
  does the same by interrupt.
- **Tests.** The part against the 6551's register behaviour (status bits, a character arriving, a read clearing it, IRQ), the pasted-text pacing,
  the board running the echo program on the bare core and on the board, one e2e test that types into the terminal.

### B3. BASIC in the ROM
- **The BASIC image** is Microsoft BASIC for the 6502, built **offline** (it is written for ca65, not for our assembler) for our map with a small
  target configuration: the input and output routines poll the terminal's status and data registers, the memory size is fixed so the start-up
  skips the memory test, the start-up code sets the stack and the vectors. The binary is committed under `src/model/` with the recipe (source
  version, configuration and the `ca65` and `ld65` commands) in a README next to it, so anyone can rebuild and compare it byte for byte.
  We do not assemble it in the app.
- Example **BASIC computer**: the board with the terminal, the RAM and ROM of B1 and the BASIC ROM, framed and explained like the other boards
  (the memory map in the decoder's note, the terminal's note: "type here"), booting to `READY.` after answering its start-up questions by itself.
- **Tests.** The image run on the **bare core** with a scripted keyboard: `PRINT 2+2` prints `4`; a program with `FOR` and `GOTO` gives the right
  output; a `LIST` shows what was typed; cycles to `READY.` and for a 1,000-turn loop are *measured and written into this note* (replacing the
  estimates above). Then the same on the board, for a few hundred cycles at the beginning and for the first prompt, and one e2e test that types
  `10 PRINT "HELLO"`, `RUN` and sees `HELLO`.

### B4. Polish
- A **Speed** setting for the board (the work cap per frame, with a note of what it costs the page), if B1 did not already need it.
- Example programs to paste (a *Programs* list on the example's note or in the terminal's inspector): `10 PRINT` forever, a multiplication table,
  primes, a number guess. A *Copy to clipboard* and a *Type it in* button for each (the second uses the paced paste).
- A BASIC page in the references (Tools menu): the statements and functions this BASIC has, in a table, and what it lacks (no graphics, no
  sound, no files); the memory map; and where the BASIC lives in the ROM.
- README, the example's thumbnail and blurb, e2e for the area, screenshots at desktop and phone width (the keyboard on a phone: typing into a
  hidden input that opens the on-screen keyboard).

## Licences
To be **checked before B3 commits an image**; none of this was verified by reading the licence files.
- Microsoft published its 6502 BASIC (version 1.1) on GitHub under the MIT licence in 2025 (reports: [Linuxiac](https://linuxiac.com/microsofts-6502-basic-goes-open-source-under-mit-license/),
  [Hackaday](https://hackaday.com/tag/ms-basic)). That source is for Microsoft's own assembler, so it would have to be ported to ca65 to be built.
- [mist64/msbasic](https://github.com/mist64/msbasic) is a ca65 port that builds several historical versions of Microsoft BASIC, and is what the
  Ben Eater community builds on. Its own licence is not confirmed here (a fork lists BSD 2-clause); read its `LICENSE` and the original copyright
  notices, and keep them next to the binary.
- **EhBASIC** (Lee Davison) is the alternative if a licence is a problem; its terms are not confirmed either.
- The decision, once read: ship the MIT or BSD licensed build with its notices, and a "where it comes from" line in the reference page.

## Not doing
The C64 (see *Why*); a tape or disk, a file system, `LOAD` and `SAVE` (programs are typed or pasted; saving is the circuit's own file save, with
the program text kept in a note, if wanted later); graphics and sound statements; a 6522 VIA and the LCD of Ben Eater's computer (a good follow-up
milestone: another behavioural part and a BASIC `POKE` example); other BASICs (Applesoft, Commodore); a BASIC editor outside the terminal.

## Open choices (my pick in bold)
1. **A 6551-style terminal part with the screen inside**, or the existing text console grown an input register. The console is a simple output-only
   device at `$4001`; the 6551 look-alike is what BASIC's I/O hooks and Ben Eater's code expect, and it is a real chip people know.
2. **Paged copy-on-write RAM**, or a "dirty page list" per edge. Pages are simpler to share between 1,000 snapshots and to step back over.
3. **The stored ROM form in B1** (base64 vs. compressed): decide with the measured share-link length.
4. **32 KB of RAM, not 64 KB.** BASIC needs about 8 KB at least; 32 KB is the size the real board has, and half the snapshot cost.

## Risks
- **Speed** is the one that can sink it: the whole design assumes the board can reach about 100,000 cycles/s. B1 measures first and has a decision
  gate; if neither the cheap wins nor the work cap get there, BASIC still runs, only slowly, and the plan says so.
- **Snapshots of a big RAM** (B1) and **share-link size** (B1) both touch every circuit; benchmark and test the old files first.
- **Licence** of the BASIC source (above): not a reason to start, a reason to read before B3.
- **Typing on a phone** (B4) needs a real input element; plan the e2e on the emulated phone early.

## Verification
Per step, the `CLAUDE.md` checklist (`npm test`, `npm run lint`, `npm run build`, the e2e specs for the area), plus screenshots in every PR (the
board at desktop and phone width, the terminal with `READY.`) and a visual check in light and dark.
