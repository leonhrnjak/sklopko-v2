import type { Step } from '../types'

/**
 * Chapter 14: A computer that runs BASIC. The BASIC computer of the examples (a 6502, 16 KB of RAM and of ROM, a terminal): the learner starts it,
 * types to it, and the goals tick as the terminal shows what they asked for. The last step is *Your journey*.
 */

const TERMINAL = 'Terminal (6551) $5000–$5003'

export const CH14: Step[] = [
  {
    id: 'basic-boot',
    chapter: 'basic',
    title: 'The BASIC computer',
    kind: 'explore',
    open: { example: '6502-basic' },
    summary: 'A 6502, 16 KB of RAM, 16 KB of ROM with BASIC in it, and a terminal: it says OK.',
    task: 'Let the computer start: in a moment its terminal says OK.',
    goals: [{ terminal: TERMINAL, line: 'OK', text: 'The terminal says OK' }],
    hint: 'It starts by itself. If it is paused, press Run at the top. The screen is on the right of the board.',
    lesson: [
      { p: 'This is the board you wired in chapter 12, with more on it: a 6502, a RAM of 16 KB at the bottom of the memory, a ROM of 16 KB at the top, and a serial chip, a 6551, at $5000, with a screen and a keyboard at its other end: the [[Terminal (6551) $5000–$5003]]. It is Ben Eater’s breadboard computer.' },
      { p: 'In the ROM is a program: Microsoft BASIC, the language of the first microcomputers, in the version that Ric Weiland and Bill Gates wrote for the 6502 (it says so in the ROM: BY WEILAND & GATES). It starts at reset, works out how much RAM there is, prints its banner, and says OK. That is a prompt: it is waiting for you.' },
      { p: 'What you see took the whole path to build. The 6502 runs BASIC the way your computer ran its little programs: fetch, decode, execute, 1,000,000 times a second.' },
    ],
  },
  {
    id: 'basic-print',
    chapter: 'basic',
    title: 'PRINT and RUN',
    kind: 'explore',
    open: { example: '6502-basic' },
    summary: 'Type PRINT 2+3, and a one-line program that you RUN.',
    task: 'Click the terminal’s screen and type PRINT 2+3 (then Enter): BASIC answers 5. Then type 10 PRINT "HELLO" (Enter) and RUN (Enter): the program prints HELLO.',
    ordered: true,
    goals: [
      { terminal: TERMINAL, line: '5', text: 'BASIC answers 5' },
      { terminal: TERMINAL, line: 'HELLO', text: 'The program prints HELLO' },
    ],
    hint: 'Click the screen first, so that the keys go to it. A line that starts with a number, like 10 PRINT "HELLO", is stored as part of a program; a line without one runs at once. RUN starts the stored program.',
    lesson: [
      { p: 'BASIC is both a language and a program that reads lines. A line without a number is a command and runs at once: PRINT 2+3 prints the sum. A line that starts with a number, like 10 PRINT "HELLO", is not run: BASIC keeps it as a line of a program, in order of the numbers. RUN starts the program.' },
      { p: 'Click the screen of the [[Terminal (6551) $5000–$5003]] and type. Everything you type is sent as a character to the 6551, which the 6502 reads, one character at a time, from address $5000 (the program in the ROM polls it); everything BASIC prints goes the other way. The keyboard types capitals: BASIC understands only those.' },
    ],
  },
  {
    id: 'basic-loop',
    chapter: 'basic',
    title: 'A loop',
    kind: 'explore',
    open: { example: '6502-basic' },
    summary: 'FOR I=1 TO 10: PRINT I: NEXT counts to ten.',
    task: 'Type FOR I=1 TO 10: PRINT I: NEXT (Enter): BASIC counts from 1 to 10.',
    goals: [{ terminal: TERMINAL, line: '10', text: 'The count reaches 10' }],
    hint: 'Type it on one line, with the colons: FOR I=1 TO 10: PRINT I: NEXT.',
    lesson: [
      { p: 'A computer is for doing things again and again. FOR I=1 TO 10 makes the variable I go from 1 to 10; PRINT I prints it; NEXT goes back to the FOR until I has reached 10. Colons let you put several statements on one line.' },
      { p: 'Underneath it is the loop you wrote in assembly: a counter, a compare, a jump back. BASIC is a program that runs your program: for every statement it fetches, decodes and executes, like the CPU does for its instructions. Tools → BASIC has a reference of the language, and programs to type in: a table, a guessing game.' },
    ],
  },
  {
    id: 'journey',
    chapter: 'basic',
    title: 'Your journey',
    kind: 'read',
    summary: 'Every chip you built, your CPU, your programs: from NAND to BASIC.',
    lesson: [
      { p: 'You started with a switch, a wire and an LED. You made a NAND gate do everything: NOT, AND, OR, XOR; then from a truth table to gates, a multiplexer, an adder, an ALU. A gate that feeds itself remembered a bit; with a clock it became a flip-flop, a register, a counter, a RAM. With those you built a computer, programmed it, met a bigger one, and then a real chip, the 6502, and wrote assembly for it. At the end it runs BASIC.' },
      { journey: true },
      { p: 'Nothing in it is magic. Every layer is made of the one below: BASIC is a program, which is instructions, which are numbers, which are bits, which are gates, which are NANDs. You have seen every step of that, and you built most of them.' },
      { p: 'Where next? The Examples gallery has more computers: games, a calculator, a ray-casting 3D view on the 8-bit computer, a BASIC computer with an LCD. You can open any circuit, edit it, and see what changes. And you can change the computer you built: give it a new instruction, one row of its Control ROM at a time.' },
    ],
  },
]
