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
This board has one black box, the terminal, and Microsoft's 6502 BASIC is MIT licensed (see *Licences*).

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
- **Speed: the history is the cost, not the simulation.** Profiled (a CPU profile of the board, plus the same run with `record()` switched off):

  | Board | with history (today) | history off |
  |---|---|---|
  | LEDs only | 38,000 cycles/s | **198,000 cycles/s** |
  | five devices | 29,000 cycles/s | **114,000 cycles/s** |

  `record()` (the snapshot taken at every clock edge so you can step back) costs about 9 µs of the 10 µs an edge takes. Inside it: the generic
  recursive `cloneState` (2.3 µs for the CPU's six numbers, 2.2 µs to copy the 2 KB RAM), and fresh arrays for `values`, `states` and `pipes`
  at every edge, which also keep the garbage collector busy. Settling the 18 parts is about 1.5 µs. So the work, in order of payoff:
  1. **Share what did not change.** A part whose state did not change since the last snapshot reuses the previous copy (the RAM changes on a few
     cycles in a hundred; a version counter on the RAM tells). With the paged RAM above a write copies one page, so this is also what makes 32 KB fine.
  2. **A cheap clone for the CPU.** Its state is plain numbers: give a part an optional `clone` (or keep the state in a small typed array) instead of
     the generic `for…in` walk.
  3. **No per-edge allocation.** Keep the history as preallocated slots (a ring buffer with its arrays reused), not new arrays and `shift()`.
  4. **Only if still short:** a *Speed* setting that raises the 10 ms work cap per frame, and snapshotting every edge only while paused or slow.
  Target: 100,000 cycles/s on a board with devices, which is what BASIC needs. Measure after each step and write the numbers in this note.
  The decoder does not need to become one part: it is not where the time goes.
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
- **The BASIC image** is Microsoft BASIC for the 6502, built **offline** (it is written for ca65, not for our assembler; *Licences* says which source and why) for our map with a small
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
Checked on 2026-10-24 by reading the repositories' pages (not a legal opinion, and the repositories' contents may change). What there is:

| Source | Licence | What it is |
|---|---|---|
| [microsoft/BASIC-M6502](https://github.com/microsoft/BASIC-M6502) | **MIT**, "Copyright (c) Microsoft Corporation" (a `LICENSE` file is in the repo) | Microsoft's own source, *Microsoft BASIC for 6502 Microprocessor, Version 1.1*, copyright Microsoft 1976–1978: one file, `m6502.asm` (6,955 lines), with `REALIO` conditionals for the Apple II, Commodore PET, Ohio Scientific, KIM-1 and a PDP-10 simulation. No build instructions and no assembler named ("compatible with period assemblers"). Archived (read-only) since September 2025. |
| [mist64/msbasic](https://github.com/mist64/msbasic) | README says **2-clause BSD**; "main work by Michael Steil"; **no `LICENSE` file** in the root listing, the README statement is the only grant | A reconstruction in `ca65` source that builds byte-exact copies of ten historical versions (Commodore 1 and 2, OSI, KIM, AIM-65, SYM-1, KBD, MicroTAN, AppleSoft I, W65C816SXB). Built with the cc65 suite and `./make.sh`, which compares each build with the original binary in `orig/`. |
| [beneater/msbasic](https://github.com/beneater/msbasic) | README says **2-clause BSD** (same wording as above), no `LICENSE` file shown | A fork of mist64's with an **`eater` target** (`eater.cfg`, `defines_eater.s`, `eater_iscntc.s`, `wozmon.s`, `lcd.s`): the one this plan imitates. Its README does not describe the target's memory map or I/O; read the files. |
| EhBASIC (Lee Davison), [mirror of its readme](https://git.applefritter.com/6502/6502_EhBASIC_V2.22/src/branch/master/readme.txt) | "free but not copyright free": any distributed binary must contain the string "Derived from EhBASIC"; **commercial use needs the author's permission** | A different BASIC, not Microsoft's. The terms come from a mirror, not the author. |

What it means for us:
- **Shipping Microsoft BASIC is allowed.** Microsoft's own repository is MIT, so the Microsoft code may be used, copied, modified and distributed if its copyright and
  licence notice stay with it. The licence notice goes in the repo next to the image, and in the reference page ("where it comes from").
- **The easy route (the `ca65` build, as Ben Eater's) has a weaker paper trail.** mist64's version is a 2-clause BSD reconstruction of code that was sold as binaries by
  Microsoft, OSI, Commodore and Apple *before* Microsoft's MIT release, and its README is the only grant (no `LICENSE` file). BSD covers the work of its authors, not
  anyone else's code in it. Microsoft's MIT release covers the Microsoft BASIC source it published (version 1.1), which is the common core of these builds, but I did not
  check which base the `eater` target comes from or how far it differs from Microsoft's 1.1, so I cannot say the MIT release covers all of it. For a free, educational
  project this is a low risk that people take every day, but it is a risk.
- **EhBASIC is not the way out:** it asks permission for commercial use and the terms come from a mirror.

**Decision, in order of preference (revisit before B3 commits an image):**
1. **Build from the `ca65` source, `eater`-style, and keep every notice**: Microsoft's MIT notice and copyright line, Michael Steil's 2-clause BSD statement, Ben
   Eater's changes if his files are used, with a short `LICENSE-BASIC` next to the image and a line in the reference page. Before committing it, **diff the Eater
   base against Microsoft's `m6502.asm` version 1.1** (does the part that matters match?), and note the result here.
2. **If that diff or a reviewer says no**, port Microsoft's `m6502.asm` (MIT, clean provenance) to our own `eater`-style target instead. It is one file with
   conditional assembly, but written for another assembler; our `asm6502.ts` has no macros, so this is a port to `ca65` (offline, as above), probably a milestone of its own.
3. **Last resort:** write a small BASIC of our own in 6502 assembly (no licence question, much more work, and not "Microsoft BASIC").
- A note in the PR that adds the image says which of these was chosen and why.

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
- **Speed** was the one that could sink it. Measured: with the history off the board already does 114,000–198,000 cycles/s, so the target is
  reachable if the snapshots are made cheap (B1). If sharing and a cheap clone fall short, BASIC still runs, only slowly, and the plan says so.
- **Snapshots of a big RAM** (B1) and **share-link size** (B1) both touch every circuit; benchmark and test the old files first.
- **Licence** of the BASIC build (above): Microsoft's own source is MIT, the `ca65` build's paper trail is weaker; B3 starts with the diff and the notices.
- **Typing on a phone** (B4) needs a real input element; plan the e2e on the emulated phone early.

## Verification
Per step, the `CLAUDE.md` checklist (`npm test`, `npm run lint`, `npm run build`, the e2e specs for the area), plus screenshots in every PR (the
board at desktop and phone width, the terminal with `READY.`) and a visual check in light and dark.
