import { box, names } from '../layouts'
import { X, type ComponentDef, type V } from '../types'

/** The picture: 160 columns by 100 rows of 4-bit pixels, stored column by column, 50 bytes a column (two pixels a byte, the upper pixel in the high nibble). */
export const VIDEO_W = 160
export const VIDEO_H = 100
export const VIDEO_BYTES = (VIDEO_W * VIDEO_H) / 2

export interface VideoState {
  /** The picture's bytes, column by column. */
  px: number[]
  /** PHI2 as it was last time (for finding its rising edge). */
  pc: V
  /** The address register (16 bits; a picture byte is `addr` modulo 8000). */
  addr: number
  /** The control register's hold bit: the port does not count up. */
  hold: number
  /** The column-fill registers: x, top, bottom, colour, width (columns a fill covers), sky, floor, and a spare. */
  fill: number[]
  /** What the data pins D show: the register read at the last rising edge, 0 when the chip was not selected. */
  out: number
  rev: number
}

/** How many fill registers follow the picture in the Rust module's array. */
export const VIDEO_FILL_REGS = 8
export const videoFillInit = () => [0, 0, 0, 0, 1, 0, 0, 0]

export const videoInit = (): VideoState => ({ px: new Array<number>(VIDEO_BYTES).fill(0), pc: X, addr: 0, hold: 0, fill: videoFillInit(), out: 0, rev: 0 })

export const videos: ComponentDef[] = [
  {
    type: 'video',
    name: 'Video 160×100',
    category: 'display',
    description:
      'A 160×100 screen of 16 colours that a CPU draws through a port, like a video chip of the 1980s. Four registers, picked by RS1 RS0: 0 and 1 the address (low and high byte) of a byte of the picture, ' +
      '2 the data, which reads or writes that byte and then counts the address up, 3 control (bit 0: do not count up; writing bit 7 clears the screen). A byte is two pixels, upper in the high nibble, ' +
      'and the picture is stored column by column, 50 bytes a column. Addresses past 7999 wrap. ' +
      'Registers 4 to 10 (RS3 RS2 RS1 RS0) are the column fill, which draws a whole wall column in one write: 4 the column x, 5 the row where the wall starts (top), 6 where it ends (bottom), 7 the colour, ' +
      '8 how many columns a fill covers (1 after reset), 9 the sky colour above the wall, 10 the floor colour below it. Writing the colour starts the fill: sky down to top, the colour down to bottom, floor below, in the columns from x. ' +
      'Registers 4 to 10 read back what was written. It answers while CS0 = 1 and CS1 = 0, at the rising edge of Φ2.',
    title: () => 'Video',
    live: true,
    init: (): VideoState => videoInit(),
    revision: (inst) => (inst.state as VideoState).rev,
    layout: () =>
      box({
        w: 340,
        minRows: 15,
        left: [
          { name: 'PHI2', label: 'Φ2', clock: true },
          { name: 'RESB', label: 'RES', invert: true, def: 1 },
          { name: 'CS0', def: 0 },
          { name: 'CS1B', label: 'CS1', invert: true, def: 1 },
          { name: 'RS0', def: 0 },
          { name: 'RS1', def: 0 },
          { name: 'RS2', def: 0 },
          { name: 'RS3', def: 0 },
          { name: 'RWB', label: 'R/W', def: 1 },
          ...names('DI', 8),
        ],
        right: names('D', 8),
      }),
  },
]
