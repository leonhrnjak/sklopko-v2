/**
 * The examples' ids, names and groups, without their builders: small enough for the main chunk, so the menu and short links
 * like /intersection work before any builder code has loaded. `examples.ts` has the builders and loads on demand.
 */

/** Menu order: the groups appear in this order, and the first example is what the app opens with. */
export const EXAMPLE_GROUPS = [
  'Start here',
  'Logic basics',
  'Memory and sequential',
  'Arithmetic',
  'Buses and tri-state',
  'Timing and glitches',
  'State machines',
  'Displays and gadgets',
  'Computers',
] as const
export type ExampleGroup = (typeof EXAMPLE_GROUPS)[number]

export interface ExampleInfo {
  /** Also the URL slug: sklopko.example/<id> opens this example. */
  id: string
  name: string
  group: ExampleGroup
  /** One line for the gallery: what the example shows. */
  blurb: string
}

const e = (group: ExampleGroup, id: string, name: string, blurb: string): ExampleInfo => ({ id, name, group, blurb })

/** Sorted by group, so the flat list and the menu agree. */
export const EXAMPLE_LIST: ExampleInfo[] = [
  e('Start here', 'counter', 'Counter → 7-segment display', 'A clock drives a decade counter, a decoder and a seven-segment display. The place to start.'),
  e('Start here', 'beginner', 'Beginner: a tiny computer (ROM, RAM, adder)', 'A tiny computer you can follow by hand: a ROM of instructions, a RAM, an adder and three steps.'),
  e('Start here', 'gates', 'Basic gates', 'AND, OR, NOT, NAND, NOR, XOR and XNOR side by side, with a switch for every input.'),
  e('Logic basics', 'mux', '4:1 multiplexer', 'Four inputs and two select switches: choose which input reaches the output.'),
  e('Logic basics', 'encoder', 'Priority encoder and decoder', 'A priority encoder turns the highest active request into a number; a decoder turns it back.'),
  e('Logic basics', 'labels', 'Net labels (wireless connections)', 'Send and Receive labels join parts without a wire, so big circuits stay readable.'),
  e('Memory and sequential', 'sr-latch', 'SR latch from NOR gates', 'Two cross-coupled NOR gates remember one bit: the simplest memory.'),
  e('Memory and sequential', 'd-latch', 'D latch from NAND gates', 'A latch from NAND gates that follows D while Enable is on and holds it afterwards.'),
  e('Memory and sequential', 'master-slave', 'Master-slave flip-flop from two latches', 'Two latches in a row make a flip-flop that changes only on the clock edge.'),
  e('Memory and sequential', 'debounce', 'Button debouncer: why a naive counter miscounts', 'A bouncing button makes a naive counter jump; a latch gives one clean pulse.'),
  e('Memory and sequential', 'shift-register', 'Shift register (D flip-flops)', 'Four D flip-flops pass a bit along one place on every clock tick.'),
  e('Memory and sequential', 'ripple-counter', 'Ripple counter (T flip-flops)', 'T flip-flops, each clocked by the one before, count in binary.'),
  e('Arithmetic', 'adder', '4-bit adder', 'Four full adders add two 4-bit numbers, carrying from bit to bit.'),
  e('Arithmetic', 'alu-flags', 'ALU with zero, carry and negative flags', 'An ALU with eight operations and flags for zero, carry and negative results.'),
  e('Arithmetic', 'calculator', 'Calculator: ALU, multiplier, ROM, BCD', 'An ALU, a multiplier, a ROM and a BCD decoder make a small calculator.'),
  e('Buses and tri-state', 'tristate', 'Tri-state buffers on a shared line', 'Several sources share one line through tri-state buffers; two that disagree are a contention.'),
  e('Buses and tri-state', 'buses', 'Buses: a running total on 4-bit wires', 'Thick 4-bit bus wires carry a running total, shown as one number.'),
  e('Buses and tri-state', 'arbiter', 'Bus arbitration: who gets the bus', 'Several devices ask for the bus and the arbiter grants it to one at a time.'),
  e('Buses and tri-state', 'databus', 'Shared data bus: tri-state buffers on 8 bits', 'An 8-bit data bus shared by tri-state buffers: one source is enabled at a time.'),
  e('Timing and glitches', 'hazard', 'Glitch: a hazard, and its fix', 'A glitch on a signal that should stay still, found in the timing view, and the fix.'),
  e('Timing and glitches', 'ripple', 'Ripple-carry adder: the carry chain and flicker', 'The carry ripples through an adder one gate at a time, so sum bits flicker before they settle.'),
  e('Timing and glitches', 'oscillator', 'Ring oscillator (unstable)', 'A ring of inverters that never settles: the simulator calls it unstable.'),
  e('State machines', 'uart', 'UART: a byte over one wire', 'Sends a byte over one wire (start bit, eight data bits, stop bit) and receives it again.'),
  e('State machines', 'fsm-traffic', 'Traffic light (generated)', 'A traffic light as a state machine, turned into gates and flip-flops by the generator.'),
  e('State machines', 'fsm-detector', '1011 sequence detector (generated)', 'Spots the bits 1011 in a stream, generated from a state diagram.'),
  e('State machines', 'fsm-vending', 'Vending machine, nickels and dimes (generated)', 'Takes nickels and dimes and dispenses a drink at 15 cents.'),
  e('State machines', 'fsm-updown', 'Up/down counter (generated)', 'A two-bit counter that counts up or down, generated from a state diagram.'),
  e('Displays and gadgets', 'intersection', 'Traffic lights with pedestrian crossing', 'Traffic lights for a crossing, with a pedestrian crossing.'),
  e('Displays and gadgets', 'dice', 'Electronic dice', 'Hold the button to roll an electronic die, let go and it shows its number.'),
  e('Displays and gadgets', 'stopwatch', 'Stopwatch with start/stop and lap', 'Start, stop, reset and lap, counting seconds on seven-segment displays.'),
  e('Displays and gadgets', 'clock', 'Digital clock (HH:MM:SS)', 'A digital clock with hours, minutes and seconds.'),
  e('Displays and gadgets', 'pwm', 'PWM: a counter and comparator dim a lamp', 'A counter and a comparator switch a lamp on for part of each cycle, so it dims.'),
  e('Displays and gadgets', 'lfsr', 'Pseudo-random generator (LFSR)', 'A shift register with feedback makes a pseudo-random pattern that repeats every 15 clocks.'),
  e('Displays and gadgets', 'matrix', 'Dot matrix smiley (scanned)', 'A dot matrix scanned row by row shows a smiley that looks steady.'),
  e('Computers', 'computer', '8-bit computer (runs Fibonacci)', 'An 8-bit computer from registers, an ALU, RAM and a control unit, running a Fibonacci program.'),
  e('Computers', 'computer-lcd', 'Computer + LCD: bouncing ball', 'The computer draws a bouncing ball on an LCD screen.'),
  e('Computers', 'computer-sound', 'Computer + speaker: siren', 'The computer plays a siren on a speaker.'),
  e('Computers', 'computer-calc', 'Computer + keypad: calculator', 'A calculator: type a sum on the keypad and the computer works it out.'),
  e('Computers', 'computer-tictactoe', 'Computer + LCD + keypad: tic-tac-toe', 'Tic-tac-toe for two players on an LCD, played with the keypad.'),
  e('Computers', 'computer-pong', 'Computer + LCD + gamepad: pong', 'Pong on an LCD, played with a gamepad.'),
  e('Computers', 'computer-snake', 'Computer + LCD + gamepad: snake', 'Snake on an LCD, played with a gamepad.'),
  e('Computers', 'computer-sieve', 'Computer + console: prime sieve (index register)', 'Prints the primes below 240 on a console, using the index register.'),
  e('Computers', 'computer-sine', 'Computer + LCD: a scrolling sine wave (table ROM)', 'Scrolls a sine wave across an LCD, with the values read from a table in the ROM.'),
  e('Computers', 'computer-ant', "Computer + LCD: Langton's ant (reads the screen)", "Langton's ant walks over the LCD, reading the pixels it draws."),
  e('Computers', 'computer-raycaster', 'Computer + LCD + gamepad: a 3D raycaster', 'A first-person view of a maze, drawn by a raycaster and walked with a gamepad.'),
]

/** The id of the example the app opens with. */
export const WELCOME_ID = EXAMPLE_LIST[0].id

/** The example named by a URL path like "/intersection", if any. */
export function exampleFromPath(pathname: string): ExampleInfo | undefined {
  const slug = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, '')).toLowerCase()
  return EXAMPLE_LIST.find((x) => x.id === slug)
}

/** The examples whose name, blurb, group or id contain every word of the query (all of them for an empty query). */
export function searchExamples(query: string): ExampleInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return EXAMPLE_LIST
  return EXAMPLE_LIST.filter((x) => {
    const hay = `${x.name} ${x.blurb} ${x.group} ${x.id}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
