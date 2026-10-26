import { comb } from '../../challenges'
import type { Circuit } from '../../circuit'
import { chipId } from '../chips'
import type { Step } from '../types'
import { withChips } from './ch02'

/**
 * Chapter 12: Meet the 6502. The same machine on one real chip: the table that maps their computer onto it, the chip's cycles on one bus,
 * the address decoder that turns two address wires into three chip selects, and the board with the decoder's wires cut.
 */

/** RAM_SEL = ¬A15·¬A14, LED_WE = ¬A15·A14·¬RW (writing is R/W low), ROM_SEL = A15. */
function decoderSolution(): Circuit {
  const { b, ins, outs } = withChips(['A15', 'A14', 'RW'], ['RAM_SEL', 'LED_WE', 'ROM_SEL'], ['nor-from-kit', 'not-from-nand', 'and-from-nand'])
  const ram = b.ic(chipId('nor-from-kit'), 130, 0)
  b.wire(`${ins.A15}.Q`, `${ram}.A`)
  b.wire(`${ins.A14}.Q`, `${ram}.B`)
  b.wire(`${ram}.Y`, `${outs.RAM_SEL}.A`)
  const n15 = b.ic(chipId('not-from-nand'), 130, 120)
  const nrw = b.ic(chipId('not-from-nand'), 130, 200)
  const both = b.ic(chipId('and-from-nand'), 250, 150)
  const led = b.ic(chipId('and-from-nand'), 370, 120)
  b.wire(`${ins.A15}.Q`, `${n15}.A`)
  b.wire(`${ins.RW}.Q`, `${nrw}.A`)
  b.wire(`${n15}.Y`, `${both}.A`)
  b.wire(`${ins.A14}.Q`, `${both}.B`)
  b.wire(`${both}.Y`, `${led}.A`)
  b.wire(`${nrw}.Y`, `${led}.B`)
  b.wire(`${led}.Y`, `${outs.LED_WE}.A`)
  b.wire(`${ins.A15}.Q`, `${outs.ROM_SEL}.A`)
  return b.build()
}

/** A program for the board that writes the LEDs, then the RAM twice, then reads the RAM back to the LEDs: wires that select the wrong chip show. */
const TEST_PROGRAM = `.org $F000
start:  LDA #$01
        STA $4000      ; the LEDs show 1
        LDA #$05
        STA $0010      ; RAM word $10 = 5: the LEDs must stay at 1
        LDA #$00
        STA $0011      ; RAM word $11 = 0
        LDA $0010      ; read the 5 back from the RAM
        STA $4000      ; the LEDs show 5
done:   JMP done
.org $FFFC
.word start`

export const CH12: Step[] = [
  {
    id: '6502-map',
    chapter: 'meet6502',
    title: 'Your computer, on one chip',
    kind: 'read',
    summary: 'What on the 6502 is what on your computer.',
    lesson: [
      { p: 'Everything you learned still holds. The MOS 6502, the processor of the Apple II and the Commodore 64, is a computer like yours, only with all of it on one chip, so that you see it from outside: pins, not parts. Here is what is what.' },
      {
        table: {
          head: ['Your computer', 'The 6502'],
          rows: [
            ['ACC, the accumulator', 'A'],
            ['PC, 4 bits', 'PC, 16 bits: it reaches 64 KB'],
            ['The Program ROM', 'A ROM on the board, at the top of the memory ($F000 to $FFFF)'],
            ['The RAM (16 words)', 'A RAM on the board, from $0000 up'],
            ['The Control ROM and the decoder', 'Inside the chip'],
            ['The Z and carry flags', 'Z and C, in the status register P'],
            ['LDI n, LDA a, STA a', 'LDA #n, LDA a, STA a'],
            ['ADD a, SUB a', 'CLC then ADC a, SEC then SBC a'],
            ['JMP, JZ, JNC', 'JMP, BEQ, BCC (after an add)'],
            ['X, the index register', 'X (and Y)'],
            ['CALL and RET, the stack', 'JSR and RTS, the stack at $0100'],
            ['HALT', 'a jump to itself'],
          ],
        },
      },
      { p: 'Two differences in the arithmetic. The 6502 has no plain add: ADC always adds the carry flag too, so you clear it first with CLC; and SBC subtracts the carry flag’s opposite, so you set it first with SEC. And after a subtraction its carry flag means the opposite of yours: C is 1 when nothing had to be borrowed (yours was 1 for a borrow). So your JNC after a SUB is BCS on the 6502, and BCC after an ADC.' },
      { p: 'One thing is new. Your computer had a separate path from the program ROM and from the RAM. The 6502 has one set of address wires and one set of data wires, a single bus, and everything is on it: the program, the data, and the devices. Which chip answers is decided by the address.' },
      {
        quiz: [
          { q: 'Which register of the 6502 is the accumulator?', options: ['A', 'X', 'S'], answer: 0, why: 'A is the accumulator, the register the arithmetic works on. X and Y are index registers; S is the stack pointer.' },
          { q: 'Where does the program live on the board you will see?', options: ['In the RAM, from $0000', 'In the LED register, at $4000', 'In the ROM, from $F000'], answer: 2, why: 'The ROM is at the top of the memory, $F000 to $FFFF. The CPU starts at the address stored at $FFFC and $FFFD, which is in the ROM too.' },
        ],
      },
    ],
  },
  {
    id: 'one-bus',
    chapter: 'meet6502',
    title: 'One bus',
    kind: 'explore',
    summary: 'Step the 6502 and watch every cycle: an address, a read or a write.',
    open: { example: '6502' },
    task: 'Run the board, or press Clock step, and watch the address bus: the CPU reads the first instruction at $F000, then the number after it, and writes to $4000.',
    ordered: true,
    goals: [
      { cpu: 'CPU', addr: 0xf000, rw: 'read', text: 'The CPU reads the first instruction, at $F000' },
      { cpu: 'CPU', addr: 0xf001, rw: 'read', text: 'It reads the number that goes with it, at $F001' },
      { cpu: 'CPU', addr: 0x4000, rw: 'write', text: 'It writes to $4000: the LEDs' },
    ],
    hint: 'Click Run, or Clock step twice for each cycle. The address bus shows the address in hexadecimal; the red LED “Writing” is lit when R/W is 0.',
    lesson: [
      { p: 'This is the board with the real chip: the [[CPU]], a ROM with the program, a RAM, and a register that drives eight LEDs. In every clock cycle the CPU puts an address on the address bus, says whether it is reading or writing (R/W), and moves one byte on the data wires. That is all it ever does.' },
      { p: 'Press Reset and run it. First it reads the two bytes at $FFFC and $FFFD, which tell it where the program starts: $F000. Then it fetches an instruction: SYNC lights during that cycle. The first instruction is LDA #$01, “load the number 1 into A”: the CPU reads the opcode at $F000, and the number at $F001. The next instruction is STA $4000: it reads three bytes, and in its last cycle it writes the A register to address $4000.' },
      { p: 'Address $4000 is the LED register: no memory answers there, but a register does, and the LEDs show what it holds. A device is just an address. That is the idea of the next step.' },
    ],
  },
  {
    id: 'address-decoder',
    chapter: 'meet6502',
    title: 'Who is it talking to?',
    kind: 'build',
    summary: 'From A15, A14 and R/W: choose the RAM, the LEDs or the ROM.',
    palette: ['nand', 'switch', 'led'],
    uses: ['nor-from-kit', 'not-from-nand', 'and-from-nand'],
    challenge: comb({
      id: 'path-decoder6502',
      group: 'Learn: Meet the 6502',
      title: 'The 6502 board’s address decoder',
      lesson: [],
      task: 'RAM_SEL is on for addresses $0000–$3FFF (A15 and A14 both 0). LED_WE is on for a write to $4000–$7FFF (A15 = 0, A14 = 1, and R/W = 0, which means writing). ROM_SEL is on for $8000–$FFFF (A15 = 1).',
      hint: 'RAM_SEL is a NOR of A15 and A14. LED_WE is an AND of NOT A15, A14 and NOT R/W. ROM_SEL is just A15.',
      inputs: ['A15', 'A14', 'RW'],
      outputs: ['RAM_SEL', 'LED_WE', 'ROM_SEL'],
      goal: 'RAM_SEL = ¬(A15 + A14)\nLED_WE = ¬A15·A14·¬RW\nROM_SEL = A15',
      rules: { only: ['nand'] },
      solution: decoderSolution,
    }),
    solution: decoderSolution,
    lesson: [
      { p: 'The CPU puts a 16-bit address on the bus, and every chip on the board sees it. Which of them answers? The board’s own circuit decides: an address decoder. The two top address wires are enough for this board: A15 and A14 split the 64 KB into four blocks of 16 KB. 00 is the RAM, 01 the LED register, and 1x, the top half, the ROM.' },
      { p: 'The CPU also says whether it is reading or writing, with the wire R/W: 1 is reading and 0 is writing (the bar over R/W in the data sheets says that the write is the active-low case). A memory should only take the data on the bus when the CPU is writing, so the LED register’s load signal is the address block AND writing.' },
      { p: 'Build it from your own gates: three outputs from A15, A14 and R/W. (The real board has these gates between the CPU and the chips, as you will see in the next step.)' },
    ],
  },
  {
    id: 'wire-board',
    chapter: 'meet6502',
    title: 'Wire the chip selects',
    kind: 'project',
    project: 'board6502',
    stage: 0,
    board: { example: '6502', cut: ['writing', 'RAM: A15 = 0, A14 = 0', 'write RAM', 'A15 = 0', 'LEDs: A15 = 0, A14 = 1, writing'] },
    summary: 'The board with the decoder’s wires cut: connect the gates so the RAM and the LEDs answer.',
    palette: ['not', 'and', 'nor', 'led', 'switch'],
    task: 'The gates of the address decoder are there, but their wires are gone. Connect them: “writing” is NOT R/W; “RAM: A15 = 0, A14 = 0” is a NOR of the two address wires; the RAM’s write enable is that AND writing; the LED register’s load is NOT A15 AND A14 AND writing.',
    hint: 'The CPU’s RWB goes into “writing” (NOT). The address splitter’s A14 and A15 outputs go to the NOR and to the 3-input AND (A15 through “A15 = 0” first). “write RAM” gets the NOR and “writing”, and its output goes to the RAM’s WE. The 3-input AND’s output goes to the LED register’s LD.',
    runs: [
      {
        title: 'Writes to RAM and to the LEDs',
        program: TEST_PROGRAM,
        checks: [
          { after: 60, text: 'the LED register took 1, then 5: a write to the RAM did not change it', expect: [{ trace: 'LED register $4000', is: [0, 1, 5], exact: true }] },
          { after: 60, text: 'the RAM took the 5 written to $0010, and the 0 written to $0011', expect: [{ ram: 'RAM $0000–$07FF', at: 0x10, is: 5 }, { ram: 'RAM $0000–$07FF', at: 0x11, is: 0 }] },
        ],
      },
      {
        title: 'The blink program',
        program: '',
        checks: [{ after: 200, text: 'the LEDs have shown 1, 2, 4, 8, 16, 32, 64, 128 and 1 again', expect: [{ trace: 'LED register $4000', is: [1, 2, 4, 8, 16, 32, 64, 128, 1] }] }],
      },
    ],
    lesson: [
      { p: 'Here is the real board, with the wires of its address decoder taken away. The gates are all in place: a NOT for “writing”, a NOR that says “the RAM is meant” (A15 and A14 both 0), an AND that lets the RAM take data when it is meant and the CPU is writing, a NOT for A15, and a 3-input AND for the LED register (A15 = 0, A14 = 1, writing).' },
      { p: 'You built these three selects in the step before. Now wire them in: the [[CPU]]’s R/W output goes into the “writing” NOT. The address wires come out of the splitter that cuts A14 and A15 off the address bus. Without the wires, nothing answers a write: the program runs, but the LEDs stay dark. Press Run to see; wire the gates; the LEDs light, one at a time, moving left.' },
      { p: 'The check runs a short program that writes the LEDs and the RAM, to see that each write goes to the right chip, and then the blink program, and watches the LED register.' },
    ],
  },
]
