import { SKASM } from './isa'

/**
 * A plain TypeScript model of the SKASM machine: the definition of what every instruction does. The computers built out
 * of parts are tested against it, step by step.
 *
 * The machine has an 8-bit accumulator (ACC), an 8-bit index register (X), two flags (carry C and zero Z), 256 bytes of RAM
 *  (an instruction's address field reaches the first 16, X reaches all), an 8-bit program counter (PC), a return stack for
 * CALL and RET (16 deep, wrapping) and up to 256 instructions. It runs one instruction per clock cycle. A word that is not an instruction does nothing.
 */
export interface Machine {
  pc: number
  acc: number
  /** The index register. */
  x: number
  /** Carry. After a subtraction or comparison it means "borrowed": ACC was smaller than what was taken away. */
  c: number
  /** Zero: the result of the last arithmetic or logic instruction was 0. */
  z: number
  ram: number[]
  /** The table of constants that LDT reads (filled in by the assembler's .byte lines). */
  table: number[]
  /** The return stack of CALL and RET: 16 addresses, and where the next one goes. */
  stack: number[]
  sp: number
  halted: boolean
}

/** What the machine is connected to. A port with nothing behind it ignores `out` and reads 0. */
export interface Ports {
  out?(port: number, value: number): void
  in?(port: number): number
}

export const newMachine = (): Machine => ({ pc: 0, acc: 0, x: 0, c: 0, z: 0, ram: new Array<number>(256).fill(0), table: new Array<number>(256).fill(0), stack: new Array<number>(16).fill(0), sp: 0, halted: false })

/** Run one instruction. */
export function step(m: Machine, program: number[], ports: Ports = {}): void {
  if (m.halted) return
  const word = program[m.pc & 255] ?? 0
  const d = SKASM.decode(word)
  let next = (m.pc + 1) & 255
  if (d) {
    const n = d.arg
    const a = m.acc
    const mem = m.ram[n & 15] ?? 0
    /** acc = a + b + carry-in, with the flags; `write` false for a comparison. */
    const add = (b: number, cin: number, write = true) => {
      const sum = a + b + cin
      if (write) m.acc = sum & 255
      m.c = sum > 255 ? 1 : 0
      m.z = (sum & 255) === 0 ? 1 : 0
    }
    /** acc = a − b − borrow-in; the carry flag becomes the borrow. */
    const sub = (b: number, borrow: number, write = true) => {
      const diff = a - b - borrow
      if (write) m.acc = diff & 255
      m.c = diff < 0 ? 1 : 0
      m.z = (diff & 255) === 0 ? 1 : 0
    }
    const logic = (result: number) => {
      m.acc = result & 255
      m.c = 0
      m.z = m.acc === 0 ? 1 : 0
    }
    switch (d.mnemonic) {
      case 'LDI': m.acc = n; break
      case 'LDA': m.acc = mem; break
      case 'STA': m.ram[n] = a; break
      case 'JMP': next = n; break
      case 'ADD': add(mem, 0); break
      case 'SUB': sub(mem, 0); break
      case 'JNC': if (!m.c) next = n; break
      case 'HALT': m.halted = true; next = m.pc; break
      case 'JZ': if (m.z) next = n; break
      case 'ADDI': add(n, 0); break
      case 'CMPI': sub(n, 0, false); break
      case 'SHL': m.acc = (a << 1) & 255; break
      case 'SHR': m.acc = a >> 1; break
      case 'SUBI': sub(n, 0); break
      case 'ANDI': logic(a & n); break
      case 'ORI': logic(a | n); break
      case 'XORI': logic(a ^ n); break
      case 'OUT': ports.out?.(n, a); break
      case 'IN': m.acc = (ports.in?.(n) ?? 0) & 255; break
      case 'JNZ': if (!m.z) next = n; break
      case 'JC': if (m.c) next = n; break
      case 'CMP': sub(mem, 0, false); break
      case 'AND': logic(a & mem); break
      case 'OR': logic(a | mem); break
      case 'XOR': logic(a ^ mem); break
      case 'ADC': add(mem, m.c); break
      case 'SBC': sub(mem, m.c); break
      case 'NOP': break
      case 'LDXI': m.x = n; break
      case 'TAX': m.x = a; break
      case 'TXA': m.acc = m.x; break
      case 'INX': m.x = (m.x + 1) & 255; m.z = m.x === 0 ? 1 : 0; m.c = 0; break
      case 'DEX': m.x = (m.x - 1) & 255; m.z = m.x === 0 ? 1 : 0; m.c = 0; break
      case 'LDX': m.acc = m.ram[m.x]; break
      case 'STX': m.ram[m.x] = a; break
      case 'LDT': m.acc = m.table[m.x] ?? 0; break
      case 'CALL':
        m.stack[m.sp] = next
        m.sp = (m.sp + 1) & 15
        next = n
        break
      case 'RET':
        m.sp = (m.sp - 1) & 15
        next = m.stack[m.sp]
        break
    }
  }
  m.pc = next
}

/** Run until HALT or `maxSteps` instructions; returns the number of instructions run. */
export function run(m: Machine, program: number[], ports: Ports = {}, maxSteps = 100000): number {
  let steps = 0
  while (!m.halted && steps < maxSteps) {
    step(m, program, ports)
    steps++
  }
  return steps
}
