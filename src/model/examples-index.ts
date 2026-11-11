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
  'Doom-like',
  'Custom ICs',
] as const
export type ExampleGroup = (typeof EXAMPLE_GROUPS)[number]

export interface ExampleInfo {
  /** Also the URL slug: sklopko.example/<id> opens this example. */
  id: string
  name: string
  group: ExampleGroup
  /** The title (or its start) of a frame to open at, for a circuit too large to read whole. *Fit* still fits everything. */
  fit?: string
}

const e = (group: ExampleGroup, id: string, name: string, fit?: string): ExampleInfo => ({ id, name, group, ...(fit ? { fit } : {}) })

// Frames to open at: the first stage of an 8-bit computer, the CPU of a 6502 board, the sequencer of the 6502 built from parts.
const FETCH = 'Fetch'
const CPU = 'THE CPU'
const SEQUENCER = 'SEQUENCER'

/** Sorted by group, so the flat list and the menu agree. */
export const EXAMPLE_LIST: ExampleInfo[] = [
  e('Start here', 'counter', 'Counter → 7-segment display'),
  e('Start here', 'gates', 'Basic gates'),
  e('Start here', 'shift-register', 'Shift register (D flip-flops)'),
  e('Logic basics', 'mux', '4:1 multiplexer'),
  e('Logic basics', 'encoder', 'Priority encoder and decoder'),
  e('Logic basics', 'seg7-table', 'Seven-segment decoder from a truth table', 'From a truth table'),
  e('Logic basics', 'labels', 'Net labels (wireless connections)'),
  e('Memory and sequential', 'sr-latch', 'SR latch from NOR gates'),
  e('Memory and sequential', 'd-latch', 'D latch from NAND gates'),
  e('Memory and sequential', 'master-slave', 'Master-slave flip-flop from two latches'),
  e('Memory and sequential', 'debounce', 'Button debouncer: why a naive counter miscounts'),
  e('Memory and sequential', 'ripple-counter', 'Ripple counter (T flip-flops)'),
  e('Memory and sequential', 'sync-counter', 'Synchronous counter (JK) beside a ripple counter, and a ring counter', 'Ripple counter'),
  e('Arithmetic', 'adder', '4-bit adder'),
  e('Arithmetic', 'adders', 'Half and full adders: from gates, and as parts'),
  e('Arithmetic', 'subtract', 'Subtracting: two’s complement, borrow and overflow', 'Four bits'),
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
  e('Computers', 'beginner', 'Beginner: a tiny computer (ROM, RAM, adder)', '1. FETCH'),
  e('Computers', 'computer', '8-bit computer (runs Fibonacci)', FETCH),
  e('Computers', 'computer-lcd', 'Computer + LCD: bouncing ball', FETCH),
  e('Computers', 'computer-sound', 'Computer + speaker: siren', FETCH),
  e('Computers', 'computer-calc', 'Computer + keypad: calculator', FETCH),
  e('Computers', 'computer-tictactoe', 'Computer + LCD + keypad: tic-tac-toe', FETCH),
  e('Computers', 'computer-pong', 'Computer + LCD + gamepad: pong', FETCH),
  e('Computers', 'computer-snake', 'Computer + LCD + gamepad: snake', FETCH),
  e('Computers', 'computer-sieve', 'Computer + console: prime sieve (index register)', FETCH),
  e('Computers', 'computer-sine', 'Computer + LCD: a scrolling sine wave (table ROM)', FETCH),
  e('Computers', 'computer-ant', "Computer + LCD: Langton's ant (reads the screen)", FETCH),
  e('Computers', 'computer-raycaster', 'Computer + LCD + gamepad: a 3D raycaster', FETCH),
  e('6502', '6502', 'A real 6502 CPU on a board: ROM, RAM and LEDs', CPU),
  e('6502', '6502-counter', '6502: a counter on the LEDs (a subroutine and the stack)', CPU),
  e('6502', '6502-hello', '6502 + console: hello (a string in the ROM)', CPU),
  e('6502', '6502-keypad', '6502 + console + keypad: type a key, see it', CPU),
  e('6502', '6502-echo', '6502 + terminal: echo (polling the status register)', CPU),
  e('6502', '6502-echo-irq', '6502 + terminal: echo by interrupt', CPU),
  e('6502', '6502-ball', '6502 + screen + gamepad: a bouncing ball', CPU),
  e('6502', '6502-via', '6502 + VIA: a timer interrupts the CPU, which counts on LEDs', CPU),
  e('6502', '6502-lcd', '6502 + VIA + LCD: hello, world (Ben Eater’s)', CPU),
  e('6502', '6502-parts', '6502 from parts: registers, an adder and a microcode ROM (all 151 opcodes)', SEQUENCER),
  e('6502', '6502-parts-irq', '6502 from parts + interrupts: IRQ and NMI buttons', SEQUENCER),
  e('6502', '65c02', '65C02: a sweeping LED with SMB, RMB, STZ and BRA', CPU),
  e('6502', '65c02-timer', '65C02 + timer: an interrupt wakes it from WAI', CPU),
  e('6502', '6502-video', '6502 + video chip: a 160×100 test card', CPU),
  e('6502', '6502-gameboard', '6502 game board: video, gamepad, VIA and two ROM banks', CPU),
  e('BASIC computer', '6502-basic', 'BASIC computer: a 6502 that runs Microsoft BASIC', CPU),
  e('BASIC computer', '6502-basic-lcd', 'BASIC computer + VIA + LCD: POKE text onto a display', CPU),
  e('BASIC computer', '6502-parts-basic', 'BASIC on a 6502 built from parts (very slow)', SEQUENCER),
  e('Doom-like', '6502-doomlike', '6502 3D shooter: five levels, monsters, a gun, a HUD', CPU),
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
