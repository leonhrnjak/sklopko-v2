# Control ROMs you can read and edit (plan)

> **How to execute this plan**
> - Read `CLAUDE.md` first. Its rules apply: version bump once per PR, scoped tests, quiet reporters.
> - Work milestone by milestone, in order. Each ends in a working, tested state. Tick its box below when it is done and add a
>   short *What it did, and where it differs from the plan* note under it, as `plan-m10-buses.md` does.
> - One PR per milestone, stacked as in `plan-next-milestones.md`: `c1-decoded-listing` on `main`, `c2-edit-row` on that, and so on;
>   each bumps the version once.
>
> - [x] C1 A decoded listing: named signals and named rows, on the four computer ROMs, v0.0.1-79
> - [x] C2 Edit a row by signal: toggles and lists instead of hex, v0.0.1-80
> - [x] C3 The text form: `LDI: LOAD_ACC SRC=CONST`, and the computers' control ROMs generated from it, v0.0.1-81
> - [x] C4 Ready-made control ROMs with the pins named after the signals, v0.0.1-82
- [ ] C5 Polish: the reference page, the example notes, e2e, README

## Why
The program ROM is easy to read and write because it has a language (SKASM) and a listing that shows each word as an
instruction. The **control ROMs** have neither: you see `0049 0000 0409 …`. Yet they are where the computer is *designed*: a
row says, for one instruction, which parts switch on (load the accumulator, write RAM, subtract, jump…). The names already
exist in the code (`computer2.ts` lists every control bit and each instruction's row in `CONTROL`; the Beginner computer
documents its 8 bits in a comment), the ROM inspector just does not know them.

There are four such ROMs: `Control`, `Control 2` and `Control 3` of the SKASM computers (16, 8 and 8 bits, 256 rows each,
addressed by opcode + 16 × sub-opcode) and the Beginner computer's `Control ROM` (8 bits, 16 rows).

## Decisions
- **The names live on the ROM part**, as two text params, so a custom or future computer (or a hand-built circuit) can use
  them without any change to the app:
  - `signals`: the layout of a word, one signal per line, **lowest bit first**. `LOAD` is one bit; `SRC 3 = CONST ALU RAM …`
    is a field of 3 bits whose values have names (value 0, 1, 2, …); `JUMP_IF 2` is a field shown as a number; `_ 3` skips
    three bits that nothing uses. `;` starts a comment. Empty (the default) means "not a control ROM".
  - `rows`: the names of the addresses, one per line: `00 LDI`, `01 LDA`, … (hex address, then a name). A row without a
    name is shown by its address only.
  Both are plain, validated text like `data` and `source`, and saved with the circuit. Nothing about them touches the
  simulation: `data` stays the only thing that runs.
- **`data` stays the single truth.** The decoded listing, the row editor (C2) and the text form (C3) are all views of it,
  so they can never disagree and there is no second copy to go stale. (Unlike a program, a control ROM has no `source`
  param: the text form is generated from the words and the two layouts each time.)
- **The same words as before.** The builders keep producing byte-for-byte the same control ROM contents; a test says so.
  Existing circuit files keep working: a ROM without `signals` is shown as before, and the inspector offers a preset
  to give an old saved computer its names (C1).
- **The text form is SKASM-like**: one row per line, `NAME: signals…`, `SRC=CONST` for a field, comments with `;`, errors
  with line numbers, applied when you click away (one undo step), as the program editor does (C3).
- **Not in scope**: microcode with several steps per instruction (these computers do each instruction in one clock
  cycle), a different number of bits per ROM, naming the bits on other parts (a plain ROM of hex words stays as it is).

## C1. A decoded listing
- `src/engine/signals.ts` (new, no UI): `parseSignals(text)` → the layout (signals with their bit position, width and value
  names) and the errors with line numbers; `parseRows(text)` → address → name; `describeWord(layout, word)` → the signals
  that are on (`LOAD, SRC=CONST`; a name for a value, a number for an unnamed one, `—` for an all-zero word);
  `encodeWord(layout, parts)` for C2/C3.
- ROM params `signals` and `rows` (defaults empty, kept out of the generic parameter list like `data`), saved and validated
  by the existing machinery.
- The builders fill them in: `computer2Builder` for `Control`, `Control 2`, `Control 3`; `beginnerBuilder` for `Control ROM`.
  The layouts are written once next to the control bits they describe, and a test checks them against the `CONTROL` table
  and the splitter in the builder (so a bit cannot be renamed on one side only).
- The ROM inspector: for a ROM with `signals`, each listing row shows `address  word  NAME  signals` (the row's name, e.g. `ADD`,
  and what it switches on, e.g. `LOAD, SRC=ALU, SAVE_FLAGS`). The row being read right now is marked as for a program.
  A `Signals` section (collapsed) shows the two texts, so a custom ROM can be given its names; a preset list offers the
  four built-in layouts (for circuits saved before this).
- Tests: parser (good and bad layouts), describe/encode round trip, every row of the three SKASM control ROMs and the
  Beginner ROM decodes to what its `CONTROL` entry says, the listing in e2e.

## C2. Edit a row by signal
- Click a row of a control ROM's listing: it opens an editor under the row, a checkbox per one-bit signal and a list per
  field (`SRC`: CONST, ALU, RAM …), with the hex word shown and a **Clear row** button. Each change writes the word into
  `data` (one undo step). Only one row is open at a time; the open row follows the simulation if you want
  (stepping with the clock shows the decoded row, as the program listing does).
- Bits that are not in any signal (the leftover high bits, `_` runs) stay as they are and show as `bit 13`, editable as raw bits.
- Running simulations: editing while it runs is allowed for hex today, so it is allowed here too.
- Tests: toggling a signal changes exactly one field of the word; e2e: change SUB's row to not subtract and see the result.

## C3. The text form
- `assembleSignals(layout, rows, text)` → words and errors. Syntax: `NAME: SIG SIG FIELD=VALUE`, where `NAME` is a row name
  (from `rows`) or an address (`0x1E`); `LDI: LOAD SRC=CONST`; `NOP:` is an all-zero row; a field value is a name or a
  number; rows left out are 0; `;` comments. Errors: unknown signal, unknown value, value too big for the field, a row
  named twice, an unknown row name.
- The ROM inspector gets a *Contents are* choice **Control signals (text)** next to *Hex words* and *A program in SKASM*:
  a text box generated from the words (only rows that have a name or are not 0), checked as you type, applied when you click
  away or press Ctrl+Enter, with *Open…* / *Save…* of a `.txt` file.
- The computers' control tables are written in this form (`LDI: LOAD SRC=CONST`) and assembled with their own layout, instead of
  the numeric constants (`LOAD | src(SRC.CONST)`): the layout is then the one description of the bits. A golden test pins the
  resulting words to today's.
- Tests: assemble/describe round trip over all four ROMs, error messages, the generated text.

## C4. Ready-made control ROMs, pins named after the signals
Added after C3, when asked how to map control signals to the output pins more easily. Instead of a break-out splitter, the ROM names
its own pins: with valid `signals`, the data pins show the signal names (`WRITE_RAM`, `SRC0`…) while keeping their ids `D4`… in wires and
saved files, so nothing existing changes. The ROM body widens to fit the names. A ROM in bus mode shows one bus pin, so this is for
single-pin ROMs (the Beginner computer's, and any custom one). The inspector's *Make it a ready-made control ROM* list sets the size,
the names, the words (assembled from the text form) and turns bus ports off, so a plain ROM becomes the SKASM or Beginner control ROM
in one step.

## C5. Polish
- The SKASM reference page gets a *Control signals* tab: each signal of the three ROMs and what it does, and a table
  of which signals each instruction switches on (generated from the same layouts and tables).
- The Beginner computer's notes and the gallery blurb of the SKASM computers point at the decoded listing.
- e2e for the whole path (open a control ROM, read it, edit a row, edit the text); the README gets a line.
- Check the phone layout of the listing and of the row editor.

## What each milestone did

### C1 (v0.0.1-79)
- `src/engine/signals.ts`: `parseSignals`, `parseRows`, `signalParts` / `describeWord`, `signalValue` / `withSignal` (for C2), and
  `splitPlan`. `src/engine/signal-presets.ts` holds the four built-in layouts and the row names (small, so the inspector can
  import it without pulling in the computer builders).
- **Differs from the plan:** the builder's splitters for the control bits are now *generated from the layouts*
  (`splitControl` in `computer2.ts` takes the widths and the pin of each signal from `splitPlan`), so the bit positions exist in
  one place instead of two. The signals are named as the wires on the canvas are (`LOAD_ACC`, `WRITE_RAM`, `B_IS_NUM`…), not as the
  old constants were (`RAM_WRITE`, `CONST_B`). A field can say `if LOAD_ACC` so it is shown while that signal is on even when it is 0
  (that is how an LDI row reads `LOAD_ACC, SRC=CONST`); this was not in the plan.
- The listing of a control ROM: `address  word  NAME  signals`, with a checkbox "Only rows with a name or signals" for the 256-row
  ROMs. Under it a collapsed "Names of the bits and rows" section with the two texts (errors with line numbers) and a *Start from*
  list of the built-in sets, for circuits saved before this (matched by the ROM's size). The inspector is wide for a control ROM.
- **A bug that was already there, fixed on the way:** the listing of any ROM collapsed to 2 px when the inspector was taller than the
  window (the inspector is a flex column and the listing had `overflow: auto`); it now has `flex: none`.
- The `rows` text is the same for the three SKASM ROMs (all 36 names), so ROM 2 and 3 show `nothing` on rows they do not use. If that
  is too noisy, C4 can name only the rows each ROM uses.
- Tests: `signals.test.ts` (parser, words, `splitPlan`), the decoded rows of all three SKASM ROMs and the Beginner ROM against the
  `CONTROL` table in words, the splitters against the layouts, and the beginner's wires against its layout; two e2e tests.

### C2 (v0.0.1-80)
- Clicking a row of a control ROM's listing (or Enter on it) opens **Row NAME** under the listing: a checkbox for each one-bit
  signal, a list for each field (`ALU (1)`, `RAM (2)`…; a number box above 5 bits), set bits that no signal names (they can be
  cleared, not set), **Clear row** and **Done** (Escape inside it also closes). Each change writes the ROM's `data` (one undo step,
  works while the simulation runs). Only one row is open at a time; an open row stays in the listing even if it is empty.
- **Differs from the plan:** the editor is *below* the listing, not inside it (inside, it was cut off by the listing's own scroll
  area). The open row does not follow the clock; the "current row" mark on the listing already shows what is being read. The editor
  is off while the signal list has errors (the hex text still works).
- Tests: one e2e (SUB's SUBTRACT unticked and its source list changed, hex words follow, Clear row, Done, Escape and keyboard).

### C3 (v0.0.1-81)
- `assembleSignals` and `signalsToText` in `engine/signals.ts`. A row is `NAME: SIGNAL FIELD=VALUE …` (or `0x1E:` by address); names and
  values are not case sensitive; a field may take a number; `bitN` sets a bit no signal names; every error has its line. Writing a
  ROM's words as text and assembling that gives the same words (tested over every word value and over the real ROMs).
- The ROM inspector's *Contents are* offers **Control signals (text)** for a ROM whose names parse (and is the first view of one): a
  text box checked as you type, applied on blur or Ctrl+Enter as one undo step, with *Open…* and *Save…* of a `.txt`. **Differs from
  the plan:** no `source` is stored. The text is written from the words each time, so comments are not kept and the text can never be
  stale; the choice between text and hex is only a view (not saved with the part).
- The computers' control tables are now this text (`SKASM_CONTROL_1/2/3`, `BEGINNER_CONTROL_TEXT` in `signal-presets.ts`); the numeric
  constants (`LOAD | src(SRC.CONST)`…) and `CONTROL` table are gone from `computer2.ts`, and the Beginner ROM's byte list from
  `beginner.ts`. A golden test pins the words to what the numeric table produced, and `controlWords` refuses an instruction that no
  text lists (`NOP:` is listed, with nothing on).
- Tests: parser/assembler/round trip in `signals.test.ts`, the golden words and the round trip of the three SKASM ROMs, an e2e for the text view.

### C4 (v0.0.1-82)
- `pinLabels` in `engine/signals.ts` and the ROM's `layout` (labels only when the signal list has no errors; width from the longest name).
  `SIGNAL_PRESETS` now carry the control text, and `presetParams` assembles a preset into the ROM's size, names and words (tested against
  the words the computers are built with). The inspector's list replaces *Start from* and works for a ROM of any size.
- The Beginner example's columns after the ROM moved right by 100 px: its output pins are wider now, and the net labels next to them
  need the room (two tests caught labels that had no room and became plain wires).
- **Not done:** the 8-bit computer still uses bus ports and a splitter after each control ROM, so its ROMs do not show signal names on
  the canvas; the splitter outputs and net labels name the signals. Changing the computer to single-pin ROMs would remove three splitters
  but change a large, routed layout, so it is left for a decision.

