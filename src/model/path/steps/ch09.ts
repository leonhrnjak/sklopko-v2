import type { Step } from '../types'
import { CPU_PROGRAM, giveControlRom } from '../cpu4'

/**
 * Chapter 9: Build a computer. One circuit, the learner's, grows through the steps; each step ends with a stage of the reference computer
 * (`cpu4.ts`) and is checked by running test programs on it (`run.ts`). The parts are built-ins, labelled as the beginner computer labels them.
 */

export const CH09: Step[] = [
  {
    id: 'cpu-plan',
    chapter: 'computer',
    title: 'Fetch, decode, execute',
    kind: 'read',
    summary: 'What a computer does, and what an instruction is: a number with a few fields.',
    lesson: [
      { p: 'You have built the parts of a computer: an ALU, registers, a counter and memories. A computer is those parts and a rhythm. On every tick of its clock it does three things in turn. It fetches the next instruction from memory, using the program counter. It decodes it: works out what it asks for. Then it executes it: the registers, the adder and the RAM do what was asked.' },
      { p: 'An instruction is only a number. The computer you will build reads a 16-bit word from its program memory. Click the bits of this one to see what the word means: bits 4 to 7 are the opcode, which says which instruction it is; the rest are what the instruction works on, a number to load or the address of a word of RAM.' },
      { word: { value: 0x0300 } },
      { p: 'The word 0300 in hexadecimal has the opcode 0, LDI, “load immediate”: put the number in the instruction into the accumulator, the register the computer works on. The number is in bits 8 to 11: 3. The word 0020 has the opcode 2, STA, “store”: write the accumulator into RAM at the address in bits 0 to 3.' },
      { p: 'Over the next steps you build this machine in one circuit, step by step: first fetching, then decoding, then executing, adding an instruction at a time. Each step checks your circuit by running a small program on it.' },
      {
        quiz: [
          { q: 'In the word 0300, which bits hold the number 3 that LDI loads?', options: ['Bits 0 to 3', 'Bits 4 to 7', 'Bits 8 to 11'], answer: 2, why: 'Bits 8 to 11 are 0011, which is 3. Bits 4 to 7 are the opcode, 0000, which is LDI.' },
          { q: 'What is the opcode of the word 0040?', options: ['0', '4', '2'], answer: 1, why: 'Bits 4 to 7 of 0040 are 0100, which is 4. Opcode 4 is ADD.' },
        ],
      },
    ],
  },
  {
    id: 'cpu-fetch',
    chapter: 'computer',
    title: 'Fetching instructions',
    kind: 'project',
    project: 'cpu4',
    stage: 1,
    summary: 'A program counter that steps through the Program ROM, one instruction per tick.',
    palette: ['counterld', 'counter', 'hexdisp', 'rom', 'clock', 'switch', 'led'],
    task: 'Add a Counter with load, label it PC, wire the Clock to it, and wire its four outputs to the Program ROM’s address pins A0 to A3. A hex display on the outputs is a good idea.',
    hint: 'The counter’s Q0 to Q3 go to the ROM’s A0 to A3 and to the display’s A to D. Its LD stays off and its EN on, so it counts on every tick.',
    runs: [
      {
        title: 'The 3 + 4 program',
        program: CPU_PROGRAM,
        checks: [
          { after: 0, text: 'at the start the PC is 0 and the ROM shows the first instruction', expect: [{ value: 'PC', is: 0 }, { value: 'Program ROM', is: 0x0300 }] },
          { after: 3, text: 'after 3 ticks the PC is 3 and the ROM shows the fourth instruction', expect: [{ value: 'PC', is: 3 }, { value: 'Program ROM', is: 0x0040 }] },
          { after: 5, text: 'after 5 ticks the PC is 5 and the ROM shows HALT', expect: [{ value: 'PC', is: 5 }, { value: 'Program ROM', is: 0x0070 }] },
        ],
      },
    ],
    lesson: [
      { p: 'The circuit already has a [[Clock]] and a [[Program ROM]]. The ROM holds the program, one 16-bit instruction at each address, and shows the instruction at the address on its pins A0 to A3. Right now nothing gives it an address.' },
      { p: 'The part that does is the program counter, the PC: a register that counts. Your counter chip is the same as the built-in Counter with load, and that one is in the parts list now. Add it, give it the label PC (select it and type the label), and wire the clock to its CLK pin. Every tick it counts up by one, so the ROM shows instruction 0, then 1, then 2…' },
      { p: 'Wire the counter’s outputs Q0 to Q3 to the ROM’s address pins A0 to A3. A hex display on the same outputs lets you see the PC. Then press Clock step to tick.' },
    ],
  },
  {
    id: 'cpu-decode',
    chapter: 'computer',
    title: 'Decoding instructions',
    kind: 'project',
    project: 'cpu4',
    stage: 2,
    give: giveControlRom,
    summary: 'The Control ROM turns an opcode into signals: here, LOAD_ACC for LDI.',
    palette: ['led', 'hexdisp', 'switch', 'rom'],
    task: 'Wire the opcode (the Program ROM’s D4 to D7) to the Control ROM’s address pins, add an LED labelled LOAD_ACC on the Control ROM’s LOAD_ACC output, and switch LOAD_ACC on in the row of LDI.',
    hint: 'Program ROM D4, D5, D6, D7 go to Control ROM A0, A1, A2, A3. Click the Control ROM, find the row 0 LDI, and turn LOAD_ACC on. The LOAD_ACC output is the pin named LOAD_ACC.',
    runs: [
      {
        title: 'LDI, STA, LDI, STA',
        program: 'LDI 3\nSTA 0\nLDI 4\nSTA 1',
        checks: [
          { after: 0, text: 'at an LDI, LOAD_ACC is lit', expect: [{ led: 'LOAD_ACC', is: 1 }] },
          { after: 1, text: 'at an STA it is dark', expect: [{ led: 'LOAD_ACC', is: 0 }] },
          { after: 2, text: 'at the next LDI it is lit again', expect: [{ led: 'LOAD_ACC', is: 1 }] },
          { after: 3, text: 'and dark at the STA after it', expect: [{ led: 'LOAD_ACC', is: 0 }] },
        ],
      },
    ],
    lesson: [
      { p: 'The ROM now shows each instruction, but nothing understands it. The opcode, bits 4 to 7 of the word, says which instruction it is, and a second table, the [[Control ROM]], says what each one does. Its address is the opcode; its outputs are the signals that switch parts of the computer on and off: LOAD_ACC (the accumulator takes a new value), WRITE_RAM, SUBTRACT, JUMP, HALT.' },
      { p: 'The Control ROM has been added for you, with its signals named and every row empty. Wire the four opcode bits to its four address pins. Then click it: the rows are the instructions, and clicking a row lets you choose its signals. LDI has to switch LOAD_ACC on; leave the others for later.' },
      { p: 'Put an LED labelled LOAD_ACC on that output to see the signal. Then tick the clock: it should light on every LDI and stay dark on every other instruction.' },
    ],
  },
  {
    id: 'cpu-ldi',
    chapter: 'computer',
    title: 'The accumulator, and LDI',
    kind: 'project',
    project: 'cpu4',
    stage: 3,
    summary: 'A register that loads the number in the instruction when LOAD_ACC is on: LDI works.',
    palette: ['register', 'hexdisp', 'led', 'switch'],
    task: 'Add a 4-bit register, label it ACC, and give it the number in the instruction (the Program ROM’s D8 to D11 into its A to D). Its load input comes from LOAD_ACC, its clock from the Clock.',
    hint: 'Program ROM D8, D9, D10, D11 go to the register’s A, B, C, D. The Control ROM’s LOAD_ACC output goes to its LD pin and the Clock to CLK. A display on its outputs shows the ACC.',
    runs: [
      {
        title: 'LDI 3, LDI 5',
        program: 'LDI 3\nLDI 5',
        checks: [
          { after: 1, text: 'after the first LDI the ACC is 3', expect: [{ value: 'ACC', is: 3 }] },
          { after: 2, text: 'after the second it is 5', expect: [{ value: 'ACC', is: 5 }] },
        ],
      },
      { title: 'LDI 9', program: 'LDI 9', checks: [{ after: 1, text: 'the ACC is 9', expect: [{ value: 'ACC', is: 9 }] }] },
      {
        title: 'LDI 6, STA 0, LDI 2',
        program: 'LDI 6\nSTA 0\nLDI 2',
        checks: [
          { after: 2, text: 'an STA leaves the ACC alone: it is still 6', expect: [{ value: 'ACC', is: 6 }] },
          { after: 3, text: 'and the next LDI loads 2', expect: [{ value: 'ACC', is: 2 }] },
        ],
      },
    ],
    lesson: [
      { p: 'The accumulator, the ACC, is the number the computer is working on: a 4-bit register. LDI puts the number that is written in the instruction into it. That number is in bits 8 to 11 of the word, the Program ROM’s outputs D8 to D11.' },
      { p: 'The register must only load when the instruction is one that loads it. That is what the signal is for: wire LOAD_ACC from the Control ROM to the register’s LD pin. On an STA, LD is off, so the register keeps its value.' },
      { p: 'Add a 4-bit register, label it ACC, wire it, and put a hex display on its outputs. Tick the clock with the 3 + 4 program: the first instruction is LDI 3.' },
    ],
  },
]
