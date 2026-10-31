# Simulator speed, phase C: run the simulation in a Web Worker (spec)

Status: **for approval.** No code until approved. This is phase C of `docs/spec-sim-speed-tier2.md` (PRs #169 to #171 are the
earlier phases). Phases A and B's word nets were measured first, and this is what the measurements say.

## Where we are

On `/6502-parts-basic` at a 1 MHz clock (production build, headless Chromium in a container with software rendering):

| | Node (engine only) | Browser (whole page) |
|---|---|---|
| exact engine | about 60,000 cycles/s | about 27,000 to 31,000 |
| fast engine (#171) | about 103,000 | about 43,000 to 46,000 |

The page reaches about 42% of what the engine does alone. A real 6502 does 1,000,000. The engine's own profile is now flat
(75 part evaluations, 126 net changes and 330 pin updates per cycle, about 60% of the time in scheduling), and word-wide nets
were estimated at about 1.3x, below the 1.5x bar the tier 2 spec set, so they are not built.

## Why the page is slower than the engine

`src/app/runtime.ts` runs one `requestAnimationFrame` loop. Each frame gives the simulation `workMs` (10 ms at least, more when a
circuit cannot keep up, see `workBudget`) of a 16.7 ms frame, and the rest goes to `publish()`, React and the browser's drawing.
So the simulation gets at most about 60% of one core, and only while drawing stays cheap. A worker removes both limits: it
simulates on its own core, all the time, and drawing only has to show the latest picture.

**Honest estimate: 1.3x to 1.7x on the BASIC board** (from the 60% budget alone: 1 / 0.6 = 1.67x at best, less the cost of
sending state across). On a circuit that is cheap to simulate, nothing changes. The page also stays responsive when a
circuit is heavy, which is worth something by itself.

## Step W0 (a gate, before any real work)

A throw-away measurement in the browser, no merged code: per frame on the BASIC board, how long `sim.frame`, `publish` and the
React render plus paint take (`performance.mark`). If the simulation already gets more than 70% of each frame, a worker would
not give 1.4x and this spec stops here (we say so, and drop it). The result is written into this file.

## Design

### What runs where

The **worker** owns a `Simulator` (the same class: it is plain TypeScript with no DOM) and does `load`, `setParams`, `setState`,
`force`, `reset`, `stepClock`, `tick`, history and `stepBack`, `setCapture`, and the run loop. The **main thread** keeps the
document, React and drawing, and a **mirror** of what drawing needs.

`src/app/sim.ts` exports `sim` today, a `Simulator`. It becomes a `SimClient` with the same method names for what the UI calls
(about 40 methods, see below), so most files change only by a few lines.

### What the main thread needs from the worker

Everything the UI reads is one of:

1. **Net values** for wire colours (`pinValue`, `signature`, `netOf`, `unstable`, `forcedValue`, `forceCount`). Sent every frame
   as one `Uint8Array` (a few hundred bytes to a few kilobytes), transferred, not copied. `netOf` and `netNames` are static
   per load and are sent once with `load`.
2. **Part state for what is on screen** (`state`): the CPU's registers, the LCD, the terminal, the memory inspector, the
   displays. The worker sends a **snapshot of the state of the parts the UI has asked to watch** each frame (a `watch` set
   of part ids, from the inspectors that are open and the parts that draw their state on the canvas). Memories are sent as
   changed pages, not whole.
3. **Time and counters** (`time`, `ticks`, `clockTime`, `lagging`, `engine`, `fastestClockHz`) in the same message.
4. **Waveform samples and glitch captures**: the worker records them (as it does today, in `sample()` and `setCapture`) and
   sends the new ones in batches.

### What the main thread sends

Commands, in order, never waiting for an answer: `load`, `setParams`, `setState` (memory edits, typing into the terminal),
`force`, `reset`, `stepClock`, `stepBack`, `tick`, run, pause, speed, `setHistory`, `setFast`, `setCapture`, `edgeHook` on/off.

### The hard part: calls that expect an answer at once

Today `sim.settle()` after an edit, and then `sim.pinValue(...)`, give the new value in the same function call. Checked in
the code: of the files that import the canvas's `sim`, only `app/store.ts` (edits: `settle`, `setParams`, `writeWord`),
`app/runtime.ts` and the toolbar do this; the rest read. And the code that needs a settled answer already has a simulator of
its own: `model/testbench.ts`, `model/analyze.ts` (the Logic panel) and `model/path/run.ts` (the Learn path's checks) each
create `new Simulator()`. Rules:

- **UI code** (drawing, inspectors) reads the mirror and never waits. A click on a switch shows its effect one message
  later (a few milliseconds), the same as a frame today.
- **Edits** (`store.ts`) become commands; nothing in the UI reads the answer straight after.
- The testbench, the Logic panel and the Learn checks **stay as they are**: they never used the canvas's simulator.
- Tests keep using `Simulator` directly. Only the app switches to `SimClient`; the worker runs the same class, so the
  lockstep tests still cover it.

### Messages

`postMessage` with transferable `ArrayBuffer`s. **No `SharedArrayBuffer`**: it needs cross-origin isolation headers (COOP and
COEP) on the Cloudflare Pages site, which would break embedding in other pages (`EmbedBar`) and any third-party content.
The cost of copying through messages is a few kilobytes per frame, small against the milliseconds saved.

Frames: the worker runs freely, but sends at most one state message per animation frame of the page (the main thread
acknowledges each frame it drew, so the worker never queues more than one). Between messages the worker keeps simulating.

### Things that must keep working

- **Step-back history** and `stepBack`: stays in the worker with its snapshots; the main thread asks and gets the new mirror.
- **Breakpoints** (`takeBreak`) and the `edgeHook` for path goals: the worker pauses itself and says so; the hook becomes a
  message per edge only while a goal is watching, or is moved into the worker for the few goals that need it.
- **Audio** (`speaker`): reads part state and time every frame today; it listens to the mirror (and gets one message per frame, as
  now). A worker could drive audio buffers directly, but that is outside this spec.
- **Offline use and the build**: a worker file is one more asset; the service worker's list and the bundle budget get it.
  The startup chunk gets a small client and does not load the engine at all (the worker does), which is a saving there.
- **Where `Worker` is unavailable or fails to start**: fall back to running `Simulator` on the main thread as today (the
  `SimClient` has two backends). This is also how the e2e tests can cover both.
- **Autosave, files, share links**: untouched (they read the document, not the simulator).

## Work, one PR each, stacked

1. **W0: measure** (above). Decides whether to go on. Written into this file.
2. **W1: the seam** (done: `SimApi` in `src/app/sim.ts`, the exact set of `Simulator` members the app uses, in three groups; the app is
   type-checked against it; nothing waits for a command's answer any more). `SimClient` with an in-thread backend (same behaviour as today: it just calls `Simulator`), every UI
   and app file moved to it, the edit paths in `store.ts` turned into commands. No visible
   change, no worker yet. All unit and e2e specs pass.
3. **W2: the worker backend.** The worker file, the messages, the mirror and the watch set; the run loop in the worker;
   history, breakpoints, forces, waveform and glitch batches. On for the canvas, the in-thread backend kept as a fallback
   and for tests.
4. **W3: measure and tune** in the browser: cycles a second and frame time before and after, and the state messages'
   size. Written here.

Each PR runs the unit tests, lint, type-check, the e2e specs for the area (all of them for W2) and the build with the
bundle budget; W2 and W3 report the benchmark.

## Risks

- **A large change to every place the UI reads the simulator.** W1 does it without the worker, so it can be reviewed and
  merged alone, and a regression there is not a threading bug.
- **Latency of a click or key** grows by a message (a few ms). The footer, the inspectors and drawing already update on frames.
- **State that the UI reads but the watch set misses** shows as stale or missing in an inspector. The e2e specs for every
  inspector (CPU, memory, LCD, terminal, VIA) are the check, and a dev-mode warning for a part read outside the watch set.
- **Debugging gets harder** (two threads). The in-thread backend stays available with a URL flag.
- **The gain may be smaller than estimated.** Hence W0.

## Decisions for you

1. **Go on to W0?** (recommended: it is cheap, and it can stop this spec before the expensive part)
2. **No `SharedArrayBuffer`** (recommended: no COOP/COEP headers, embedding keeps working), or accept the headers for a
   lower copy cost.

## Result (W2 and W3, same container and build as W0)

`/6502-parts-basic` at a 1 MHz clock, production build, 5 s of frame counting after a 3 s warm-up:

| | Cycles a second (footer) | Frames a second |
|---|---|---|
| in the page (`?thread=main`) | 52.6 kHz | 11.6 |
| in a worker (default) | **107 kHz** | **26.6** |

So about **2x the speed and 2.3x the frames**; the engine alone does about 103 kHz in Node, so the worker has all but removed the
page's share. A light circuit (`/counter`) still draws at 60 frames a second. Phase C is done; what is left is the engine's own
speed (the profile is flat: 75 evaluations, 126 net changes and 330 pin updates per cycle) and drawing, which is now the part
that limits the frame rate on this machine (software rendering). Word-wide nets (about 1.3x, estimated) were not built.
