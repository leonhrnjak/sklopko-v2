# From NAND to a computer: a guided learning path (plan)

> **Status: L1 and L1.5 built; L2 under way (L2a, chapter 3, #105; L2b, explore steps, #106; L2c, the spotlight, #107; L2d-1, chapter 4, built).** Read `CLAUDE.md` first. Seven PRs, stacked (`learn-l1-framework`, `learn-l2-explore`, …), each
> based on the one before; L1 bumps the version to `0.4.0`. Tick each box when its PR merges and add a *What it did, and where it differs
> from the plan* note under it, as `plan-via-lcd.md` does.
>
> **While there are no CI credits:** every PR runs the whole check locally before it is merged (`npm test -- --reporter=dot`, `npm run lint`,
> `npm run build`, and the whole e2e suite, `npm run e2e`) and writes the results in its *Checks* section. This replaces the usual "scoped e2e
> locally, the rest in CI" until CI runs again.
>
> - [x] L1 The framework (map, step panel, progress, your kit) and chapters 1–2 (bits; NAND is all you need)
> - [x] L1.5 Kit chips look like the gates they are: gate symbols for ICs that are known gates, and smaller boxes for the rest (own PR, `ic-gate-symbols`)
> - [ ] L2 Explore steps, quizzes, the spotlight, and chapters 3–6 (from a truth table to gates; choosing; adding numbers; the ALU)
>   - [x] L2a Quiz blocks, map figures, NAND-only rules, chapter 3 (#105)
>   - [x] L2b The goal evaluator and the explore steps of chapters 1–2 (own PR, `learn-l2-explore`)
>   - [x] L2c The `[[label]]` spotlight (own PR, `learn-l2-spotlight`)
>   - [x] L2d-1 Chapter 4, choosing (own PR, `learn-l2-ch4`)
>   - [ ] L2d-2 Chapter 5, adding numbers
>   - [ ] L2d-3 Chapter 6, the ALU
> - [ ] L3 Clocked builds and chapters 7–8 (memory; counting, ROM and RAM)
> - [ ] L4 The CPU project: chapter 9 (build a computer, and its two upgrades)
> - [ ] L5 Program steps: chapters 10–11 (programming your computer; a bigger computer)
> - [ ] L6 The 6502 and BASIC: chapters 12–14
> - [ ] L7 Polish: the phone sheet, backup, entry points, README
>
> The mockup of every screen is `docs/mockups/learn-path.html` (open it in a browser; it has no dependencies; a published copy is at
> https://claude.ai/artifact/RKVpcszUh8wGNZyLrQBqwk). The ASCII wireframes below are the same screens. (The mockup was drawn before chapter 3, *From a truth table to gates*, was added: its chapters from 3 on are one lower than here.)

## Why
Everything a course needs is in the app already, in separate places. There are 17 challenges (`src/model/challenges.ts`) and 60 examples
in 12 gallery groups (`src/model/examples-index.ts`). There are custom ICs (`src/model/ic.ts`), a testbench (`src/model/testbench.ts`), a
4-bit computer meant to be read (`src/model/beginner.ts`), the 8-bit SKASM computer, a cycle-exact 6502 on Ben Eater's board
(`src/model/board6502.ts`), the VIA, the LCD, and Microsoft BASIC. Nothing leads a learner from one to the next. Someone who opens Sklopko
sees a counter and a parts list. They cannot find their way to "I built a computer, and then I ran BASIC on a real CPU".

Turing Complete (a game: NAND, then gates, then a CPU you build and program) and CircuitVerse's *Interactive book* (chapters with
embedded circuits) show what works. Turing Complete has a sequence of levels where each level's result becomes a part. The book has text
next to a live circuit. Sklopko can do both, and it goes further than either: the path ends on a real 6502 running a real BASIC, in a
browser, with nothing to install. **The path is what ties together everything built so far.**

## What a learner does
1. Opens **Learn** (a toolbar button, or `/learn`). A map shows 14 chapters, from *Signals and wires* to *A computer that runs BASIC*, with
   **Continue** at the top.
2. Each step is short: a few paragraphs with live links into the circuit, and one thing to do. That can be build a gate, play with an
   example until some goals tick, answer a question, or write a program. The step is checked automatically.
3. Every gate and block they build goes into **Your kit** as a chip, and the next steps use it. AND is built from *your* NOT, the 4-bit adder
   from *your* full adders. When a chapter is done, the matching built-in parts unlock, which are the same thing, only faster.
4. In chapter 9 they build a 4-bit CPU in one circuit that grows step by step: fetch, decode, the accumulator, RAM, the adder, jumps.
   Then they give it decisions (a zero flag and conditional jumps) and a way to talk to the world (an output at a memory address). In
   chapter 10 they program it.
5. They tour the 8-bit computer and program it for the ideas the 6502 needs: an index register and subroutines. Then they meet the 6502
   and see that it is the same machine on one chip. They wire its address decoder, program it in assembly, and finish by typing
   `PRINT "HELLO"` into Microsoft BASIC.
6. Progress, the circuits they built and their kit stay in the browser. Nothing is sent anywhere.

## Decisions
- **Name:** *Learn*, subtitled *From NAND to a computer*. A toolbar button left of *Examples*, also *Tools ▾ → Learn*. Routes `/learn` (the
  map) and `/learn/<step-id>` (a step: a link a teacher can hand out, which covers part of the dropped milestone 15a).
- **The learner builds a 4-bit CPU, not an 8-bit one.** Building the 8-bit computer is mostly more wiring of the same ideas. The ideas the
  6502 needs that the beginner computer lacks are taught one at a time instead, in four steps (see *The bridge to the 6502*).
- **Chips carry forward, then built-ins take over** (Nand2Tetris and Turing Complete). A build step with a `chip` turns the learner's passing
  circuit into a custom IC in their kit, and later steps that `use` it get it. When a chapter is done, the built-in parts that do the same thing
  unlock. From chapter 9 on, the steps use built-ins, so the CPU runs at full speed and a slip in an early chip cannot break it.
- **Soft gating.** Any step can be opened, from the map or a link. The map always recommends the next step. A step whose chips the learner
  has not built uses the reference chips and says so: "You haven't built XOR yet, so this step uses ours. *Build it* →".
- **Show a solution** marks the step *shown* (◐), not *solved* (✔). It counts for unlocking, so nobody is stuck, and the kit gets the
  reference chip. Solving it later turns it to ✔.
- **Stars, optional and few.** Some build steps have a par, for example XOR in 4 NANDs, and give a ⭐ for meeting it, as Turing
  Complete's scores do. A star never blocks progress.
- **Existing challenges are reused, not copied.** A step can be an existing challenge (`challenge: 'half-adder'`). It shares that
  challenge's solved state (`sklopko.challenges.v1`) and its library document (`origin.challenge`). The Challenges list marks those *In the
  path: chapter 5*. Challenges stay as they are: free practice.
- **All progress is local.** Small state goes in `localStorage`, circuits in the IndexedDB library (as challenges do now). *Download all* and
  *Import* in *My circuits* carry the path's progress as well, so it can move to another computer.
- **Chips look like the gates they are** (L1.5, from a review of L1). A custom IC used to be a labelled box, at least 80 × 60 against 40 × 40 for an
  AND gate, so a learner's AND never looked like an AND. Now an IC that behaves as a known gate (NOT, buffer, AND, OR, NAND, NOR, XOR, XNOR) is drawn with
  that gate's symbol at the gate's own size (US or IEC, as the setting says), in the chip colour with its name under it, so it still reads as *yours*.
  Every other IC stays a box but is smaller (at least 60 wide, 40 tall for one input and one output). The gate is a field of the definition
  (`ICDef.symbol`), set by the kit steps (they know what they build) and, for chips made by hand, found from the truth table when the IC is made. The
  pins keep the IC's own names, so nothing wired changes.
- **The map opens where you were.** On the chapter of the step last visited, not on the one *Continue* recommends, so finishing a chapter and opening the
  map shows that chapter. A skipped earlier step is offered as "Go back to a step you skipped", not as the way on.
- **No new engine, no new editor.** Checks use `checkChallenge` and `runSteps` (testbench) and `Simulator`. Programs are edited in the
  ROM inspector that already edits SKASM and 6502 assembly. Control ROM rows are edited with the C2 editor (by signal). Live state is read the
  way the inspectors read it (`sim.state`, `sim.subscribe`).
- **The startup chunk stays under budget.** It is 177.7 kB of 180 (`scripts/check-bundle.mjs`). The main chunk gets only the button, the
  routes and a small index of the steps (ids, titles, chapters, about 3 kB). The step contents, the checkers, the map and the panel are lazy
  chunks, as `ChallengePanel` is in `src/App.tsx`.

## The bridge to the 6502
The beginner computer (`/beginner`) has PC, Program ROM, a control ROM, ACC, a 16-word RAM, an adder and seven instructions. The 6502
has more ideas than that, but not many. Each one gets one step, built from what the learner already has:

| Idea the 6502 needs | Where the path teaches it | What it becomes on the 6502 |
|---|---|---|
| Flags and conditional jumps | 9.9 *Decisions*, on **their own CPU**: their ZERO chip, a Z flag register, and the JZ and JNC rows of the control ROM (SKASM opcodes 8 and 6, which fit the 4-bit opcode field) | the P register, `BEQ`, `BNE`, `BCC`, `BCS` |
| Memory-mapped I/O and address decoding | 9.10 *Talking to the world*, on **their own CPU**: an AND of the address bits makes `STA 15` write an output register (a display) instead of RAM | `STA $4000` lights the board's LEDs; its decoder is three gates (12.3) |
| Wider data and a shared bus | 11.2, one small build: two registers on one bus through tri-state buffers | the 8-bit data bus |
| An index register | 11.4, a program on the 8-bit computer: add up a table with X | X and Y, `LDA table,X` |
| Subroutines and a stack | 11.5, a program with `CALL` and `RET` | `JSR` and `RTS`, the stack in page `$01` |
| One memory for program and data | 12.2, explore: step the 6502 cycle by cycle and watch it read the opcode, then the operand, then write `$4000` | why one instruction takes 2–7 cycles |

Chapter 12 opens with this map, from *your* computer to the 6502:

| Your 4-bit computer | The 6502 |
|---|---|
| PC (your counter with load) | PC, 16 bits |
| ACC | A |
| Carry and zero flags | C and Z in P (plus N, V, I, D) |
| (8-bit computer) X, the return stack | X, Y, S and the stack page `$0100–$01FF` |
| Program ROM, its own address | ROM at `$8000–$FFFF`, on the same bus as everything else |
| RAM, 16 words | RAM at `$0000–$3FFF` |
| Output register at address 15 | LEDs at `$4000` (the VIA at `$6000` on the bigger boards) |
| Control ROM, one row per opcode | the 6502's decoder (inside the chip) |

## The curriculum
Kinds: 📖 **read** (text, with an optional quiz), 🔍 **explore** (an example or a prepared circuit with goals that tick while you play),
🔧 **build** (a circuit checked against a truth table or step list), 🏗 **project** (one CPU circuit that grows from step to step), ⌨
**program** (SKASM or 6502 assembly, checked by running it). *Chip* is what goes into the kit. *Unlocks* lists the built-in parts that unlock
when the chapter is done.

Step ids are permanent (progress is stored by them). Numbers like 5.3 are only for reading.

### 1. Signals and wires
| # | id | Kind | What | Check | Links |
|---|---|---|---|---|---|
| 1.1 | `bits` | 🔍 | A bit is 0 or 1; wires are green, red or grey. A switch, an LED, Run and Pause | goals: Y lit; Y dark again | |
| 1.2 | `wire` | 🔧 | Make the light follow the switch | challenge `wire` | |
| 1.3 | `binary` | 📖 | Four bits make 16 numbers; place values 8 4 2 1 | quiz: 1011 = ?, 6 = ?, how many numbers in 4 bits | |
| 1.4 | `show-nine` | 🔍 | A 4-bit input and a hex display | goals: the display shows 9; then 15 | `/counter` |

### 2. NAND is all you need
Palette: NAND, switches, LEDs, and your kit. Everything is built from NAND.
| # | id | Kind | What | Check | Chip |
|---|---|---|---|---|---|
| 2.1 | `meet-nand` | 🔍 | Find the only combination that makes a NAND give 0 | goal: Y dark | |
| 2.2 | `not-from-nand` | 🔧 | Y = NOT A, from one NAND | `Y = ¬A`, only NAND | NOT |
| 2.3 | `and-from-nand` | 🔧 | AND = NAND, then your NOT | `Y = A·B`, only NAND | AND |
| 2.4 | `or-from-nand` | 🔧 | OR from NANDs (De Morgan) | challenge `or-from-nand` | OR |
| 2.5 | `nor-from-kit` | 🔧 | NOR from your OR and NOT | `Y = ¬(A + B)`, only NAND | NOR |
| 2.6 | `xor-from-kit` | 🔧 | XOR: "A or B, but not both"; ⭐ in 4 NANDs | `Y = A ⊕ B`, only NAND; star at ≤ 4 | XOR |
| 2.7 | `nand-recap` | 📖 | Why chips are made of NAND; De Morgan's two rules | quiz (2 questions) | |
Unlocks: the built-in NOT, AND, OR, NOR, XOR, XNOR (2–8 inputs).

### 3. From a truth table to gates
The step most courses skip, and the one that makes the rest of the path usable: given *any* truth table, how do you get gates? Sum of products, then
making it smaller, then doing it with NAND only. Palette: NAND, switches, LEDs and your kit. Built on what exists: `minimizeExpr` and `kmapOf`
(`src/logic/minimize.ts`, `kmap.ts`) and the `KarnaughMap` figure already do the minimising and the picture; the existing challenges `majority` and
`valid-bcd` are two of the steps. Majority moved here from *Choosing*, where it was one line about "sum of products".
| # | id | Kind | What | Check | Links |
|---|---|---|---|---|---|
| 3.1 | `table-to-sop` | 📖 | Each 1-row of a table is an AND of the inputs, inverted where the row has a 0; OR them: sum of products. Worked on 3-input majority, its 1-rows highlighted in the table | quiz: the term for row 101; how many terms for a table with five 1-rows | |
| 3.2 | `sop-majority` | 🔧 | Build majority from its four 1-rows, with your NOT, AND and OR | challenge `majority`, with the rule *only NAND* added by the step | *Logic → Build circuit* shown as a way to check |
| 3.3 | `combine-terms` | 📖 | Two terms that differ in one variable merge: `X·Y + X·¬Y = X`. Majority's four terms become `A·B + A·C + B·C` | quiz: simplify `A·B·C + A·B·¬C` | |
| 3.4 | `kmap` | 📖 | The Karnaugh map as a picture of that merging: rectangles of 1, 2, 4 or 8 ones, each rectangle one term, rectangles wrap round the edges. The majority map | quiz: how many terms for these groups | the figure |
| 3.5 | `sop-bcd` | 🔧 | Four inputs: "is it a decimal digit?" Read the groups off the map, build the small circuit; ⭐ for the fewest gates | challenge `valid-bcd`, with the rule *only NAND* added by the step; star at ≤ 4 gates (three NANDs make the OR, one more finishes it) | |
| 3.6 | `nand-nand` | 📖 | AND-OR becomes NAND-NAND (the De Morgan of 2.7): each term a NAND, the OR a NAND of those; an inverted input is a NAND with its inputs tied | quiz: the NAND-NAND form of `A·B + C` | |
| 3.7 | `sop-nand` | 🔧 | Majority again, with NAND only: three 2-input NANDs and one 3-input NAND, no inverters; ⭐ at 4 gates | `Y = A·B + A·C + B·C`, only NAND; star at ≤ 4 | |
The done-card of 3.7 links back to the XOR step: "Now you can get the star on 2.6: `A⊕B = A·¬(A·B) + B·¬(A·B)` is a NAND-NAND form with one NAND shared: 4 gates."
(`BuildStep.after`, a step id and a sentence, shown as a link in the done-card; the XOR step's hint also says to come back after this chapter. The star is still
awarded on the XOR step, by its own check, so there is no second XOR step.)
A `BuildStep` can carry its own `rules`, which replace the challenge's: that is how an existing challenge (`majority`, `valid-bcd`) is made NAND-only here.
Reference solutions for NAND-NAND are written with a small builder, `nandNandSolution(inputs, output, terms)` (the library's `synthesize` has no NAND-only
mode); a test checks each against its goal. New lesson blocks: a Karnaugh map (`{ kmap }`, rendered with `KarnaughMap.tsx`) and a `highlight` list of rows for
`{ table }`. Chip: none (these are circuits, not parts to keep).

### 4. Choosing
| # | id | Kind | What | Check | Chip / links |
|---|---|---|---|---|---|
| 4.1 | `mux` | 🔧 | Choose one of two | challenge `mux` | MUX |
| 4.2 | `demux` | 🔧 | Send D to Y0 or Y1 | `Y0 = ¬S·D`, `Y1 = S·D` | DEMUX |
| 4.3 | `decoder` | 🔧 | 2:4 decoder: one line for each number | four outputs, one-hot | DEC2 |
| 4.4 | `mux4-tour` | 🔍 | A 4:1 multiplexer | goals: select input 2; Y follows it | `/mux` |
Unlocks: MUX 2:1 / 4:1 / 8:1, DEMUX, binary decoder.

### 5. Adding numbers
| # | id | Kind | What | Check | Chip / links |
|---|---|---|---|---|---|
| 5.1 | `binary-add` | 📖 | Adding in binary, column by column, with a carry | quiz: 0110 + 0011 | |
| 5.2 | `half-adder` | 🔧 | Two bits: Sum and Carry | challenge `half-adder` | HA |
| 5.3 | `full-adder` | 🔧 | Three bits, from two of your HAs and an OR | challenge `full-adder` | FA |
| 5.4 | `adder4` | 🔧 | A 4-bit adder from four of your FAs (A3–A0, B3–B0, Cin; S3–S0, Cout) | goal table, 512 rows | ADD4 |
| 5.5 | `ripple-tour` | 🔍 | The carry ripples: watch it with slow gates | goals: add 15 + 1; see Cout | `/ripple` |
| 5.6 | `negative` | 📖 | Two's complement: −n is "flip the bits, add 1" | quiz: −3 in 4 bits | |
| 5.7 | `addsub` | 🔧 | Adder/subtractor: your ADD4 with four XORs, SUB into Cin | goal table | ADDSUB |
Unlocks: half and full adder, 4-bit adder, 4-bit adder/subtractor.

### 6. The ALU
| # | id | Kind | What | Check | Chip / links |
|---|---|---|---|---|---|
| 6.1 | `is-zero` | 🔧 | Z = 1 when all four bits are 0 | `Z = ¬(A3+A2+A1+A0)` | ZERO |
| 6.2 | `compare` | 🔧 | Compare two 2-bit numbers | challenge `compare` | |
| 6.3 | `alu4` | 🔧 | ADD, SUB, AND, OR by two select bits; outputs Y3–Y0, Z, C | goal table, 1024 rows | ALU |
| 6.4 | `alu-tour` | 🔍 | The built-in ALU with flags | goals: make Z light; make C light | `/alu-flags` |
Unlocks: 4-bit ALU, 4-bit comparator.

### 7. Memory
Clocked steps: the step list can `pulse CLK` (one rising and one falling edge), which the testbench already does.
| # | id | Kind | What | Check | Chip / links |
|---|---|---|---|---|---|
| 7.1 | `feedback` | 🔍 | A gate fed by itself: it never settles | goal: see *Oscillating* | `/oscillator` |
| 7.2 | `sr-latch` | 🔧 | Two NORs that remember | challenge `sr-latch` | SR |
| 7.3 | `d-latch` | 🔧 | A latch with an enable | challenge `d-latch` | DLATCH |
| 7.4 | `dff` | 🔧 | Edge-triggered D flip-flop: two of your latches, master and slave | steps with `pulse CLK` | DFF |
| 7.5 | `reg1` | 🔧 | One bit with load: your DFF and MUX; LD = 0 keeps the bit | steps | REG1 |
| 7.6 | `reg4` | 🔧 | Four bits with one CLK and one LD | steps | REG4 |
Unlocks: SR latch, D latch, D / JK / T flip-flops, 4-bit register.

### 8. Counting and memories
| # | id | Kind | What | Check | Chip / links |
|---|---|---|---|---|---|
| 8.1 | `tff` | 🔧 | T flip-flop: your DFF and an XOR | steps | TFF |
| 8.2 | `counter4` | 🔧 | Count 0–15: your REG4 and ADD4 adding 1 | 17 pulses | COUNT4 |
| 8.3 | `pc` | 🔧 | A program counter: count (EN), or load D (LD) | steps | PC |
| 8.4 | `rom-gates` | 🔧 | A ROM is a decoder and ORs: four words, contents given | goal table | |
| 8.5 | `ram4x4` | 🔧 | Four words of four bits: four REG4, a DEC2 for WE, a 4:1 MUX per bit | steps: write two words, read both | RAM4 |
| 8.6 | `rom-ram-tour` | 🔍 | The built-in ROM and RAM; write a word in the inspector while paused | goals: RAM[3] = 9 | `/beginner` (its RAM) |
Unlocks: counters, counter with load, ROM, RAM.

### 9. Build a computer
One project document, `cpu4`, that grows: each step starts from the learner's circuit at the end of the step before (or, after *Show a
solution*, from the reference). The parts are built-ins, labelled as the beginner computer labels them (`Clock`, `PC`, `Program ROM`, `Control
ROM`, `ACC`, `RAM`, `Adder`). The checks run test programs (see *Clock-run checks*).
| # | id | Kind | What the learner adds | Check (test programs, run on their circuit) |
|---|---|---|---|---|
| 9.1 | `cpu-plan` | 📖 | Fetch, decode, execute. An instruction is a number: opcode, number, address (an interactive word: click bits, see the fields) | quiz: decode `0x0302` |
| 9.2 | `cpu-fetch` | 🏗 | Clock → PC → Program ROM addresses; a hex display on the PC | after 5 ticks the PC is 5; ROM shows word 5 |
| 9.3 | `cpu-decode` | 🏗 | Opcode bits → Control ROM; LEDs on its signals; fill the LDI row (LOAD_ACC) with the row editor | at an LDI, LOAD_ACC is lit; at others, dark |
| 9.4 | `cpu-ldi` | 🏗 | ACC: loads the number when LOAD_ACC | `LDI 3; LDI 5` → ACC = 5; `LDI 9` → 9 |
| 9.5 | `cpu-ram` | 🏗 | RAM and the ACC multiplexer (ACC_SRC); rows STA and LDA | `LDI 6; STA 2; LDI 0; LDA 2` → ACC = 6, RAM[2] = 6 |
| 9.6 | `cpu-add` | 🏗 | Adder, the XOR flip and SUBTRACT, the carry flag; rows ADD and SUB | 3 + 4 → RAM[1] = 7; 9 − 2 → 7; 12 + 7 → carry |
| 9.7 | `cpu-jump` | 🏗 | JMP (load the PC from the instruction), HALT (stop the PC) | a loop counts on the ACC; HALT stops the PC |
| 9.8 | `cpu-same` | 🔍 | "It is the beginner computer": theirs next to `/beginner` | goal: run the 3 + 4 program on theirs |
| 9.9 | `cpu-decide` | 🏗 | **Decisions:** their ZERO chip on the adder's output, a Z flag, rows JZ and JNC; PC load = JUMP + JZ·Z + JNC·¬C | count down from 5 and HALT at 0; JNC loops until a carry |
| 9.10 | `cpu-output` | 🏗 | **Talking to the world:** an AND of the four address bits and WRITE_RAM loads an output register at address 15, shown on a display | `LDI 7; STA 15` → display 7, RAM unchanged |

### 10. Programming your computer
The program is written in the Program ROM's inspector (SKASM, the instructions their CPU has). It runs on their own CPU from chapter 9,
and the check also runs it on the reference CPU. When the two disagree, the verdict says which one is wrong: "Your program is right, but
your computer gives 6 at RAM[2]. Open step 9.6." When there is no chapter-9 circuit, it runs on the reference.
| # | id | Kind | Task | Check |
|---|---|---|---|---|
| 10.1 | `prog-add` | ⌨ | Put 2 + 5 into RAM[2] | RAM[2] = 7, halted |
| 10.2 | `prog-countdown` | ⌨ | Count down from 9 to 0 on the output, then stop | output shows 9…0 in order, halted |
| 10.3 | `prog-multiply` | ⌨ | 3 × 4 by adding, into RAM[0] (and with other numbers: the check changes them) | RAM[0] = a × b for three pairs |
| 10.4 | `prog-fib` | ⌨ | Fibonacci on the output until the next one would not fit in 4 bits | 1 1 2 3 5 8 13, halted |

### 11. A bigger computer
| # | id | Kind | What | Check | Links |
|---|---|---|---|---|---|
| 11.1 | `meet-8bit` | 🔍 | The 8-bit computer as blocks: the same fetch, decode and execute, 8 bits wide, on buses | goals: open the ALU block; step until PC = 4 | `/computer-blocks` |
| 11.2 | `shared-bus` | 🔧 | Two registers, one bus: tri-state buffers decide who drives it | steps | `/tristate`, `/databus` |
| 11.3 | `prog-console` | ⌨ | Write `HI` on the console with `OUT CHAR` | console text = `HI` | `/computer-sieve` |
| 11.4 | `prog-table-sum` | ⌨ | Add up five numbers from a `.byte` table with X and `LDT` | output = the sum | |
| 11.5 | `prog-call` | ⌨ | A subroutine that doubles ACC, called three times with `CALL` and `RET` | output = 8 from 1 | |

### 12. Meet the 6502
| # | id | Kind | What | Check | Links |
|---|---|---|---|---|---|
| 12.1 | `6502-map` | 📖 | Your computer → the 6502 (the table above) | quiz: which register is ACC; where the program lives | *Tools → 6502* |
| 12.2 | `one-bus` | 🔍 | Step the CPU cycle by cycle with the CPU inspector open | goals: see it read `$F000` (the opcode); see the operand read; see it write to `$4000` | `/6502` |
| 12.3 | `address-decoder` | 🔧 | From A15, A14 and R/W: RAM_SEL (`$0000–$3FFF`), LED_WE (`$4000–$7FFF`, writing), ROM_SEL (`$8000–$FFFF`) | goal table | |
| 12.4 | `wire-board` | 🏗 | The board with its decoder's wires removed: wire the chip selects | runs the blink program 400 cycles; LEDs show 1, 2, 4… | `/6502` |

### 13. Programming the 6502
Programs are 6502 assembly in the ROM inspector (*Tools → 6502* is the reference). They are checked on the board by running it.
| # | id | Kind | Task | Check | Links |
|---|---|---|---|---|---|
| 13.1 | `asm-leds` | ⌨ | `LDA #$55` / `STA $4000` | LEDs = `$55` | `/6502` |
| 13.2 | `asm-count` | ⌨ | Count on the LEDs with `INX`, `TXA` and `BNE` | the LEDs take 1, 2, 3, … in order | `/6502-counter` |
| 13.3 | `asm-string` | ⌨ | Write `HELLO` on the console with `LDA msg,X` | console text = `HELLO` | `/6502-hello` |
| 13.4 | `asm-subroutine` | ⌨ | A `JSR` delay routine between LED changes; watch S and page `$01` | LEDs change; S is back after each `RTS` | |
| 13.5 | `asm-lcd` | 🔍⌨ | Ben Eater's hello world on the LCD; then change the message | LCD line 1 = their text | `/6502-lcd` |
| 13.6 | `asm-irq` | 🔍 | A timer interrupts the CPU | goals: see an interrupt; LEDs count | `/6502-via` |

### 14. A computer that runs BASIC
| # | id | Kind | What | Check | Links |
|---|---|---|---|---|---|
| 14.1 | `basic-boot` | 🔍 | The BASIC computer: a 6502, 16 KB RAM, 16 KB ROM, a terminal | goal: the terminal shows `OK` | `/6502-basic` |
| 14.2 | `basic-print` | 🔍 | `PRINT 2+3`, then `10 PRINT "HELLO"` and `RUN` | goals: `5` appears; `HELLO` after `RUN` | |
| 14.3 | `basic-loop` | 🔍 | `FOR I=1 TO 10: PRINT I: NEXT` | goal: `10` appears | *Tools → BASIC* |
| 14.4 | `journey` | 📖 | **Your journey:** every chip you built, your CPU, your programs, from NAND to BASIC | — | |

78 steps. Ten are existing challenges as they are, and most explore steps open an existing example.

## The model
New files under `src/model/path/` (pure, tested in Node) and `src/app/path*.ts` (the store and the work). The UI goes under `src/ui/path/`.

```ts
// src/model/path/types.ts
type StepKind = 'read' | 'explore' | 'build' | 'project' | 'program'

interface Chapter {
  id: string                 // permanent
  title: string
  blurb: string              // one line on the map
  unlocks?: string[]         // built-in part types that unlock when every step is done or shown
}

interface StepBase {
  id: string                 // permanent: progress is stored by it
  chapter: string
  title: string
  kind: StepKind
  summary: string            // one line on the map
  lesson: Block[]            // what the panel shows
  hint?: string
  see?: { example?: string; challenge?: string; reference?: 'skasm' | '6502' | 'basic' }[]
}

/** A paragraph may name parts as [[label]]: hovering or clicking it spotlights that part on the canvas. */
type Block =
  | { p: string }
  | { figure: 'truth' | 'word' | 'map'; data: unknown }                          // a small table or the instruction-word widget
  | { quiz: { q: string; options: string[]; answer: number; why: string }[] }

interface BuildStep extends StepBase {
  kind: 'build'
  challenge: string | Challenge      // an existing challenge's id, or one written here (comb or seq, as in challenges.ts)
  chip?: string                      // goes into the kit when solved
  uses?: string[]                    // ids of the steps whose chips the starter gets
  palette?: string[]                 // the parts the palette offers (plus the kit); rules still decide what passes
  star?: { maxParts: number }        // an optional par
}

interface ExploreStep extends StepBase {
  kind: 'explore'
  open: { example: string } | { build: () => Circuit } | { project: string }
  goals: Goal[]
}

interface ProjectStep extends StepBase {
  kind: 'project'
  project: string                    // 'cpu4' or 'board6502'
  start: 'previous' | (() => Circuit) // the learner's circuit from the step before, or a starter
  solution: () => Circuit
  runs: Run[]                        // the clock-run checks, all must pass
}

interface ProgramStep extends StepBase {
  kind: 'program'
  machine: 'cpu4' | 'computer' | 'board6502' | 'board6502-lcd'
  starterSource: string
  solutionSource: string
  runs: Run[]                        // each may change the inputs (RAM or switches) before it runs
}

type Goal =
  | { led: string; is: 0 | 1 }
  | { display: string; is: number }                     // hex display or bus display, by label
  | { ram: string; at: number; is: number }
  | { cpu: 'pc' | 'a' | 'x' | 'y' | 's' | 'addr'; is: number; rw?: 'read' | 'write' }
  | { text: string; contains: string }                  // console, terminal or LCD, by label
  | { oscillating: true }
  | { clocks: number }                                   // at least this many clock edges since the step opened

interface Run {
  program?: string                   // assembled into the Program ROM (project steps); program steps use the learner's
  set?: Record<string, 0 | 1>        // switches before it runs
  ram?: Record<number, number>       // RAM words before it runs
  ticks: number                      // clock pulses
  expect: Expect[]                   // read after the run (or, with `history`, along it)
}

type Expect =
  | { ram: number; is: number }
  | { reg: string; is: number }                         // a register by label (ACC, PC, the output register)
  | { display: string; history: number[] }              // the values it showed, in order, repeats removed
  | { led: string; is: 0 | 1 }
  | { text: string; is: string }
  | { halted: true }
```

### Progress, the kit and the documents
- **Progress:** `localStorage['sklopko.path.v1']`:
  `{ v: 1, done: { [stepId]: { at: number, how: 'solved' | 'shown' | 'read', star?: true } }, current?: stepId, quiz: { [stepId]: number[] } }`.
  It is read at startup by the small index (for the button's badge and *Continue*), and written on every change. A broken or unreadable
  value is ignored, as `loadSolved` in `src/app/challenges.ts` does. *Forget my progress* (on the map) clears it and the kit, but not the documents.
- **The kit:** `localStorage['sklopko.path.kit.v1']` = `{ [stepId]: { name: string, circuit: SavedCircuit } }`, the **passing** circuit of each
  chip step, snapshotted at the moment it passed. Later edits to the document cannot break the kit. Solving the step again replaces it.
  A kit of about 30 small circuits is a few tens of kB.
- **The chips in a starter:** a step that `uses` chips gets an `ics` table with an `ICDef` for each (`id: 'kit:<stepId>'`, `name`, and the snapshot as
  its circuit), plus every chip those contain (AND contains NOT). The pins come from `deriveInterface` (`src/model/ic.ts`), which already turns the
  challenge's labelled switches and LEDs into inputs and outputs. The palette's *ICs in this circuit* section is titled *Your kit* in a path step.
  `ruleProblems` (`src/model/challengecheck.ts`) expands ICs before counting, so `only: ['nand']` holds for an AND built from your NOT.
- **Documents:** each step's work is a library document, as each challenge's is now (`startChallenge` in `src/app/challengeWork.ts`). Its
  `origin` gets a third field, `path: stepId` (`DocMeta.origin` in `src/app/library.ts` and its read-back check, `library.ts:370`). A project's
  steps share one document per step, each started from the one before (`start: 'previous'`), so going back to 9.4 still shows 9.4.
- **Backup:** *Download all* adds `{ path: progress, kit }` to the file, and *Import* merges them in. A step done in either copy counts as
  done, and a kit chip is kept from the newer copy.

### Checks
- **Build steps** are `checkChallenge` as it is. Clocked steps add a third kind of step action, `pulse`. `runSteps` already supports it (the
  testbench's `pulse CLK`), so `Step` in `challenges.ts` becomes `{ set?, pulse?, expect }`.
- **Stars** count the logic parts after IC expansion, as the `maxParts` rule does.
- **Clock-run checks** (project and program steps, in `src/model/path/run.ts`): copy the circuit, change the part labelled *Clock* into a
  switch, put the run's program in the part labelled *Program ROM* (assembled for its ISA, as its inspector does), and set the run's switches and
  RAM words (`Simulator.writeWord`). Then pulse it `ticks` times, settling after each edge, and read the expectations: RAM through
  `sim.state(id).mem`, registers through the outputs of the labelled part, CPU registers through `sim.state`, text through the console,
  terminal and LCD states. `halted` means the PC did not change over the last two ticks. Every step has two or more runs with different numbers,
  so a circuit that only shows the right answer fails.
- **The 6502 board** runs the same way, at the CPU's clock. `wire-board` counts LED changes over 400 cycles.
- **Explore goals** (`src/app/pathGoals.ts`): an evaluator subscribed with `sim.subscribe` (as `MemoryInspector` subscribes) checks the step's
  goals after each settled step, by label, with the same readers. A goal that has held once stays ticked. The step is done when all are ticked.
  `cpu.addr … rw` is checked on every CPU cycle, from the CPU's address and RWB output pins (`sim.pinValue`).

### Starters made from a solution
`withoutWires(solution, names)` removes the wires into the named pins and leaves everything else. `wire-board` (the board from
`board6502Builder` without its decoder's outputs) is made this way. So is a project step's starter after *Show a solution* on the step
before. That way the starter is always in step with the reference.

### Tests (unit, in Node)
One test file loops over every step, as `challenges.test.ts` does for the challenges:
- every build step: the starter fails, the solution passes, and removing any one wire of the solution makes it fail;
- every chip step: its solution, used as a chip in the steps that `use` it, makes their solutions pass;
- every project step: its solution passes its own runs and those of every earlier step of the project (nothing gets broken on the way), and
  the starter fails;
- every program step: the solution source passes, the starter source fails, and on `cpu4` it gives the same answer on the reference CPU;
- every explore step: a short script of actions (set switches, pulse, type text) reaches every goal in a headless simulator;
- every `[[label]]` in a lesson names a part of the step's circuit; every linked example, challenge and unlocked part type exists;
- step ids are unique and the index in the main chunk agrees with the full steps.

## The UI
All of it is in the mockup, `docs/mockups/learn-path.html`. These are the same screens in text.

### Where it starts
- **Toolbar:** a **Learn** button left of *Examples*, with a small ring showing progress once something is done. On a phone it is in the
  first row of the menu.
- **`/learn`** opens the map. **`/learn/<id>`** opens that step: its document if the learner has one, otherwise its starter.
- The welcome example (`/counter`) gets a line in its note: *New to logic? Learn → From NAND to a computer*. The *How to* panel gets a
  link too.

### The map
A modal like the example gallery (full screen on a phone). The chapters are on the left. The steps of the chosen chapter are on the
right, as a track. *Your kit* is underneath.
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Learn · From NAND to a computer          25 of 78 steps ███████░░░░░░░░░   [ ✕ ]     │
│                                     [ Continue: 5.4 A 4-bit adder → ]                │
├────────────────────────────┬─────────────────────────────────────────────────────────┤
│ ✔ 1 Signals and wires   4/4│ 5  Adding numbers                                       │
│ ✔ 2 NAND is all you need 7/7│    From a half adder to a 4-bit adder/subtractor.       │
│ ✔ 3 From a truth table  7/7│                                                         │
│ ✔ 4 Choosing             4/4│ ✔ 📖 5.1 Adding in binary                                │
│ ◕ 5 Adding numbers       3/7│ ✔ 🔧 5.2 Half adder                    chip: HA          │
│ ○ 6 The ALU              0/4│ ◐ 🔧 5.3 Full adder (solution shown)    chip: FA         │
│ ○ 7 Memory               0/6│ ● 🔧 5.4 A 4-bit adder  ← next          chip: ADD4       │
│ ○ 8 Counting, ROM, RAM   0/6│ ○ 🔍 5.5 Watch the carry ripple                          │
│ ○ 9 Build a computer    0/10│ ○ 📖 5.6 Negative numbers                                │
│ ○ 10 Programming it      0/4│ ○ 🔧 5.7 Adder/subtractor               chip: ADDSUB     │
│ ○ 11 A bigger computer   0/5│                                                         │
│ ○ 12 Meet the 6502       0/4│   Unlocks: half adder · full adder · 4-bit adder · …    │
│ ○ 13 Programming the 6502 0/6│                                                         │
│ ○ 14 BASIC               0/4│                                                         │
├────────────────────────────┴─────────────────────────────────────────────────────────┤
│ Your kit  [NOT] [AND] [OR] [NOR] [XOR⭐] [MUX] [DEMUX] [DEC2] [HA] [FA◐]  · 10 chips   │
│                                                              Forget my progress     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
✔ solved, ◐ solution shown, ● next, ○ not yet. ◕ is a chapter in progress. A step can always be clicked. The map opens on the chapter of the step you were last on (so finishing a chapter shows it, not an earlier one with a step skipped); *Continue* goes to the next step not done after it, and when only earlier steps are left it says so: "Go back to a step you skipped".

### A build step
The panel under the canvas, where the challenge panel is now (its layout, grown up). The palette shows the step's parts and *Your kit*.
```
┌ toolbar: … [Learn ◕] [Examples] Tools ▾ File ▾ ────────────────────────────────────────┐
├─ Parts ─────────┬───────────────────────── canvas ─────────────────────┬─ Inspector ────┤
│ For this step   │   [A]──┐                                              │ (selected part)│
│  NAND           │   [B]──┤   (your gates)                     (Y)       │                │
│  Switch  LED    │                                                       │                │
│ Your kit        │                                                       │                │
│  NOT AND OR     │                                                       │                │
├─────────────────┴───────────────────────────────────────────────────────┴────────────────┤
│ ◀  2 · NAND is all you need · step 6 of 7  ▶   2.6 XOR, from the kit        [Map] [✕]   │
├──────────────────────────────────────────────────────┬───────────────────────────────────┤
│ XOR is 1 when A and B differ: "A or B, but not both". │ What it should do                 │
│ You have OR, AND and NOT in your kit: use them.       │   A B │ Y                         │
│                                                       │   0 0 │ 0                         │
│ Your task: make Y = A XOR B.  Only NAND (your chips   │   0 1 │ 1                         │
│ are NAND inside).   ⭐ Par: 4 NANDs.                   │   1 0 │ 1                         │
│                                                       │   1 1 │ 0                         │
│ [ Check my circuit ] [Hint] [Show a solution] [Start over]                                │
│ ✔ Solved!  ┌──────────────────────────────┐                                              │
│            │ 🧩 XOR is in your kit (9 NANDs)│  [ Next: 2.7 Why NAND → ]                   │
│            └──────────────────────────────┘  ⭐ Do it in 4 NANDs for a star.             │
└──────────────────────────────────────────────────────┴───────────────────────────────────┘
```

### An explore step
The goals are a checklist that ticks while the learner plays. `[[Program ROM]]` in the text is a link: hovering it outlines the part, and
clicking it centres the canvas on it and dims everything else for a moment (the *spotlight*, drawn like the trace rings).
```
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ◀  12 · Meet the 6502 · step 2 of 4  ▶   12.2 One bus for everything      [Map] [✕]      │
├──────────────────────────────────────────────────────┬───────────────────────────────────┤
│ Your computer read its program from a ROM of its own. │ Goals                             │
│ The 6502 has one address bus for everything: the      │  ☑ Pause, and open the CPU        │
│ program in the [[ROM]], data in the [[RAM]], and the   │  ☑ See it read $F000: an opcode   │
│ [[LEDs]]. So an instruction takes several cycles:      │  ☐ See it read the operand        │
│ read the opcode, read the operand, then read or write. │  ☐ See it write to $4000          │
│ Press Clock step and watch the address bus.            │                                   │
│                                                        │  2 of 4 · keep stepping           │
└──────────────────────────────────────────────────────┴───────────────────────────────────┘
```

### A program step
The step names the machine and the expected result. *Edit the program* selects the Program ROM, so the inspector opens on its
editor, the one that already lists errors line by line and shows the listing. The check runs it.
```
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ◀  10 · Programming your computer · step 3 of 4  ▶   10.3 Multiply by adding   [Map] [✕]   │
├──────────────────────────────────────────────────────┬───────────────────────────────────┤
│ Your computer has no multiply instruction, but it can │ The check                         │
│ add in a loop. RAM[1] and RAM[2] hold two numbers:    │  run 1: RAM[1]=3, RAM[2]=4        │
│ put their product in RAM[0], then HALT.               │     → RAM[0] = 12 ✔  halted ✔     │
│ You have: LDI LDA STA ADD SUB JMP JZ JNC HALT         │  run 2: RAM[1]=5, RAM[2]=3        │
│                                                       │     → RAM[0] = 10 ✘ wanted 15     │
│ [ Edit the program ] [ Check ] [Hint] [Show a solution]│  run 3: not run                  │
│ ✘ Not yet: run 2 is wrong. The loop stops one round    │ Runs on your computer (9.10) and  │
│   early: is the counter checked before or after ADD?  │ on ours: both agree.              │
└──────────────────────────────────────────────────────┴───────────────────────────────────┘
```

### Phone
The step panel is a bottom sheet over the canvas. Folded, it shows the title, the goal count and *Check*. Dragging it up, or tapping it,
opens the lesson. The parts handle and the zoom controls stay where they are.
```
┌───────────────────────────┐
│ ☰  Sklopko     [Learn ◕]  │
│                           │
│        (canvas)           │
│                           │
│                           │
├───────────────────────────┤
│ ━━━  2.6 XOR, from the kit │
│ ◀ 6 of 7 ▶     [ Check ]  │
└───────────────────────────┘
      ↑ drag up: the lesson, the table, Hint, Show a solution
```

### Your journey (14.4)
A page in the map window: the chips in the order they were built, a thumbnail of their CPU (the thumbnails of the gallery), the
programs they wrote, the dates, and *Download my work* (*Download all*).
```
┌─────────────────────────────────────────────────────────────────────┐
│  From NAND to BASIC                                                 │
│  NAND → NOT → AND → OR → XOR → MUX → HA → FA → ADD4 → ALU →         │
│  SR → D latch → DFF → REG4 → PC → RAM4 → [your CPU] → 6502 → BASIC  │
│  ┌────────────┐   You built 31 chips and a computer, wrote 14       │
│  │ (thumbnail │   programs, and ran Microsoft BASIC on a 6502.      │
│  │  of cpu4)  │   Started 3 Oct · finished 26 Oct                   │
│  └────────────┘   [ Download my work ]  [ Back to the map ]         │
└─────────────────────────────────────────────────────────────────────┘
```

## Milestones
Each is one PR, stacked: its branch starts from the one before and the PR targets it. Each ends in a working, tested state. While CI has
no credits, each runs the whole suite locally (see the top). Each lists *What it did* here when it merges.

### L1 The framework, and chapters 1–2 (bumps to `0.4.0`)
- `src/model/path/types.ts`, `index.ts` (ids, titles, chapters; in the main chunk), `steps/ch01.ts`, `steps/ch02.ts`.
- `src/app/path.ts`: the store (map open, current step, progress, kit), reading and writing `sklopko.path.v1` and `sklopko.path.kit.v1`.
  `src/app/pathWork.ts` (lazy): `startStep`, `checkStep`, `showStepSolution`, `restartStep`, `nextStep`, the kit snapshot, and the chips injected
  into a starter. It is modelled on `challengeWork.ts`.
- `origin.path` in the library (with its read-back check), and the routes `/learn` and `/learn/<id>` next to `exampleFromPath` in `runtime.ts`.
- `src/ui/path/PathMap.tsx`, `StepPanel.tsx` (read and build kinds, with the verdict from the challenge panel moved into a shared component),
  the toolbar button and its ring, and the palette filter (`Palette.tsx`: the step's parts and *Your kit*).
- Tests: the invariant loop for read and build steps and for chips; the progress store (corrupt values, *Forget*); e2e `e2e/learn.spec.ts`:
  open the map, solve 2.2 and see NOT in the kit, use it in 2.3, reload and still see the progress, and a step link `/learn/and-from-nand`.

**What L1 did, and where it differs from the plan.**
- Built as planned: the types, the progress store (`sklopko.path.v1`), the kit (`sklopko.path.kit.v1`), `pathWork.ts` (`startStep`, `checkStep`,
  `showStepSolution`, `restartStep`, `nextStep`), `origin.path` in the library, the routes `/learn` and `/learn/<id>`, the map, the step panel,
  the toolbar button with its ring (also *Tools → Learn* and the phone menu), the palette filter, and the verdict moved out of the challenge
  panel into `CheckVerdict.tsx`. The shown version is `v0.4.0` from this PR on.
- **Chapters 1 and 2 have 8 of their 11 steps.** The explore steps (`bits`, `show-nine`, `meet-nand`) and the quizzes of `binary` and `nand-recap` need
  the goal evaluator and quiz blocks, which are L2's: they come in with it, at their places in the chapters. Step numbers (1.1, 2.3…) are worked
  out from the order, so they shift when those arrive; ids do not. `Block` is `{ p }` or `{ table }` for now.
- **The main chunk has a count, not a list.** `model/path/index.ts` (startup) holds `PATH_STEP_COUNT`, the addresses and nothing else; the order of
  the steps, the chapters, `recommended` and the rest are in `steps/index.ts`, which loads with the map. `path.test.ts` keeps the count equal to the
  number of steps. The startup chunk is 179.4 kB of 180 (it was 177.7), so L2 onward must not put anything but small state in it.
- **The kit stores each chip with the chips it needs** (a circuit that places an IC cannot be read without its definition), but a starting circuit
  takes every chip by id from the kit, or from our reference chips, never from another chip's copy. So solving NOT again reaches every gate made of it.
- **An existing challenge as a step shares its solved state one way:** solving the step ticks the challenge in the Challenges list (`markSolved`),
  but a challenge solved earlier does not tick the step, since a step done means its chip is in the kit. The step has its own document
  (`origin.path`), not the challenge's, because its starting circuit holds the kit's chips.
- **Show a solution** marks the step *shown* (◐) at once, puts our chip in the kit unless the learner has solved the step, and a check of the
  unchanged solution keeps it *shown*: any change by the learner makes the next passing check *solved*.
- A step's circuit ends when another document is put on the canvas (File → New, an example, My circuits, a challenge): `onCircuitOpened` in
  `documents.ts`. A circuit opened again with an older kit gets the learner's chips swapped in (`refreshChips`).
- After review: the map opens on the chapter of the step last visited, and a skipped earlier step is offered as "Go back to a step you skipped"
  (before, finishing chapter 2 with chapter 1's reading step skipped opened the map on chapter 1, which looked like the next section).
- The star is counted in L1 (step 2.6 has one): `logicParts` in `challengecheck.ts` after IC expansion, the same count as the `maxParts` rule.

### L1.5 Kit chips look like the gates they are (own PR, `ic-gate-symbols`, stacked on L1)
- `ICDef.symbol` (`'not' | 'buf' | 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor'`), saved with the IC (`serialize.ts`; an optional field, the format
  version stays) and written into the instance's params by `icParams`, only while the pins fit it (one output, single wires, one input for NOT and buffer,
  two to eight for the rest); otherwise the IC is a box.
- Layout (`engine/components/ic.ts`): with a symbol, the gate's own layout (`gateLayout`) with the IC's pin names; without, the box shrinks (minimum width
  60, `minRows: 1`, so one input and one output is 40 tall). Drawing (`ui/symbols.tsx`): `GateSym` in the chip colour with the name under it, so both gate
  styles work; the parts list and the thumbnails follow.
- Who sets it: the kit steps (`BuildStep.symbol`, passed on by `chips.ts`), and Make IC and collapse (`model/icsymbol.ts`, `detectSymbol`: one output, one to
  four inputs, the truth table of the body, `analyzeCircuit`). Existing saved ICs have none and stay boxes, only smaller.
- Tests: layout and drawing of a symbol IC, a symbol that no longer fits falls back to the box, save and read back (a bad value is ignored), `detectSymbol`
  on each gate and on an adder, kit chips carry their symbol; `e2e/ics.spec.ts` and `learn.spec.ts` still pass.
- The startup chunk has about 0.6 kB of room: measure, and if this goes over, ask before raising the budget.

### L2 Explore steps, quizzes, the spotlight, and chapters 3–6
- `src/app/pathGoals.ts` (the live-goal evaluator), quiz blocks, the `[[label]]` spotlight (a canvas overlay from a small store, drawn like the
  trace rings), stars.
- Chapters 3–6. Chapter 3 (*From a truth table to gates*, above) is the first: the lesson blocks it needs (`{ kmap }`, `highlight` on `{ table }`), `BuildStep.rules`
  and `BuildStep.after`, `nandNandSolution`, and the chapter's id `tables` in `chapters.ts` (14 chapters now) and `PATH_STEP_COUNT`. *Choosing* loses `majority`.
  The Challenges list marks the steps that are in the path.
- Tests: explore scripts reach their goals; the spotlight names real parts; `nandNandSolution` against each goal; every `after` names a step; e2e: an explore step ticks its goals, a quiz, a star, a NAND-NAND build, and the link from 3.7 back to the XOR step.

**What L2a did, and where it differs from the plan.**
- Built as planned: `Block` gains `{ quiz }` (a `Question` is `{ q, options, answer, why }`), `{ kmap }` (inputs, output name, the rows that are 1; drawn with
  the existing `KarnaughMap`) and `highlight` on `{ table }`; `BuildStep` gains `rules` (replaces the challenge's, applied in `challengeOf`, so the panel, the
  check and the tests agree and `challenges.ts` is untouched) and `after` (a sentence and a link in the done-card); the chapter `tables` (14 chapters, 15 steps,
  `PATH_STEP_COUNT` 15); `model/path/sop.ts` with `nandNandSolution` and `sopFromKit` (the big sum of products from the kit's NOT, AND and OR for 3.2).
- A quiz is practice: answers are kept in `progress.quiz[stepId]` (`answerQuiz` in `pathWork.ts`, -1 for an unanswered question), a wrong choice shows
  "Not quite" and can be changed, a right one shows why, and a read step with every question right counts as read. *Next* is never blocked. Chapters 1 (`binary`)
  and 2 (`nand-recap`) got the quizzes L1 left out.
- Majority is solved twice (3.2 from the kit, 3.7 in NAND-NAND) and both mark the `majority` challenge solved in the Challenges list, as `valid-bcd` does for 3.5.
- **Not done here:** the Challenges list does not yet say "In the path: chapter 3" (the startup chunk is at 179.9 of 180 kB; it needs a lazy import) and
  *Choosing* has no `majority` to lose yet (chapter 4 is L2c). The explore steps, the goal evaluator and the spotlight are L2b.

**What L2b did, and where it differs from the plan.**
- Built as planned: `ExploreStep` (`open: { build }`, `task`, `palette`, `goals`, `ordered`) and `Goal` (`{ led, is }`, `{ display, is }`, `{ oscillating }`, each with the `text` of its checklist line);
  the pure `model/path/goals.ts` (`goalHolds`, `tick`, `displayValue`, `goalProblems`, found by label) and the app's `pathGoals.ts`, which looks at the goals after each
  settled step of the simulator, keeps a ticked goal ticked, and marks the step solved when all are. A step that is done shows its goals ticked. *Start over* puts the circuit back.
  An explore step has a document of its own like a build step, so coming back restores the circuit.
- The three steps of chapters 1–2: `bits` (1.1), `show-nine` (1.4) and `meet-nand` (2.1). Step numbers shift as the plan said (`wire` is 1.2, NOT is 2.2), ids do not.
  `show-nine` is a 4-bit input and a hex display built on the spot, not the Counter example (the lesson points at it in words); `PATH_STEP_COUNT` is 18.
- `ordered` is new: `bits` has "Y is lit" and then "Y is dark again", and the second must not count while the LED has never been lit.
- A step opened from its address was fitted to the canvas before the panel under it had taken its room, so the circuit ran under the panel; `pathWork`'s `fitSoon` now fits once more after 300 ms.
- Left for later: goals on examples, CPU registers, console text and RAM (they come with the chapters that need them).

**What L2c did, and where it differs from the plan.**
- A paragraph of a lesson names a part as `[[label]]` (`Paragraph` in `StepPanel.tsx`): pointing at the name (mouse or keyboard focus) outlines the part on the canvas, and
  clicking it brings the part to the middle of the canvas and dims everything else for 1.8 s. The part is the one with that label in the circuit now on the canvas.
- The overlay is not in `Canvas.tsx` (the startup chunk has no room): `ui/path/Spotlight.tsx` is a portal into `.stage-view`, an SVG laid over the canvas that follows the view
  (outline, and a dim rectangle with a hole for each part, made with an SVG mask); its state is `app/pathSpot.ts` (`hover`, `focus`, `focusSpot`). It leaves with the step.
- Used in the three explore steps so far. A test checks every `[[label]]` against the circuit of its step (explore: the circuit it opens; build: the starting circuit) and that
  read steps, which have no circuit of their own, name nothing.
- Pointing at the part of a *read* step's lesson, wires and pins are not done: only labelled parts.

**What L2d-1 (chapter 4, *Choosing*) did, and where it differs from the plan.**
- The four steps as in the table: `mux` (the existing challenge, NAND-only by the step's `rules`, chip MUX), `demux` (chip DEMUX) and `decoder` (chip DEC2), which are
  new challenges written in `steps/ch04.ts` (`path-demux`, `path-decoder`) because the plan's goals have no existing challenge, and the explore step `mux4-tour`.
  The three chips are made of the learner's NOT, AND and OR and are drawn as boxes (they are not gates: no `symbol`).
- `mux4-tour` plays with the built-in 4:1 multiplexer, built on the spot (four switches, two select switches, an LED) rather than the `/mux` example. For its goals a new
  `{ switches: { label: 0 | 1 } }` goal says "the switches are like this" (S1 = 1, S0 = 0), so the plan's "select input 2" is a goal, and the three goals are ordered.
- *Unlocks* is not done: it is L3's (the toast and the built-ins that unlock). `PATH_STEP_COUNT` is 22.
- The e2e that finishes the path now takes its last step from `PATH_STEPS`, so adding steps no longer breaks it.

### L3 Clocked builds, and chapters 7–8
- `pulse` in challenge steps (`Step` in `challenges.ts`, used by `runChallengeSteps` in `challengecheck.ts`), and the steps table in the panel
  shows pulses.
- Chapters 7–8. Unlocking built-ins in the palette when a chapter is done, with a toast: "Chapter 7 done: the D flip-flop and the register are
  in the parts list".
- Tests: every clocked solution passes and its starter fails; the gate-level DFF holds through 16 pulses; e2e: the DFF step.

### L4 The CPU project: chapter 9
- `src/model/path/run.ts` (clock-run checks), `withoutWires`, project documents with `start: 'previous'`, and the reference CPU built step by
  step from `beginnerBuilder`'s parts (`src/model/beginner.ts`), with the control ROM text from `signal-presets.ts`.
- The two upgrades: the Z flag and JZ/JNC rows (9.9), and the output register at address 15 (9.10).
- The instruction-word figure (bits → opcode, number, address), using `wordFields` (`src/engine/isa.ts`).
- Tests: every step's solution passes all the earlier runs of the project; e2e: 9.2 and 9.4 by hand, and *Show a solution* followed by the next step.

### L5 Program steps: chapters 10–11
- Program steps on `cpu4` (the learner's from 9.10, or the reference) and on the 8-bit computer. *Edit the program* selects the ROM. The verdict
  shows each run.
- Chapter 11, with the shared-bus build.
- Tests: the solutions pass and the starters fail; the learner's CPU and the reference agree on every solution; e2e: 10.1 typed in the inspector and checked.

### L6 The 6502 and BASIC: chapters 12–14
- CPU-cycle goals (`cpu.addr` with R/W), the board starter without its decoder's wires (`board6502Builder` and `withoutWires`), 6502 program checks
  (LEDs, RAM, console, LCD text), the terminal goals for BASIC (typing in the terminal is the learner's; the explore script types for the test).
- *Your journey*.
- Tests: `wire-board`'s solution blinks and its starter does not; the BASIC goals are reached by a script within a time budget; e2e: 12.3 and 14.1.

### L7 Polish
- The phone bottom sheet, the welcome example's and *How to*'s links, progress and kit in *Download all* / *Import*, README (*Learn*), and
  `CLAUDE.md`'s *Current work*.
- A check of the whole path for wording and length (each lesson fits the panel at 1280 × 800 without scrolling the canvas away).
- e2e `mobile.spec.ts`: the sheet folds and opens; a step is checked on a phone.

## Not doing
Accounts, class lists and server-side progress. Paths written by teachers (milestone 15c stays dropped). A 6502 built from gates. Building
the 8-bit computer by hand. Translations. Timed levels and leaderboards.
