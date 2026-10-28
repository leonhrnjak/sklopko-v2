# Sklopko

A browser-based digital logic simulator. Drag gates onto a canvas, wire them pin to pin, and watch signals
propagate live. Wires are green for 1, red for 0 and grey for unknown.

A rewrite of the original Sklopko (JavaScript, ~2015) in TypeScript, React and SVG.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

`npm run build` writes a static site to `dist/`, served from the site root. There is no backend. Example links
such as `/intersection` need the host to answer unknown paths with `index.html`; Cloudflare Pages does that
automatically (as long as there is no `404.html`), and so do `npm run dev` and `npm run preview`.

## Deploy (Cloudflare Pages)

Connected through Cloudflare's Git integration: every push to `main` deploys to production, and every other
branch gets its own preview URL. Build settings:

| Setting | Value |
|---|---|
| Framework preset | None (or Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | from `.node-version` (22) |

`public/_headers` sets caching (hashed assets cached forever, `index.html` always revalidated) and basic
security headers.

## Using it

- **Add parts:** drag from the left panel, or click one and then click the canvas (Shift keeps placing).
- **Wire:** press on a pin and drag to another pin, in either direction (output→input). Dragging a connected
  input picks the wire back up so you can re-plug or remove it.
- **Move:** drag parts and their wires re-route. Drag a wire segment sideways to reshape it by hand.
  Double-click a wire to auto-route it again.
- **Right-click** a part, a wire, a selection or empty canvas for a menu: rotate, flip, duplicate, copy, delete, open an IC,
  auto-route a wire, paste, select all, fit.
- **Zoom:** the − and + buttons in the corner of the canvas (the percentage between them goes back to 100%), the `-` and
  `+` keys, ⌘/Ctrl+scroll, or pinch. On a phone the parts list folds down to its *Parts* handle, and folds away by
  itself while a part waits to be placed.
- **Operate:** click switches, hold push buttons, click a 4-bit input to count up (Alt/Option-click: down).
  Clicking a control never selects it; to edit one, long-press it, right-click it, or drag it.
- **Simulation:** Run/Pause, Step (one gate delay), **Back** (go back one clock edge: every signal, memory and the
  time as they were; it pauses the simulation, and Clock step then goes forward again; the last 1000 edges are kept),
  Clock step (flip the clocks to their next level now), Reset (power-cycle), speed ¼×–4×.
- **Breakpoints:** a *Breakpoint* part watches a signal (1 bit) or a number (4, 8 or 16 bits, wired bit by bit) and
  pauses the simulation at the clock edge where it becomes equal to a value, or changes. It only fires when the
  condition *starts* to hold, so Run carries on afterwards, and unknown (grey) inputs never fire it. A message says
  which one stopped it; the `/computer` example pauses itself when the program reaches HALT.
- **Trace a signal:** select a wire to light up the whole signal it belongs to: every wire from the same output,
  also through net labels, with rings on every pin it reaches. *Also show what feeds it* adds the logic behind its
  source (through gates and other purely combinational parts, back to the nearest registers, memories and inputs).
- **Programs and memory:** a ROM's contents are hex words, or a program in assembly: pick *A program in SKASM* in the
  inspector and write `LDI 5`, `loop: ADD 3`, `JNC loop` (labels, `NAME = 15` constants, `;` comments, decimal / `0x` /
  `$` hex / `0b` binary numbers; *Tools ▾ → SKASM* is the reference). Mistakes are listed by
  line as you type; the program is applied when you click away from the box (the circuit keeps running the last good
  one meanwhile). The listing under it shows every word with its instruction and marks the one being read now, so it
  follows the program counter. *Open…* and *Save…* read and write `.asm` (or `.hex`) files. Select a RAM to see all
  its words live; while paused, click a word to change it (hex). Reset clears it. A control ROM (the computers' decoders)
  lists its rows by name and signals, and can be edited that way, or as text, instead of in hex.
- **Net labels:** a *Send label* publishes the signal wired into it under a name, and every *Receive label* with
  the same name carries that signal, with no wire in between. Like a wire, a label adds no delay. Select one to see
  the other labels of its name outlined, and *Select all* to find them. The *Net labels* example (`/labels`) shows it.
- **Waveforms:** wire a *Probe* to any signal and give it a label. The first probe opens the waveform panel
  under the canvas (or use *Tools ▾ → Waveforms*), with one trace per probe in the wire colours. Pick a
  2/5/10/30 s window; while paused, drag sideways to look back in time (double-click or *Live* returns). Traces
  are kept for the last minute of simulated time and cleared by Reset. Select several probes to **group** them: the
  group is drawn as one trace showing the number the bits form (hex, decimal or binary; the label order sets the bit
  order, so ACC0 is bit 0), as in the `/computer` example's PC and ACC. *PNG* saves the window as an image, and *VCD*
  saves everything recorded in the format that GTKWave and other waveform viewers open.
- **Logic panel:** *Tools ▾ → Logic*. *Analyze circuit* sweeps the switches you choose and shows the truth
  table, a minimal Boolean expression and (up to 4 inputs) a Karnaugh map with its groups. *Build circuit* turns an
  expression such as `Sum = A ⊕ B ⊕ Cin` or a truth table (with don't-cares) into wired, laid-out gates on the
  canvas. *Compare* checks the circuit against an expression or a circuit file over all inputs and lists the rows
  that differ.
- **Challenges:** *Tools ▾ → Challenges* has 17 short lessons, each ending in something to build: from wiring a
  switch to an LED, through gates, adders and multiplexers, to an SR latch and a gated D latch. Picking one puts
  labelled switches and LEDs on the canvas; *Check my circuit* tries every combination of the switches (or, for a
  latch, a sequence of steps) and shows which answers are wrong. Some limit the gates you may use. *Hint* and *Show a
  solution* help when stuck, and *Start over* puts the starting circuit back (undoable); solved challenges are ticked and
  remembered in your browser. Each challenge keeps a circuit of its own, so leaving one and coming back brings back what
  you built.
- **Learn:** the *Learn* button (left of *Examples*) opens *From NAND to a computer*: 14 chapters of short steps, each with
  something to do. You start with a switch, a wire and an LED; build every gate from NAND, then a multiplexer, an adder and an
  ALU; make a latch, a flip-flop, a register, a counter and a RAM; and put them together into a 4-bit CPU, one circuit that
  grows step by step, checked by running small programs on it. You then program it, meet an 8-bit computer and a real MOS
  6502 (wiring its address decoder, writing assembly for it), and finish with Microsoft BASIC running on it. A step is a
  few paragraphs, with part names you can point at to find them on the canvas, and one thing to do: *read* (with questions),
  *explore* (play with a circuit until its goals tick), *build* (a gate, or a block that goes into *Your kit* and is used by the
  next steps), *project* (the CPU), or *program* (SKASM or 6502 assembly, run on the computer). *Hint*, *Show a solution* and
  *Start over* are always there, and any step can be opened from the map or a link such as `/learn/dff`. Finishing a chapter
  unlocks its built-in parts. Progress, the kit and the circuits you built stay in your browser, and *My circuits → Download all*
  keeps them in the backup file. On a phone the lesson folds to a bar, so the parts list is within reach.
- **Notes and frames:** the *Notes & frames* group of the parts panel has a *Note* (text that wraps at the width you
  choose, in five colours) and a *Frame* (a titled, tinted box drawn behind everything). Neither has pins or any
  effect on the simulation, and wires route straight through them. Drag a frame by its border or title bar to move it
  together with everything inside, and drag its corner handle to resize it; clicking inside it still selects
  what is under the pointer and starts a marquee as usual. The examples use them to explain themselves.
- **Pictures:** *File ▾ → Save a picture* saves the circuit as an SVG or a PNG, either the whole circuit or what is on
  screen, as it looks right now (wires in their current colours, without selection marks or pins).
- **Embed:** `?embed=1` on any link (an example's short link, or a share link) shows only the circuit with a few
  controls (Run/Pause, Back, Clock step, Reset, Fit, and *Open in Sklopko*). It runs, switches and buttons work,
  and you can pan and zoom, but nothing can be edited, and nothing is read from or written to the visitor's saved
  circuit. *File ▾ → Embed code* copies the iframe HTML for the current circuit, e.g.
  `<iframe src="https://…/computer?embed=1" width="900" height="560"></iframe>`. The site allows being framed by
  any page.
- **Settings (⚙):** gate symbols US (curved) or IEC (rectangles), wire hops on or off (wires of different
  signals that cross show a small bridge), and signal colours: green 1 / red 0, or orange 1 / blue 0 for people who
  confuse red and green. Stored in the browser.
- **Files:** autosaves to the browser, as a document in your library (IndexedDB; the single saved circuit of earlier
  versions is brought in on the first visit). Nothing replaces your work: an example or *New* opens without a document of
  its own and becomes one, "<example> (copy)" or "Untitled N", the moment you edit it; a share link or an opened file is a
  new document at once. What was open stays in the library. Save/Open as `.json`; Share copies a link containing the circuit.
- **My circuits:** *File ▾ → My circuits* lists every circuit and state machine you have (newest first): open, rename,
  duplicate or delete them (a toast brings a deleted one back), or start a new circuit. The name of the open circuit is
  over the canvas; click it to rename. *Download all* saves everything in one file and *Import…* adds a file like that
  (nothing is overwritten), so you can back up or move to another computer: the library lives in this browser only. State
  machines are kept there too.
- **Examples:** the *Examples* button opens a gallery of every example with a picture, a line about it and a search box,
  one group at a time (or *All*); each card has a *Copy link* button. Every example has a short link, e.g. `/intersection`, `/dice`, `/clock`. Opening an
  example shows its link in the address bar, and Share copies it while the example is unedited.
- **Toolbar:** *Tools ▾* (Logic, State machines, Make IC, Tests, Challenges, the SKASM, 6502 and BASIC references, Step-back history, Waveforms, Timing) and *File ▾* (New, My
  circuits, Open and Save file, Embed code, Clear wires, pictures). The *How to* panel on the right can be hidden (**Hide**);
  the **?** button brings it back.
- **Custom ICs:** *Tools ▾ → Make IC…* turns the circuit (or the selected parts) into a part of your own: its pins are the
  labelled switches and bus inputs (inputs) and LEDs and bus displays (outputs) inside. It is kept in the circuit, under
  *ICs in this circuit* in the parts list, and used like any part. *Edit IC* (the inspector, a double-click, or the parts
  list) opens its inside, with a breadcrumb and *Back*: every copy changes with it. ICs can contain ICs. *Collapse into IC…*
  (select several parts) replaces them by one IC wired as they were, and *Expand into parts* does the reverse. The *Custom
  ICs* examples show a 4-bit adder of ICs inside ICs and the 8-bit computer as blocks.
- **Tests:** *Tools ▾ → Tests…* is a testbench for any circuit: one step per line, e.g. `D=1; pulse CLK; expect Q=1`, saved
  with the circuit; *Run tests* lists the steps that fail and why.
- **Offline:** after one visit the built app (page, scripts and all examples) is kept by the browser, so it opens without a
  network, and it can be installed from the browser's menu.
- **Pins:** select a part to see a table of what each of its pins does, inputs first, then outputs.
- **Keys:** R rotate, F flip, Del delete, ⌘Z/⇧⌘Z undo/redo, ⌘C/⌘V/⌘D copy/paste/duplicate, ⌘A select all,
  H (or 0) fit to screen, Space+drag or scroll to pan, ⌘/Ctrl+scroll or pinch to zoom. A switch with a **Key** (1–9 or a letter,
  in its inspector) flips when you press it; a keypad reads digits and A–F (or the calculator keys) from the keyboard, and
  a gamepad the arrow keys, W A S D, Z and X.

## Parts

| Group | Parts |
|---|---|
| Input / output | switch, push button, clock (0.25 Hz–1 MHz), constant 0/1, 4-bit input, keypad (hex digits or calculator keys), gamepad (arrow-key buttons), serial terminal (a 6551 chip with a 40 × 24 screen and a keyboard), VIA (a 6522: two ports, two timers, interrupts), character LCD (HD44780, 16 × 2), LED, speaker (a tone from the square wave on its input; *Octaves up* for slow circuits), probe (waveform trace), breakpoint, send / receive net labels |
| Logic gates | AND, OR, NAND, NOR, XOR, XNOR (2–8 inputs), NOT, buffer |
| Flip-flops & counters | SR latch, D latch, D / JK / T flip-flops (async set/reset), up/down counter (any range from 0–1 to 0–15; chain CO → EN for multi-digit counters), counter with parallel load (a program counter), 4-bit register, shift register (serial/parallel), ring and Johnson counters |
| Arithmetic | half/full adder, 4-bit adder, half/full subtractor, 4-bit subtractor, 4-bit adder/subtractor with overflow, 4-bit comparator, 4-bit ALU (8 operations), multiplier (2×2 / 4×4), BCD adder |
| Memory | ROM (2–8 address bits, 4, 8 or 16 data bits; contents as hex text, or a program in assembly), RAM (4–8 address bits, 4 or 8 data bits), lookup table (2–8 inputs, 1, 2, 4 or 8 outputs, edited as a truth table or filled from boolean expressions) |
| Multiplexers | MUX 2:1 / 4:1 / 8:1, DEMUX 1:2 / 1:4 / 1:8, tri-state buffer (1–16 bits), bus junction (2–8 drivers sharing a line or bus, with pull-up/down and contention detection) |
| Encoders & decoders | binary decoder 2:4 / 3:8 / 4:16, priority encoder 4:2 / 8:3, BCD → 7-segment, BCD → decimal, binary → BCD, Gray code converter, parity |
| Displays | 7-segment display, hex display, dice display, 8×8 dot matrix (with persistence), LED bar, text console (ASCII, 28 columns), 16×16 pixel screen (1 bit or 4 colours) |
| Buses | splitter and merger (pure wiring), bus send / receive labels, bus constant and input (hex), bus display (hex / decimal / binary), n-bit (2–16) register, counter with load, adder, subtractor, adder/subtractor, comparator, bitwise gate and multiplexer. Many 4-bit and memory parts also have a *Bus ports* option that turns their pin runs into one thick bus pin |
| Notes & frames | note, frame (annotations: no pins, no effect on the simulation) |

The *Examples* menu includes showpieces built only from these parts. The **8-bit computer** (`/computer`) runs SKASM: an
8-bit program counter, a 256-instruction program ROM, three control ROMs that turn each instruction into control signals,
an 8-bit ALU, 256 bytes of RAM, an accumulator, an index register, a carry and a zero flag, a return stack for `CALL`
and `RET`, all joined by 8-bit buses. It runs a Fibonacci program you can edit in assembly, and shows each number (up to
233) in decimal on an output port via ROM tables and BCD adders. Devices are reached with `OUT` and `IN` through named
ports, and each example has only the ones it uses: an LCD (`/computer-lcd`, a bouncing ball; also `/computer-sine`,
`/computer-ant`), a speaker (`/computer-sound`, a siren), a keypad and text console (`/computer-calc`, a calculator for
whole numbers up to 255), a gamepad (`/computer-pong`, `/computer-snake`, `/computer-raycaster`, a 3D raycaster), a
keypad and LCD (`/computer-tictactoe`) and a console (`/computer-sieve`, primes). `/beginner` is a much smaller computer
(seven instructions, 4-bit numbers) meant to be read, and `/computer-blocks` shows the 8-bit computer as custom ICs. The
**calculator** (`/calculator`) has an ALU, multiplier, ROM lookup table, BCD adder, comparator and a memory register.
`/databus` shows the other way to move data: several sources sharing one 8-bit bus through tri-state buffers, and `/buses` and
`/tristate` are the small introductions. To write your own program, pick *A program in SKASM* in a Program ROM's inspector.

**A real CPU.** The MOS 6502 (and the WDC 65C02) is one part, cycle-exact, on a board like Ben Eater's: a ROM with a program in
6502 assembly (*Tools ▾ → 6502* is the reference, with every instruction and addressing mode), a RAM, address decoding made of a few gates,
and devices at memory addresses (LEDs, a console, a speaker, a keypad, a gamepad, a pixel screen, a timer that interrupts it, and a 6522 VIA with its ports and timers: `/6502-via`, and with a character LCD on it: `/6502-lcd`, Ben Eater's hello-world). The
*6502* group of the examples has them, from a blinking LED (`/6502`) to an interrupt waking a 65C02 from sleep (`/65c02-timer`).
`/6502-echo` and `/6502-echo-irq` add a serial terminal (click its screen and type; the program sends every key back, by polling and by
interrupt), and **`/6502-basic` is a computer that runs Microsoft BASIC**: a 6502, 16 KB of RAM, 16 KB of ROM and the terminal, with the
memory map of Ben Eater's breadboard computer. It boots to `OK`; type `10 PRINT "HELLO"` and `RUN`. It runs at a 1 MHz clock without the
step-back history, a sixth or so of a real 6502's speed in a browser. The BASIC is Microsoft's own 1978 source (MIT licence), translated
and built by `npm run build:basic`; *Tools ▾ → BASIC* lists its statements and functions and has programs to type in; `/6502-basic-lcd` adds the VIA and an LCD, which BASIC writes to with `POKE`.
**`/6502-parts` is a 6502 built from our own parts**: registers, counters, multiplexers, an adder and a microcode ROM, one bus cycle per
clock, with 59 opcodes so far (see `docs/plan-micro6502.md`); a test runs it next to the 6502 part and compares every cycle.

Bistable circuits built from gates (SR latches, gated D latches) and oscillators
work too. The *Examples* menu has ready-made ones.

## How it works

```
src/
  engine/     pure TypeScript simulator, no DOM: logic values, part definitions, Simulator
  routing/    orthogonal wire router (A*) and path editing helpers
  logic/      Boolean expressions, truth tables and minimisation (the Logic panel)
  model/      circuit data, editing operations, save/load, examples, state machines, custom ICs
  app/        zustand store (undo/redo), simulator singleton, runtime loop
  ui/         React + SVG: canvas, palette, inspector, toolbar, part symbols
e2e/          Playwright tests that drive the real UI
```

**Simulation.** Values are 0, 1 or X (unknown). Every tick is one gate delay. Each part reads the signal
values from the end of the previous tick, then all outputs update together. So feedback loops behave
deterministically and flip-flops sharing a clock never race. Everything starts at X, so a gate-level latch
shows "unknown" until it is set or reset, as in real hardware. A loop that never settles, such as a ring
oscillator, is flagged *Oscillating* and keeps animating. Clocks run in real time. Between clock edges the
circuit is settled instantly.

**Time and sampling.** The simulator keeps a clock of simulated milliseconds (it follows the speed setting
and stops while paused). Parts that record over time implement `sample`, which runs after every settled step,
for example after each clock edge: probes store their transitions and the dot matrix remembers when each pixel
last lit, so fast scanning shows a steady image.

**Routing.** Wires are orthogonal paths found by A* search on the 10px grid. The search avoids component
bodies and pins, penalises bends and crossings, and forbids running along a wire of a different signal.
Wires of the same signal may share a trunk, and junction dots mark where it branches. A clean-up pass
re-routes wires that cross others to untangle bundles. Only affected wires re-route when you move parts.
Wires you shaped by hand keep their shape and stretch at the ends.

**Adding a part** is one entry in `src/engine/components/*`: its pins (`layout`), what each pin does (its text in `src/engine/pindata.ts`, shown in the inspector), its behaviour
(`evaluate`) and optional params. The palette, inspector, saving and routing pick it up automatically. Box-shaped parts
need no drawing code; gates and displays have custom symbols in `src/ui/symbols.tsx`.

## Tests

```sh
npm test           # unit tests: every part's truth table, latches, counters, router invariants, save/load
npm run e2e        # browser tests: drag & drop, wiring, moving, reshaping, undo, examples, ICs, offline (build first)
```

The first e2e run needs `npx playwright install chromium`.
