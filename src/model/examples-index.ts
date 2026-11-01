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
  '6502',
  'BASIC computer',
  'Custom ICs',
] as const
export type ExampleGroup = (typeof EXAMPLE_GROUPS)[number]

export interface ExampleInfo {
  /** Also the URL slug: sklopko.example/<id> opens this example. */
  id: string
  name: string
  group: ExampleGroup
}

const e = (group: ExampleGroup, id: string, name: string): ExampleInfo => ({ id, name, group })

/** Sorted by group, so the flat list and the menu agree. */
export const EXAMPLE_LIST: ExampleInfo[] = [
  e('Start here', 'counter', 'Counter → 7-segment display'),
  e('Start here', 'beginner', 'Beginner: a tiny computer (ROM, RAM, adder)'),
  e('Start here', 'gates', 'Basic gates'),
  e('Logic basics', 'mux', '4:1 multiplexer'),
  e('Logic basics', 'encoder', 'Priority encoder and decoder'),
  e('Logic basics', 'labels', 'Net labels (wireless connections)'),
  e('Memory and sequential', 'sr-latch', 'SR latch from NOR gates'),
  e('Memory and sequential', 'd-latch', 'D latch from NAND gates'),
  e('Memory and sequential', 'master-slave', 'Master-slave flip-flop from two latches'),
  e('Memory and sequential', 'debounce', 'Button debouncer: why a naive counter miscounts'),
  e('Memory and sequential', 'shift-register', 'Shift register (D flip-flops)'),
  e('Memory and sequential', 'ripple-counter', 'Ripple counter (T flip-flops)'),
  e('Arithmetic', 'adder', '4-bit adder'),
  e('Arithmetic', 'alu-flags', 'ALU with zero, carry and negative flags'),
  e('Arithmetic', 'calculator', 'Calculator: ALU, multiplier, ROM, BCD'),
  e('Buses and tri-state', 'tristate', 'Tri-state buffers on a shared line'),
  e('Buses and tri-state', 'buses', 'Buses: a running total on 4-bit wires'),
  e('Buses and tri-state', 'arbiter', 'Bus arbitration: who gets the bus'),
  e('Buses and tri-state', 'databus', 'Shared data bus: tri-state buffers on 8 bits'),
  e('Timing and glitches', 'hazard', 'Glitch: a hazard, and its fix'),
  e('Timing and glitches', 'ripple', 'Ripple-carry adder: the carry chain and flicker'),
  e('Timing and glitches', 'oscillator', 'Ring oscillator (unstable)'),
  e('State machines', 'uart', 'UART: a byte over one wire'),
  e('State machines', 'fsm-traffic', 'Traffic light (generated)'),
  e('State machines', 'fsm-detector', '1011 sequence detector (generated)'),
  e('State machines', 'fsm-vending', 'Vending machine, nickels and dimes (generated)'),
  e('State machines', 'fsm-updown', 'Up/down counter (generated)'),
  e('Displays and gadgets', 'intersection', 'Traffic lights with pedestrian crossing'),
  e('Displays and gadgets', 'dice', 'Electronic dice'),
  e('Displays and gadgets', 'stopwatch', 'Stopwatch with start/stop and lap'),
  e('Displays and gadgets', 'clock', 'Digital clock (HH:MM:SS)'),
  e('Displays and gadgets', 'pwm', 'PWM: a counter and comparator dim a lamp'),
  e('Displays and gadgets', 'lfsr', 'Pseudo-random generator (LFSR)'),
  e('Displays and gadgets', 'matrix', 'Dot matrix smiley (scanned)'),
  e('Computers', 'computer', '8-bit computer (runs Fibonacci)'),
  e('Computers', 'computer-lcd', 'Computer + LCD: bouncing ball'),
  e('Computers', 'computer-sound', 'Computer + speaker: siren'),
  e('Computers', 'computer-calc', 'Computer + keypad: calculator'),
  e('Computers', 'computer-tictactoe', 'Computer + LCD + keypad: tic-tac-toe'),
  e('Computers', 'computer-pong', 'Computer + LCD + gamepad: pong'),
  e('Computers', 'computer-snake', 'Computer + LCD + gamepad: snake'),
  e('Computers', 'computer-sieve', 'Computer + console: prime sieve (index register)'),
  e('Computers', 'computer-sine', 'Computer + LCD: a scrolling sine wave (table ROM)'),
  e('Computers', 'computer-ant', "Computer + LCD: Langton's ant (reads the screen)"),
  e('Computers', 'computer-raycaster', 'Computer + LCD + gamepad: a 3D raycaster'),
  e('6502', '6502', 'A real 6502 CPU on a board: ROM, RAM and LEDs'),
  e('6502', '6502-counter', '6502: a counter on the LEDs (a subroutine and the stack)'),
  e('6502', '6502-hello', '6502 + console: hello (a string in the ROM)'),
  e('6502', '6502-keypad', '6502 + console + keypad: type a key, see it'),
  e('6502', '6502-ball', '6502 + screen + gamepad: a bouncing ball'),
  e('6502', '6502-via', '6502 + VIA: a timer interrupts the CPU, which counts on LEDs'),
  e('6502', '6502-video', '6502 + video chip: a 160×100 test card'),
  e('6502', '6502-lcd', '6502 + VIA + LCD: hello, world (Ben Eater’s)'),
  e('6502', '6502-parts', '6502 from parts: registers, an adder and a microcode ROM (first steps)'),
  e('6502', '6502-parts-irq', '6502 from parts + interrupts: IRQ and NMI buttons'),
  e('6502', '65c02', '65C02: a sweeping LED with SMB, RMB, STZ and BRA'),
  e('6502', '65c02-timer', '65C02 + timer: an interrupt wakes it from WAI'),
  e('BASIC computer', '6502-basic', 'BASIC computer: a 6502 that runs Microsoft BASIC'),
  e('BASIC computer', '6502-basic-lcd', 'BASIC computer + VIA + LCD: POKE text onto a display'),
  e('BASIC computer', '6502-parts-basic', 'BASIC on a 6502 built from parts (very slow)'),
  e('BASIC computer', '6502-echo', '6502 + terminal: echo (polling the status register)'),
  e('BASIC computer', '6502-echo-irq', '6502 + terminal: echo by interrupt'),
  e('Custom ICs', 'ic-adder', 'A 4-bit adder made of ICs inside ICs'),
  e('Custom ICs', 'computer-blocks', 'The 8-bit computer as blocks'),
]

/** The id of the example the app opens with. */
export const WELCOME_ID = EXAMPLE_LIST[0].id

/** The example named by a URL path like "/intersection", if any. */
export function exampleFromPath(pathname: string): ExampleInfo | undefined {
  const slug = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, '')).toLowerCase()
  return EXAMPLE_LIST.find((x) => x.id === slug)
}
