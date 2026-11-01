import { assemble6502 } from '../../engine/asm6502'
import { cycle, newCpu, reset, setIrq, type Cpu6502 } from '../../engine/testdata/oracle/cpu6502'
import { COLUMN_BYTES, SCREEN_H, SCREEN_W, screenWidth } from './tables'
import { unpackColumns } from './reference'
import { doomSource } from './source'
import { ART_BANK_SOURCE, GAME_CELLS, levelBankSource } from './game'

/**
 * The game board without the circuit: the bare 65C02 core (the test oracle), 16 KB of RAM, the fixed ROM at `$C000`, the two banked ROMs
 * at `$8000` with their latch at `$5001`, the gamepad at `$5000`, a model of the video chip (the port and the column fill, taking no
 * time) and of the VIA's timer 1 (the frame tick, as an interrupt every 16,667 cycles). It runs the game ROM much faster than the board
 * built from parts does, so a long scripted run can go through every level; `gameboard.test.ts` and `game.test.ts` check the same ROM on
 * the real board.
 */
export class GameMachine {
  ram = new Uint8Array(0x4000)
  fb = new Uint8Array(SCREEN_W * COLUMN_BYTES)
  pad = 0
  bank = 0
  readonly cpu: Cpu6502 = newCpu(true)
  readonly symbols: Record<string, number>
  readonly bytes: number
  private rom: number[]
  private banks: number[][]
  private vaddr = 0
  private fill = { cx: 0, top: 0, bottom: 0, width: 1, sky: 0, floor: 0 }
  private timer = { latch: 0, left: 0, flag: false, enable: false }

  constructor(banks: [string, string] = [levelBankSource(), ART_BANK_SOURCE], columns = 160) {
    const r = assemble6502(doomSource(columns, 'fill', true), 0x4000, true)
    if (r.errors.length) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n'))
    this.rom = r.bytes
    this.symbols = r.symbols
    this.bytes = r.items.reduce((n, it) => n + (it.kind === 'code' || it.kind === 'data' ? it.bytes.length : 0), 0)
    this.banks = banks.map((src) => {
      const b = assemble6502(src, 0x4000, true)
      if (b.errors.length) throw new Error(b.errors.map((e) => `bank line ${e.line}: ${e.message}`).join('\n'))
      return b.bytes
    })
    reset(this.cpu)
  }

  private read(a: number): number {
    if (a < 0x4000) return this.ram[a]
    if (a === 0x5000) return this.pad
    if ((a & 0xfff0) === 0x6000) return this.viaRead(a & 15)
    if (a >= 0xc000) return this.rom[a - 0xc000]
    if (a >= 0x8000) return this.banks[this.bank][a - 0x8000] ?? 0
    return 0
  }

  private viaRead(r: number): number {
    if (r === 4) {
      this.timer.flag = false
      return this.timer.left & 255
    }
    if (r === 5) return (this.timer.left >> 8) & 255
    return 0
  }

  private write(a: number, v: number) {
    if (a < 0x4000) this.ram[a] = v
    else if (a === 0x5001) this.bank = v & 1
    else if ((a & 0xfff0) === 0x6000) this.viaWrite(a & 15, v)
    else if ((a & 0xfff0) === 0x4000) this.videoWrite(a & 15, v)
  }

  private viaWrite(r: number, v: number) {
    const t = this.timer
    if (r === 4) t.latch = (t.latch & 0xff00) | v
    else if (r === 5) {
      t.latch = (t.latch & 0xff) | (v << 8)
      t.left = t.latch + 2
      t.flag = false
    } else if (r === 14 && v & 0x40) t.enable = (v & 0x80) !== 0
  }

  private videoWrite(r: number, v: number) {
    const f = this.fill
    if (r === 0) this.vaddr = (this.vaddr & 0xff00) | v
    else if (r === 1) this.vaddr = (this.vaddr & 0xff) | (v << 8)
    else if (r === 2) this.fb[this.vaddr++ % this.fb.length] = v
    else if (r === 4) f.cx = v
    else if (r === 5) f.top = v
    else if (r === 6) f.bottom = v
    else if (r === 8) f.width = v
    else if (r === 9) f.sky = v & 15
    else if (r === 10) f.floor = v & 15
    else if (r === 7) {
      const px = (y: number) => (y < f.top ? f.sky : y < f.bottom ? v & 15 : f.floor)
      for (let k = 0; k < f.width; k++) {
        const col = (f.cx + k) % SCREEN_W
        for (let y = 0; y < SCREEN_H; y += 2) this.fb[col * COLUMN_BYTES + (y >> 1)] = (px(y) << 4) | px(y + 1)
      }
    }
  }

  /** One clock cycle. */
  step(): void {
    const c = this.cpu
    const t = this.timer
    if (--t.left <= 0) {
      t.left = t.latch + 2
      t.flag = true
    }
    setIrq(c, t.flag && t.enable)
    if (c.read) cycle(c, this.read(c.addr))
    else {
      this.write(c.addr, c.out)
      cycle(c, 0)
    }
  }

  /** Run until the CPU is about to fetch the instruction at `name` (a label). Gives up after `limit` cycles. */
  runTo(name: string, limit = 2_000_000): void {
    const at = this.symbols[name]
    const c = this.cpu
    for (let n = 0; n < limit; n++) {
      if (c.sync && c.addr === at && n > 0) return
      this.step()
    }
    throw new Error(`the program did not reach ${name} in ${limit} cycles`)
  }

  get cycles(): number {
    return this.cpu.cycles
  }

  get frames(): number {
    return this.ram[GAME_CELLS.frames] + 256 * this.ram[GAME_CELLS.frames + 1]
  }

  /** The picture on the screen: 160×100 colours, row by row. */
  picture(columns = 160): Uint8Array {
    return unpackColumns(this.fb, screenWidth(columns))
  }
}
