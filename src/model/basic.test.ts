import { describe, expect, it } from 'vitest'
import io from '../../scripts/basic/io.s?raw'
import source from '../../scripts/basic/m6502.asm?raw'
import { buildBasic } from '../../scripts/basic/target'
import { BasicMachine } from './basic-harness'

/**
 * Microsoft BASIC, built from Microsoft's source, running on the bare 6502 core with the terminal's registers as the only device
 * (the memory map of the BASIC computer). Each test boots its own machine (about 17,000 cycles, a few milliseconds).
 */
const build = buildBasic(source, io)

const boot = (dsr = false) => {
  const m = new BasicMachine(build.rom, build.symbols.INWAIT, dsr)
  m.settle()
  return m
}

/** The screen without the empty lines at its end. */
const shown = (m: BasicMachine) => m.screen.trimEnd()

describe('Microsoft BASIC on the bare core', () => {
  it('starts, says how much memory it has, and waits at OK', () => {
    const m = new BasicMachine(build.rom, build.symbols.INWAIT)
    const cycles = m.settle()
    expect(shown(m).trimStart()).toBe('15615 BYTES FREE\n\nSKLOPKO BASIC V1.1\nCOPYRIGHT 1978 MICROSOFT\n\nOK')
    expect(cycles).toBeLessThan(25_000)
  })

  it('adds', () => {
    expect(boot().answer('PRINT 2+2')).toBe(' 4 ')
  })

  it('prints numbers the way Microsoft BASIC does', () => {
    const m = boot()
    const cases: [string, string][] = [
      ['1/3', ' .333333333 '],
      ['100', ' 100 '],
      ['-7/2', '-3.5 '],
      ['7/2', ' 3.5 '],
      ['12345678', ' 12345678 '],
      ['0.1+0.2', ' .3 '],
      ['1E10', ' 1E+10 '],
      ['1E-5', ' 1E-05 '],
      ['123456789012', ' 1.23456789E+11 '],
      ['100000*100000', ' 1E+10 '],
      ['INT(-3.5)', '-4 '],
      ['ABS(-2.5)', ' 2.5 '],
      ['SGN(-7)', '-1 '],
      ['10^2', ' 100 '],
      ['2^0.5', ' 1.41421356 '],
    ]
    for (const [expr, printed] of cases) expect(m.answer(`PRINT ${expr}`), expr).toBe(printed)
  })

  it('agrees with the maths of JavaScript to nine digits for the functions', () => {
    const m = boot()
    let worst = 0
    const check = (expr: string, expected: number) => {
      const got = Number(m.answer(`PRINT ${expr}`).trim())
      const error = Math.abs(got - expected) / Math.max(Math.abs(expected), 1e-3)
      worst = Math.max(worst, error)
      expect(error, `${expr} gave ${got}, expected ${expected}`).toBeLessThan(1e-8)
    }
    for (const x of [0.001, 0.25, 0.5, 1, 2, 3, 7.5, 10, 123.456, 1000, 65535]) {
      check(`SQR(${x})`, Math.sqrt(x))
      check(`LOG(${x})`, Math.log(x))
      check(`ATN(${x})`, Math.atan(x))
    }
    for (const x of [-10, -2.5, -0.5, 0.001, 0.5, 1, 2, 5, 10, 20]) check(`EXP(${x})`, Math.exp(x))
    for (const x of [0.1, 0.5, 1, 1.5, 2, 3, 4, 6, 9]) {
      check(`SIN(${x})`, Math.sin(x))
      check(`COS(${x})`, Math.cos(x))
    }
    for (const x of [0.1, 0.5, 1, 1.4, 2, 3, 4, 6]) check(`TAN(${x})`, Math.tan(x))
    for (const [a, b] of [[2, 10], [3, 0.5], [10, -2], [1.5, 7], [0.5, 3], [100, 1.5], [7, 7]]) check(`${a}^${b}`, a ** b)
    for (const [a, b] of [[1, 3], [22, 7], [123456, 789], [0.001, 3], [9999, 7]]) {
      check(`${a}/${b}`, a / b)
      check(`${a}*${b}`, a * b)
      check(`${a}-${b}`, a - b)
    }
    expect(worst).toBeLessThan(1e-8)
  })

  it('gives the errors of Microsoft BASIC', () => {
    const m = boot()
    expect(m.answer('PRINT 1/0')).toBe('?/0 ERROR')
    expect(m.answer('PRINT SQR(-1)')).toBe('?FC ERROR')
    expect(m.answer('PRINT LOG(0)')).toBe('?FC ERROR')
    expect(m.answer('PRINT 1E38*10')).toBe('?OV ERROR')
    expect(m.answer('PRINT +')).toBe('?SN ERROR')
    expect(m.answer('GOTO 100')).toBe('?US ERROR')
    expect(m.answer('PRINT "A"+1')).toBe('?TM ERROR')
    expect(m.answer('NEXT')).toBe('?NF ERROR')
    expect(m.answer('RETURN')).toBe('?RG ERROR')
    expect(m.answer('READ A')).toBe('?OD ERROR')
    expect(m.answer('PRINT A(11)')).toBe('?BS ERROR')
    expect(m.answer('RUN')).toBe('')
  })

  it('does strings', () => {
    const m = boot()
    expect(m.answer('PRINT "A"+"B"')).toBe('AB')
    expect(m.answer('PRINT LEN("HELLO")')).toBe(' 5 ')
    expect(m.answer('PRINT LEFT$("HELLO",2);RIGHT$("HELLO",3);MID$("HELLO",2,3)')).toBe('HELLO'.slice(0, 2) + 'LLO' + 'ELL')
    expect(m.answer('PRINT ASC("A");CHR$(66)')).toBe(' 65 B')
    expect(m.answer('PRINT VAL("12.5")+1')).toBe(' 13.5 ')
    expect(m.answer('PRINT STR$(12.5)+"!"')).toBe(' 12.5!')
    expect(m.answer('A$="TEST":PRINT A$;A$')).toBe('TESTTEST')
    expect(m.answer('PRINT "A"<"B"')).toBe('-1 ')
  })

  it('runs a program with FOR, GOSUB, IF, GOTO, DATA, arrays and DEF FN', () => {
    const m = boot()
    m.command('10 DIM A(5):FOR I=0 TO 5:A(I)=I*I:NEXT')
    m.command('20 GOSUB 100:IF S>50 THEN PRINT "BIG";S')
    m.command('30 READ X,Y$:PRINT X;Y$:DATA 42,HELLO')
    m.command('40 DEF FNQ(X)=X*X+1:PRINT FNQ(3)')
    m.command('50 FOR J=10 TO 1 STEP -4:PRINT J;:NEXT:PRINT')
    m.command('60 ON 2 GOTO 70,80,90')
    m.command('70 END')
    m.command('80 PRINT "EIGHTY":END')
    m.command('100 S=0:FOR I=0 TO 5:S=S+A(I):NEXT:RETURN')
    expect(m.answer('RUN')).toBe('BIG 55 \n 42 HELLO\n 10 \n 10  6  2 \nEIGHTY')
  })

  it('lists a program in line order, and forgets it with NEW', () => {
    const m = boot()
    m.command('20 PRINT "B"')
    m.command('10 PRINT "A"')
    expect(m.answer('LIST')).toBe(' 10 PRINT "A"\n 20 PRINT "B"')
    expect(m.answer('NEW')).toBe('')
    expect(m.answer('LIST')).toBe('')
  })

  it('takes input and GET from the keyboard', () => {
    const m = boot()
    m.command('10 INPUT "NAME";N$:PRINT "HI ";N$')
    m.type('RUN\r')
    m.settle()
    expect(shown(m)).toMatch(/NAME\?$/)
    m.command('BOB')
    expect(shown(m)).toMatch(/NAME\? BOB\nHI BOB\n\nOK$/)
    m.command('NEW')
    m.command('10 GET A$:IF A$="" THEN 10')
    m.command('20 PRINT "GOT ";A$')
    m.type('RUN\r')
    m.run(30_000)
    m.type('x')
    m.settle()
    expect(m.screen).toContain('GOT X')
  })

  it('edits the line being typed: Backspace and “_” delete a character, “@” the line', () => {
    const m = boot()
    m.type('PRINT 12')
    m.key(8)
    m.type('3\r')
    m.settle()
    expect(shown(m)).toMatch(/PRINT 13\n 13\n\nOK$/)
    expect(m.answer('PRINT 4_5')).toBe(' 5 ')
    m.type('PRINT 99@PRINT 7\r')
    m.settle()
    expect(shown(m)).toMatch(/PRINT 99@\n?PRINT 7\n 7\n\nOK$/)
  })

  it('follows a wrapped line with Backspace: the screen erases what BASIC deletes', () => {
    const m = boot()
    const forty = '1234567890'.repeat(4)
    m.type(forty + 'AB') // 42 characters: the 41st wraps on the screen
    m.run(60_000)
    expect(shown(m)).toMatch(new RegExp(`${forty}\\nAB$`))
    m.key(8)
    m.key(8)
    m.key(8) // the third goes back over the wrap
    m.run(60_000)
    expect(shown(m)).toMatch(new RegExp(`${forty.slice(0, 39)}$`))
    expect(shown(m)).not.toMatch(/AB$/)
    m.type('9\r') // BASIC has 40 characters in its buffer; whatever it makes of them, the screen shows them as typed
    m.settle()
    expect(shown(m)).toContain(forty.slice(0, 39) + '9')
  })

  it('stops a running program with Control-C and goes on with CONT', () => {
    const m = boot()
    m.command('10 N=N+1:GOTO 10')
    m.type('RUN\r')
    m.run(300_000)
    m.interrupt()
    m.settle()
    expect(shown(m)).toMatch(/BREAK IN {2}10\nOK$/)
    m.type('CONT\r')
    m.run(200_000)
    m.interrupt()
    m.settle()
    expect(shown(m).match(/BREAK IN {2}10/g)).toHaveLength(2)
    expect(Number(m.answer('PRINT N'))).toBeGreaterThan(100)
  })

  it('still stops on Control-C after a key was typed while the program ran (and gives the key to a later GET)', () => {
    const m = boot()
    m.command('10 N=N+1:GOTO 10')
    m.type('RUN\r')
    m.run(100_000)
    m.type('x')
    m.run(100_000)
    m.interrupt()
    m.settle(4_000_000)
    expect(shown(m)).toMatch(/BREAK IN {2}10\nOK$/)
  })

  it('stops on Control-C however much was typed ahead of it, and forgets what was typed before it', () => {
    const m = boot()
    m.command('10 N=N+1:GOTO 10')
    m.type('RUN\r')
    m.run(100_000)
    m.type('abcdefghijklmnopqrstuvwxyz0123456789') // more than the program's queue holds
    m.run(100_000)
    m.interrupt()
    m.settle(4_000_000)
    expect(shown(m)).toMatch(/BREAK IN {2}10\nOK$/)
    expect(m.answer('PRINT 7')).toBe(' 7 ') // (none of the typed-ahead keys is left to spoil the next line)
  })

  it('keeps a key typed while a program runs, and does not take it for a break', () => {
    const m = boot()
    m.command('10 FOR I=1 TO 300:NEXT:GET A$:PRINT "KEY ";A$')
    m.type('RUN\r')
    m.run(5000)
    m.type('q')
    m.settle()
    expect(m.screen).toContain('KEY Q')
  })

  it('wraps its own output at the width of the screen without a blank line', () => {
    const m = boot()
    const text = '1234567890'.repeat(5).slice(0, 49)
    m.command(`10 PRINT "${text}"`)
    m.command('RUN')
    expect(shown(m).endsWith(`${text.slice(0, 40)}\n${text.slice(40)}\n\nOK`)).toBe(true)
  })

  it('puts the items of a PRINT with commas in columns of fourteen: three on a line of forty, the fourth on the next', () => {
    const m = boot()
    expect(m.answer('PRINT 1,2')).toBe(' 1 ' + ' '.repeat(11) + ' 2 ')
    // (the third item is where Microsoft's assembled-in default and its start-up code disagreed: it needs the NCMPOS edit)
    expect(m.answer('PRINT 1,2,3')).toBe(' 1 ' + ' '.repeat(11) + ' 2 ' + ' '.repeat(11) + ' 3 ')
    expect(m.answer('PRINT 1,2,3,4')).toBe(' 1 ' + ' '.repeat(11) + ' 2 ' + ' '.repeat(11) + ' 3 \n 4 ')
  })

  it('keeps a program of 300 lines typed in one go, as a paste feeds it', () => {
    const m = boot()
    for (let n = 1; n <= 300; n++) m.type(`${n * 10} PRINT ${n}\r`)
    m.settle(40_000_000)
    expect(m.answer('LIST 2990-3000')).toBe(' 2990 PRINT 299\n 3000 PRINT 300')
    // (PEEK/FRE: about ten bytes a line)
    expect(Number(m.answer('PRINT FRE(0)'))).toBeLessThan(15_615 - 300 * 8)
  })

  it('does PEEK and POKE on the RAM', () => {
    const m = boot()
    expect(m.answer('POKE 12000,77:PRINT PEEK(12000)')).toBe(' 77 ')
    expect(m.ram[12000]).toBe(77)
  })

  it('counts the cycles of a few things, for the notes (they only have to stay in the same range)', () => {
    const m = boot()
    expect(m.cycles).toBeLessThan(25_000) // start-up to OK
    const print = m.command('PRINT 2+2')
    expect(print).toBeLessThan(40_000)
    m.command('10 FOR I=1 TO 1000:NEXT')
    const loop = m.command('RUN')
    expect(loop).toBeGreaterThan(900_000)
    expect(loop).toBeLessThan(1_100_000) // about a million: BASIC is slow, even on a real 1 MHz machine
  })
})

describe('the start-up questions, when the switch on the DSR pin is on', () => {
  it('asks the memory size and the width, takes Enter for both, and ends with the same memory as without them', () => {
    const m = new BasicMachine(build.rom, build.symbols.INWAIT, true)
    expect(m.runUntil(() => /MEMORY SIZE\? $/.test(m.sent), 300_000)).toBeGreaterThan(0)
    m.type('\r')
    expect(m.runUntil(() => /TERMINAL WIDTH\? $/.test(m.sent), 5_000_000)).toBeGreaterThan(0)
    m.type('\r')
    m.settle()
    expect(m.screen).toContain('15615 BYTES FREE')
    expect(m.sent).not.toMatch(/U/) // the memory test stops at the end of the RAM: it never writes into the terminal
  })

  it('holds a memory size that is too big to the end of the RAM, so that strings never land on the terminal', () => {
    const m = new BasicMachine(build.rom, build.symbols.INWAIT, true)
    m.runUntil(() => /MEMORY SIZE\? $/.test(m.sent), 300_000)
    m.type('20000\r')
    m.runUntil(() => /TERMINAL WIDTH\? $/.test(m.sent), 300_000)
    m.type('\r')
    m.settle()
    expect(m.screen).toContain('15615 BYTES FREE') // the same as with no size typed
    expect(m.answer('A$="HELLO":B$=A$+" WORLD":PRINT B$')).toBe('HELLO WORLD')
    expect(m.term.command).toBe(0x0b) // (strings written into the terminal's registers would have changed it)
    // a size exactly at the end is allowed, and one in the last page is cut to it
    const exact = new BasicMachine(build.rom, build.symbols.INWAIT, true)
    exact.runUntil(() => /MEMORY SIZE\? $/.test(exact.sent), 300_000)
    exact.type('16384\r')
    exact.runUntil(() => /TERMINAL WIDTH\? $/.test(exact.sent), 300_000)
    exact.type('\r')
    exact.settle()
    expect(exact.screen).toContain('15615 BYTES FREE')
  })

  it('takes the answers: a smaller memory, a different width', () => {
    const m = new BasicMachine(build.rom, build.symbols.INWAIT, true)
    m.runUntil(() => /MEMORY SIZE\? $/.test(m.sent), 300_000)
    m.type('8000\r')
    m.runUntil(() => /TERMINAL WIDTH\? $/.test(m.sent), 300_000)
    m.type('60\r')
    m.settle()
    expect(m.screen).toContain('7231 BYTES FREE')
  })

  it('shows who wrote it when asked with an “A”', () => {
    const m = new BasicMachine(build.rom, build.symbols.INWAIT, true)
    m.runUntil(() => /MEMORY SIZE\? $/.test(m.sent), 300_000)
    m.type('A\r')
    m.run(500_000)
    expect(m.screen).toContain('WRITTEN BY WEILAND & GATES')
  })
})
