import { assemble6502 } from '../../engine/asm6502'
import { cycle, newCpu, reset } from '../../engine/testdata/oracle/cpu6502'
import { FLOOR, SCREEN_H, screenWidth, SKY } from './tables'
import { unpackColumns, type Pose } from './reference'
import { doomSource, POSE, ROM_BASE, ROM_SIZE, VIDEO, type DrawMode } from './source'
import { COLUMN_BYTES, SCREEN_W } from './tables'

/**
 * The D0 spike's machine: the bare 65C02 core, 16 KB of RAM at $0000, the ROM at $C000, and a model of the video part at $4000: an
 * address register with a data port that counts up (`VADDR`, `VDATA`), and the column-fill command (`cx`, `top`, `bottom`, `colour`, `width`).
 * The framebuffer is 8,000 bytes, column by column, so that a column is one run of the port. The fill takes no time in this model.
 */
export class DoomMachine {
  ram = new Uint8Array(0x4000)
  rom: number[]
  fb = new Uint8Array(SCREEN_W * COLUMN_BYTES)
  symbols: Record<string, number>
  /** Bytes of the ROM taken by code and by data (tables), from the assembler's listing. */
  size: { code: number; data: number }
  private vaddr = 0
  private fill = { cx: 0, top: 0, bottom: 0, width: 1 }
  private cpu = newCpu(true)
  private columns: number

  constructor(columns: number, draw: DrawMode) {
    this.columns = columns
    const r = assemble6502(doomSource(columns, draw), ROM_SIZE, true)
    if (r.errors.length) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n'))
    this.rom = r.bytes
    this.symbols = r.symbols
    this.size = { code: 0, data: 0 }
    for (const it of r.items) {
      if (it.kind === 'code') this.size.code += it.bytes.length
      else if (it.kind === 'data') this.size.data += it.bytes.length
    }
  }

  private read(a: number): number {
    if (a < 0x4000) return this.ram[a]
    if (a >= ROM_BASE) return this.rom[a - ROM_BASE]
    return 0
  }

  private write(a: number, v: number) {
    if (a < 0x4000) this.ram[a] = v
    else if (a === VIDEO.addrLo) this.vaddr = (this.vaddr & 0xff00) | v
    else if (a === VIDEO.addrHi) this.vaddr = (this.vaddr & 0xff) | (v << 8)
    else if (a === VIDEO.data) this.fb[this.vaddr++ % this.fb.length] = v
    else if (a === VIDEO.cx) this.fill.cx = v
    else if (a === VIDEO.top) this.fill.top = v
    else if (a === VIDEO.bottom) this.fill.bottom = v
    else if (a === VIDEO.width) this.fill.width = v
    else if (a === VIDEO.colour) {
      for (let k = 0; k < this.fill.width; k++)
        for (let y = 0; y < SCREEN_H; y += 2) {
          const px = (yy: number) => (yy < this.fill.top ? SKY : yy < this.fill.bottom ? v & 15 : FLOOR)
          this.fb[(this.fill.cx + k) * COLUMN_BYTES + (y >> 1)] = px(y) | (px(y + 1) << 4)
        }
    }
  }

  private step() {
    const c = this.cpu
    if (c.read) cycle(c, this.read(c.addr))
    else {
      this.write(c.addr, c.out)
      cycle(c, 0)
    }
  }

  /** Render one frame from `pose`. Returns the cycles from the first instruction of `RENDER` to `FRAMEEND`, and the picture (160×100 colours). */
  frame(pose: Pose): { cycles: number; pixels: Uint8Array } {
    this.ram.fill(0)
    this.fb.fill(0)
    this.vaddr = 0
    this.ram[POSE.xFrac] = pose.xFrac
    this.ram[POSE.xCell] = pose.xCell
    this.ram[POSE.yFrac] = pose.yFrac
    this.ram[POSE.yCell] = pose.yCell
    this.ram[POSE.angle] = pose.angle
    const c = this.cpu
    reset(c)
    const at = (name: string) => c.sync && c.addr === this.symbols[name]
    for (let n = 0; !at('RENDER'); n++) {
      if (n > 100) throw new Error('the reset did not reach RENDER')
      this.step()
    }
    const start = c.cycles
    for (let n = 0; !at('FRAMEEND'); n++) {
      if (n > 3_000_000) throw new Error('the frame did not finish')
      this.step()
    }
    return { cycles: c.cycles - start, pixels: unpackColumns(this.fb, screenWidth(this.columns)) }
  }
}
