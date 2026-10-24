import type { Circuit } from './circuit'
import { boardExample } from './board6502'
import { BALL_SOURCE, COUNTER_SOURCE, HELLO_SOURCE, KEYPAD_SOURCE, SWEEP_65C02_SOURCE, TIMER_NMI_SOURCE } from './programs6502'

/** The 6502 board with devices, one example for each program of `programs6502.ts`. */

const MAP =
  'The devices are at memory addresses, one register each, in the block $4000–$7FFF. A write to $4000 loads the LEDs, $4001 prints a character on the console, $4002 drives the speaker, $4005 and $4006 draw a pixel; a read of $4003 gives the keypad and a read of $4004 the gamepad.'

/** The LEDs count up. */
export const counter6502 = (): Circuit =>
  boardExample(
    { hz: 512, source: COUNTER_SOURCE, devices: ['leds'] },
    {
      intro:
        'A 6502 counting on its LEDs. The program is in the ROM, written in 6502 assembly: select the ROM to read it, with the address and bytes of every instruction beside it. It stores the count at $4000, calls a subroutine that waits (JSR pushes the return address on the stack in the RAM, RTS pulls it back), adds one, and goes round again. After 255 the count wraps to 0.',
    },
  )

/** The console says hello. */
export const hello6502 = (): Circuit =>
  boardExample(
    { hz: 128, source: HELLO_SOURCE, devices: ['console'] },
    {
      intro:
        'A 6502 says hello. The text is bytes in the ROM, ending with a 0; the program walks along it with the X register (LDA text,X) and writes each character to $4001, where the console prints it. Select the ROM to change the greeting, then press Reset.',
      devices: MAP,
    },
  )

/** Keys on the keypad are printed on the console. */
export const keypad6502 = (): Circuit =>
  boardExample(
    { hz: 256, source: KEYPAD_SOURCE, devices: ['leds', 'console', 'keypad'] },
    {
      intro:
        'Type on the keypad: the 6502 prints each key on the console and shows its code on the LEDs. The program waits in a loop, reading $4003 until bit 4 says a press is waiting, then reads the key, writes to $4003 to say it has been read, and looks the code up in a table of characters in the ROM.',
      devices: MAP,
    },
  )

/** A ball bounces on the pixel screen. */
export const ball6502 = (): Circuit =>
  boardExample(
    { hz: 2048, source: BALL_SOURCE, devices: ['screen', 'gamepad'] },
    {
      intro:
        'A ball bounces around a 16 × 16 screen. Every frame the program takes the old ball off, steers it from the gamepad (the arrow keys, while the simulation runs), moves it one pixel, turns it round at a wall, and puts it down again: it writes where to $4005, then a 1 (or a 0) to $4006. The ball and its speed are kept in the first bytes of the RAM, the zero page.',
      devices: MAP,
    },
  )

/** The board with a 65C02, running a program with its new instructions. */
export const sweep65c02 = (): Circuit =>
  boardExample(
    { hz: 512, chip: 'cmos', source: SWEEP_65C02_SOURCE, devices: ['leds'] },
    {
      intro:
        'The same board with a WDC 65C02, the chip that is still made and that breadboard builders use. Its program (select the ROM to read it) uses what the 6502 does not have: STZ clears the pattern, SMB and RMB set and clear one bit of a byte in the zero page so that one LED sweeps along the eight, PHX and PLX keep X on the stack while it waits, and BRA branches back. The part has three more pins than the 6502: BE, VP and ML. Open the 6502 reference (Tools → 6502) and switch to the 65C02 to see every new instruction.',
    },
  )

/** A timer interrupts a 65C02 that is asleep (WAI). */
export const timer65c02 = (): Circuit =>
  boardExample(
    { hz: 512, chip: 'cmos', source: TIMER_NMI_SOURCE, devices: ['leds', 'console'], timer: 2, probes: true },
    {
      intro:
        'An interrupt. The 65C02 runs WAI and goes to sleep: its address bus stops on the next instruction. Twice a second a timer drops the NMI line; the CPU wakes, pushes its place and its flags on the stack, reads the NMI vector from $FFFA, and runs the interrupt routine, which counts on the LEDs and prints a star. RTI returns to where it was, and it sleeps again. The probes record Φ2, the address bus, the data, R/W and SYNC: open Tools → Waveforms to see an interrupt cycle by cycle (the vector is read with VP low).',
      devices: 'The timer is a clock whose output is inverted, so the NMI line rests high and falls at each tick: NMI reacts to the falling edge, whatever the I flag says.',
    },
  )

