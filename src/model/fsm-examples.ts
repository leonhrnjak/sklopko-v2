import { fsmFrom, type Fsm } from './fsm'

/** Four small machines, as data: the starting points of the state machine editor. */

/** Three lamps in turn. A Moore machine: the lamps depend on the state only. */
export const TRAFFIC_LIGHT: Fsm = fsmFrom({
  name: 'Traffic light',
  type: 'moore',
  outputs: ['Red', 'Yellow', 'Green'],
  states: [
    { name: 'Red', outputs: ['Red'] },
    { name: 'Green', outputs: ['Green'] },
    { name: 'Yellow', outputs: ['Yellow'] },
  ],
  transitions: [
    ['Red', 'Green'],
    ['Green', 'Yellow'],
    ['Yellow', 'Red'],
  ],
})

/**
 * Finds the bits 1 0 1 1 in a stream, one bit per clock. A Mealy machine: Z is 1 on the clock edge where the last 1 comes in. A found
 * pattern can overlap the next (1011011 holds two).
 */
export const SEQUENCE_DETECTOR: Fsm = fsmFrom({
  name: 'Detect 1011',
  type: 'mealy',
  inputs: ['X'],
  outputs: ['Z'],
  states: ['Start', 'One', 'OneZero', 'OneZeroOne'],
  transitions: [
    ['Start', 'One', 'X'],
    ['Start', 'Start', '!X'],
    ['One', 'One', 'X'],
    ['One', 'OneZero', '!X'],
    ['OneZero', 'OneZeroOne', 'X'],
    ['OneZero', 'Start', '!X'],
    ['OneZeroOne', 'One', 'X', ['Z']],
    ['OneZeroOne', 'OneZero', '!X'],
  ],
})

/** A drink for 15 cents, paid in nickels (N) and dimes (D). A Moore machine: Dispense is on while it holds 15 or more. */
export const VENDING_MACHINE: Fsm = fsmFrom({
  name: 'Vending machine',
  type: 'moore',
  inputs: ['N', 'D'],
  outputs: ['Dispense'],
  states: ['Cents0', 'Cents5', 'Cents10', { name: 'Cents15', outputs: ['Dispense'] }],
  transitions: [
    ['Cents0', 'Cents5', 'N & !D'],
    ['Cents0', 'Cents10', 'D & !N'],
    ['Cents5', 'Cents10', 'N & !D'],
    ['Cents5', 'Cents15', 'D & !N'],
    ['Cents10', 'Cents15', 'N | D'],
    ['Cents15', 'Cents0'],
  ],
})

/** A two-bit counter that counts up while Up is 1 and down while it is 0; the outputs are its bits. A Moore machine. */
export const UP_DOWN_COUNTER: Fsm = fsmFrom({
  name: 'Up/down counter',
  type: 'moore',
  inputs: ['Up'],
  outputs: ['B1', 'B0'],
  states: ['Zero', { name: 'One', outputs: ['B0'] }, { name: 'Two', outputs: ['B1'] }, { name: 'Three', outputs: ['B1', 'B0'] }],
  transitions: [
    ['Zero', 'One', 'Up'],
    ['Zero', 'Three', '!Up'],
    ['One', 'Two', 'Up'],
    ['One', 'Zero', '!Up'],
    ['Two', 'Three', 'Up'],
    ['Two', 'One', '!Up'],
    ['Three', 'Zero', 'Up'],
    ['Three', 'Two', '!Up'],
  ],
})

export const FSM_EXAMPLES: Fsm[] = [TRAFFIC_LIGHT, SEQUENCE_DETECTOR, VENDING_MACHINE, UP_DOWN_COUNTER]
