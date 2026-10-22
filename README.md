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
- **Programs and memory:** a ROM's contents are hex words, or, for the 8-bit computer, a program in assembly:
  pick *A program for the Sklopko 8-bit computer* in the inspector and write `LDI 5`, `loop: ADD 3`, `JNC loop`
  (labels, `NAME = 15` constants, `;` comments, decimal / `0x` hex / `0b` binary numbers). Mistakes are listed by
  line as you type; the program is applied when you click away from the box (the circuit keeps running the last good
  one meanwhile). The listing under it shows every word with its instruction and marks the one being read now, so it
  follows the program counter. *Open…* and *Save…* read and write `.asm` (or `.hex`) files. Select a RAM to see all
  its words live; while paused, click a word to change it (hex). Reset clears it.
- **Net labels:** a *Send label* publishes the signal wired into it under a name, and every *Receive label* with
  the same name carries that signal, with no wire in between. Like a wire, a label adds no delay. Select one to see
  the other labels of its name outlined, and *Select all* to find them. The *Net labels* example (`/labels`) shows it.
- **Waveforms:** wire a *Probe* to any signal and give it a label. The first probe opens the waveform panel
  under the canvas (or use *Waveforms* in the toolbar), with one trace per probe in the wire colours. Pick a
  2/5/10/30 s window; while paused, drag sideways to look back in time (double-click or *Live* returns). Traces
  are kept for the last minute of simulated time and cleared by Reset. Select several probes to **group** them: the
  group is drawn as one trace showing the number the bits form (hex, decimal or binary; the label order sets the bit
  order, so ACC0 is bit 0), as in the `/computer` example's PC and ACC. *PNG* saves the window as an image, and *VCD*
  saves everything recorded in the format that GTKWave and other waveform viewers open.
- **Logic panel:** *Logic…* in the toolbar. *Analyze circuit* sweeps the switches you choose and shows the truth
  table, a minimal Boolean expression and (up to 4 inputs) a Karnaugh map with its groups. *Build circuit* turns an
  expression such as `Sum = A ⊕ B ⊕ Cin` or a truth table (with don't-cares) into wired, laid-out gates on the
  canvas. *Compare* checks the circuit against an expression or a circuit file over all inputs and lists the rows
  that differ.
- **Challenges:** *Challenges* in the toolbar has 17 short lessons, each ending in something to build: from wiring a
  switch to an LED, through gates, adders and multiplexers, to an SR latch and a gated D latch. Picking one puts
  labelled switches and LEDs on the canvas; *Check my circuit* tries every combination of the switches (or, for a
  latch, a sequence of steps) and shows which answers are wrong. Some limit the gates you may use. *Hint* and *Show a
  solution* help when stuck; solved challenges are ticked and remembered in your browser.
- **Notes and frames:** the *Notes & frames* group of the parts panel has a *Note* (text that wraps at the width you
  choose, in five colours) and a *Frame* (a titled, tinted box drawn behind everything). Neither has pins or any
  effect on the simulation, and wires route straight through them. Drag a frame by its border or title bar to move it
  together with everything inside, and drag its corner handle to resize it; clicking inside it still selects
  what is under the pointer and starts a marquee as usual. The examples use them to explain themselves.
- **Pictures:** *Picture…* in the toolbar saves the circuit as an SVG or a PNG, either the whole circuit or what is on
  screen, as it looks right now (wires in their current colours, without selection marks or pins).
- **Embed:** `?embed=1` on any link (an example's short link, or a share link) shows only the circuit with a few
  controls (Run/Pause, Back, Clock step, Reset, Fit, and *Open in Sklopko*). It runs, switches and buttons work,
  and you can pan and zoom, but nothing can be edited, and nothing is read from or written to the visitor's saved
  circuit. *Embed* in the toolbar copies the iframe HTML for the current circuit, e.g.
  `<iframe src="https://…/computer?embed=1" width="900" height="560"></iframe>`. The site allows being framed by
  any page.
- **Settings (⚙):** gate symbols US (curved) or IEC (rectangles), and wire hops on or off. Wires of different
  signals that cross show a small bridge. Stored in the browser.
- **Files:** autosaves to the browser; Save/Open as `.json`; Share copies a link containing the circuit.
- **Example links:** every example has a short link, e.g. `/intersection`, `/dice`, `/clock`. Picking an example
  shows its link in the address bar, and Share copies it while the example is unedited.
- **Keys:** R rotate, F flip, Del delete, ⌘Z/⇧⌘Z undo/redo, ⌘C/⌘V/⌘D copy/paste/duplicate, ⌘A select all,
  H fit to screen, Space+drag or scroll to pan, ⌘/Ctrl+scroll or pinch to zoom.

## Parts

| Group | Parts |
|---|---|
| Input / output | switch, push button, clock (0.25–1024 Hz), constant 0/1, 4-bit input, hex keypad (0–F), LED, speaker (a tone from the square wave on its input; *Octaves up* for slow circuits), probe (waveform trace), breakpoint, send / receive net labels |
| Gates | AND, OR, NOT, NAND, NOR, XOR, XNOR, buffer (2–8 inputs) |
| Flip-flops & counters | SR latch, D latch, D / JK / T flip-flops (async set/reset), up/down counter (any range from 0–1 to 0–15; chain CO → EN for multi-digit counters), counter with parallel load (a program counter), 4-bit register, shift register (serial/parallel), ring and Johnson counters |
| Arithmetic | half/full adder, 4-bit adder, half/full subtractor, 4-bit subtractor, 4-bit adder/subtractor with overflow, 4-bit comparator, 4-bit ALU (8 operations), multiplier (2×2 / 4×4), BCD adder |
| Memory | ROM (2–8 address bits, 4, 8 or 16 data bits; contents as hex text, or a program in assembly), RAM (4–8 address bits, 4 or 8 data bits), lookup table (2–8 inputs, 1–8 outputs, edited as a truth table) |
| Multiplexers | MUX 2:1 / 4:1 / 8:1, DEMUX 1:2 / 1:4 / 1:8 |
| Encoders & decoders | binary decoder 2:4 / 3:8 / 4:16, priority encoder 4:2 / 8:3, BCD → 7-segment, BCD → decimal, binary → BCD, Gray code converter, parity |
| Displays | 7-segment display, hex display, dice display, 8×8 dot matrix (with persistence), LED bar, text console (ASCII, 28 columns), 16×16 pixel screen (1 bit or 4 colours) |
| Notes & frames | note, frame (annotations: no pins, no effect on the simulation) |

The *Examples* menu includes two showpieces built only from these parts: an **8-bit computer** (`/computer`: program
counter, two program ROMs (instruction and constant), control ROM, two 4-bit adders chained into one 8-bit
adder/subtractor, two RAMs and two registers for the high and low halves of the data, and a carry flag, running a
Fibonacci program that you can edit as hex in the ROMs; it shows each number (up to 233) in decimal on an output port,
written with `STA 15`, via ROM tables and BCD adders) and a **calculator** (`/calculator`: ALU, multiplier, ROM lookup
table, BCD adder, comparator and a memory register).

A second computer adds a four-bit opcode, jump if zero, immediate arithmetic (`ADDI`, `SUBI`, `CMPI`), shifts and a
128-instruction program ROM. It comes in three examples, each with only the devices it uses on the top RAM
addresses: **LCD** (`/computer-lcd`: a ball bouncing round a 16×16 screen; `STA 14` lights the pixel at the
accumulator's (low nibble, high nibble), `STA 13` darkens it), **speaker** (`/computer-sound`: a siren; `STA 14`
flips the speaker) and **keypad** (`/computer-calc`: a calculator for single digits with + − ×, typed on a hex keypad
and shown on a text display; `LDA 15` reads the keypad, `STA 14` says the key has been read, `STA 15` prints a
character). Write your own in the Program ROM's inspector (pick *A program for the Sklopko 8-bit computer 2*).

Bistable circuits built from gates (SR latches, gated D latches) and oscillators
work too. The *Examples* menu has ready-made ones.

## How it works

```
src/
  engine/     pure TypeScript simulator, no DOM: logic values, part definitions, Simulator
  routing/    orthogonal wire router (A*) and path editing helpers
  model/      circuit data, editing operations, save/load, examples
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

**Adding a part** is one entry in `src/engine/components/*`: its pins (`layout`), its behaviour (`evaluate`)
and optional params. The palette, inspector, saving and routing pick it up automatically. Box-shaped parts
need no drawing code; gates and displays have custom symbols in `src/ui/symbols.tsx`.

## Tests

```sh
npm test           # unit tests: every part's truth table, latches, counters, router invariants, save/load
npm run e2e        # browser tests: drag & drop, wiring, moving, reshaping, undo, examples
```

The first e2e run needs `npx playwright install chromium`.
