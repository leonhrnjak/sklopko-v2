import { aciaBreak, aciaClock, aciaInit, aciaKey, aciaRead, aciaType, aciaWrite, screenText, type AciaState } from '../engine/testdata/oracle/acia'
import { cycle, newCpu, reset, type Cpu6502 } from '../engine/testdata/oracle/cpu6502'

/**
 * The BASIC computer without a board: the 6502 core, its memory map and the terminal's registers (`engine/acia.ts`), nothing else.
 *
 *     $0000–$3FFF  RAM, 16 KB       $4000–$7FFF  the terminal (its four registers repeat)       $8000–$FFFF  ROM, 16 KB, seen twice
 *
 * For tests: type text, run for a number of cycles or until the screen shows something, read what is on the screen.
 */
export class BasicMachine {
  ram = new Uint8Array(0x4000)
  rom: Uint8Array
  term: AciaState = aciaInit()
  /** The level on the terminal's DSR pin: the start-up questions switch. */
  dsr: boolean
  cpu: Cpu6502
  /** Every character sent to the terminal, as sent. */
  sent = ''

  /** The address of the terminal code's poll loop (`INWAIT` in io.s): where the program counter is while BASIC waits for a key. */
  waitFrom: number

  constructor(rom: ArrayLike<number>, waitFrom: number, dsr = false, cmos = false) {
    this.rom = Uint8Array.from(rom)
    this.waitFrom = waitFrom
    this.dsr = dsr
    this.cpu = newCpu(cmos)
    reset(this.cpu)
  }

  get cycles() {
    return this.cpu.cycles
  }

  /** A read of the terminal's register `rs`, with its side effects. */
  protected terminalRead(rs: number): number {
    return aciaRead(this.term, rs & 3, this.dsr)
  }

  /** A write to the terminal's register `rs`; what is sent to the screen is also kept, as sent, in `sent`. */
  protected terminalWrite(rs: number, v: number) {
    if ((rs & 3) === 0) this.sent += String.fromCharCode(v & 0x7f)
    aciaWrite(this.term, rs & 3, v)
  }

  /** What is on the bus when the CPU reads `a` (the memory map above). */
  protected read(a: number): number {
    if (a < 0x4000) return this.ram[a]
    if (a < 0x8000) return this.terminalRead(a)
    return this.rom[a & 0x3fff]
  }

  protected write(a: number, v: number) {
    if (a < 0x4000) this.ram[a] = v
    else if (a < 0x8000) this.terminalWrite(a, v)
  }

  /** One clock cycle. */
  step() {
    const c = this.cpu
    aciaClock(this.term)
    if (c.read) cycle(c, this.read(c.addr))
    else {
      this.write(c.addr, c.out)
      cycle(c, 0)
    }
  }

  /** Run `n` cycles. */
  run(n: number) {
    for (let i = 0; i < n; i++) this.step()
  }

  /** Run until `done` says so, at most `max` cycles. Returns the cycles it took, or -1 if `max` ran out first. */
  runUntil(done: () => boolean, max: number): number {
    const start = this.cycles
    while (this.cycles - start < max) {
      this.step()
      if (done()) return this.cycles - start
    }
    return -1
  }

  /** The text of the screen. */
  get screen() {
    return screenText(this.term)
  }

  type(text: string) {
    aciaType(this.term, text)
  }

  /** A key that is not text, such as Backspace (8). */
  key(code: number) {
    aciaKey(this.term, code)
  }

  /** Control+C: it goes to the front, and what was typed and not yet read is thrown away. */
  interrupt() {
    aciaBreak(this.term)
  }

  /** Is BASIC waiting for a key, with nothing typed left to read? (The program counter is in the terminal code's poll loop.) */
  get idle(): boolean {
    const c = this.cpu
    return c.sync && c.addr >= this.waitFrom && c.addr < this.waitFrom + 7 && this.term.next >= this.term.keys.length && !this.term.full
  }

  /** Run until BASIC is idle (see `idle`). Returns the cycles it took, and throws if that is more than `max`. */
  settle(max = 20_000_000): number {
    // (a cycle first: right after a line is typed, BASIC has not yet looked at the keyboard)
    this.step()
    const n = this.runUntil(() => this.idle, max)
    if (n < 0) throw new Error(`BASIC did not become idle in ${max} cycles. The screen:\n${this.screen}`)
    return n + 1
  }

  /** Type a line (without its CR) and run until BASIC has dealt with it and is waiting again. Returns the cycles that took. */
  command(line: string, max = 20_000_000): number {
    this.type(line + '\r')
    return this.settle(max)
  }

  /**
   * What a command printed: not the echo of the line (it ends in CR, and BASIC adds a CR LF), not the `OK` after it, and not the one
   * line break that ends the last thing printed. Line breaks are `\n`.
   */
  answer(line: string, max = 20_000_000): string {
    const mark = this.sent.length
    this.command(line, max)
    const printed = this.since(mark)
    return printed
      .slice(printed.indexOf('\r\r\n') + 3)
      .replace(/(\r\n)?OK\r\n$/, '')
      .replace(/\r\n/g, '\n')
      .replace(/^\n/, '')
      .replace(/\n$/, '')
  }

  /** What was printed since `mark` (a length of `sent`), without the echo of the line that was typed. */
  since(mark: number): string {
    return this.sent.slice(mark)
  }
}
