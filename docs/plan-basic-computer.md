# A BASIC computer on the 6502 (spec)

> **Status: spec, waiting for approval; nothing built.** Read `CLAUDE.md` first (feature branch → PR → CI → merge; scoped tests; a PR
> does not bump the version, but the first PR of a larger feature bumps the *minor* number in `package.json`: B1 does, `0.1.0` → `0.2.0`).
> One PR per milestone, each stacked on the one before it (`b1-basic-image`, `b2-cheap-history`, `b3-big-memory`…); tick each box when
> its PR merges and add a short *What it did, and where it differs from the spec* note under it, as `plan-cpu6502.md` does.
>
> - [ ] B1 Microsoft BASIC built from Microsoft's source, run on the bare core (no board, no UI)
> - [ ] B2 Cheap history and a fast clock: the board runs several times faster, and the app can show it
> - [ ] B3 Big memory: RAM to 32 KB, ROM to 16 KB, and a board with them
> - [ ] B4 The terminal part: a 6551 serial chip with a screen and a keyboard
> - [ ] B5 A board with the terminal, and two echo examples
> - [ ] B6 The BASIC computer: the board boots to `OK` and runs your programs
> - [ ] B7 Polish: programs to type in, a BASIC reference page, speed setting, README
>
> This spec grew out of the plan in PR #82. *Review of the plan* lists what changed and why; the rest is the spec.

## Why
After Ben Eater's 6502 computer: a CPU, RAM, ROM and one serial chip on a breadboard, running Microsoft BASIC, so that you type
`10 PRINT "HELLO"` and `RUN` on a computer you wired yourself. It fits what Sklopko is for (every wire and every address decode is
visible) and it reuses the 6502 work: the part, the assembler, the board builder. It is the small answer to "can we have a C64?":
a C64 is mostly four custom chips (VIC-II, SID, two CIAs) that would be black boxes here, and its ROMs cannot be shipped.
This board has one black box, the terminal, and Microsoft's 6502 BASIC is MIT licensed (see *Licences*).

## Review of the plan
What the plan in PR #82 got wrong or left out, checked against the code and against Microsoft's source (`m6502.asm`, read in full for
this review). Each one changes the spec below.

| # | Finding | What the spec does |
|---|---|---|
| 1 | **The clock part stops at 4,096 Hz and the speed menu at 4×** (`io.ts`, `Toolbar.tsx`). In the app the board can never do more than 4,096 × 4 / 2 = **8,192 CPU cycles a second**, whatever the engine can do. The plan's 26,000 cycles/s is a benchmark number that the app cannot reach. | B2 adds faster clock settings (up to 1 MHz, "as fast as it can") and shows the real rate in the CPU inspector. |
| 2 | **This BASIC's prompt is `OK`, not `READY.`** `READY.` is the Commodore build (`REALIO=3`, line 1357). | All tests and texts expect `OK`. |
| 3 | **The source is MACRO-10, the PDP-10 assembler**, and needs a macro file (`SEARCH M6502`) that is not in Microsoft's repository. Instructions carry their addressing mode in the name (`LDAI` = `LDA #`, `LDADY` = `LDA (zp),Y`, `CMPDY`, `STADY`, `JMPD` = `JMP (ind)`); the maths package (lines 4847–6671) is in **octal** (`RADIX 8`); numbers are written `^O377` and `^D256`; there are 32 `DEFINE` macros, about 330 `IFE`/`IFN` conditionals, `REPEAT`, `IRPC`, `XWD ^O1000,n` for a single byte, `.+4` for "4 bytes on", `%Q` for generated labels and `COMMENT` blocks. Our `asm6502.ts` knows none of this. | B1 *is* the translator; it is specified below, with the full list of what it must understand. It goes first, because it is the one thing that could sink the plan. |
| 4 | **BASIC is about ten times slower than the plan estimated.** Published benchmark results for Microsoft BASIC machines at about 1 MHz (Apple II, PET, C64) put an empty `FOR I=1 TO 1000: NEXT` at 1 to 1.5 seconds, i.e. **about a million cycles**, not 100,000–200,000. At 100,000 cycles/s that loop takes 10–15 s. | Speed targets are set from this; the example programs are picked to print as they go or to finish in seconds; B1 measures the real numbers. |
| 5 | **The ROM has no state to snapshot.** Its words are a parameter, parsed once per params object (`romWords` keeps them in a `WeakMap`). Only its text cap (14,000 characters) is in the way. | B3 only raises the cap. |
| 6 | **Base64 does not make share links shorter.** Measured with `lz-string`, as `toShareHash` does, on 16 KB: random bytes as hex → 30,183 characters of link, as base64 → 27,264; code-like bytes 26,328 against 26,056. | The ROM stays hex text (open choice 3 of the plan is closed); the cap becomes 49,152 characters (16,384 words of two digits and a space). |
| 7 | **The memory map was not Ben Eater's**, so "his programs carry over" did not hold. His map (RAM `$0000–$3FFF`, serial chip at `$5000`, ROM `$8000–$FFFF`) is also *exactly the decoding our 6502 board already has*: A15 and A14 pick RAM, devices or ROM. | The spec uses his map (see *The computer*). |
| 8 | **BASIC's memory test would print a `U`.** Asked `MEMORY SIZE?` with no answer, BASIC writes `$55` past the end of RAM to find it, and the first address past RAM is the terminal's data register. | Our build fixes the memory size and skips the start-up questions. |
| 9 | **BASIC's line editing is a teletype's.** `_` deletes a character, `@` deletes the line, codes below 32 and from 125 up are dropped, and BASIC does not echo what you type (the KIM-1's monitor did that). | Our input routine echoes, and turns Backspace into `_`. |
| 10 | **Paged copy-on-write RAM would change `state.mem`**, which the memory inspector and the symbol read as one flat array. | The RAM keeps a flat `mem`, plus a dirty-page bitmap and a saved copy of each page: the same sharing, no change for readers. |
| 11 | **The benchmark numbers vary twofold between machines**, and the first case includes the JIT's warm-up: re-run for this review, the LED board gave 20,770 cycles/s and the five-device board 27,692 (the plan: 43,800 and 31,500). | Measurements compare before and after on one machine, after a warm-up run. |
| 12 | **Typing must not reach the editor's shortcuts** (Delete deletes the selected part, letters are shortcuts). | The terminal types through a focused hidden `<textarea>`, which the shortcut handlers already ignore. The same element opens a phone's keyboard, so phone typing moves from polish (B4 of the plan) into the terminal milestone. |

## The computer
**Memory map** (Ben Eater's; decoded from A15 and A14 by the gates the 6502 board already has):

| Address | What | Decoded by |
|---|---|---|
| `$0000–$3FFF` | RAM, 16 KB (zero page, stack, BASIC's program and variables) | A15 = 0, A14 = 0 |
| `$4000–$7FFF` | the terminal: four registers at `$5000–$5003` as on Eater's board, repeated through the block | A15 = 0, A14 = 1 (the chip's own CS0 and CS1 pins, no gate) |
| `$8000–$FFFF` | ROM, 16 KB, seen twice: BASIC from `$C000`, the vectors at `$FFFA` | A15 = 1 |

The terminal is the only device on this board, so it answers to the whole device block. Its chip-select pins do the decoding:
CS0 ← A14 and CS1 ← A15 (low-active), which is how a 6551 is meant to be wired.

### The terminal part (`acia6551`, B4)
A behavioural part that stands for a 6551 serial chip with a terminal on the other end of the wire: a screen and a keyboard.
Its register behaviour lives in one pure module, `src/engine/acia.ts`, which both the part (B4) and the bare-core test harness (B1) use.

**Pins** (as the chip, without the serial side): inputs `PHI2` (Φ2), `RESB`, `CS0`, `CS1B`, `RS0`, `RS1`, `RWB`, `DI0–DI7`; outputs
`D0–D7`, `IRQB`. Bus mode groups `DI` and `D` into two bus pins, as the CPU part does.

**When it acts.** At the falling edge of Φ2, when CS0 = 1 and CS1B = 0 (the same edge at which the CPU finishes its cycle and reads
DI). A write takes DI into the register RS picks; a read has its side effects (clearing a flag). `D` shows the register RS picks while
the chip is selected, 0 otherwise, and is never X (a CPU waits while DI is X). A dummy read by the CPU counts as a read, as on the chip.

**Registers** (RS1 RS0):

| RS | Read | Write |
|---|---|---|
| 0 | received character; clears *receiver full* (status bit 3) | send a character: it appears on the screen at once |
| 1 | status (below); clears the interrupt bit (bit 7) | programmed reset: command bits 0–4 to 0 |
| 2 | command register | command register |
| 3 | control register (baud rate and so on: kept, ignored) | control register |

Status: bit 3 *receiver full*, bit 4 *transmitter empty* (always 1: a character takes no time), bit 7 *interrupt*; bits 0–2 (errors)
and 5–6 (carrier, data set ready) read 0. Command bit 0 (DTR) switches the receiver on: **until a program sets it, typed characters
wait in the keyboard buffer**, as a real 6551 ignores the line until it is switched on. Bit 1 = 0 enables the receive interrupt. The
other command bits (transmit control, echo, parity) are kept and ignored. `RESB` low clears the command, control and status registers;
the screen and the keyboard buffer stay.

**IRQB** is low while status bit 7 is set. Bit 7 is set when a character arrives with the receiver on and its interrupt enabled, and
cleared by reading the status register (as on the chip: an interrupt routine reads the status first).

**Receiving.** Typed and pasted text goes into a keyboard buffer (up to 8,000 characters). Whenever the receiver is on and not full,
the next character moves into the receive register. So a character is only delivered after the program has read the one before: nothing
is lost, there is no overrun, and a pasted program goes in at the speed BASIC takes it.

**The screen** is 40 columns by 16 rows (BASIC is told its width is 40), with 200 lines kept for scrolling back in the inspector.
Codes: 32–126 print; CR (13) goes to column 0; LF (10) to the next line; BS (8) moves back one column and blanks it; FF (12) clears;
BEL (7) flashes the screen frame; anything else is ignored. A line wraps when a character arrives at a full line (not when it fills),
so a program that prints exactly 40 characters and then CR LF does not get a blank line.

**The keyboard.** Click the screen to type: a hidden `<textarea>` over the part takes the focus, which also opens a phone's on-screen
keyboard. Text is read from `input` events (phone keyboards send no usable `keydown`), Enter sends CR, Backspace sends BS ($08), Esc and
Ctrl+C send $03 (BASIC's *break*). Pasting goes into the keyboard buffer: line breaks become CR, tabs a space, anything outside
ASCII 32–126 is dropped. With **Capitals** on (a setting, on by default, since this BASIC knows its keywords only in capitals) letters
are sent as capitals. Click elsewhere or press Tab to stop typing.

**State, for the history.** Plain values plus the screen's `lines` array, which is never changed in place (a print replaces it), and the
keyboard buffer as a string with a read position. A snapshot is then a shallow copy.

**Not modelled:** baud rate and timing, parity, framing and overrun errors, the handshake lines, the transmit interrupt, echo mode,
the W65C51's stuck *transmitter empty* bit.

## Speed
What is known (see finding 11 for how much these vary):

| What | Result |
|---|---|
| 6502 board, LEDs only, history on | 20,000–44,000 CPU cycles/s, depending on the machine |
| same, history off (`record()` disabled) | about 198,000 cycles/s (plan's profile) |
| the bare core (R1's Dormann run) | about 30,000,000 cycles/s |
| what the app runs today | at most 8,192 cycles/s (finding 1) |

`record()`, the snapshot taken at every clock edge so you can step back, costs about 9 µs of the 10 µs an edge takes: the generic
recursive `cloneState` (2.3 µs for the CPU, 2.2 µs for the 2 KB RAM) and new arrays for `values`, `states` and `pipes` at every edge.
Settling the parts is about 1.5 µs.

**Targets.** Engine (warm benchmark, one machine, before and after): with history on, the board runs at ≥ 70% of its history-off speed.
App (desktop browser, read in the CPU inspector): the BASIC computer runs at ≥ 60,000 cycles/s at a 1 MHz clock. That makes typing and
`PRINT` instant, a start-up of under a second (B1 measures it) and an empty 1,000-turn loop 15–20 s. That is slow next to a real 1 MHz
machine (6%), and the texts say so; the example programs print as they go.

**Gate after B2:** if the app stays under 60,000 cycles/s, B2's PR says by how much, and the *Speed* setting of B7 (more work per frame)
moves into B3.

## Steps

### B1. Microsoft BASIC from Microsoft's source, on the bare core
No board and no UI: the riskiest work first, testable without anything else in this plan. Bumps the minor version (`0.2.0`).

**Files.**
- `scripts/basic/m6502.asm`: Microsoft's file, verbatim (its SHA-256 recorded in the README), and `scripts/basic/LICENSE`, Microsoft's MIT notice.
- `scripts/basic/macro10.ts`: the translator (below). `scripts/` already holds TypeScript that unit tests import (`version.ts`).
- `scripts/basic/target.ts`: our build's switches and our edits to Microsoft's file, as a list of *exact* line replacements (the lines
  as they are, what replaces them, why). An edit that no longer matches fails the build, so the changes to Microsoft's code stay few,
  visible and reviewable.
- `scripts/basic/io.s`: our start-up and I/O code, in our assembler's syntax. Written from scratch; ours.
- `scripts/basic/build.ts` and `npm run build:basic` (run with `vite-node`, so the app's TypeScript imports resolve): translate, add
  `io.s`, assemble with `assemble6502`, write the image to `src/model/basic-rom.ts` (hex, 32 bytes a line, so a diff is readable) and
  print a memory map.
- `scripts/basic/README.md`: where the source comes from, the recipe, what our edits do.

**The translator** turns the subset of MACRO-10 that `m6502.asm` uses into plain 6502 assembly for `asm6502.ts`. It does the macro
expansion, the conditionals, the number bases and the constant arithmetic itself, so the assembler only sees what it already knows
(labels, `+`, `-`, `<`, `>`, `*`). What it handles, all found in the file:
- **Lines**: label (`NAME:`, `NAME::`), operator, operands, `;` comments, `COMMENT x … x` blocks, `PAGE`, `SUBTTL`, `TITLE`, `SEARCH`,
  `SALL`, `XLIST`/`LIST`, `PRINTX`, `IF1`/`IF2`, `PURGE` (all listing or assembler chatter: dropped).
- **Symbols**: `A=…` and `A==…` (a constant), `ORG`, `BLOCK n` (in RAM: becomes a constant for the label, not bytes in the image).
- **Numbers**: `RADIX 8`/`RADIX 10` (tracked line by line), `^O…`, `^D…`, `"A"` (a character); operators `+ - * / & !` and `<…>`
  for grouping. An expression with a label in it may only use `+` and `-`, or `&^O377` and `/^O400` (which become `<` and `>`);
  anything else is an error naming the line.
- **Conditionals**: `IFE`, `IFN`, `IFDIF`, `IFNDEF` with `<…>` bodies, nested.
- **Macros**: `DEFINE NAME (ARGS),<…>` with `<…>` bodies, `REPEAT n,<…>`, `IRPC`, generated labels (`%Q`), and the macros the file
  defines for itself (`LDWD`, `STWD`, `PSHWD`, `INCW`, `DT"…"`, `DCI`, `DCE`, `ACRLF`, `SKIP1`, `SKIP2`…).
- **The instruction forms** of the missing `M6502` macro file, recovered from how the file uses them: a suffix `I` is immediate
  (`LDAI 0` = `LDA #0`), `DY` is `(zp),Y` (`LDADY`, `STADY`, `CMPDY`, `ADCDY`, `SBCDY`), `JMPD` is `JMP (…)`; a plain operand is zero
  page or absolute by its value; `X,` / `Y,` after an operand is indexed; `A,` is the accumulator (`LSR A,`); a trailing comma is
  ignored; `.+n` is `*+n`; `XWD ^O1000,n` is the single byte `n`; `ADR(x)` is a word; `EXP n` a byte.
- **A line map**: every output line remembers its `m6502.asm` line, so an assembler error points into Microsoft's file.

**Our build (`target.ts`)**: a new `REALIO=6` (5 is Microsoft's "STM", unused). Its switches follow the KIM-1 build (`REALIO=1`), the
  plainest; where the file has a `REALIO` block per machine (`INCHR`, `ISCNTC`, `OUTCH`…), an edit adds one for ours.
- `ROMSW=1`, `ROMLOC=$C000`, `RAMLOC=$0300` (BASIC's program text starts there; pages 0–2 are its variables, the stack and the input
  buffer), `LINLEN=40`, `DISKO=0` (no `LOAD`/`SAVE`).
- The memory size is fixed at `$4000` and the width at 40: `MEMORY SIZE?` and `TERMINAL WIDTH?` are not asked (finding 8).
- `OUTCH`, `INCHR`, `CZGETL` (for `GET`) and `ISCNTC` (Ctrl-C) call `io.s`. The banner reads `SKLOPKO BASIC V1.1` and keeps
  Microsoft's `COPYRIGHT 1978 MICROSOFT` line.
- Expected start-up (B1 confirms the number): about `15600 BYTES FREE`, the banner, `OK`.

**Our I/O (`io.s`)**, at the end of the ROM, with the vectors:
- *Reset*: `CLD`, stack to `$FF`, terminal: programmed reset, command `$0B` (receiver on, its interrupt off), control `$1F`, then
  BASIC's cold start (`INIT`).
- *Character out*: wait for *transmitter empty*, write the data register.
- *Character in* (waits): a character kept by *break check* comes first; otherwise wait for *receiver full*, read it, strip bit 7.
  Backspace ($08) or Delete ($7F) echoes BS and returns `_` (BASIC's "delete a character"); anything else is echoed and returned.
- *Get* (does not wait): the same without waiting and without echo; 0 if nothing is there.
- *Break check*: if a character is waiting, read it; Ctrl-C ($03) means break; any other character is kept (one byte in zero page)
  for *character in*, so typing ahead while a program runs is not lost.
- IRQ and NMI vectors point at an `RTI`.

**The bare-core harness** (`src/model/basic.test.ts` with a small helper): the CPU core, a 64 KB array for the memory map above, and
the terminal's register model at `$4000–$7FFF`, fed by a scripted keyboard; it returns what was printed and how many cycles it took.
The register model is written here, as `src/engine/acia.ts` (*The terminal part*), with its own tests, so B4 only wraps it in a part.

**Tests.**
- The committed image is what the source builds: translate, assemble, compare with `basic-rom.ts` (in the unit tests, so CI checks it).
- The translator on its own: numbers in both radixes, `<…>` grouping, a nested conditional, a macro with a generated label, each
  instruction form, an error that points at the right line of the input.
- BASIC: start-up prints the banner and `OK`; `PRINT 2+2` prints ` 4`; `PRINT 1/3`, `PRINT SQR(2)`, `PRINT SIN(1)` give Microsoft's
  digits (the maths package is the octal part, so it gets its own checks); a program with `FOR`, `GOSUB`, `IF` and `GOTO` prints the
  right lines; `LIST` shows what was typed; `_` deletes; Ctrl-C stops a running loop with `BREAK IN …`; a 300-line program pasted
  in one go is all there afterwards (`LIST`).
- **Measured, and written into this file:** cycles from reset to `OK`, for `PRINT 2+2`, for an empty 1,000-turn `FOR` loop.
- **On a developer's machine only, never committed** (finding 3's risk): build `REALIO=1` and compare it with the KIM-1 BASIC V1.1
  binary, and our build against Ben Eater's `msbasic` (`PRINT` of the same expressions). If the KIM-1 build matches byte for byte, the
  translator is proven; any difference is listed in the PR.

**If the port goes badly** (the translator cannot produce a ROM that reaches `OK` after a few days of work): stop and report, with
the fallback below (*Risks*), before anything else in this spec is built.

### B2. Cheap history and a fast clock
Engine work, measured at each step with `bench.test.ts` (which gets a warm-up run). No change to what stepping back does.
- **Snapshot hooks.** `ComponentDef` gets two optional functions, used by `record()` and `stepBack()` instead of `cloneState`:
  `snapshot(state)` returns a copy that will never change, and `restore(saved)` returns a live state from it and leaves `saved` as it
  was (it may be restored again). Without them the part's state is copied as now.
  - **CPU**: `{ ...st, cpu: { ...st.cpu } }` (its state is plain numbers, booleans and one string).
  - **RAM**: `mem` stays one flat `Uint8Array`, so the inspector and the symbol read it as before. The state gains a bitmap of
    256-byte pages written since the last snapshot and the last snapshot itself (an array of saved pages). A snapshot copies only the
    written pages and shares the others with the previous snapshot; with nothing written it returns the previous snapshot. Every write
    marks its page: the part's own writes, `memory.write` (the memory editor), and a resize. A restore copies the saved pages into a new
    `mem`. So a snapshot costs nothing on most edges (the CPU writes RAM a few cycles in a hundred) and one 256-byte copy on the others,
    at any RAM size.
  - **Clock**, and other small parts, as the profile shows they matter.
- **No allocation per edge.** The history becomes a ring of `HISTORY_EDGES` slots whose `values`, `states` and `pipes` arrays are
  allocated once and reused; no `shift()`.
- **Record only what can still be stepped back to.** The history keeps the last 1,000 edges, so when one call of `advance` does more
  than 1,000 edges, snapshots of the earlier ones are thrown away in the same call. `advance` skips them: with no deadline the number of
  edges is known from the time and the clock; with a deadline it is estimated from the previous frame. The last edge of a call is
  always recorded. Paused or stepping, every edge is recorded as now.
- **A fast clock.** The clock's *Frequency* gains 16,384 Hz to 1,048,576 Hz (shown as `1 MHz`). A clock faster than the page can
  simulate runs as fast as it can (this is how `advance` already behaves).
- **The real rate in the CPU inspector**: "Running at 64,000 cycles a second (6% of a 1 MHz 6502)", from the cycle count over the last second.
- **Tests.** The existing history tests unchanged; a RAM written, snapshotted, written again and stepped back over (one page, two pages,
  a page shared by many snapshots); the memory editor's write inside a page shared with a snapshot; a fast run whose last 1,000 edges,
  stepped back one at a time, equal those of the same run recorded at every edge; the clock's new settings in a saved file.
- **Measured, and written here:** the benchmark before and after each of the four changes; the in-app rate of the LED board at 1 MHz.

### B3. Big memory
- **RAM** address bits up to 15 (32 KB); **ROM** up to 14 (16 KB), and its hex text cap raised to 49,152 characters. Old files load
  unchanged (the cap only grows). The *Page* drop-down of the memory inspector lists 64 or 128 pages: check it, and group it by 4 KB if
  it is unwieldy.
- `board6502Builder` gets `memory: 'big'`: RAM 16 KB at `$0000–$3FFF`, ROM 16 KB at `$8000–$FFFF` (seen at `$8000` and `$C000`),
  the address split into A0–A13, A14, A15. The existing boards keep `'small'`, so no saved circuit or example changes.
- `romImage` and the assembler take the ROM size from the board instead of the fixed 4 KB.
- **Tests.** An old file with a 4 KB ROM loads the same; a saved 16 KB ROM survives save, load and a share link; a board with
  `memory: 'big'` runs a program that fills all 16 KB of RAM with a pattern and checks it, then reads the last ROM byte at both
  mirrors; the share link of a board with a full 16 KB ROM is measured and written here.

### B4. The terminal part
- The `acia6551` part around B1's `src/engine/acia.ts` (*The terminal part* above), with the screen and the keyboard buffer added: its symbol (the screen drawn inside, a cursor while it has the focus, "click to type" when it has not), pin descriptions
  (`pindata.ts`), bus mode, and the *Capitals* setting.
- The inspector: the four registers with the status bits spelled out ("receiver full", "interrupt"), whether the receiver is on, what
  is waiting in the keyboard buffer, the screen with its 200 lines, and buttons *Type text…* (a box to paste into; it goes through the
  keyboard buffer), *Copy screen*, *Clear screen*, *Break* (sends $03).
- The keyboard: the hidden `<textarea>` (focus, `input` events, blur). Check every global key handler (`Toolbar.tsx`, `keypad.ts`,
  `gamepad.ts`, the canvas shortcuts) ignores keys typed into it.
- **Tests.** The register behaviour (each status bit, a read clearing *receiver full*, reading the status clearing the interrupt,
  IRQB, the receiver off until command bit 0, programmed reset, `RESB`); the keyboard buffer's pacing (a character only after the one
  before was read, 8,000 characters at most); the screen (CR, LF, BS, FF, the deferred wrap, scrolling); a snapshot shared with the
  live state is not changed by a later print; an e2e test that types into the terminal on the desktop and on the emulated phone.

### B5. A board with the terminal, and two echo examples
- `board6502Builder` gets a `terminal` device: CS0 ← A14, CS1B ← A15, RS0/RS1 ← A0/A1, R/W ← the CPU, its D into the multiplexer's
  device input, IRQB to the CPU's IRQ when asked. It needs `memory: 'big'` and is the only device (the builder says so if not).
- Example **6502 + terminal: echo**, in 6502 assembly: switch the chip on, print `HELLO`, then wait for a character and send it back
  (CR as CR LF). Example **6502 + terminal: echo by interrupt**: the same, with the receive interrupt (the handler reads the status,
  then the data). Both use Ben Eater's addresses (`$5000–$5003`) and his register names in the source.
- **Tests.** Both programs on the board in the unit tests (typed text comes back; the interrupt one with the CPU busy in a loop);
  e2e: open the example, type, see the echo.

### B6. The BASIC computer
- Example **BASIC computer**: the board of B5 with `basic-rom.ts` in its ROM, the clock at 1 MHz, framed and explained like the other
  boards: the memory map in the decoder's note, the terminal's note ("click the screen and type; try `PRINT 2+2`"), the memory note
  (where BASIC, your program and its variables live), and a line on speed (finding 4).
- It starts by itself: power-on reset, the banner, `OK`. *Reset* is a cold start (the program is lost), as on Ben Eater's board.
- **Tests.** The B1 checks again, now on the board (start-up to `OK`, `PRINT 2+2`, a short program); the board left running for a
  minute keeps its memory use flat (the trace, the history and the screen are bounded); e2e: open the example, type
  `10 PRINT "HELLO"` and `RUN`, see `HELLO`, on the desktop and on the emulated phone.

### B7. Polish
- **Programs to type in**: the terminal's inspector (or the example's note) lists a few, each with *Copy* and *Type it in* (through
  the keyboard buffer): the endless maze `10 PRINT MID$("/\",INT(RND(1)*2)+1,1);:GOTO 10`, a multiplication table, a number guess
  (`INPUT`, `RND`), primes to 100. Each one is timed on the board and must print within a few seconds.
- **A BASIC reference page** in the Tools menu: the statements, functions and operators of this BASIC in a table (checked by a unit test
  against the keyword table in the built image), what it lacks (graphics, sound, files, lower case), the memory map, how to stop a
  program (Ctrl-C), the line editing (`_`, `@`, Backspace), and where it comes from (Microsoft's MIT release, with the notice).
- **Speed**: if the gate after B2 did not already need it, a *Speed* setting for the work done per frame, with a note of what it costs
  the page.
- README, the example's thumbnail and blurb, the e2e for the area, screenshots at desktop and phone width.

## Licences
Checked on 2026-10-24 by reading the repositories' pages (not a legal opinion, and the repositories' contents may change). What there is:

| Source | Licence | What it is |
|---|---|---|
| [microsoft/BASIC-M6502](https://github.com/microsoft/BASIC-M6502) | **MIT**, "Copyright (c) Microsoft Corporation" (a `LICENSE` file is in the repo) | Microsoft's own source, *Microsoft BASIC for 6502 Microprocessor, Version 1.1*, copyright Microsoft 1976–1978: one file, `m6502.asm` (6,955 lines, MACRO-10 syntax, needs a macro file that is not included), with `REALIO` conditionals for the Apple II, Commodore PET, Ohio Scientific, KIM-1 and a PDP-10 simulation. No build instructions. Archived (read-only) since September 2025. |
| [mist64/msbasic](https://github.com/mist64/msbasic) | README says **2-clause BSD**; "main work by Michael Steil"; **no `LICENSE` file** in the root listing, the README statement is the only grant | A reconstruction in `ca65` source that builds byte-exact copies of ten historical versions. |
| [beneater/msbasic](https://github.com/beneater/msbasic) | README says **2-clause BSD** (same wording as above), no `LICENSE` file shown | A fork of mist64's with an **`eater` target**. |
| EhBASIC (Lee Davison), [mirror of its readme](https://git.applefritter.com/6502/6502_EhBASIC_V2.22/src/branch/master/readme.txt) | "free but not copyright free": any distributed binary must contain the string "Derived from EhBASIC"; **commercial use needs the author's permission** | A different BASIC, not Microsoft's. The terms come from a mirror, not the author. |

**Decision: ship only code whose licence comes straight from its copyright holder.**
1. **The image is built from Microsoft's own `m6502.asm`**, with Microsoft's copyright line and MIT notice kept in `scripts/basic/LICENSE`,
   a `LICENSE-BASIC` next to the image, and the reference page. The banner keeps `COPYRIGHT 1978 MICROSOFT`. Our additions (the
   translator, the target, the I/O and start-up code) are ours, written from scratch.
2. **mist64/msbasic and Ben Eater's fork are not used in the repo.** Their code is not copied, linked or committed. They, and the
   historical KIM-1 binary, may be used on a developer's machine as an **oracle** to check our build against.
3. **EhBASIC is not an option** (commercial use needs the author's permission).
- The PR that adds the image says in its description which source it was built from.

## Not doing
The C64 (see *Why*); a tape or disk, a file system, `LOAD` and `SAVE` (programs are typed or pasted; the circuit's own file save keeps
the circuit, not the program); graphics and sound statements; lower-case BASIC; a warm start that keeps the program over *Reset*; a 6522
VIA and the LCD of Ben Eater's computer (a good follow-up: another behavioural part and a BASIC `POKE` example, at his `$6000`);
Wozmon and other code from Eater's videos whose licence is not clear; other BASICs (Applesoft, Commodore); running the simulation in a
Web Worker (it would give the simulation the whole frame, but changes how every part of the app talks to the simulator).

## Open choices (my pick in bold)
1. **Order: the port first (B1)**, or the plan's order (memory, terminal, then BASIC). The port is the one risk that could stop the
   plan, and it needs nothing else from it.
2. **Ben Eater's memory map** (16 KB RAM, terminal at `$5000`, ROM `$8000–$FFFF`), or the plan's (32 KB RAM, terminal at `$8000`,
   ROM `$C000–$FFFF`). His map is the one people following his videos know, it is the existing board's decoding, and 16 KB is plenty
   for typed programs (about 15,600 bytes free).
3. **Skip `MEMORY SIZE?` and `TERMINAL WIDTH?`**, or keep them (authentic, and typing `A` at the first prints "WRITTEN BY WEILAND &
   GATES"; but an empty answer runs the memory test, finding 8, so the memory test would need a patch instead).
4. **A 40 × 16 screen**, or 80 × 24 (Eater's PC terminal; twice as wide on the canvas and unreadable on a phone).
5. **The receiver is off until a program switches it on** (as the chip), or always on (one less thing to get wrong, one less thing to learn).

## Risks
- **The port (B1)**: about 7,000 lines in a dialect nothing here reads, with its macro file missing. The instruction forms are
  recovered from use and the octal maths package is easy to get subtly wrong; the maths checks and the KIM-1 comparison are there for
  that. Fallback, if B1 cannot reach `OK`: a small integer BASIC of our own in 6502 assembly (no licence question, much more work, not
  Microsoft's). Not EhBASIC.
- **Speed (B2)**: the targets are reachable on paper (history off already gives 114,000–198,000 cycles/s). If not, BASIC still runs,
  only slower, and the gate after B2 brings the *Speed* setting forward.
- **Every circuit goes through B2's history changes**: the existing history tests and the golden simulation test (`sim-golden`) must
  pass unchanged.
- **Typing (B4)**: focus, phone keyboards and the editor's shortcuts; e2e on the emulated phone from the start.
- **CI time**: BASIC's start-up in the e2e tests at the speed of a CI machine; give those tests room, and check the shard times.

## Verification
Per step, the `CLAUDE.md` checklist (all unit tests, lint, build with the bundle budget, the e2e specs for the area), plus screenshots in
every PR with something to see (the board at desktop and phone width, the terminal with `OK`) and a look in light and dark. The numbers
each step measures are written into this file in its PR.
