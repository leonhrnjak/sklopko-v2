import { describe, expect, it } from 'vitest'
import { screenText, type AciaState } from '../engine/acia'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { board6502Builder } from './board6502'
import { basicRomBytes } from './basic-rom'
import { flatten } from './buses'
import { micro6502Builder } from './micro6502'

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

describe('the BASIC computer with the 6502 built from parts', () => {
  it('puts the same address, R/W and SYNC on the bus as the board with the 6502 part, cycle for cycle, through the start of BASIC', () => {
    const mine = micro6502Builder({ hz: 100, board: 'basic' })
    const theirs = board6502Builder({ hz: 100, memory: 'big', rom: hex(basicRomBytes()), devices: ['terminal'] })
    const a = new Simulator()
    a.load(flatten(mine.b.c))
    a.settle()
    const b = new Simulator()
    b.load(flatten(theirs.b.build(false)))
    b.settle()
    const bits = (sim: Simulator, id: string, prefix: string, n: number) => toNum(Array.from({ length: n }, (_, i) => sim.pinValue(id, `${prefix}${i}`)), 0, n)
    const pins = {
      mine: () => ({ addr: bits(a, mine.keys.abus, 'Y', 16), write: a.pinValue(mine.keys.writing, 'A'), sync: a.pinValue(mine.keys.sync, 'A') }),
      theirs: () => ({ addr: bits(b, theirs.keys.cpu, 'A', 16), write: b.pinValue(theirs.keys.cpu, 'RWB') ? 0 : 1, sync: b.pinValue(theirs.keys.cpu, 'SYNC') }),
    }
    const history: string[] = []
    const cycles = 6000
    for (let n = 0; n < cycles; n++) {
      // (The part's stack pointer starts at $FD and the circuit's at 0: the three stack reads of the reset sequence differ, and nothing else.)
      history.push(`${n}: ${JSON.stringify(pins.mine())} ${JSON.stringify(pins.theirs())}`)
      if (n < 2 || n > 4) expect(pins.mine(), `cycle ${n}\n${history.slice(-12).join('\n')}`).toEqual(pins.theirs())
      for (const sim of [a, b]) {
        sim.stepClock()
        sim.stepClock()
      }
    }
  }, 120_000)

  it('boots Microsoft BASIC to OK, and runs a program and a statement typed on the terminal', () => {
    const m = micro6502Builder({ hz: 100, board: 'basic' })
    const sim = new Simulator()
    sim.load(flatten(m.b.c))
    sim.settle()
    sim.setHistory(false)
    const text = () => screenText(sim.state(m.keys.terminal) as AciaState)
    const runUntil = (done: RegExp, most: number) => {
      for (let n = 0; n < most; n++) {
        sim.stepClock()
        sim.stepClock()
        if (n % 1000 === 999 && done.test(text())) return
      }
      throw new Error(`Not there after ${most} cycles. The screen: ${JSON.stringify(text())}`)
    }
    runUntil(/SKLOPKO BASIC[\s\S]*OK\s*$/, 60_000)
    const type = (line: string) => sim.terminal(m.keys.terminal, { op: 'type', text: `${line}\r`, capitals: true })
    type('10 PRINT "HELLO"')
    type('RUN')
    type('PRINT 2+2')
    runUntil(/HELLO\s+OK\s+PRINT 2\+2\s+4\s+OK\s*$/, 120_000)
  }, 120_000)
})
