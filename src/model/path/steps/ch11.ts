import { comb } from '../../challenges'
import type { Circuit } from '../../circuit'
import { startOf } from '../../challenges'
import type { Step } from '../types'

/**
 * Chapter 11: A bigger computer. The 8-bit computer of the Computers examples is not built by the learner: they meet it as blocks, build the
 * one idea it adds that a bus needs (many drivers on one line), and write three programs for it (the console, a table and the index register,
 * and a subroutine). The programs run on the circuit on the canvas, until HALT (`run.ts`, `checkProgram8`).
 */

/** Two sources on one 2-bit bus: SEL chooses X (0) or Y (1); the other is let go with a tri-state buffer. */
function sharedBusSolution(): Circuit {
  const { b, ins, outs } = startOf(['X1', 'X0', 'Y1', 'Y0', 'SEL'], ['B1', 'B0'])
  const nsel = b.add('not', 100, 340)
  b.wire(`${ins.SEL}.Q`, `${nsel}.A`)
  ;['1', '0'].forEach((bit, i) => {
    const fromX = b.add('tribuf', 180, i * 140)
    const fromY = b.add('tribuf', 180, i * 140 + 60)
    const join = b.add('busjoin', 320, i * 140 + 20, { params: { drivers: 2 } })
    b.wire(`${ins[`X${bit}`]}.Q`, `${fromX}.A`)
    b.wire(`${nsel}.Y`, `${fromX}.EN`)
    b.wire(`${ins[`Y${bit}`]}.Q`, `${fromY}.A`)
    b.wire(`${ins.SEL}.Q`, `${fromY}.EN`)
    b.wire(`${fromX}.Y`, `${join}.A`)
    b.wire(`${fromY}.Y`, `${join}.B`)
    b.wire(`${join}.Y`, `${outs[`B${bit}`]}.A`)
  })
  return b.build()
}

export const CH11: Step[] = [
  {
    id: 'meet-8bit',
    chapter: 'bigger',
    title: 'The 8-bit computer',
    kind: 'read',
    summary: 'The same machine as yours, 8 bits wide, on buses, with an index register and subroutines.',
    lesson: [
      { p: 'The computer you built is the beginner computer: 4-bit numbers, 16 words of RAM, 16 instructions of program. It is enough to see how a computer works, and too small to do much. Open Examples → Custom ICs → “The 8-bit computer as blocks” to meet its big sister: the same fetch, decode and execute, in 8 bits.' },
      { p: 'It is drawn as seven blocks: Fetch (the program counter), the Program ROM, the Instruction fields, Control (the control ROMs, as yours), Data memory, the ALU and the Accumulator. Wires of eight bits travel together as buses, drawn thick. Select a block and press Edit IC to look inside: it is made of the same parts as yours. Press Clock step to run it: it counts through the Fibonacci numbers.' },
      { p: 'It also knows more instructions, the language SKASM: logic and shifts, an index register X that points anywhere in 256 bytes of RAM, a table of constants in the ROM, a stack for subroutines, and ports for devices: a text console, a screen, a speaker, a keypad. The next steps use some of them.' },
      {
        quiz: [
          { q: 'What is the biggest number the 8-bit computer’s accumulator can hold?', options: ['15', '127', '255'], answer: 2, why: '8 bits make 2⁸ = 256 numbers, from 0 to 255. Yours holds 4 bits: 0 to 15.' },
          { q: 'How is the 8-bit computer different from yours in the way it works?', options: ['It fetches, decodes and executes in the same three steps', 'It has no control ROM', 'It runs the program without a clock'], answer: 0, why: 'It is the same machine: a program counter, a ROM, control ROMs, RAM, an ALU and an accumulator. It is wider, and it knows more instructions.' },
        ],
      },
    ],
  },
  {
    id: 'shared-bus',
    chapter: 'bigger',
    title: 'Many drivers, one bus',
    kind: 'build',
    summary: 'Two sources share a line: a tri-state buffer lets go of it when it is not its turn.',
    palette: ['tribuf', 'busjoin', 'not', 'switch', 'led'],
    challenge: comb({
      id: 'path-shared-bus',
      group: 'Learn: A bigger computer',
      title: 'A shared bus',
      lesson: [],
      task: 'Two 2-bit numbers, X and Y, are both connected to the bus B. When SEL is off the bus carries X; when SEL is on it carries Y. Use tri-state buffers, so that only one source drives the bus at a time.',
      hint: 'Each bit has two buffers: X’s is enabled when SEL is off (a NOT of SEL), Y’s when SEL is on. Join the two outputs of a bit with a Bus junction (with 2 drivers).',
      inputs: ['X1', 'X0', 'Y1', 'Y0', 'SEL'],
      outputs: ['B1', 'B0'],
      goal: 'B1 = ¬SEL·X1 + SEL·Y1\nB0 = ¬SEL·X0 + SEL·Y0',
      rules: { only: ['tribuf', 'busjoin', 'not'] },
      solution: sharedBusSolution,
    }),
    solution: sharedBusSolution,
    lesson: [
      { p: 'The computer you built has a multiplexer in front of the ACC to choose where the number comes from. There is another way, and the 8-bit computer’s designers could have used it: put every source on one set of wires, the bus, and let only one of them talk at a time.' },
      { p: 'A gate’s output is always 0 or 1; wire two outputs together and they fight. A tri-state buffer has a third state: when its enable, EN, is off it lets go of the line (Z, “high impedance”) and is as if it were not there. So a bus is several tri-state buffers whose outputs are joined, with at most one enabled. A Bus junction joins them; if two enabled buffers disagree, you get X, a contention. The examples Tri-state and Shared data bus show it.' },
      { p: 'Build a bus of two bits for two sources, X and Y. SEL chooses who drives it.' },
    ],
  },
  {
    id: 'prog-console',
    chapter: 'bigger',
    title: 'Hello, console',
    kind: 'program',
    computer: 'cpu8',
    summary: 'Write HI on the console with OUT CHAR.',
    task: 'Write a program that prints HI on the text console and stops. OUT CHAR prints the ACC as a character: the letter H is 72 and I is 73 (or write them as characters, 72 = \'H\').',
    hint: 'LDI 72 puts H in the ACC, OUT CHAR prints it. Then the same for I, then HALT.',
    starter: `; Print HI on the console, then stop.
; OUT CHAR prints the ACC as a character (ASCII: H is 72, I is 73).
`,
    solution: `; Print HI on the console.
        LDI 72       ; H
        OUT CHAR
        LDI 73       ; I
        OUT CHAR
        HALT
`,
    tests: [{ title: 'The console shows HI, and the program stops', expect: { console: 'HI' } }],
    lesson: [
      { p: 'The canvas now has the 8-bit computer with a text console: a small screen that prints the character whose code the program sends to port CHAR. The [[Program]] has room for 256 instructions, and the RAM 256 bytes.' },
      { p: 'Instructions that talk to devices are `OUT port` and `IN port`: `OUT CHAR` sends the ACC to the console. Characters are numbers too, in the ASCII code: A is 65, H 72, I 73, a space 32, 10 a new line. Select the Program ROM (the button below does it) and write the program in its inspector.' },
    ],
  },
  {
    id: 'prog-table-sum',
    chapter: 'bigger',
    title: 'A table and the index register',
    kind: 'program',
    computer: 'cpu8',
    summary: 'Add up five numbers from a .byte table, with X and LDT.',
    task: 'The table has five numbers. Add them up and leave the sum in the ACC at HALT. The check changes the numbers, so read them from the table; do not use their values.',
    hint: 'Keep a total in RAM. Put 0 in X (LDXI 0), then loop: LDT gets TABLE[X], ADD total, STA total, INX. Count to 5 with TXA and CMPI 5, and JNZ back while it is not 5. At the end LDA total.',
    starter: `total = 0
; Add the five numbers of the table, and leave the sum in the ACC.
; LDXI n sets X; LDT reads TABLE[X]; INX adds 1 to X; TXA copies X to the ACC; CMPI n compares the ACC with n; JNZ jumps if not equal.
        HALT
table:  .byte 3, 9, 4, 7, 2
`,
    solution: `total = 0
        LDI 0
        STA total
        LDXI 0       ; X = 0
loop:   LDT          ; ACC = TABLE[X]
        ADD total
        STA total
        INX
        TXA
        CMPI 5       ; five numbers
        JNZ loop
        LDA total    ; ACC = the sum
        HALT
table:  .byte 3, 9, 4, 7, 2
`,
    tests: [
      { title: '3 + 9 + 4 + 7 + 2 = 25', expect: { acc: 25 } },
      { title: '10 + 20 + 30 + 40 + 50 = 150', bytes: [10, 20, 30, 40, 50], expect: { acc: 150 } },
      { title: '1 + 2 + 3 + 4 + 5 = 15', bytes: [1, 2, 3, 4, 5], expect: { acc: 15 } },
    ],
    lesson: [
      { p: 'A loop over a table needs something to count with, and in your computer there was nothing: every address was written into the instruction. The 8-bit computer adds an index register, X, a number that picks which word to use. `LDXI 0` sets X, `INX` adds 1, and `LDT` loads the word of the table that X points to. The table is made by the `.byte` line: a list of constants kept in the ROM, read only.' },
      { p: 'So adding a table is a loop in which X goes 0, 1, 2, 3, 4. TXA copies X to the ACC, CMPI 5 compares it with 5 without changing it, and JNZ jumps back while they are not equal. The check changes the numbers in the table, so a program that counts the numbers itself will not pass.' },
    ],
  },
  {
    id: 'prog-call',
    chapter: 'bigger',
    title: 'A subroutine',
    kind: 'program',
    computer: 'cpu8',
    needs: ['CALL', 'RET'],
    summary: 'A piece of code you call three times: it doubles the ACC.',
    task: 'Write a subroutine that doubles the ACC, and call it three times with CALL: starting from START, the ACC ends at START × 8. End the subroutine with RET.',
    hint: 'After LDI START, three lines of CALL double. HALT. Then, at the label double:, SHL (shift left: doubles the number) and RET.',
    starter: `START = 1            ; the check changes this number
; Double the ACC three times, with a subroutine called with CALL and ended with RET.
; SHL shifts the ACC left one bit: it doubles the number.
        HALT
`,
    solution: `START = 1
        LDI START
        CALL double
        CALL double
        CALL double
        HALT         ; ACC = START x 8
double: SHL          ; ACC = ACC x 2
        RET
`,
    tests: [
      { title: 'From 1 the ACC ends at 8', set: { START: 1 }, expect: { acc: 8 } },
      { title: 'From 3 it ends at 24', set: { START: 3 }, expect: { acc: 24 } },
      { title: 'From 5 it ends at 40', set: { START: 5 }, expect: { acc: 40 } },
    ],
    lesson: [
      { p: 'A subroutine is code you can use from several places. `CALL double` jumps to the label double, and remembers where it came from; `RET` jumps back to the instruction after the CALL. The 8-bit computer keeps the return addresses on a stack, 16 calls deep, so a subroutine can call another.' },
      { p: 'Without CALL and RET you would have to copy the code each time, or jump to it and jump back by hand, and a plain JMP back cannot tell where to go. The check makes sure you use both.' },
      { p: 'This was the last idea the 6502 needs that your computer lacked: an index register, and subroutines. In the next chapter you meet the real chip.' },
    ],
  },
]
