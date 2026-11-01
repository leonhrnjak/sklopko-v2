import { box, names } from '../../../layouts'
import { X, type ComponentDef, type Instance, type V } from '../../../types'

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

export const videos: (ComponentDef & { evaluate(inst: Instance): void })[] = [
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
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state as VideoState
      const rising = st.pc === 0 && ins[0] === 1
      if (ins[0] <= 1) st.pc = ins[0]
      if (ins[1] === 0) {
        st.addr = 0
        st.hold = 0
        st.out = 0
      } else if (rising) {
        st.out = 0
        if (ins[2] === 1 && ins[3] === 0 && ins[4] <= 1 && ins[5] <= 1) {
          const rs = ins[4] | (ins[5] << 1)
          const at = st.addr % VIDEO_BYTES
          if (ins[6] === 1) {
            if (rs === 0) st.out = st.addr & 255
            else if (rs === 1) st.out = st.addr >> 8
            else if (rs === 2) {
              st.out = st.px[at]
              if (!st.hold) st.addr = (at + 1) % VIDEO_BYTES
            } else st.out = st.hold
          } else if (ins[6] === 0) {
            let d = 0
            let known = true
            for (let i = 0; i < 8; i++) {
              const v = ins[7 + i]
              if (v > 1) known = false
              else d |= v << i
            }
            if (known) {
              if (rs === 0) st.addr = (st.addr & 0xff00) | d
              else if (rs === 1) st.addr = (st.addr & 0x00ff) | (d << 8)
              else if (rs === 2) {
                if (st.px[at] !== d) st.rev++
                st.px[at] = d
                if (!st.hold) st.addr = (at + 1) % VIDEO_BYTES
              } else {
                st.hold = d & 1
                if (d & 0x80) {
                  if (st.px.some((v) => v !== 0)) st.rev++
                  st.px.fill(0)
                }
              }
            }
          }
        }
      }
      for (let b = 0; b < 8; b++) outs[b] = ((st.out >> b) & 1) as V
    },
    layout: () =>
      box({
        w: 342,
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
