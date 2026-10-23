# More examples: plan

> **Status:** in progress. The PRs are stacked (each on top of the previous), from E1 to E5c. Each batch below is one PR from its own feature branch per `CLAUDE.md` (version bump, scoped tests, CI,
> ask before merging). Tick each batch when it ships.
>
> - [x] E1 Quick wins: the two unused state machines, master-slave flip-flop, LFSR
> - [x] E2 Logic and bus teaching examples: encoder/decoder, bus arbitration, ALU slice, PWM dimmer
> - [ ] E3 Sequential gadgets: button debouncer, stopwatch
> - [ ] E4 Serial link: UART transmitter and receiver
> - [ ] E5a Tic-tac-toe on the 8-bit computer
> - [ ] E5b Pong on the 8-bit computer
> - [ ] E5c Snake on the 8-bit computer

## Context
The example menu is now grouped (`EXAMPLE_GROUPS` in `src/model/examples.ts`). The groups are: Start here, Logic basics,
Memory and sequential, Arithmetic, Buses and tri-state, Timing and glitches, State machines, Displays and gadgets, Computers.
New examples go into one of these groups; add a group only if a batch really needs one.

## Rules for every example
- Built with `CircuitBuilder` (or `generateFsm`, or a `Program` for the computer), laid out so parts don't overlap, with a short
  `note()` explaining what to click and what to watch, and a `frameAround()` per logical block when there are several.
- Registered with the `g(group, id, name, build)` helper. The id is also the URL slug (`/<id>`).
- Covered by the existing "all examples" tests (no overlaps, frames, serialize round trip, timing). Each example also gets a
  behaviour test in `examples.test.ts` (or a new test file) that drives the inputs and checks the outputs, like `dice` and `clock`.
- No e2e per example. One e2e check that the new example loads from the menu is enough, and only for showpieces.
- Keep the build under about a second (the big ones are slow to route).

## Batches

### E1: quick wins
1. **Vending machine and up/down counter, generated.** `VENDING_MACHINE` and `UP_DOWN_COUNTER` already exist in
   `fsm-examples.ts`. Add `fsm-vending` and `fsm-updown` to *State machines*. Test: the generated circuit matches the state
   table (the FSM tests already have a helper for this).
2. **Master-slave flip-flop from gates.** Gated D latch, then two latches in series with opposite enables. Group: *Memory and
   sequential*. Note shows the master follows D while CLK is high and the slave copies it on the falling edge.
3. **LFSR pseudo-random generator.** 4 or 8 bit shift register with XOR feedback, LEDs for the bits, a reset button to seed it.
   Group: *Displays and gadgets*. Test: the sequence has the maximal period (15 or 255).

### E2: teaching examples
1. **Priority encoder and 3-to-8 decoder** driving an LED row. *Logic basics*.
2. **Bus arbitration.** Three devices behind tri-state buffers with an arbiter picking one driver. A switch to enable two at once
   shows the conflict (X) on the bus. *Buses and tri-state*.
3. **ALU slice with flags (Z, C, N).** Add, subtract, AND, OR on 4-bit buses, with flag LEDs. *Arithmetic*.
4. **Frequency divider and PWM dimmer.** Counter plus comparator, duty cycle set by a switch bus, with probes so the waveform
   view shows the duty cycle. *Displays and gadgets*.

### E3: sequential gadgets
1. **Button debouncer.** A bouncing button source (a clock burst), an SR latch fix and a synchroniser, side by side with a counter
   showing counts with and without the fix. *Memory and sequential*.
2. **Stopwatch with start/stop/lap.** Reuses the clock's BCD counters and the debouncer. *Displays and gadgets*.

### E4: UART
1. **UART transmitter and receiver.** Two generated or hand-built state machines, a baud divider, a shift register each, one wire
   between them. The timing view shows the frame (start bit, 8 data bits, stop bit). New group *Communication* if it is
   joined by more serial examples later; for now put it in *State machines*.

### E5: showpieces on the 8-bit computer
Each is a new `Program` in `computer2.ts` (SKASM source, using the LCD and keypad ports), exposed like `computer-lcd`, and is its
own PR. Test with the assembler and simulator: feed key presses, check the LCD memory.
- **E5a Tic-tac-toe** (keypad picks a cell, LCD shows the board, the computer plays the other side).
- **E5b Pong** (a bigger version of the bouncing ball, keypad moves the paddle).
- **E5c Snake** (keypad steers, the snake grows, the game ends when it hits itself or the wall). Check the program size and
  cycle time first.

## Order and risk
E1 and E2 are small and independent, so they can ship in either order. The stopwatch (E3.2) uses the debouncer (E3.1). E4 is the
biggest hand-built circuit, so do it before E5 to learn how much state-machine wiring costs. E5 depends on the program memory
size and on the LCD and keypad ports; read `docs/plan-skasm.md` first.
