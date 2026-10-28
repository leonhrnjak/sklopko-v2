import { describe, expect, it } from 'vitest'
import io from '../../scripts/basic/io.s?raw'
import source from '../../scripts/basic/m6502.asm?raw'
import { buildBasic } from '../../scripts/basic/target'
import { aciaType, screenText, type AciaState } from '../engine/acia'
import { Simulator } from '../engine/simulator'
import { BasicMachine } from './basic-harness'
import { BASIC_PROGRAMS } from './basic-programs'
import { flatten } from './buses'
import { micro6502Builder } from './micro6502'

/**
 * BASIC programs on the CPU built from parts, checked against the bare core running the same ROM: the same program is typed on both,
 * and the screens must be the same. The quick ones run with the unit tests. The long ones (millions of cycles: a few minutes) run
 * with `SLOW=1 npx vitest run src/model/micro6502-programs.test.ts`.
 */
interface Prog {
  id: string
  lines: string[]
  run: string
}
const fromApp = (id: string): Prog => {
  const p = BASIC_PROGRAMS.find((q) => q.id === id)!
  return { id, lines: p.lines, run: p.run }
}

const QUICK: Prog[] = [
  { id: 'squares', lines: ['10 FOR I=1 TO 6:PRINT I*I;:NEXT I'], run: 'RUN' },
  { id: 'strings', lines: ['10 A$="HELLO, WORLD"', '20 PRINT LEFT$(A$,5);"|";MID$(A$,8,3);"|";LEN(A$);"|";CHR$(65+ASC("B")-66)', '30 PRINT RIGHT$(A$,5)+"!"'], run: 'RUN' },
]
const SLOW: Prog[] = [
  { id: 'gosub', lines: ['10 FOR I=1 TO 3:GOSUB 100:NEXT I:END', '100 PRINT "SQUARE OF";I;"IS";FNQ(I)', '110 RETURN', '5 DEF FNQ(X)=X*X'], run: 'RUN' },
  { id: 'arrays', lines: ['10 DIM A(5)', '20 FOR I=0 TO 5:A(I)=(5-I)*3:NEXT', '30 FOR I=0 TO 5:PRINT A(I);:NEXT:PRINT', '40 S=0:FOR I=0 TO 5:S=S+A(I):NEXT:PRINT "SUM";S'], run: 'RUN' },
  fromApp('table'),
  fromApp('primes'),
  { id: 'math', lines: ['10 PRINT SQR(2);SIN(1);COS(1);ATN(1)', '20 PRINT EXP(1);LOG(10);2^10;INT(-3.5);ABS(-7)'], run: 'RUN' },
  { id: 'sort', lines: ['10 DIM A(9)', '20 FOR I=0 TO 9:A(I)=INT(RND(1)*90)+10:NEXT', '30 FOR I=0 TO 8:FOR J=0 TO 8-I', '40 IF A(J)>A(J+1) THEN T=A(J):A(J)=A(J+1):A(J+1)=T', '50 NEXT J,I', '60 FOR I=0 TO 9:PRINT A(I);:NEXT:PRINT'], run: 'RUN' },
]

const build = buildBasic(source, io)
const finished = (screen: string) => /RUN\n[\s\S]*OK\s*$/.test(screen)

/** The screen of the bare core after the program has run, and the cycles that took (after the start-up). */
function onCore(p: Prog) {
  const m = new BasicMachine(build.rom, build.symbols.INWAIT)
  m.settle()
  m.type(p.lines.join('\n') + '\n')
  m.settle()
  const start = m.cycles
  m.type(p.run + '\n')
  expect(m.runUntil(() => finished(m.screen), 40_000_000), `${p.id}: the core did not finish`).toBeGreaterThan(0)
  return { screen: m.screen, cycles: m.cycles - start }
}

/** The same on the circuit: lines are typed as the keyboard buffer empties, and it runs until the screen is the core's. */
function onCircuit(p: Prog, want: string, max: number) {
  const m = micro6502Builder({ hz: 100, board: 'basic' })
  const sim = new Simulator()
  sim.load(flatten(m.b.c))
  sim.settle()
  sim.setHistory(false)
  const state = () => sim.state(m.keys.terminal) as AciaState
  const queue = [...p.lines, p.run].map((l) => `${l}\r`)
  let cycles = 0
  let ready = false
  while (cycles < max) {
    sim.stepClock()
    sim.stepClock()
    cycles++
    if (cycles % 1000) continue
    const st = state()
    if (!ready) ready = /OK\s*$/.test(screenText(st))
    else if (queue.length && st.keys.length - st.next === 0) aciaType(st, queue.shift()!)
    if (ready && !queue.length && finished(screenText(st))) break
  }
  return { screen: screenText(state()), cycles }
}

const same = (a: string, b: string) => a.replace(/\s+$/g, '') === b.replace(/\s+$/g, '')

describe('BASIC programs on the CPU built from parts, against the core', () => {
  for (const p of QUICK)
    it(`${p.id}: the same screen as the core`, () => {
      const core = onCore(p)
      const mine = onCircuit(p, core.screen, 400_000)
      expect(same(mine.screen, core.screen), `${p.id}\ncircuit:\n${mine.screen}\ncore:\n${core.screen}`).toBe(true)
    }, 120_000)

  describe.skipIf(!process.env.SLOW)('the long ones', () => {
    for (const p of SLOW)
      it(`${p.id}: the same screen as the core`, () => {
        const core = onCore(p)
        console.log(`${p.id}: ${core.cycles} cycles after the start-up`)
        const t0 = performance.now()
        const mine = onCircuit(p, core.screen, 20_000_000)
        console.log(`${p.id}: circuit ${mine.cycles} cycles in ${((performance.now() - t0) / 1000).toFixed(0)} s`)
        expect(same(mine.screen, core.screen), `${p.id}\ncircuit:\n${mine.screen}\ncore:\n${core.screen}`).toBe(true)
      }, 3_600_000)
  })
})
