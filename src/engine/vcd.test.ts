import { describe, expect, it } from 'vitest'
import { toVcd, vcdId, type VcdSignal } from './vcd'

const when = new Date('2026-10-22T12:00:00Z')

describe('VCD identifiers', () => {
  it('are printable ASCII, unique, and go on past 94 signals', () => {
    const ids = Array.from({ length: 300 }, (_, i) => vcdId(i))
    expect(new Set(ids).size).toBe(300)
    expect(ids[0]).toBe('!')
    expect(ids[93]).toBe('~')
    expect(ids[94]).toBe('!!')
    expect(ids.every((id) => /^[!-~]+$/.test(id))).toBe(true)
  })
})

describe('VCD export', () => {
  const clk: VcdSignal = { name: 'CLK', width: 1, t: [0, 125, 250, 375], v: [0, 1, 0, 1] }
  const acc: VcdSignal = { name: 'ACC', width: 8, t: [0, 125, 375], v: [0, 5, 233] }

  it('writes a header, the signals, the starting values and every change in time order', () => {
    const text = toVcd([clk, acc], 500, when)
    expect(text).toBe(
      [
        '$date 2026-10-22T12:00:00.000Z $end',
        '$version Sklopko logic simulator $end',
        '$timescale 1 us $end',
        '$scope module sklopko $end',
        '$var wire 1 ! CLK $end',
        '$var wire 8 " ACC $end',
        '$upscope $end',
        '$enddefinitions $end',
        '#0',
        '$dumpvars',
        '0!',
        'b00000000 "',
        '$end',
        '#125000',
        '1!',
        'b00000101 "',
        '#250000',
        '0!',
        '#375000',
        '1!',
        'b11101001 "',
        '#500000',
        '',
      ].join('\n'),
    )
  })

  it('shows unknown values as x, for a wire and for a bus', () => {
    const text = toVcd(
      [
        { name: 'A', width: 1, t: [0, 100], v: [2, 1] },
        { name: 'N', width: 4, t: [0, 100], v: [-1, 9] },
      ],
      100,
      when,
    )
    expect(text).toContain('$dumpvars\nx!\nbx "\n$end')
    expect(text).toContain('#100000\n1!\nb1001 "')
  })

  it('starts at zero even when the recording lost its beginning, and leaves unrecorded signals unknown until they change', () => {
    const text = toVcd(
      [
        { name: 'LATE', width: 1, t: [60000, 60500], v: [1, 0] },
        { name: 'LATER', width: 1, t: [60200], v: [1] },
      ],
      61000,
      when,
    )
    expect(text).toContain('$dumpvars\n1!\nx"\n$end') // LATER has not recorded anything at the origin
    expect(text).toContain('#200000\n1"')
    expect(text).toContain('#500000\n0!')
    expect(text.trim().split('\n').at(-1)).toBe('#1000000')
  })

  it('makes names safe and unique', () => {
    const text = toVcd(
      [
        { name: 'ACC low', width: 1, t: [0], v: [0] },
        { name: 'ACC low', width: 1, t: [0], v: [1] },
        { name: '  ', width: 1, t: [0], v: [0] },
      ],
      0,
      when,
    )
    expect(text).toContain('$var wire 1 ! ACC_low $end')
    expect(text).toContain('$var wire 1 " ACC_low_2 $end')
    expect(text).toContain('$var wire 1 # signal $end')
  })

  it('works with nothing recorded yet, and with no signals', () => {
    expect(toVcd([{ name: 'Q', width: 1, t: [], v: [] }], 0, when)).toContain('$dumpvars\nx!\n$end')
    expect(toVcd([], 0, when)).toContain('$enddefinitions $end')
  })

  it('puts several changes of one instant under a single timestamp', () => {
    const text = toVcd(
      [
        { name: 'A', width: 1, t: [0, 10], v: [0, 1] },
        { name: 'B', width: 1, t: [0, 10], v: [0, 1] },
      ],
      10,
      when,
    )
    expect(text.match(/#10000/g)).toHaveLength(1)
    expect(text).toContain('#10000\n1!\n1"')
  })
})
