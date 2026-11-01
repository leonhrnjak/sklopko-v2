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
  /** What the data pins D show: the register read at the last rising edge, 0 when the chip was not selected. */
  out: number
  rev: number
}

export const videoInit = (): VideoState => ({ px: new Array<number>(VIDEO_BYTES).fill(0), pc: X, addr: 0, hold: 0, out: 0, rev: 0 })

export const videos: ComponentDef[] = [
  {
    type: 'video',
    name: 'Video 160×100',
    category: 'display',
    description:
      'A 160×100 screen of 16 colours that a CPU draws through a port, like a video chip of the 1980s. Four registers, picked by RS1 RS0: 0 and 1 the address (low and high byte) of a byte of the picture, ' +
      '2 the data, which reads or writes that byte and then counts the address up, 3 control (bit 0: do not count up; writing bit 7 clears the screen). A byte is two pixels, upper in the high nibble, ' +
      'and the picture is stored column by column, 50 bytes a column. Addresses past 7999 wrap. It answers while CS0 = 1 and CS1 = 0, at the rising edge of Φ2.',
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
          { name: 'RWB', label: 'R/W', def: 1 },
          ...names('DI', 8),
        ],
        right: names('D', 8),
      }),
  },
]
