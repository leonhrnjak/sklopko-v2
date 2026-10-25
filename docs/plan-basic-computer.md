# A BASIC computer on the 6502 (spec)

> **Status: spec, all decisions made. B1 (the BASIC ROM and its tests), B2 (fast clock, history off) and B3 (big memory) B4 (the terminal part), B5 (the board with the terminal) and B6 (the BASIC computer) are built; B7 is not.** Read `CLAUDE.md` first (feature branch → PR → CI → merge; scoped tests; a PR
> does not bump the version, but the first PR of a larger feature bumps the *minor* number in `package.json`: B1 does, `0.1.0` → `0.2.0`).
> One PR per milestone, each stacked on the one before it (`b1-basic-image`, `b2-fast-clock`, `b3-big-memory`…); tick each box when
> its PR merges and add a short *What it did, and where it differs from the spec* note under it, as `plan-cpu6502.md` does.
>
> - [x] B1 Microsoft BASIC built from Microsoft's source, run on the bare core (no board, no UI)
> - [x] B2 A fast clock, and a switch to run a circuit without step-back history (the BASIC computer runs without it)
> - [x] B3 Big memory: RAM to 32 KB, ROM to 16 KB, and a board with them
> - [x] B4 The terminal part: a 6551 serial chip with a screen and a keyboard
> - [x] B5 A board with the terminal, and two echo examples
> - [x] B6 The BASIC computer: the board boots to `OK` and runs your programs
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
| 8 | **BASIC's memory test would print a `U`.** Asked `MEMORY SIZE?` with no answer, BASIC writes `$55` past the end of RAM to find it, and the first address past RAM is the terminal's data register. | The start-up questions are a switch on the board (off: the size is fixed, nothing is asked); with them on, an edit stops the memory test at the end of RAM. |
| 9 | **BASIC's line editing is a teletype's.** `_` deletes a character, `@` deletes the line, codes below 32 and from 125 up are dropped, and BASIC does not echo what you type (the KIM-1's monitor did that). | Our input routine echoes, and turns Backspace into `_`. |
| 10 | **Paged copy-on-write RAM would change `state.mem`**, which the memory inspector and the symbol read as one flat array. | Not needed: the BASIC computer runs without step-back history (decided), so no snapshot work is done for it. History stays as it is for every other circuit. |
| 11 | **The benchmark numbers vary twofold between machines**, and the first case includes the JIT's warm-up: re-run for this review, the LED board gave 20,770 cycles/s and the five-device board 27,692 (the plan: 43,800 and 31,500). | Measurements compare history on and off on one machine, after a warm-up run. |
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

**Pins** (as the chip, without most of the serial side): inputs `PHI2` (Φ2), `RESB`, `CS0`, `CS1B`, `RS0`, `RS1`, `RWB`, `DI0–DI7`,
`DSRB` (*data set ready*, unconnected reads 0); outputs `D0–D7`, `IRQB`. Bus mode groups `DI` and `D` into two bus pins, as the CPU part does.

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

Status: bit 3 *receiver full*, bit 4 *transmitter empty* (always 1: a character takes no time), bit 6 the level on `DSRB`, bit 7
*interrupt*; bits 0–2 (errors) and 5 (carrier) read 0. `DSRB` is how a board passes a setting to its program: a switch wired to it can
be read in the status register (the BASIC computer uses it for its start-up questions). Command bit 0 (DTR) switches the receiver on: **until a program sets it, typed characters
wait in the keyboard buffer**, as a real 6551 ignores the line until it is switched on. Bit 1 = 0 enables the receive interrupt. The
other command bits (transmit control, echo, parity) are kept and ignored. `RESB` low clears the command, control and status registers;
the screen and the keyboard buffer stay.

**IRQB** is low while status bit 7 is set. Bit 7 is set when a character arrives with the receiver on and its interrupt enabled, and
cleared by reading the status register (as on the chip: an interrupt routine reads the status first).

**Receiving.** Typed and pasted text goes into a keyboard buffer (up to 8,000 characters). Whenever the receiver is on and not full,
the next character moves into the receive register. So a character is only delivered after the program has read the one before: nothing
is lost, there is no overrun, and a pasted program goes in at the speed BASIC takes it.

**The screen** is 40 columns by 24 rows (BASIC is told its width is 40), with 200 lines kept for scrolling back in the inspector.
Codes: 32–126 print; CR (13) goes to column 0; LF (10) to the next line; BS (8) moves back one column and blanks it (at the start of a line that the terminal wrapped it goes back onto the line above, so that the
screen follows what BASIC deletes); FF (12) clears;
BEL (7) flashes the screen frame; anything else is ignored. A line wraps when a character arrives at a full line (not when it fills),
so a program that prints exactly 40 characters and then CR LF does not get a blank line.

**The keyboard.** Click the screen to type: a hidden `<textarea>` over the part takes the focus, which also opens a phone's on-screen
keyboard. Text is read from `input` events (phone keyboards send no usable `keydown`), Enter sends CR, Backspace sends BS ($08), Esc and
Ctrl+C send $03 (BASIC's *break*), which does not wait its turn: what was typed and not yet read is thrown away and the break is the next character. Pasting goes into the keyboard buffer: line breaks become CR, tabs a space, anything outside
ASCII 32–126 is dropped. With **Capitals** on (a setting, on by default, since this BASIC knows its keywords only in capitals) letters
are sent as capitals. Click elsewhere or press Tab to stop typing.

**State, for the history** (on the echo boards, which keep it): plain values plus the screen's `lines` array (changed in place, 200 short
strings at most, which the simulator's generic copy handles at each clock edge), and the keyboard buffer as a string with a read position.

**Not modelled:** baud rate and timing, parity, framing and overrun errors, the handshake lines, the transmit interrupt, echo mode,
the W65C51's stuck *transmitter empty* bit.

## Speed
What is known (see finding 11 for how much these vary):

| What | Result |
|---|---|
| 6502 board, LEDs only, history on | 20,000–44,000 CPU cycles/s, depending on the machine |
| same, history off (`record()` disabled) | 114,000–198,000 cycles/s (plan's profile: five devices, LEDs only) |
| the bare core (R1's Dormann run) | about 30,000,000 cycles/s |
| what the app runs today | at most 8,192 cycles/s (finding 1) |

`record()`, the snapshot taken at every clock edge so you can step back, costs about 9 µs of the 10 µs an edge takes.

**Decision: the BASIC computer runs without step-back history.** Stepping back over a BASIC interpreter's millions of cycles teaches
nothing, so this board turns history off (B2) and gets the history-off speed. Every other circuit keeps its history exactly as now;
making snapshots cheaper is not part of this spec (see *Not doing*).

**Targets.** App (desktop browser, read in the CPU inspector): the BASIC computer runs at ≥ 60,000 cycles/s at a 1 MHz clock. The app
gives the simulation 10 ms of each 16.7 ms frame, so the history-off benchmark predicts 70,000–120,000. That makes typing and `PRINT`
instant, a start-up of under a second (B1 measures it) and an empty 1,000-turn loop 10–15 s: slow next to a real 1 MHz machine (about
8%), and the texts say so; the example programs print as they go.

**Gate after B2:** if the app stays under 60,000 cycles/s, B2's PR says by how much, and the *Speed* setting of B7 (more work per frame)
moves into B3. *Result:* it did (1,700 cycles/s in a browser, whatever the history), because drawing took 135 ms of each 150 ms frame; the
work per frame is now automatic for a circuit that cannot keep up (see the note of B2), which gives 48,000 to 110,000 (B2's note).

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
- **The start-up questions are a switch.** At reset `io.s` reads the terminal's status bit 6 (the `DSRB` pin). Off (0): the memory
  size is fixed at `$4000`, the width at 40, and `MEMORY SIZE?` and `TERMINAL WIDTH?` are not asked. On (1): BASIC asks them as in 1978
  (Enter for the defaults, `A` at the first for the authors' names). An edit stops the memory test at `$4000`, so an empty answer no longer
  writes into the terminal (finding 8).
- `OUTCH`, `INCHR`, `CZGETL` (for `GET`) and `ISCNTC` (Ctrl-C) call `io.s`. The banner reads `SKLOPKO BASIC V1.1` and keeps
  Microsoft's `COPYRIGHT 1978 MICROSOFT` line.
- Expected start-up with the questions off (B1 confirms the number): about `15600 BYTES FREE`, the banner, `OK`.

**Our I/O (`io.s`)**, at the end of the ROM, with the vectors:
- *Reset*: `CLD`, stack to `$FF`, terminal: programmed reset, command `$0B` (receiver on, its interrupt off), control `$1F`, then
  BASIC's cold start (`INIT`).
- *Character out*: wait for *transmitter empty*, write the data register.
- *Character in* (waits): a character kept by *break check* comes first; otherwise wait for *receiver full*, read it, strip bit 7.
  Backspace ($08) or Delete ($7F) echoes BS and returns `_` (BASIC's "delete a character"); anything else is echoed and returned.
- *Get* (does not wait): the same without waiting and without echo; 0 if nothing is there.
- *Break check*: if a character has arrived, read it; Ctrl-C ($03) means break (and the type-ahead is thrown away); any other character
  goes into a queue of 16 in page 2 for *character in* and *get*, so typing ahead while a program runs is not lost, and a Control-C cannot
  wait behind another key.
- IRQ and NMI vectors point at an `RTI`.

**The bare-core harness** (`src/model/basic.test.ts` with a small helper): the CPU core, a 64 KB array for the memory map above, and
the terminal's register model at `$4000–$7FFF`, fed by a scripted keyboard; it returns what was printed and how many cycles it took.
The register model is written here, as `src/engine/acia.ts` (*The terminal part*), with its own tests, so B4 only wraps it in a part.

**Tests.**
- The committed image is what the source builds: translate, assemble, compare with `basic-rom.ts` (in the unit tests, so CI checks it).
- The translator on its own: numbers in both radixes, `<…>` grouping, a nested conditional, a macro with a generated label, each
  instruction form, an error that points at the right line of the input.
- BASIC: start-up prints the banner and `OK`; with `DSRB` high it asks both questions, takes Enter for both (the same bytes free:
  the memory test stops at `$4000`, and nothing is printed by it) and takes `8000` and `60` as answers; `PRINT 2+2` prints ` 4`; `PRINT 1/3`, `PRINT SQR(2)`, `PRINT SIN(1)` give Microsoft's
  digits (the maths package is the octal part, so it gets its own checks); a program with `FOR`, `GOSUB`, `IF` and `GOTO` prints the
  right lines; `LIST` shows what was typed; `_` deletes; Ctrl-C stops a running loop with `BREAK IN …`; a 300-line program pasted
  in one go is all there afterwards (`LIST`).
- **Measured, and written into this file:** cycles from reset to `OK`, for `PRINT 2+2`, for an empty 1,000-turn `FOR` loop.
- **On a developer's machine only, never committed** (finding 3's risk): build `REALIO=1` and compare it with the KIM-1 BASIC V1.1
  binary, and our build against Ben Eater's `msbasic` (`PRINT` of the same expressions). If the KIM-1 build matches byte for byte, the
  translator is proven; any difference is listed in the PR.

**Time limit: one week.** If by then the KIM-1 build from our translator is not byte-exact against the original binary, or our own
build does not reach `OK` and pass the tests above, stop and report. The fallback is then Ben Eater's route (*Risks*): the same
harness, tests and `io.s` ideas, only the image is built from `beneater/msbasic` with `ca65` instead of from our translation.
Nothing else in the spec changes.

**What B1 did, and where it differs from the spec.** It took a day, not a week, and the fallback was not needed. `scripts/basic/` holds
Microsoft's file verbatim (its SHA-256 is pinned by a test), the translator `macro10.ts`, the edits and the build (`target.ts`), our I/O
code (`io.s`) and a README; `src/engine/acia.ts` is the terminal's register model (24 tests) and `src/model/basic-harness.ts` the bare
core around it. `npm run build:basic` writes `src/model/basic-rom.ts` (the 16 KB image: BASIC from `$C000` to `$E032`, 8,243 bytes, our code
from `$F000`), and a test fails if the committed image is not what the source builds. The minor version is `0.2.0`.

- **Measured**, on the bare core with the questions off: 16,813 cycles from reset to `OK`, with `15615 BYTES FREE`; typing `PRINT 2+2`
  and its answer, 22,019 cycles, `PRINT "HELLO"` 11,143, `PRINT SQR(2)` 75,837; an empty 1,000-turn `FOR` loop
  958,478 (about a million, as finding 4 said); the same loop with `A=A+1` in it 3,602,599. Typing in a program, as a paste feeds it:
  20 lines 410,254 cycles (20,500 a line, growing with the size because BASIC relinks the whole program at each new line), 50 lines
  1,586,429, 300 lines 14.7 million. At the targeted 60,000–100,000 cycles a second that is 4–7 s for 20 lines, so the programs to type
  in (B7) stay short. A run of those 20 `PRINT` lines: 267,497.
- **The maths agrees with the true values to 4.3 × 10⁻⁹** (relative, 91 results across `SQR LOG EXP SIN COS TAN ATN ^ / * -`; the
  32-bit mantissa allows about that), and the same, to the last digit, with a second build of Microsoft BASIC: the **oracle** of
  `src/model/basic-oracle.test.ts` (developer machine only) runs 68 numbers, 19 string and format cases, 15 programs and 400 seeded
  random expressions on mist64's KIM-1 build (built with cc65) and on ours: identical output, and a single flipped bit in the sine
  polynomial is caught by the random ones. **The byte-for-byte comparison with the KIM-1 binary that the spec asked for is not
  possible:** that binary is the 1977 build and Microsoft's file the July 1978 source (the later one has a `GO TO` case, the earlier
  the long error messages), so they differ in the keyword list, the error table and the addresses. Comparing what the programs print is
  what is done instead. (The `eater` target of Ben Eater's fork is a different build again, `CONFIG_2A` with 7 digits, so it cannot be compared digit
  for digit with a 9-digit one.)
- **The target is the KIM-1 build (`REALIO=1`), not a new `REALIO=6`:** the KIM-1 block is the plainest, and its hooks are the ones
  to point at the terminal anyway, so a new block would only have copied it. There are 25 edits to 6,954 lines, each in `target.ts` with
  its reason: the switches (width 40, `RAMLOC=$0300`, `ROMLOC=$C000`, no LOAD/SAVE, the 6502's own ROR), the hooks (`JSR TERMIN`, the break
  check, the banner), `MEMTOP`, the start-up switch, and two repairs of Microsoft's own code that our additions exposed: a branch that
  became too long (`BEQ TYPAUT`, now a jump), and the comma-field cut-off, which the code computes as `width/14*14` when it asks the
  width but which was assembled in one field short (at width 40 `PRINT 1,2,3` put the third item on a second line only when the
  questions were off: the oracle found it).
- **The switch** is the DSR pin as planned (`io.s` reads status bit 6 at reset). With the questions on, `MEMORY SIZE?` accepts a number
  or Enter (the test stops at `$4000`: no stray `U`), then `TERMINAL WIDTH?`; `A` at the first prints the authors' names.
- **Translator facts the spec did not have:** names are significant to six characters (the dispatch table says `RESTORE` where the routine
  is `RESTOR`); `* / & !` bind tighter than `+ -` (not strictly left to right as assumed); a number with an 8 or 9 in it is decimal
  even in base 8; `LDA zp,Y` does not exist, so a zero-page name with `,Y` is three bytes; the translator counts addresses itself (one
  condition asks whether the input buffer straddles a page), and a test checks that it agrees with the assembler about every label (about 900)
  for ours and for machines 1, 3 and 4 of the file. Machine 2 (OSI) has no `GET` routine in Microsoft's file and machine 0 is the PDP-10
  simulator; neither is built.
- **The review of #83 found, and the PR fixed:** after one key typed while a program ran, Control-C no longer stopped it (the break check
  gave up while a key was kept; it now always reads what has arrived and keeps up to 16 keys), and a break waited behind everything typed
  or pasted (it now jumps the queue and clears it); a memory size typed at `MEMORY SIZE?` above `$4000` put BASIC's strings on the
  terminal's registers (it is cut to `MEMTOP`, one more edit); Backspace over a wrapped line left the screen one character behind BASIC
  (the terminal goes back over its own wraps); the translator turned `<X/^O400>+1` into the high byte of `X+1` (it now refuses to add
  anything to a high byte, or a name to either byte). The comma-field edit and these have tests that fail without them. Also changed on the
  review's advice: printing a character updates the screen's lines in place instead of copying the array (0.04 µs a character with a
  full 200 lines, down from 1.2 µs; my first reply measured 1.2 µs as negligible and left it, which was the wrong call when the better
  version costs nothing, since the history copies arrays itself).
- **For the later milestones:** the terminal part has to behave as `acia.ts` does (its tests are the specification, B4 wraps it), the board
  must give BASIC a command register of `$0B` at reset (`io.s` writes it: the receiver is on, its interrupt off), and Backspace reaches
  BASIC as `$08` (`io.s` turns it into the `_` that BASIC takes for delete).

### B2. A fast clock, and history off for a circuit
- **A per-circuit setting, *Step-back history*** (on by default). It is saved in the file (`history: false`, written only when off,
  so other files do not change; an old file reads as on) and in share links. Where *Step back* is, a checkbox *Keep history for
  stepping back* turns it on and off (an undoable edit of the circuit).
- **The simulator** gets `setHistory(on)`: off, `advance` and `stepClock` do not call `record()`, the history is emptied, and
  `canStepBack()` is false. Off means off, paused or running: the setting is for circuits that run too fast to step back over.
- **The UI**: with history off, *Step back* is disabled, and its tooltip says why and where to switch it on.
- **A fast clock.** The clock's *Frequency* gains 16,384 Hz to 1,048,576 Hz (shown as `1 MHz`). A clock faster than the page can
  simulate runs as fast as it can (this is how `advance` already behaves). With history on, a fast clock is as slow as now.
- **The real rate in the CPU inspector**: "Running at 80,000 cycles a second (8% of a 1 MHz 6502)", from the cycle count over the last second.
- **Tests.** The existing history tests unchanged (history on is the default); with history off nothing is recorded, `stepBack()`
  returns false, and turning it back on starts a new history from that edge; the setting survives save, load and a share link, and an
  old file without it has history on; the clock's new settings in a saved file; an e2e test that the checkbox disables *Step back*.
- **Measured, and written here:** the benchmark with history on and off, warm, on one machine; the in-app rate of the LED board at 1 MHz
  with history off.

**What B2 did, and where it differs from the spec.** The engine part is as specified: `Simulator.setHistory(on)`, `historyOn`, nothing
recorded at a clock edge when it is off, the setting kept over a load and a reset, a new history from the next edge when it is switched
on again. The setting is `Circuit.history`, written as `false` only when off (so no existing file changes; the file format is version 4
and an older file reads as on), in files and share links. Undo and redo follow it, and the simulator follows the circuit
(`startRuntime` hands it over at each change, `loadIntoSim` at each load). The clock's rates go up to `1_000_000` Hz, shown as `1 MHz`
(not 1,048,576: a real 6502 runs at a million), by powers of two from 8192. The CPU inspector says "Running at 100,000 cycles a second
(10% of a 1 MHz 6502)", measured over the last second (`RateMeter` in `src/app/cpurate.ts`).

- **The checkbox is in the Tools menu, not next to Back:** the toolbar is full, and the narrow layout's ☰ menu already holds the Tools
  list, so the entry (*Step-back history*, ticked when on) is there on a phone too. Back is disabled when it is off, and its tooltip says
  where to switch it on.
- **Found by measuring in the browser: the page, not the simulation, was the limit.** With a 1 MHz clock the page dropped from 60 to
  6.8 frames a second: each frame gave the simulation its 10 ms, and drawing the circuit took about 135 ms more (headless Chromium with
  software rendering, 4 vCPU Xeon at 2.8 GHz: slower than a desktop with a GPU, but the shape is the same). So the board ran at
  **1,700 cycles a second whatever the history setting**, and the 4× of the engine did not show. The "Speed" setting that the gate after B2
  had put into B3 became an automatic one: the simulator says when it ran out of its time with clock time left (`Simulator.lagging`), and
  only then does the next frame give it as much as the rest of the frame cost, between 10 and 100 ms (`workBudget` in
  `src/app/workbudget.ts`). A circuit that keeps up stays at 10 ms and 60 frames a second. The price is that a circuit with a very fast
  clock is redrawn 2–5 times a second. **B7's Speed setting is therefore not needed** (it could still be added as an override).
- **Probes are capped at 20,000 transitions** (`TRACE_MAX_POINTS`): at 1 MHz they kept millions, and the cost of drawing and of the
  memory grew every second (the 6502 board has probes, and slowed down more and more).
- **Measured.** Engine, warm benchmark on this machine (`VITE_BENCH=1 npx vitest run src/engine/bench`), cycles a second: LEDs only
  41,830 with history, **178,727 without** (4.3×); five devices 28,075 with, **107,103 without** (3.8×). In the browser at 1 MHz (the same
  sandbox as above): before the work budget 1,700 on the LED board, with it, history on / off: LED board with probes 14,000 / 48,000,
  console and keypad board 22,000 / **86,000–110,000** (two runs). The target of the spec, 60,000 cycles a second for a board with one
  device and no probes, is met by the last one even in this slow environment; the BASIC board itself is measured in B6.
- **Not done, as decided:** snapshot-cost work (paged RAM, a ring of snapshots, a cheap CPU copy) stays out; `Not doing` says so.

### B3. Big memory
- **RAM** address bits up to 15 (32 KB); **ROM** up to 14 (16 KB), and its hex text cap raised to 49,152 characters. Old files load
  unchanged (the cap only grows). With history on, a big RAM is copied at every edge (16 KB: about 4 µs, and 1,000 copies held), so the
  RAM's description says to turn history off for a fast board with a big RAM. The *Page* drop-down of the memory inspector lists 64 or 128 pages: check it, and group it by 4 KB if
  it is unwieldy.
- `board6502Builder` gets `memory: 'big'`: RAM 16 KB at `$0000–$3FFF`, ROM 16 KB at `$8000–$FFFF` (seen at `$8000` and `$C000`),
  the address split into A0–A13, A14, A15. The existing boards keep `'small'`, so no saved circuit or example changes.
- `romImage` and the assembler take the ROM size from the board instead of the fixed 4 KB.
- **Tests.** An old file with a 4 KB ROM loads the same; a saved 16 KB ROM survives save, load and a share link; a board with
  `memory: 'big'` runs a program that fills all 16 KB of RAM with a pattern and checks it, then reads the last ROM byte at both
  mirrors; the share link of a board with a full 16 KB ROM is measured and written here.

**What B3 did, and where it differs from the spec.** As specified: the RAM's address bits go up to 15 (32 KB; its description now says to
switch the history off for a fast circuit with a big RAM), the ROM's up to 14 (16 KB) with its hex text cap raised from 14,000 to 49,152
characters (16,384 bytes of two digits and a space). Old files load unchanged: a test loads a 4 KB ROM, a 16 KB ROM and a 32 KB RAM, and
still drops an oversized text (49,153 characters). `board6502Builder({ memory: 'big' })` builds the RAM of 16 KB at `$0000–$3FFF` and the ROM of
16 KB seen at `$8000` and again at `$C000`; the address splitter is `A0–A13, A14, A15`, the ROM takes A0–A13 straight from it (no merger), and
the small board is unchanged: a test compares its saved file with the default board's.

- **Where the image begins.** The assembler's image starts at the program's first `.org`, so the big board's source must start at
  `.org $C000` (the image is the ROM from `$C000`; `$8000` shows the same bytes) and the small board's at `$F000`. The builder now says so
  (*The program starts at $F000, but this board's ROM image begins at $C000*) instead of building a board that runs the wrong bytes. The
  default blink program is moved to `$C000` on the big board, and `romImage(bytes, start, size)` takes the size (the vector is at
  `size − 4`). The ROM inspector already took the size from the part's address bits, so nothing changed there.
- **The page list.** A 16 KB memory has 64 pages of 256 words. The drop-down keeps one flat list up to 32 pages (so the 4 KB ROM looks as
  before) and splits a longer one into groups of 4 KB with their address ranges (`optgroup`).
- **Tests.** A program fills all 16 KB of RAM with a pattern (`low EOR high EOR $A5`, page 0 last because it holds the pointer) and checks
  the ROM at `$8000`/`$C000` and at `$BFFF`/`$FFFF`; the test then compares all 16,384 RAM bytes with the pattern from outside (about
  300,000 cycles of the gate-level board, a few seconds with the history off). Hello and the keypad echo run on the big board with their
  origin moved to `$C000`. e2e: a RAM of 16,384 words shows 64 pages in four groups, and so does a 14-bit ROM.
- **Measured: the share link of the big board with the BASIC ROM in it is 18,183 characters** (the ROM's 16 KB as hex text, LZ-compressed
  by the share link; BASIC is only 8 KB of the image, the rest is zeros, which compress to almost nothing). Browsers and chat programs
  take links of that size; B6 can still offer *Copy as file* beside it.

### B4. The terminal part
- The `acia6551` part around B1's `src/engine/acia.ts` (*The terminal part* above), with the screen and the keyboard buffer added: its symbol (the screen drawn inside, a cursor while it has the focus, "click to type" when it has not), pin descriptions
  (`pindata.ts`), bus mode, and the *Capitals* setting.
- The inspector: the four registers with the status bits spelled out ("receiver full", "interrupt"), whether the receiver is on, what
  is waiting in the keyboard buffer, the screen with its 200 lines, and buttons *Type text…* (a box to paste into; it goes through the
  keyboard buffer), *Copy screen*, *Clear screen*, *Break* (sends $03).
- The keyboard: the hidden `<textarea>` (focus, `input` events, blur). Check every global key handler (`Toolbar.tsx`, `keypad.ts`,
  `gamepad.ts`, the canvas shortcuts) ignores keys typed into it.
- **Tests.** The register behaviour (each status bit, a read clearing *receiver full*, reading the status clearing the interrupt,
  IRQB, the receiver off until command bit 0, programmed reset, `RESB`, `DSRB` in status bit 6); the keyboard buffer's pacing (a character only after the one
  before was read, 8,000 characters at most); the screen (CR, LF, BS, FF, the deferred wrap, scrolling); a snapshot shared with the
  live state is not changed by a later print; an e2e test that types into the terminal on the desktop and on the emulated phone.

**What B4 did, and where it differs from the spec.** The part is `acia6551` (`src/engine/components/terminal.ts`, in the *Input / output* group
of the palette, *Serial terminal (6551)*): the pins as specified (Φ2, RES, CS0, CS1, RS0, RS1, R/W, DI0–DI7, DSR in; D0–D7, IRQ out), a bus
mode that joins DI and D, a *Capitals* setting (on), the register behaviour of `acia.ts` unchanged, a symbol with the 40 × 24 screen, and an
inspector with the registers, the screen, and the four buttons. Pin texts are in `pindata.ts`.

- **It acts at the rising edge of Φ2, not the falling one.** The CPU part moves on at the *falling* edge and changes its address, R/W and
  data in the same step, so a device that looked at those pins at the falling edge could see the next cycle's. Every other device on the
  board (the LED register, the console, the screen) already takes its write at the rising edge, when the pins have been steady for half a
  cycle. The terminal does the same: at the rising edge, if CS0 = 1 and CS1 = 0, a write takes DI into the register, and a read **keeps the
  value it returns** (`out`), which D shows until the next edge. That is also what makes the status register right: the read clears the
  interrupt bit at the edge, but the CPU, which samples D at the falling edge, still sees the bit. Not selected, D shows 0. D is never X
  and a pin that is X (a select, R/W, a register select, the data of a write) makes the edge do nothing.
- **A character moves into the receive register at the same edge in which the one before was read** (the read clears *full*, then the
  chip's clock delivers the next), so the next status read already shows the next character. Nothing is lost; there is no baud rate to wait for.
- **The keyboard.** A hidden `<textarea>` sits over the screen in a `foreignObject` (so it moves, turns and zooms with the part). A click on the
  part (the canvas handler, on pointer-up) focuses it; Tab or a click elsewhere takes the focus away. Typed text comes in through `input`
  events, Enter, Backspace and Delete are keys (CR, BS, DEL), Escape and Control+C are the break (`aciaBreak`), and Control+V or Cmd+V paste
  as usual. After a **touch** the focus waits for the `click` that follows the finger: the browser's mouse-down, sent after the tap,
  would take the focus away again (found by the phone test). While it has the focus the screen shows a blinking cursor, and otherwise
  *click to type*. The global key handlers (canvas shortcuts, keypad, gamepad) already ignore a text box, so Delete does not delete the part.
- **The inspector** (`TerminalInspector.tsx`, loaded when the part is first selected): the registers with their bits spelled out (character,
  status with *receiver full*, *transmitter empty*, DSR and *interrupt*, command with *receiver on/off* and *receive interrupt*, control), how many
  characters wait on the keyboard, the screen text (all 200 lines, scrolling), and the buttons *Type text…* (a box that sends through the
  keyboard buffer), *Copy screen*, *Clear screen* and *Break*. The registers are read every 100 ms while it is open.
- **Not in B4:** the part is not on a board yet (B5), so the timing of the rising-edge design against the CPU is first checked there, with
  the echo programs. The startup bundle grew by the part, its symbol and its styles (167.2 kB to 171.2 kB gzipped with the UI work that
  came in between; the budget is 180 kB); the inspector is its own lazy chunk.
- **Tests.** Part, pin level (`terminal.test.ts`, 12): the write at the rising edge and only then; status and DSR; the receiver off until
  command bit 0; one character at a time; IRQ low from the arrival until the status is read, and that status still showing bit 7; no interrupt with the
  interrupt off; the two selects; unknown pins; RES clears the registers and keeps the screen and the buffer; the programmed reset; the control register;
  a copy for the history unchanged by a later print. Keyboard logic (`app/terminal.test.ts`, 6): the keys, the break ahead of the queue,
  capitals and no capitals, a paste. e2e: on the desktop, click, type, Backspace and Delete (the part stays), Control+C, the *Type text…* box, *Break*
  and Tab; on the emulated phone, tap and type. The pin-documentation and bus-mode tests include the part.

### B5. A board with the terminal, and two echo examples
- `board6502Builder` gets a `terminal` device: CS0 ← A14, CS1B ← A15, RS0/RS1 ← A0/A1, R/W ← the CPU, its D into the multiplexer's
  device input, IRQB to the CPU's IRQ when asked. It needs `memory: 'big'` and is the only device (the builder says so if not).
- Example **6502 + terminal: echo**, in 6502 assembly: switch the chip on, print `HELLO`, then wait for a character and send it back
  (CR as CR LF). Example **6502 + terminal: echo by interrupt**: the same, with the receive interrupt (the handler reads the status,
  then the data). Both use Ben Eater's addresses (`$5000–$5003`) and his register names in the source. They keep history on and a
  slow clock, so you can step through the loop that polls the status register.
- **Tests.** Both programs on the board in the unit tests (typed text comes back; the interrupt one with the CPU busy in a loop);
  e2e: open the example, type, see the echo.

**What B5 did, and where it differs from the spec.** As specified: `board6502Builder({ memory: 'big', devices: ['terminal'] })` puts the
`acia6551` part on the board (CS0 ← A14, CS1B ← A15, RS0/RS1 ← A0/A1 from an address splitter, R/W straight from the CPU, the CPU's D into DI,
the terminal's D into the multiplexer's third input, RESB from the reset button's inverter), and `interrupt: true` wires its IRQB to the CPU's.
It throws if the memory is not `'big'` or if there is any other device. The examples are `6502-echo` and `6502-echo-irq` (256 Hz, history on),
with the sources `ECHO_SOURCE` and `ECHO_IRQ_SOURCE` in `programs6502.ts`, using Ben Eater's register names.

- **No write strobe, no register decoder.** The chip looks at the address wires itself (that is what its two selects are for), so the board
  has none of the LED register's decoding (`nA15`, `ledWe`, the 3-bit decoder) and the address splitter is `A0, A1, the rest`. The decoder's
  note says why: the block `$4000–$7FFF` repeats the four registers.
- **The rising-edge design works against the CPU**, as B4 left open: the CPU samples D at its falling edge and sees the value the read returned,
  including a status register whose interrupt bit the same read cleared. Nothing needed changing.
- **The polling echo** sends with a wait for status bit 4 (always set here, but it is the habit of real code); the interrupt echo does not.
  Enter is CR, and both send an LF after it. The interrupt echo's main program counts in `$00–$01`, so the RAM inspector shows it still busy.
- **Labels are cut at 40 characters** (the file format's limit; the first labels were longer and the round-trip test said so).
- **Tests.** Unit (`board6502.test.ts`): the builder's refusals; the wiring; polling echo (HELLO, typed text back as capitals, a key typed before the
  receiver was on, the break key); interrupt echo (the counter keeps counting between and after interrupts, IRQ released afterwards); without
  the IRQ wire the flag is raised and the CPU never answers. e2e (`computers.spec.ts`): both examples, type and see the echo. The golden file
  and the gallery counts gained the two examples.

### B6. The BASIC computer
- Example **BASIC computer**: the board of B5 with `basic-rom.ts` in its ROM, the clock at 1 MHz, history off, framed and explained like the other
  boards: the memory map in the decoder's note, the terminal's note ("click the screen and type; try `PRINT 2+2`"), the memory note
  (where BASIC, your program and its variables live), and a line on speed (finding 4).
- A switch **Ask the start-up questions** (off), wired to the terminal's `DSRB`, with a note: it is read at *Reset*.
- It starts by itself: power-on reset, the banner, `OK`. *Reset* is a cold start (the program is lost), as on Ben Eater's board.
- **Tests.** The B1 checks again, now on the board (start-up to `OK`, `PRINT 2+2`, a short program, the switch on and *Reset*: `MEMORY SIZE?`); the board left running for a
  minute keeps its memory use flat (the trace, the history and the screen are bounded); e2e: open the example, type
  `10 PRINT "HELLO"` and `RUN`, see `HELLO`, on the desktop and on the emulated phone.

**What B6 did, and where it differs from the spec.** The example `6502-basic` (*6502* group, short link `/6502-basic`) is the board of B5 with the
16 KB BASIC image (`basic-rom.ts`) in its ROM, the clock at 1 MHz and `history: false` saved with the circuit. The decoder's, memory's and devices' notes
say what the spec asked (the memory map, where BASIC and your program live, *click the screen and type; try `PRINT 2+2`*, and the speed: about a
sixth of a real 6502). It starts by itself and *Reset* is a cold start (the simulator's reset clears the RAM and the screen).

- **The switch** *Ask the start-up questions (at Reset)* is a plain switch part on the terminal's `DSRB` pin (`dsrSwitch` in the builder), off.
  Turned on, the next *Reset* shows `MEMORY SIZE?` and `TERMINAL WIDTH?`; Enter answers both.
- **Measured.** In headless Chromium with software rendering, the CPU inspector says 170,000 cycles a second (17% of a 1 MHz 6502) with the BASIC board
  running a program, above the 60,000 target. Start-up to `OK` is about 17,000 cycles (a fraction of a second). The share link of the board is the
  18,183 characters measured in B3, and its example file is 60 KB (a 16 KB ROM as hex text).
- **Notes are cut at 600 characters** by the note part (a longer text is dropped), so the devices note is shorter than the spec's draft; a test checks
  that no note of the board is over the limit.
- **Tests.** Board (`board6502.test.ts`): the circuit's settings (history off, 1 MHz, a 16 KB ROM, one switch, the setting survives a save); start-up to
  the banner and `OK`; `PRINT 2+2`; a three-line program and `RUN`; the switch on and *Reset* gives the two questions; a program printing forever
  for 600,000 cycles keeps the screen at its 200 lines, the history empty. e2e: desktop (type `10 print "hello"` and `run`) and the emulated phone
  (tap, type `print 6*7`, see `42`). The offline spec counts the examples (it said 54 and was already behind by B5's two; now 57).

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
2. **mist64/msbasic and Ben Eater's fork are not used in the repo** as long as plan A works. Their code is not copied, linked or
   committed. They, and the historical KIM-1 binary, may be used on a developer's machine as an **oracle** to check our build against.
3. **EhBASIC is not an option** (commercial use needs the author's permission).
4. **Only if B1 falls back** (*Risks*): the image is built from `beneater/msbasic`. For its `eater` target the code is essentially
   Microsoft's BASIC 1.1, which Microsoft has since released under MIT; the reconstruction and the target are BSD by their READMEs (no
   `LICENSE` file). The repo then keeps Microsoft's MIT notice and the BSD notice (Michael Steil, Ben Eater) next to the image, the
   README says which commit it was built from and that the BSD grant is a README statement, and the reference page credits both.
- The PR that adds the image says in its description which source it was built from.

## Not doing
The C64 (see *Why*); a tape or disk, a file system, `LOAD` and `SAVE` (programs are typed or pasted; the circuit's own file save keeps
the circuit, not the program); graphics and sound statements; lower-case BASIC; a warm start that keeps the program over *Reset*; a 6522
VIA and the LCD of Ben Eater's computer (a good follow-up: another behavioural part and a BASIC `POKE` example, at his `$6000`);
Wozmon and other code from Eater's videos whose licence is not clear; other BASICs (Applesoft, Commodore); running the simulation in a
Web Worker (it would give the simulation the whole frame, but changes how every part of the app talks to the simulator); cheaper
step-back snapshots (sharing unchanged state, a fast CPU copy, a reused history ring, paged RAM): the plan's profile says they would make
every circuit with history faster, and they stay a good later step, but the BASIC computer does not need them.

## Decisions
1. **The port goes first (B1)**: it is the one risk that could stop the plan, and it needs nothing else from it. *(Decided.)*
2. **Ben Eater's memory map** (16 KB RAM, terminal at `$5000`, ROM `$8000–$FFFF`) rather than the plan's (32 KB RAM, terminal at
   `$8000`, ROM `$C000–$FFFF`). His map is what people following his videos know (his addresses, his code, his wiring), it is the
   decoding our 6502 board already has (no new gates: the terminal's own chip-select pins do it), and 16 KB is plenty for typed
   programs (about 15,600 bytes free; a long listing from a 1970s book is a few KB). The plan's 32 KB would need a different decoder
   and buys room nobody types in. *(Decided.)*
3. **The start-up questions are a switch on the board**, off by default (see B1 and B6). *(Decided.)*
4. **A 40 × 24 screen.** 80 columns would make the part about 600 px wide, twice any other part, and on a phone 80 columns are about 4 px
   a character, unreadable without zooming and scrolling; it would also make BASIC wrap at 80. Rows cost only height, so 24 rows (as a
   real terminal) instead of 16 is free. *(Decided.)*
5. **The receiver is off until a program switches it on**, as on the chip. *(Decided.)*
6. **The BASIC computer runs without step-back history**; every other circuit keeps it. *(Decided.)*

## Risks
- **The port (B1)**: about 7,000 lines in a dialect nothing here reads, with its macro file missing. The instruction forms are
  recovered from use and the octal maths package is easy to get subtly wrong; the maths checks and the KIM-1 comparison are there for
  that. **Fallback**, if B1 is not done within its week: build the image from Ben Eater's fork of mist64's reconstruction
  (`beneater/msbasic`, its `eater` target, which already talks to a 6551) with the `cc65` tools, on a developer's machine, and commit
  the image with its recipe. About a day of work. Its licence is a little weaker (see *Licences*, point 4). Not a BASIC of our own
  (far more work, and not Microsoft's), and not EhBASIC.
- **Speed (B2)**: the target follows from the history-off benchmark (114,000–198,000 cycles/s). If the app falls short, BASIC still
  runs, only slower, and the gate after B2 brings the *Speed* setting forward.
- **B2 touches every circuit only through a default**: history on unless a file says off; the existing history tests and the golden
  simulation test (`sim-golden`) must pass unchanged.
- **Typing (B4)**: focus, phone keyboards and the editor's shortcuts; e2e on the emulated phone from the start.
- **CI time**: BASIC's start-up in the e2e tests at the speed of a CI machine; give those tests room, and check the shard times.

## Verification
Per step, the `CLAUDE.md` checklist (all unit tests, lint, build with the bundle budget, the e2e specs for the area), plus screenshots in
every PR with something to see (the board at desktop and phone width, the terminal with `OK`) and a look in light and dark. The numbers
each step measures are written into this file in its PR.
