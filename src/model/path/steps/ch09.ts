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
  {
    id: 'cpu-ram',
    chapter: 'computer',
    title: 'Memory: STA and LDA',
    kind: 'project',
    project: 'cpu4',
    stage: 4,
    summary: 'RAM for data, and a multiplexer in front of the ACC to choose where it loads from.',
    palette: ['ram', 'mux', 'hexdisp', 'led', 'switch'],
    task: 'Add a 4-bit RAM labelled RAM: its address pins from the instruction (the Program ROM’s D0 to D3), its data from the ACC, WE from WRITE_RAM and its clock from the Clock. Put a 4:1 multiplexer in front of each ACC input, with the number on input 0, the RAM on input 2 and ACC_SRC on its selects. Set the rows STA and LDA.',
    hint: 'Each multiplexer: I0 from Program ROM D8 to D11 (the number), I2 from the RAM’s Q, S0 from the Control ROM’s ACC_SRC pin (first of its two bits) and S1 from the second, Y into the register. In the Control ROM, STA switches on WRITE_RAM, and LDA switches on LOAD_ACC with ACC_SRC set to RAM.',
    runs: [
      {
        title: 'LDI 6, STA 2, LDI 0, LDA 2',
        program: 'LDI 6\nSTA 2\nLDI 0\nLDA 2',
        checks: [
          { after: 1, text: 'LDI still works: the ACC is 6', expect: [{ value: 'ACC', is: 6 }] },
          { after: 2, text: 'STA writes the ACC into RAM word 2', expect: [{ ram: 'RAM', at: 2, is: 6 }] },
          { after: 3, text: 'then LDI 0 clears the ACC', expect: [{ value: 'ACC', is: 0 }] },
          { after: 4, text: 'LDA 2 reads RAM word 2 back: the ACC is 6', expect: [{ value: 'ACC', is: 6 }] },
        ],
      },
      {
        title: 'LDI 5, STA 7, LDI 0, LDA 7',
        program: 'LDI 5\nSTA 7\nLDI 0\nLDA 7',
        checks: [
          { after: 2, text: 'RAM word 7 is 5', expect: [{ ram: 'RAM', at: 7, is: 5 }] },
          { after: 4, text: 'and LDA 7 brings it back', expect: [{ value: 'ACC', is: 5 }] },
        ],
      },
    ],
    lesson: [
      { p: 'So far the computer can load a number from the instruction, and nothing else. A computer also remembers: it has a RAM, and the two instructions that use it. STA, “store”, writes the ACC into the RAM word whose address is in the instruction. LDA, “load”, reads that word into the ACC.' },
      { p: 'Add the [[Program ROM]]’s address to a RAM: bits 0 to 3 of the instruction are the address. The RAM’s data input is the ACC’s output, and its WE, “write enable”, is the Control ROM’s WRITE_RAM signal. STA switches that on; no other instruction does.' },
      { p: 'The ACC now has two places to load from: the number in the instruction, and the RAM. (The adder will be a third.) A multiplexer chooses, one for each bit, and the Control ROM says which with a two-bit signal, ACC_SRC: 0 for the number, 1 for the adder, 2 for the RAM. You earned the built-in multiplexer in chapter 4; use the 4:1 one. Take the wires from the Program ROM that went straight into the ACC and send them through the multiplexers instead.' },
      { p: 'In the Control ROM, the row STA has WRITE_RAM on. The row LDA has LOAD_ACC on, and ACC_SRC set to RAM (click the signal until it says so). LDI keeps LOAD_ACC with ACC_SRC at NUM.' },
    ],
  },
  {
    id: 'cpu-add',
    chapter: 'computer',
    title: 'Arithmetic: ADD and SUB',
    kind: 'project',
    project: 'cpu4',
    stage: 5,
    summary: 'The adder, a flip for subtraction and a carry flag.',
    palette: ['add4', 'xor', 'register', 'const', 'led', 'hexdisp', 'switch'],
    task: 'Add a 4-bit adder labelled Adder: the ACC into A, and the RAM word, through four XORs with SUBTRACT, into B. Its sum is the multiplexers’ input 1, and SUBTRACT goes to its carry in. Add a carry flag: a register labelled Carry flag that takes the adder’s carry out XOR SUBTRACT when SAVE_CARRY, with an LED labelled Carry. Set the rows ADD and SUB.',
    hint: 'The adder’s A0 to A3 come from the ACC’s outputs; B0 to B3 from the XORs; its S0 to S3 go to the multiplexers’ I1. XOR each RAM output with SUBTRACT. The flag register’s A takes the XOR of Co and SUBTRACT; its other inputs go to a Constant 0. ADD: LOAD_ACC, ACC_SRC = ADDER, SAVE_CARRY. SUB is the same with SUBTRACT.',
    runs: [
      {
        title: 'LDI 3, STA 0, LDI 4, ADD 0, STA 1',
        program: 'LDI 3\nSTA 0\nLDI 4\nADD 0\nSTA 1',
        checks: [
          { after: 4, text: 'ADD 0 gives 3 + 4: the ACC is 7', expect: [{ value: 'ACC', is: 7 }] },
          { after: 5, text: 'STA 1 keeps it: RAM word 1 is 7', expect: [{ ram: 'RAM', at: 1, is: 7 }] },
        ],
      },
      {
        title: 'LDI 2, STA 0, LDI 9, SUB 0, STA 1',
        program: 'LDI 2\nSTA 0\nLDI 9\nSUB 0\nSTA 1',
        checks: [
          { after: 4, text: 'SUB 0 gives 9 − 2: the ACC is 7', expect: [{ value: 'ACC', is: 7 }] },
          { after: 5, text: 'and RAM word 1 is 7', expect: [{ ram: 'RAM', at: 1, is: 7 }] },
        ],
      },
      {
        title: 'LDI 12, STA 0, LDI 7, ADD 0',
        program: 'LDI 12\nSTA 0\nLDI 7\nADD 0',
        checks: [
          { after: 3, text: 'before the ADD the Carry LED is dark', expect: [{ led: 'Carry', is: 0 }] },
          { after: 4, text: '12 + 7 is 19, which does not fit in 4 bits: the ACC is 3 and Carry lights', expect: [{ value: 'ACC', is: 3 }, { led: 'Carry', is: 1 }] },
        ],
      },
    ],
    lesson: [
      { p: 'The adder is what makes it a calculator. ADD adds a word of RAM to the ACC and keeps the sum in the ACC: the adder’s A is the ACC, its B the RAM word, and its sum goes to the ACC through the third input of each multiplexer (ACC_SRC = ADDER).' },
      { p: 'Subtraction is addition with the second number flipped and a 1 added: A − B is A + NOT B + 1 (your ADDSUB did exactly that). So B passes through an XOR with a signal, SUBTRACT: XOR leaves the bit as it is when SUBTRACT is 0 and flips it when it is 1. And SUBTRACT also goes to the adder’s carry in, which is the + 1.' },
      { p: 'The carry out is worth keeping: it says that an ADD went over 15, or that a SUB had to borrow. A one-bit memory, the carry flag, takes it when the control signal SAVE_CARRY is on. For SUB the carry comes out the other way round, so the flag takes the carry XOR SUBTRACT. A 4-bit register is a good flag: use its first bit, and tie the other three inputs to a Constant 0.' },
      { p: 'ADD and SUB rows: LOAD_ACC, ACC_SRC set to ADDER, and SAVE_CARRY; SUB also has SUBTRACT on.' },
    ],
  },
  {
    id: 'cpu-jump',
    chapter: 'computer',
    title: 'Jumps and HALT',
    kind: 'project',
    project: 'cpu4',
    stage: 6,
    summary: 'JMP loads the PC from the instruction; HALT stops it. Now it can loop.',
    palette: ['not', 'led', 'hexdisp', 'switch'],
    task: 'Make the PC load the address in the instruction when JUMP is on (its D pins from the Program ROM’s D0 to D3, LD from JUMP), and stop counting when HALT is on (EN from NOT HALT). Add an LED labelled Halted. Set the rows JMP and HALT.',
    hint: 'Program ROM D0 to D3 go to the counter’s D0 to D3 as well as to the RAM. The Control ROM’s JUMP output goes to the PC’s LD. HALT goes through a NOT to the PC’s EN, and to a red LED labelled Halted. The row JMP switches JUMP on, the row HALT switches HALT on.',
    runs: [
      {
        title: 'LDI 1, JMP 3, LDI 9, LDI 5',
        program: 'LDI 1\nJMP 3\nLDI 9\nLDI 5',
        checks: [
          { after: 2, text: 'JMP 3 puts 3 in the PC', expect: [{ value: 'PC', is: 3 }] },
          { after: 3, text: 'the LDI 9 in between was skipped: the ACC is 5', expect: [{ value: 'ACC', is: 5 }] },
        ],
      },
      {
        title: 'A loop that counts',
        program: 'LDI 1\nSTA 0\nloop: ADD 0\nJMP loop',
        checks: [
          { after: 3, text: 'after the first ADD the ACC is 2', expect: [{ value: 'ACC', is: 2 }] },
          { after: 4, text: 'the JMP sends the PC back to 2', expect: [{ value: 'PC', is: 2 }] },
          { after: 7, text: 'and it keeps counting: the ACC is 4', expect: [{ value: 'ACC', is: 4 }] },
        ],
      },
      {
        title: 'LDI 4, HALT, LDI 9',
        program: 'LDI 4\nHALT\nLDI 9',
        checks: [
          { after: 1, text: 'at HALT the Halted LED is lit', expect: [{ led: 'Halted', is: 1 }] },
          { after: 6, text: 'the PC has stopped on the HALT, and the ACC is still 4', expect: [{ value: 'PC', is: 1 }, { value: 'ACC', is: 4 }] },
        ],
      },
    ],
    lesson: [
      { p: 'A program that can only run straight through is short. A jump, JMP, changes what runs next: it loads the PC with a new address. That address is in the instruction (bits 0 to 3, like the RAM address), so the PC’s D inputs, from the [[Program ROM]]. When the signal JUMP is on, the PC loads them instead of counting: the counter you built in chapter 8 has just that input, LD.' },
      { p: 'HALT stops the computer. The PC counts while its enable, EN, is on, so EN is “not HALT”: a NOT gate between the HALT signal and EN. Once the PC sits on the HALT instruction, it runs that instruction again and again, and nothing changes. An LED labelled Halted shows it.' },
      { p: 'With a jump the computer can loop: add a number again and again. In the second test the label “loop:” stands for the address of the instruction after it.' },
    ],
  },
  {
    id: 'cpu-same',
    chapter: 'computer',
    title: 'It is the beginner computer',
    kind: 'project',
    project: 'cpu4',
    stage: 6,
    summary: 'Run the 3 + 4 program on your computer, and compare it with the built-in one.',
    palette: ['hexdisp', 'led', 'switch'],
    task: 'Run the 3 + 4 program on your computer: tick the clock, and see the ACC reach 7, RAM word 1 hold 7 and the PC stop at the HALT. Then press Check.',
    runs: [
      {
        title: 'The 3 + 4 program',
        program: CPU_PROGRAM,
        checks: [
          { after: 4, text: 'after ADD, the ACC is 7', expect: [{ value: 'ACC', is: 7 }] },
          { after: 5, text: 'STA 1 has put 7 in RAM word 1 (word 0 still holds 3)', expect: [{ ram: 'RAM', at: 1, is: 7 }, { ram: 'RAM', at: 0, is: 3 }] },
          { after: 9, text: 'the program is over: the PC sits on the HALT and Halted is lit', expect: [{ value: 'PC', is: 5 }, { led: 'Halted', is: 1 }] },
        ],
      },
    ],
    lesson: [
      { p: 'Look at what you have built: a clock, a program counter, a ROM with the program, a Control ROM, an accumulator, a RAM and an adder. It is the same machine as the beginner computer in the Examples gallery, part for part: open that example and put it next to yours.' },
      { p: 'Press Clock step to tick, or let it run. The PC counts 0, 1, 2, 3, 4, 5. The ACC becomes 3, then 7. The RAM keeps the 3 and, at the end, the 7. At the HALT the PC stops. Everything it does, it does by a table of numbers and a few gates: that is all a computer is.' },
      { p: 'Your computer can add and loop, but it cannot make a decision: it cannot ask “is it zero?” and go one way or the other. That is the next step.' },
    ],
  },
]
