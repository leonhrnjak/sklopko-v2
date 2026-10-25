import { basicRomBytes } from './basic-rom'
import type { Circuit } from './circuit'
import { boardExample } from './board6502'
import { BALL_SOURCE, VIA_TIMER_SOURCE, COUNTER_SOURCE, ECHO_IRQ_SOURCE, ECHO_SOURCE, HELLO_SOURCE, KEYPAD_SOURCE, SWEEP_65C02_SOURCE, TIMER_NMI_SOURCE } from './programs6502'

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


const TERMINAL_MAP =
  'This is Ben Eater\u2019s memory map. The terminal is a 6551 serial chip: its chip selects are A14 (CS0, must be 1) and A15 (CS1, must be 0), so it answers in $4000\u2013$7FFF, and A0 and A1 pick one of its four registers, so $5000\u2013$5003 is the data, status, command and control registers (and they repeat). RAM is $0000\u2013$3FFF and the ROM is $8000\u2013$FFFF. The chip works at the rising edge of the clock, like every device here.'

const TERMINAL_DEVICE =
  'The terminal is a screen and a keyboard on the other end of a serial chip. Click its screen and type; select it to see its registers. Until the program sets bit 0 of the command register (the receiver), what you type waits in the keyboard buffer. Bit 3 of the status register says a key has arrived; reading the data register takes it, and writing the data register prints a character.'

/** Echo: the program polls the terminal's status register. */
export const echo6502 = (): Circuit =>
  boardExample(
    { hz: 256, memory: 'big', source: ECHO_SOURCE, devices: ['terminal'] },
    {
      intro:
        'A 6502 with a terminal. The program switches the serial chip on, prints HELLO, and then waits: it reads the status register over and over until bit 3 (a key has arrived), reads the key from the data register and writes it straight back, so it appears on the screen. Click the terminal\u2019s screen and type. Pause and use Clock step to watch the loop poll the status register; select the ROM to read the program.',
      decode: TERMINAL_MAP,
      devices: TERMINAL_DEVICE,
    },
  )

/** Echo by interrupt: the terminal pulls the CPU's IRQ line. */
export const echoIrq6502 = (): Circuit =>
  boardExample(
    { hz: 256, memory: 'big', source: ECHO_IRQ_SOURCE, devices: ['terminal'], interrupt: true },
    {
      intro:
        'The same echo, without polling. The main program does something else: it counts in the first two bytes of the RAM, over and over. The terminal\u2019s IRQ pin is wired to the CPU\u2019s: when a key arrives the chip pulls it low, the CPU finishes its instruction, pushes where it was, and runs the interrupt routine whose address is stored at $FFFE. The routine reads the status register (which lets IRQ go high again), reads the key, writes it back, and returns with RTI. Type, and watch the count in the RAM keep going.',
      decode: TERMINAL_MAP,
      devices: TERMINAL_DEVICE,
    },
  )

/** The ROM of the BASIC computer as hex text (16 KB, from $C000: Microsoft BASIC and the terminal code). */
const basicRomText = () => basicRomBytes().map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ')

const BASIC_DECODE =
  'Ben Eater\u2019s memory map. RAM is $0000\u2013$3FFF (16 KB: BASIC\u2019s zero page and stack, then your program and its variables, about 15,600 bytes free). The terminal\u2019s own chip selects do the decoding (CS0 = A14, CS1 = A15 low), so its four registers are at $5000\u2013$5003. The ROM is $8000\u2013$FFFF (16 KB seen twice): Microsoft BASIC from $C000, and the reset and interrupt vectors at $FFFA.'

const BASIC_MEMORY =
  'The ROM holds Microsoft BASIC 1.1 (1978, MIT licence, built from Microsoft\u2019s own source) and a small routine that talks to the terminal. Your program and its variables live in the RAM, starting above BASIC\u2019s zero page. The RAM\u2019s inspector shows them as you type: a program line is a link, a line number and the keywords as one-byte tokens.'

const BASIC_DEVICES =
  'Click the terminal\u2019s screen and type. Try PRINT 2+2, then 10 PRINT "HELLO" and RUN. Capitals only; Backspace deletes, Control+C stops a program. The clock is 1 MHz and the step-back history is off, but this is a simulation of every gate\u2019s wires in a web page: expect about a sixth of a real 6502\u2019s speed, so a 1,000-turn FOR loop takes several seconds. The switch makes BASIC ask MEMORY SIZE? and TERMINAL WIDTH? at the next Reset: press Enter for both.'

/** The BASIC computer: Ben Eater\u2019s board with Microsoft BASIC in its ROM. */
export const basic6502 = (): Circuit => {
  const c = boardExample(
    { hz: 1_000_000, memory: 'big', rom: basicRomText(), devices: ['terminal'], dsrSwitch: { label: 'Ask the start-up questions (at Reset)' } },
    {
      intro:
        'A BASIC computer you can read wire by wire: a 6502, 16 KB of RAM, 16 KB of ROM holding Microsoft BASIC, and one serial chip with a screen and a keyboard on the other end, as on Ben Eater\u2019s breadboard. It starts by itself and says OK. Click the terminal\u2019s screen and type a program. Reset is a cold start: the program is lost.',
      decode: BASIC_DECODE,
      memory: BASIC_MEMORY,
      devices: BASIC_DEVICES,
    },
  )
  c.history = false // stepping back over a BASIC interpreter teaches nothing, and the board runs about four times faster without
  return c
}

const VIA_DECODE =
  'The VIA is at $6000 as on Ben Eater\u2019s board: it answers when A15 is 0 and A14 and A13 are both 1 (an AND gate gives its CS1, and A15 is its CS2), and A0 to A3 pick one of its sixteen registers. RAM is $0000\u2013$3FFF, the ROM $8000\u2013$FFFF. Its interrupt pin goes straight to the CPU\u2019s IRQ.'

const VIA_DEVICES =
  'The 6522 has two 8-bit ports and two timers. Port B is wired to eight LEDs: a pin shows only after DDRB says it is an output (until then the chip lets go of it, and the LED is grey). Timer 1 counts the clock, interrupts the CPU when it reaches 0, and starts again; select the VIA to see its registers. PB7 is the timer\u2019s own square wave, with no help from the CPU.'

/** The VIA's timer interrupts the CPU, which counts on port B's LEDs. */
export const via6502 = (): Circuit =>
  boardExample(
    { hz: 1024, memory: 'big', source: VIA_TIMER_SOURCE, devices: ['via'], viaLeds: true },
    {
      intro:
        'A 6522 VIA, the chip that gives a 6502 its input and output pins. The program sets port B to outputs, starts timer 1 in free-running mode, and goes to sleep in a one-line loop. Once a second the timer interrupts the CPU: the routine reads the timer (that clears the flag), adds one to a counter and shows it on the LEDs. The top LED is the timer\u2019s own square wave. Select the VIA to watch its registers; select the ROM to read the program.',
      decode: VIA_DECODE,
      devices: VIA_DEVICES,
    },
  )
