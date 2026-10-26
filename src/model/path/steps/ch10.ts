import type { Step } from '../types'

/**
 * Chapter 10: Programming your computer. The learner writes SKASM in the Program ROM's inspector. The program runs until HALT on the
 * computer from chapter 9 (theirs, or ours if they skipped it) and on the reference one (`run.ts`, `checkProgram`).
 */

export const CH10: Step[] = [
  {
    id: 'prog-add',
    chapter: 'programming',
    title: 'Your first program',
    kind: 'program',
    summary: 'Add 2 and 5 and keep the answer in RAM word 2.',
    task: 'Write a program that puts 2 + 5 into RAM word 2 and then stops with HALT.',
    hint: 'LDI 2 loads the 2 into the ACC. STA 0 keeps it in RAM word 0. LDI 5, then ADD 0 adds that word to the ACC. STA 2 stores the sum in word 2. HALT stops.',
    starter: `; Put 2 + 5 into RAM word 2, then stop.
; One instruction per line. LDI n, STA address, ADD address, HALT.
`,
    solution: `; Put 2 + 5 into RAM word 2, then stop.
        LDI 2        ; ACC = 2
        STA 0        ; RAM[0] = 2
        LDI 5        ; ACC = 5
        ADD 0        ; ACC = 5 + 2
        STA 2        ; RAM[2] = 7
        HALT
`,
    tests: [{ title: 'RAM word 2 holds 7, and the program stops', expect: { ram: { 2: 7 } } }],
    lesson: [
      { p: 'You have built a computer; now it needs a program. The program lives in the [[Program ROM]], and you write it as assembly: one instruction on each line, with the name of the instruction (its mnemonic) and its operand. Select the ROM and its inspector shows the program as text; the button below selects it for you.' },
      { p: 'The computer knows nine instructions. LDI n puts the number n in the ACC. LDA a loads RAM word a into the ACC. STA a stores the ACC in RAM word a. ADD a and SUB a add or subtract RAM word a to or from the ACC. JMP a jumps to instruction a. JZ a and JNC a jump if the last result was zero or had no carry. HALT stops. A line may start with a label, like “loop:”, to name an address, and a semicolon starts a comment.' },
      { p: 'The adder adds a RAM word to the ACC, not a number to the ACC, so to add 2 and 5 you put one of them in RAM first. The check runs your program on the reference computer and on yours, until it stops.' },
    ],
  },
  {
    id: 'prog-countdown',
    chapter: 'programming',
    title: 'Counting down',
    kind: 'program',
    summary: 'Show 9, 8, 7… down to 0 on the output, then stop.',
    task: 'Write a program that sends 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 to the output (STA 15 writes the ACC there), in that order, and then stops.',
    hint: 'Keep a 1 in RAM to subtract. Loop: write the ACC to address 15, jump to the end if the last subtraction gave zero, otherwise subtract 1 and go round again.',
    starter: `; Count down from 9 to 0 on the output (address 15), then stop.
; JZ label jumps if the last ADD or SUB gave zero; JMP label always jumps.
`,
    solution: `; Count down from 9 to 0 on the output.
        LDI 1
        STA 0        ; RAM[0] = 1, to subtract
        LDI 9
loop:   STA 15       ; show the ACC
        JZ done      ; was the last subtraction zero?
        SUB 0
        JMP loop
done:   HALT
`,
    tests: [{ title: 'The output shows 9 8 7 6 5 4 3 2 1 0, and the program stops', expect: { writes: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] } }],
    lesson: [
      { p: 'The output register is at address 15: `STA 15` shows the ACC on its display and does not touch the RAM. To count down you need a loop: do something, change a number, and jump back. A jump changes what runs next, and a conditional jump, JZ, lets the loop stop: it jumps only if the last ADD or SUB gave zero.' },
      { p: 'The zero flag only changes when an ADD or a SUB runs. So the order matters: after you subtract 1, the flag tells you whether you reached zero. The program has to show the 0 before it stops.' },
    ],
  },
  {
    id: 'prog-multiply',
    chapter: 'programming',
    title: 'Multiplying by adding',
    kind: 'program',
    summary: 'A × B by adding A to itself B times, into RAM word 0.',
    task: 'Multiply FIRST by SECOND by adding, and leave the product in RAM word 0. The check changes the two numbers, so use the names FIRST and SECOND and not the numbers.',
    hint: 'A loop that adds FIRST to word 0, SECOND times. You need a counter in RAM that counts down from SECOND, and a 1 in RAM to subtract. RAM starts out all zeros, so word 0 starts as 0. The whole program has to fit in 16 instructions.',
    starter: `FIRST = 3        ; the check changes these two numbers
SECOND = 4
; RAM word 0 = FIRST x SECOND, by adding. RAM starts as zeros.
`,
    solution: `FIRST = 3
SECOND = 4
        LDI 1
        STA 3        ; RAM[3] = 1
        LDI FIRST
        STA 2        ; RAM[2] = FIRST
        LDI SECOND
        STA 1        ; RAM[1] = how many left to add
loop:   LDA 0
        ADD 2        ; product = product + FIRST
        STA 0
        LDA 1
        SUB 3        ; one fewer to add
        STA 1
        JZ done
        JMP loop
done:   HALT
`,
    tests: [
      { title: '3 × 4 = 12', set: { FIRST: 3, SECOND: 4 }, expect: { ram: { 0: 12 } } },
      { title: '5 × 3 = 15', set: { FIRST: 5, SECOND: 3 }, expect: { ram: { 0: 15 } } },
      { title: '2 × 6 = 12', set: { FIRST: 2, SECOND: 6 }, expect: { ram: { 0: 12 } } },
      { title: '7 × 1 = 7', set: { FIRST: 7, SECOND: 1 }, expect: { ram: { 0: 7 } } },
    ],
    lesson: [
      { p: 'The computer has no multiply instruction. A × B is A added to itself B times, and that is a loop. A line `FIRST = 3` gives the number 3 a name, so that `LDI FIRST` means `LDI 3`. The check rewrites those two lines to try other numbers, so your program must not use the numbers themselves.' },
      { p: 'You need to keep three things in RAM: the product so far, how many times are left to add, and FIRST itself (ADD adds a RAM word). A 1 in RAM is needed too, to count down with SUB. Four words, and 16 instructions in the ROM: it is a tight fit.' },
      { p: 'Numbers have 4 bits, so the product must be 15 or less: the check does not try the ones that do not fit.' },
    ],
  },
  {
    id: 'prog-fib',
    chapter: 'programming',
    title: 'Fibonacci',
    kind: 'program',
    summary: '1 1 2 3 5 8 13 on the output, and stop when the next one would not fit in 4 bits.',
    task: 'Send the Fibonacci numbers 1 1 2 3 5 8 13 to the output, in order, and stop with HALT when the next one would be more than 15.',
    hint: 'Keep the last two numbers in RAM. Add them (ADD sets the carry if the sum is over 15, and JNC jumps when it is not), show the sum, then move the numbers along. Each number is the sum of the two before it. It fits in 16 instructions.',
    starter: `; Fibonacci on the output: 1 1 2 3 5 8 13, then stop (the next, 21, does not fit in 4 bits).
; ADD sets the carry flag when the sum is over 15. JNC label jumps when there was no carry.
`,
    solution: `        LDI 1
        STA 0        ; a = 1
        STA 15       ; show 1
        STA 1        ; b = 1
        STA 15       ; show 1
loop:   LDA 0
        ADD 1        ; a + b
        JNC fits     ; no carry: it fits in 4 bits
        HALT
fits:   STA 2        ; c = a + b
        STA 15       ; show c
        LDA 1
        STA 0        ; a = b
        LDA 2
        STA 1        ; b = c
        JMP loop
`,
    tests: [{ title: 'The output shows 1 1 2 3 5 8 13, and the program stops', expect: { writes: [1, 1, 2, 3, 5, 8, 13] } }],
    lesson: [
      { p: 'Each Fibonacci number is the sum of the two before it: 1, 1, 2, 3, 5, 8, 13, 21… With 4-bit numbers the sequence stops at 13, because 8 + 13 = 21 does not fit. The computer tells you so itself: the ADD sets the carry flag, and JNC (jump if no carry) goes on only while the sum fits.' },
      { p: 'You need to remember two numbers and work out a third, then forget the oldest: that is three words of RAM. The ACC is only one number wide, so every step goes through it: LDA, ADD, STA.' },
      { p: 'This is also the end of the programs for this computer. Its RAM is 16 words and its ROM 16 instructions: it is time for a bigger one.' },
    ],
  },
]
