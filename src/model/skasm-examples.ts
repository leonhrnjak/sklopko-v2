/** Small SKASM programs for the language reference. Each is tested: it assembles, and it does what its title says. */
export interface SkasmExample {
  id: string
  title: string
  text: string
  /** What to look at. */
  note: string
  /** The accumulator when the program has halted (checked by the tests). */
  result: number
}

export const SKASM_EXAMPLES: SkasmExample[] = [
  {
    id: 'add',
    title: 'Add two numbers',
    note: 'The accumulator (ACC) holds one number; the other has to be in RAM to add it. STA puts ACC into RAM, ADD adds a RAM word to ACC.',
    result: 12,
    text: `; 7 + 5
        LDI 7        ; ACC = 7
        STA 0        ; RAM[0] = 7
        LDI 5        ; ACC = 5
        ADD 0        ; ACC = 5 + RAM[0] = 12
        HALT
`,
  },
  {
    id: 'countdown',
    title: 'Count down with a loop',
    note: 'A label names an address, and a jump goes there. SUBI sets the zero flag when the result is 0, and JNZ jumps back until then.',
    result: 0,
    text: `        LDI 5        ; start at 5
loop:   SUBI 1       ; ACC = ACC - 1, sets the zero flag when it reaches 0
        JNZ loop     ; not zero yet: go round again
        HALT
`,
  },
  {
    id: 'mask',
    title: 'Split a byte into two halves',
    note: 'ANDI keeps the bits that are 1 in the mask. SHR moves everything one place right, so four of them bring the high half down.',
    result: 10,
    text: `HEX = 0xA5       ; high half 0xA, low half 0x5

        LDI HEX
        SHR
        SHR
        SHR
        SHR              ; ACC = 0xA (the high half)
        STA 0
        LDI HEX
        ANDI 0x0F        ; ACC = 0x5 (the low half)
        STA 1
        LDA 0            ; ACC = the high half again
        HALT
`,
  },
  {
    id: 'sixteen',
    title: 'A 16-bit sum with ADC',
    note: 'ADD sets the carry flag when the sum does not fit in 8 bits. ADC adds that carry to the next byte, so two bytes make one 16-bit number. This adds 0x01F0 + 0x0120 = 0x0310.',
    result: 3,
    text: `; low bytes in RAM 0 and 2, high bytes in RAM 1 and 3; the answer goes to RAM 4 (low) and 5 (high)
        LDI 0xF0
        STA 0
        LDI 0x01
        STA 1
        LDI 0x20
        STA 2
        LDI 0x01
        STA 3

        LDA 0
        ADD 2            ; low bytes: sets the carry flag
        STA 4
        LDA 1
        ADC 3            ; high bytes, plus the carry
        STA 5            ; RAM[5] = 3, RAM[4] = 0x10
        HALT
`,
  },
  {
    id: 'hello',
    title: 'Print a message',
    note: 'OUT CHAR sends the accumulator to the text console as an ASCII character. Run it on a computer with a console (the calculator example has one); on a computer without one, OUT is ignored.',
    result: 33,
    text: `        LDI 72
        OUT CHAR         ; H
        LDI 105
        OUT CHAR         ; i
        LDI 33
        OUT CHAR         ; !
        HALT
`,
  },
]
