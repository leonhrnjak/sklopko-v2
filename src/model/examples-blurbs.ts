import { EXAMPLE_LIST, type ExampleInfo } from './examples-index'

/** One line for the gallery about each example: what it shows. Kept apart from the index, which is in the main chunk; only the gallery needs these. */
export const BLURBS: Record<string, string> = {
  counter: 'A clock drives a decade counter, a decoder and a seven-segment display. The place to start.',
  '6502': 'A real MOS 6502 on a board: it fetches a program from a ROM, and you watch its address and data bus, clock cycle by clock cycle.',
  beginner: 'A tiny computer you can follow by hand: a ROM of instructions, a RAM, an adder and three steps.',
  gates: 'AND, OR, NOT, NAND, NOR, XOR and XNOR side by side, with a switch for every input.',
  mux: 'Four inputs and two select switches: choose which input reaches the output.',
  encoder: 'A priority encoder turns the highest active request into a number; a decoder turns it back.',
  labels: 'Send and Receive labels join parts without a wire, so big circuits stay readable.',
  'sr-latch': 'Two cross-coupled NOR gates remember one bit: the simplest memory.',
  'd-latch': 'A latch from NAND gates that follows D while Enable is on and holds it afterwards.',
  'master-slave': 'Two latches in a row make a flip-flop that changes only on the clock edge.',
  debounce: 'A bouncing button makes a naive counter jump; a latch gives one clean pulse.',
  'shift-register': 'Four D flip-flops pass a bit along one place on every clock tick.',
  'ripple-counter': 'T flip-flops, each clocked by the one before, count in binary.',
  adder: 'Four full adders add two 4-bit numbers, carrying from bit to bit.',
  'alu-flags': 'An ALU with eight operations and flags for zero, carry and negative results.',
  calculator: 'An ALU, a multiplier, a ROM and a BCD decoder make a small calculator.',
  tristate: 'Several sources share one line through tri-state buffers; two that disagree are a contention.',
  buses: 'Thick 4-bit bus wires carry a running total, shown as one number.',
  arbiter: 'Several devices ask for the bus and the arbiter grants it to one at a time.',
  databus: 'An 8-bit data bus shared by tri-state buffers: one source is enabled at a time.',
  hazard: 'A glitch on a signal that should stay still, found in the timing view, and the fix.',
  ripple: 'The carry ripples through an adder one gate at a time, so sum bits flicker before they settle.',
  oscillator: 'A ring of inverters that never settles: the simulator calls it unstable.',
  uart: 'Sends a byte over one wire (start bit, eight data bits, stop bit) and receives it again.',
  'fsm-traffic': 'A traffic light as a state machine, turned into gates and flip-flops by the generator.',
  'fsm-detector': 'Spots the bits 1011 in a stream, generated from a state diagram.',
  'fsm-vending': 'Takes nickels and dimes and dispenses a drink at 15 cents.',
  'fsm-updown': 'A two-bit counter that counts up or down, generated from a state diagram.',
  intersection: 'Traffic lights for a crossing, with a pedestrian crossing.',
  dice: 'Hold the button to roll an electronic die, let go and it shows its number.',
  stopwatch: 'Start, stop, reset and lap, counting seconds on seven-segment displays.',
  clock: 'A digital clock with hours, minutes and seconds.',
  pwm: 'A counter and a comparator switch a lamp on for part of each cycle, so it dims.',
  lfsr: 'A shift register with feedback makes a pseudo-random pattern that repeats every 15 clocks.',
  matrix: 'A dot matrix scanned row by row shows a smiley that looks steady.',
  computer: 'An 8-bit computer from registers, an ALU, RAM and a control unit, running a Fibonacci program.',
  'computer-lcd': 'The computer draws a bouncing ball on an LCD screen.',
  'computer-sound': 'The computer plays a siren on a speaker.',
  'computer-calc': 'A calculator: type a sum on the keypad and the computer works it out.',
  'computer-tictactoe': 'Tic-tac-toe for two players on an LCD, played with the keypad.',
  'computer-pong': 'Pong on an LCD, played with a gamepad.',
  'computer-snake': 'Snake on an LCD, played with a gamepad.',
  'computer-sieve': 'Prints the primes below 240 on a console, using the index register.',
  'computer-sine': 'Scrolls a sine wave across an LCD, with the values read from a table in the ROM.',
  'computer-ant': "Langton's ant walks over the LCD, reading the pixels it draws.",
  'computer-raycaster': 'A first-person view of a maze, drawn by a raycaster and walked with a gamepad.',
  'ic-adder': 'A half adder in a full adder in a 4-bit adder: parts made from circuits, used like any other part.',
  'computer-blocks': 'The Fibonacci computer drawn as seven ICs: fetch, program ROM, fields, control, memory, ALU and accumulator.',
}

/** The examples whose name, blurb, group or id contain every word of the query (all of them for an empty query). */
export function searchExamples(query: string): ExampleInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return EXAMPLE_LIST
  return EXAMPLE_LIST.filter((x) => {
    const hay = `${x.name} ${BLURBS[x.id] ?? ''} ${x.group} ${x.id}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
