# A 6502 built from our own parts (plan)

A proof of concept: the 6502 as a circuit of this app's parts (registers, counters, multiplexers, an adder, ROMs), not the behavioural
`cpu6502` part. It will be slow, and it is not the real chip's transistor netlist (Visual6502's 3,510 transistors use pass gates the
engine cannot express, see `plan-cpu6502.md`); it is the textbook microcoded machine, with the same registers and the same bus cycles.

## Design
- **One clock = one bus cycle**, as on the chip. The microcode ROM is addressed by the opcode (IR, 8 bits), the cycle of the
  instruction (T, 3 bits) and a reset flag: 4096 words of 40 bits, in three ROMs. Cycle 0 is the opcode fetch for every opcode.
- **Datapath.** The ALU takes A from a register (`AIN`: A X Y SP PCL PCH TL, or 0) and B from the data bus or a constant (`BIN`), adds
  (with the carry flag, 0 or 1, and B optionally inverted) or does AND, OR, EOR. Its result `R` is what every register loads and what a
  write puts on the data bus, so a load is `0 + data`, a store `register + 0`, INX `X + 1`, a branch `PCL + offset`.
- **Address bus**: a 16-bit multiplexer over PC, `TH:TL` (an address built in two cycles), the stack (`01:SP`), zero page (`00:TL`) and
  the four vectors.
- **PC** is two counters, the low one carrying into the high one. A branch adds the offset to PCL in one cycle and fixes PCH in a
  fourth only if the page changed, as the chip does (the signals `BRANCH`, `NOCROSS` and `PAGEFIX`).
- **Reset** is a sequence of seven cycles in the microcode (two dummy reads, three stack reads that count SP down, the vector at
  `$FFFC`); the circuit runs it at power-on and when the Reset button is held.
- The names of the control bits are on the microcode ROMs (`signals`), so the inspector shows what each output switches on.

## Test
`src/model/micro6502.test.ts` runs the circuit and the `cpu6502` core side by side with the same memory map, over random programs that
use every implemented opcode and over hand-made ones (a branch across a page boundary, both ways). In every cycle the address bus,
R/W, SYNC and the data written must match, and after every cycle so must A, X, Y, SP, P and PC.

## Steps
- [x] **1. Datapath, reset, and 59 opcodes**: LDA LDX LDY (immediate, zero page, absolute), STA STX STY (zero page, absolute), ADC SBC AND
  ORA EOR CMP CPX CPY (the same three modes), INX INY DEX DEY, TAX TXA TAY TYA, CLC SEC, NOP, the eight branches, JMP absolute.
  Example `/6502-parts`.
- [ ] **2. The other addressing modes**: absolute and zero page indexed (with the extra cycle when a page is crossed, and the dummy
  read), `(zp,X)`, `(zp),Y`, JMP indirect, read-modify-write (ASL LSR ROL ROR INC DEC with their dummy write), accumulator shifts.
- [ ] **3. The rest of the documented set**: the stack (PHA PLA PHP PLP, JSR RTS, BRK RTI, TSX TXS), BIT, the flag instructions (CLI SEI
  CLD SED CLV), decimal mode. Check every opcode against the SingleStepTests vectors the core already passes.
- [ ] **4. Interrupts**: IRQ and NMI through the same sequence as BRK.
- [ ] **5. A board**: the same pins as the `cpu6502` part (or an IC with them), so that it can replace the part on the BASIC computer, and
  see how fast it runs.

## Speed
A clock of this circuit is about 6,000 per second in the unit tests (about 12,000 clock edges), so a program of a few hundred
instructions per second: enough for a counting loop, not for BASIC.
