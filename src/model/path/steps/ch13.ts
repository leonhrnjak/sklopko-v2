import { LCD_HELLO_SOURCE } from '../../programs6502'
import type { Step } from '../types'

/**
 * Chapter 13: Programming the 6502. The program is 6502 assembly in the ROM's inspector, and runs on a board of the Computers examples: the
 * canvas is that board, with the step's starting program in its ROM. It is checked by running the board (`run.ts`, `runProgram6502`).
 */

/** The start of every program: it begins where the small board's ROM does, and the reset vector says where to start. */
const FRAME = (body: string) => `.org $F000
start:
${body}
.org $FFFC
.word start`

export const CH13: Step[] = [
  {
    id: 'asm-leds',
    chapter: 'asm6502',
    title: 'Light the LEDs',
    kind: 'program',
    computer: 'board6502',
    example: '6502',
    summary: 'LDA #$55 and STA $4000: show a pattern on the eight LEDs.',
    task: 'Write a program that shows $55 (01010101) on the eight LEDs.',
    hint: 'LDA #$55 loads the number $55 into A. STA $4000 stores A at address $4000, which is the LED register. Then loop on the spot so the program has something to do.',
    starter: `; Show $55 on the eight LEDs.
; The LED register is at address $4000: STA $4000 stores the accumulator there.
${FRAME('        ; your instructions here\ndone:   JMP done      ; then stay here')}`,
    solution: FRAME(`        LDA #$55      ; the pattern 01010101
        STA $4000     ; show it on the LEDs
done:   JMP done`),
    tests: [{ title: 'The LEDs show $55', expect: { leds: 0x55 } }],
    maxTicks: 300,
    lesson: [
      { p: 'Now the program is for the real chip, and you write it in its own language, 6502 assembly. The program goes in the [[ROM $F000–$FFFF]]; the button below selects the ROM, and its inspector shows the program. It starts with `.org $F000`, “the next byte goes at address $F000”, and ends with `.word start`, a pair of bytes at $FFFC: the address the chip reads after reset, which says where to begin.' },
      { p: 'A few things are different from SKASM. The accumulator is A, and a number is written with a # in front: `LDA #$55` loads the number $55 (the $ means hexadecimal). Without the #, `LDA $55` loads the byte at address $55. `STA $4000` stores A at address $4000, where the LED register is. The LEDs show what it holds.' },
      { p: 'There is no HALT: the program ends by jumping to itself, `done: JMP done`.' },
    ],
  },
  {
    id: 'asm-count',
    chapter: 'asm6502',
    title: 'Counting',
    kind: 'program',
    computer: 'board6502',
    example: '6502-counter',
    needs: ['INX', 'TXA', 'BNE'],
    summary: 'INX, TXA and BNE: count on the LEDs, 1, 2, 3…',
    task: 'Make the LEDs count 1, 2, 3, 4… Use X as the counter: INX adds 1 to it, TXA copies it into A, and BNE loops back while the result is not zero.',
    hint: 'Start with LDX #0. Loop: INX, TXA, STA $4000, and BNE back to the loop. After 255 the counter wraps to 0 and BNE falls through.',
    starter: `; Count on the LEDs: 1, 2, 3, ... (use X, INX, TXA and BNE).
${FRAME('        ; your instructions here\ndone:   JMP done')}`,
    solution: FRAME(`        LDX #0        ; X is the counter
loop:   INX           ; one more
        TXA           ; copy it into A
        STA $4000     ; show it
        BNE loop      ; not zero yet: go round again
done:   JMP done      ; after 255 it wraps to 0`),
    tests: [{ title: 'The LEDs take 1, 2, 3, 4, 5, 6, 7, 8 in order', expect: { ledTrace: [1, 2, 3, 4, 5, 6, 7, 8] } }],
    maxTicks: 600,
    lesson: [
      { p: 'The 6502 has three registers you use all the time: the accumulator A, and two index registers, X and Y. They are 8 bits each, so they count from 0 to 255 and then wrap to 0. A counter in X is the usual way to loop: `INX` adds 1 to X, `DEX` takes 1 away, `TXA` copies X into A, and `TAX` copies A into X.' },
      { p: 'A conditional branch looks at the flags, like your computer’s JZ and JNC. `BNE`, “branch if not equal”, branches when the Z flag is 0: when the last result was not zero. The flags come from the last instruction that sets them: here TXA, which sets them from the number it copies. STA does not change them. So when X wraps from 255 to 0, the Z flag is set, BNE does not branch, and the loop ends.' },
    ],
  },
  {
    id: 'asm-string',
    chapter: 'asm6502',
    title: 'A string on the console',
    kind: 'program',
    computer: 'board6502',
    example: '6502-hello',
    needs: ['INX'],
    summary: 'Write HELLO on the console with LDA msg,X.',
    task: 'Write HELLO on the console. Put the letters in the ROM as a string that ends with a 0, and walk along it with X: LDA text,X loads the next letter, and STA $4001 prints it.',
    hint: 'text: .byte "HELLO", 0 is the string. LDX #0, then loop: LDA text,X; BEQ done (a 0 ends it); STA $4001; INX; JMP loop.',
    starter: `; Print HELLO on the console. The console is at $4001: a character stored there is printed.
; text: .byte "HELLO", 0   puts the letters in the ROM, with a 0 at the end.
${FRAME('        ; your instructions here\ndone:   JMP done')}`,
    solution: `.org $F000
CHAR = $4001
start:  LDX #0
next:   LDA text,X    ; the next character
        BEQ done      ; a 0 ends the string
        STA CHAR      ; print it
        INX
        JMP next
done:   JMP done
text:   .byte "HELLO", 0
.org $FFFC
.word start`,
    tests: [{ title: 'The console shows HELLO', expect: { console: 'HELLO' } }],
    maxTicks: 1500,
    lesson: [
      { p: 'The board now has a text console at address $4001: a character stored there is printed. A string is a row of bytes, one for each letter, and a 0 at the end so a program knows when to stop: `text: .byte "HELLO", 0`. The label `text` is the address of the first letter.' },
      { p: 'The 6502 can add X to an address: `LDA text,X` loads the byte at text + X. With X counting 0, 1, 2… the program reads one letter after the other, until the 0, which BEQ (“branch if equal”: the Z flag is 1 because the byte loaded was 0) notices. This is the idea of the index register you met in chapter 11, with the table you read there.' },
    ],
  },
  {
    id: 'asm-subroutine',
    chapter: 'asm6502',
    title: 'A subroutine, and the stack',
    kind: 'program',
    computer: 'board6502',
    example: '6502-counter',
    needs: ['JSR', 'RTS'],
    summary: 'A JSR delay routine between LED changes; watch S and page $01.',
    task: 'Show 1, 2, 4 and 8 on the LEDs, one after the other, with a pause between them: write the pause as a subroutine that you call with JSR and end with RTS. Set up the stack first: LDX #$FF and TXS.',
    hint: 'pause: LDX #$20, a loop with DEX and BNE, then RTS. Call it with JSR pause after each STA $4000. Select the CPU and watch S, the stack pointer, and the RAM at page $01 while a JSR runs.',
    starter: `; Show 1, 2, 4, 8 on the LEDs with a pause between them: a subroutine, called with JSR.
${FRAME('        LDX #$FF      ; the stack pointer: the stack lives at the top of page 1\n        TXS\n        ; your instructions here\ndone:   JMP done\n\n; your subroutine here')}`,
    solution: FRAME(`        LDX #$FF
        TXS
        LDA #1
        STA $4000
        JSR pause
        LDA #2
        STA $4000
        JSR pause
        LDA #4
        STA $4000
        JSR pause
        LDA #8
        STA $4000
done:   JMP done

pause:  LDX #$20      ; waste some time
wait:   DEX
        BNE wait
        RTS           ; go back to after the JSR`),
    tests: [{ title: 'The LEDs take 1, 2, 4, 8 in order', expect: { ledTrace: [1, 2, 4, 8] } }],
    maxTicks: 3000,
    lesson: [
      { p: 'A subroutine is code you call from several places, as in chapter 11, where CALL and RET kept the return addresses in a stack of their own. The 6502 has no separate stack: it uses the RAM. `JSR pause` pushes the return address on the stack, and jumps; `RTS` pulls it back and returns. The stack is in page 1, the 256 bytes from $0100 to $01FF; the register S, the stack pointer, says where the top is. It starts anywhere, so a program sets it first: `LDX #$FF` and `TXS` put it at the top.' },
      { p: 'Select the [[CPU]] while the program runs: S goes down by two when JSR pushes the address, and up again at the RTS. Select the RAM and look at page $01 to see the address that was pushed. The pause itself is a loop that does nothing, a few dozen times: waiting is a program too.' },
    ],
  },
  {
    id: 'asm-lcd',
    chapter: 'asm6502',
    title: 'Hello on an LCD',
    kind: 'program',
    computer: 'board6502',
    example: '6502-lcd',
    summary: 'Ben Eater’s hello world on a character LCD, then change the message.',
    task: 'The program is Ben Eater’s hello world: it writes “Hello, world!” on the LCD. Run it, read how it works, and change the message so the first line says SKLOPKO.',
    hint: 'Only the line message: .byte "Hello, world!", 0 has to change. The rest of the program is the LCD’s start-up and the routines that send a byte.',
    starter: LCD_HELLO_SOURCE,
    solution: LCD_HELLO_SOURCE.replace('"Hello, world!"', '"SKLOPKO"'),
    tests: [{ title: 'The first line of the LCD says SKLOPKO', expect: { lcd: 'SKLOPKO' } }],
    maxTicks: 40000,
    lesson: [
      { p: 'The last output device is a real one: an LCD that shows 16 characters on 2 lines, driven through a 6522 VIA, the chip that gives a 6502 its input and output pins. The VIA’s port B is the LCD’s eight data pins, and three pins of port A are RS, R/W and E, the signals that say “this byte is an instruction or a character”, “read or write” and “now”.' },
      { p: 'The program does what Ben Eater’s video does: first it sets up the ports; then it sends the LCD four instructions (8-bit mode and two lines, display on, entry mode, clear); then it sends the characters of the message, one at a time. Before each byte it reads the LCD’s busy flag, because the LCD is slow. It is the longest program so far, and it is made of the pieces you know: JSR and RTS, a string with X, and registers at addresses.' },
      { p: 'Read it in the ROM’s inspector, with the instructions and their bytes beside it, and press Clock step to follow one write. Then change the message.' },
    ],
  },
  {
    id: 'asm-irq',
    chapter: 'asm6502',
    title: 'An interrupt',
    kind: 'explore',
    open: { example: '6502-via' },
    summary: 'A timer interrupts the CPU: watch it push the return address and read the vector.',
    task: 'Run the board and wait for the timer’s first interrupt. Watch the CPU save where it was on the stack, then read the interrupt vector.',
    ordered: true,
    goals: [
      { cpu: 'CPU', addr: 0x01ff, rw: 'write', text: 'The CPU pushes the return address on the stack ($01FF)' },
      { cpu: 'CPU', addr: 0xfffe, rw: 'read', text: 'It reads the interrupt vector at $FFFE' },
    ],
    hint: 'The timer interrupts once every 1,024 cycles; at the speed of the board that is one second. Run it and wait.',
    lesson: [
      { p: 'A program that waits in a loop for something to happen is wasting the chip. An interrupt is the other way: a device pulls a wire, IRQ, and the CPU stops what it is doing, saves where it was, and runs a routine, then comes back. The program on this board sets up a timer in the VIA, and goes to sleep in a one-line loop, `idle: JMP idle`. Once a second the timer interrupts the [[CPU]].' },
      { p: 'What the CPU does is the same every time: it finishes the instruction, pushes the return address (two bytes) and the flags on the stack, and reads the address of the routine from the interrupt vector, at $FFFE and $FFFF, as it reads the start address from $FFFC at reset. The routine ends with RTI, “return from interrupt”, which pulls the flags and the address back. The routine here adds one to a counter and shows it on the LEDs of port B: the LEDs count seconds.' },
    ],
  },
]
