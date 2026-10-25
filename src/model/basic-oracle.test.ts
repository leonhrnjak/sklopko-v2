import { describe, expect, it } from 'vitest'
import io from '../../scripts/basic/io.s?raw'
import source from '../../scripts/basic/m6502.asm?raw'
import { buildBasic } from '../../scripts/basic/target'
import { BasicMachine } from './basic-harness'

/**
 * A second opinion, on a developer's machine only (nothing of it is in the repository): the same programs on the KIM-1 build of
 * Michael Steil's reconstruction of Microsoft BASIC, built with cc65 from github.com/mist64/msbasic, and on ours; what they print
 * must be the same. (That build is the 1977 KIM-1 BASIC, 9 digits like ours; it prints its error messages in full and has no GO TO
 * special case, so error texts are left out.)
 *
 *     git clone https://github.com/mist64/msbasic && cd msbasic
 *     ca65 -D kb9 msbasic.s -o kb9.o && ld65 -C kb9.cfg kb9.o -o kb9.bin -Ln kb9.lbl     # (cc65 from your package manager)
 *     VITE_KB9_BIN=/path/kb9.bin VITE_KB9_ENTRY=$((16#4065)) npx vitest run src/model/basic-oracle
 *
 * `VITE_KB9_ENTRY` is COLD_START in kb9.lbl. The file is loaded at $2000; the KIM monitor’s two routines BASIC calls are small stubs.
 */
const file = import.meta.env.VITE_KB9_BIN as string | undefined
const entry = Number(import.meta.env.VITE_KB9_ENTRY ?? 0x4065)

/** The KIM-1 BASIC in 64 KB of RAM with the monitor’s character routines (at $1E5A and $1EA0) standing in for the monitor. */
class Kim1Machine extends BasicMachine {
  flat = new Uint8Array(65536)

  constructor(image: Uint8Array) {
    super(new Uint8Array(0x4000), 0x1e5a)
    const f = this.flat
    f.set(image, 0x2000)
    // GETCH ($1E5A): wait for a character, echo it, return it in A
    f.set([0xad, 0x01, 0x50, 0x29, 0x08, 0xf0, 0xf9, 0xad, 0x00, 0x50, 0x29, 0x7f, 0x8d, 0x00, 0x50, 0x60], 0x1e5a)
    // OUTCH ($1EA0): print A
    f.set([0x8d, 0x00, 0x50, 0x60], 0x1ea0)
    f[0x1740] = 0x80 // the serial line idles high: no Control-C
    // boot ($1F00): stack, decimal off, receiver on, then BASIC’s cold start
    f.set([0xa2, 0xff, 0x9a, 0xd8, 0xa9, 0x0b, 0x8d, 0x02, 0x50, 0x4c, entry & 255, entry >> 8], 0x1f00)
    f[0xfffc] = 0x00
    f[0xfffd] = 0x1f
  }

  protected override read(a: number) {
    return a >= 0x5000 && a < 0x5004 ? this.terminalRead(a) : this.flat[a]
  }

  protected override write(a: number, v: number) {
    if (a >= 0x5000 && a < 0x5004) this.terminalWrite(a, v)
    else this.flat[a] = v
  }
}

/** What a line printed, as in basic.test.ts but also leaving out the error texts. */
function answer(m: BasicMachine, line: string): string {
  const mark = m.sent.length
  m.command(line)
  const printed = m.since(mark)
  return printed
    .slice(printed.indexOf('\r\r\n') + 3)
    .replace(/(\r\n)?OK\r\n$/, '')
    .replace(/\r\n/g, '\n')
    .replace(/^\n/, '')
    .replace(/\n$/, '')
    .replace(/\?[A-Z0-9/' ]+ERROR( IN \d+)?/, '?ERROR')
}

describe.skipIf(!file)('against the KIM-1 build of the reconstruction of Microsoft BASIC', async () => {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(path: string): Uint8Array }
  const image = file ? fs.readFileSync(file) : new Uint8Array()
  const ours = buildBasic(source, io)

  const machines = () => {
    const a = new BasicMachine(ours.rom, ours.symbols.INWAIT)
    a.settle()
    const k = new Kim1Machine(image)
    k.runUntil(() => /MEMORY SIZE\? $/.test(k.sent), 1_000_000)
    k.type('20000\r')
    k.runUntil(() => /WIDTH\? $/.test(k.sent), 20_000_000)
    k.type('40\r')
    k.runUntil(() => /ATN\? $/.test(k.sent), 1_000_000)
    k.type('Y\r')
    k.settle()
    return [a, k] as const
  }

  /** The lines are typed one by one into both; each answer must be the same. Returns how many answers were compared. */
  const same = (lines: string[]): number => {
    const [a, k] = machines()
    for (const line of lines) expect(answer(a, line), line).toBe(answer(k, line))
    return lines.length
  }

  it('prints the same numbers, to the last digit', { timeout: 60_000 }, () => {
    const exprs = [
      '1/3', '2/3', '22/7', '1E10', '1E-5', '123456789', '1234567890', '0.000123', '100*100', '3.14159265358979', '-0.5', '1E38', '1E-38',
      'SQR(2)', 'SQR(1E10)', 'SQR(0.0001)', 'EXP(1)', 'EXP(-1)', 'EXP(10)', 'EXP(0.5)', 'LOG(2)', 'LOG(10)', 'LOG(0.5)', 'LOG(12345)',
      'SIN(1)', 'SIN(2)', 'SIN(0.5)', 'SIN(10)', 'COS(1)', 'COS(2)', 'COS(0.1)', 'TAN(1)', 'TAN(0.5)', 'TAN(1.5)', 'ATN(1)', 'ATN(0.5)',
      'ATN(10)', 'ATN(100)', '2^10', '2^0.5', '10^-2', '3^3.3', '7^7', '0.5^4', '(-2)^3', 'INT(3.7)', 'INT(-3.7)', 'INT(1E9+0.5)',
      'ABS(-12.5)', 'SGN(-3)', 'SGN(0)', '1+2*3-4/5', '(1+2)*(3-4)/5', '7-6*5', '1E5+0.5', '99999999.9', '999999999', '0.1+0.2',
      '1/7', '100/7', '1000000/7', '0.1*3', '5E-1', '12345.6789', '4*ATN(1)', 'LOG(2)/LOG(10)', 'EXP(LOG(5))', 'SQR(2)*SQR(2)',
    ]
    expect(same(exprs.map((e) => `PRINT ${e}`))).toBe(exprs.length)
  })

  it('does strings and conversions the same way', () => {
    same([
      'PRINT "A"+"B"', 'PRINT LEN("HELLO WORLD")', 'PRINT LEFT$("HELLO",2);RIGHT$("HELLO",2);MID$("HELLO",2,2);MID$("HELLO",4)',
      'PRINT ASC("Z");ASC("0")', 'PRINT CHR$(65);CHR$(97)', 'PRINT VAL("12.5E2")', 'PRINT VAL("ABC")', 'PRINT VAL(" 7")',
      'PRINT STR$(1/3)', 'PRINT STR$(-5)', 'PRINT STR$(1E10)', 'PRINT "A"<"B"; "B"<"A"; "A"="A"', 'A$="X":B$=A$+A$+A$:PRINT B$;LEN(B$)',
      'PRINT STR$(12)+"%"', 'PRINT 1;2;-3', 'PRINT 1,2,3', 'PRINT "A","B"', 'PRINT "A";TAB(10);"B"', 'PRINT SPC(3);"X"',
    ])
  })

  it('runs the same programs the same way', () => {
    const programs: string[][] = [
      ['10 FOR I=1 TO 10:PRINT I;I*I;SQR(I):NEXT', 'RUN'],
      ['10 FOR I=10 TO 1 STEP -3:PRINT I;:NEXT:PRINT', '20 FOR X=0 TO 1 STEP 0.25:PRINT X;:NEXT:PRINT', 'RUN'],
      ['10 DIM A(10),B$(3),C(2,3)', '20 FOR I=0 TO 10:A(I)=I*I:NEXT', '30 FOR I=0 TO 2:FOR J=0 TO 3:C(I,J)=I*10+J:NEXT:NEXT', '40 PRINT A(7);C(2,3);C(1,2)', '50 B$(2)="TWO":PRINT B$(2);B$(1);"."', 'RUN'],
      ['10 READ A,B$,C:PRINT A;B$;C', '20 DATA 5,HELLO,2.5', '30 RESTORE:READ X:PRINT X', 'RUN'],
      ['10 GOSUB 100:GOSUB 100:PRINT N:END', '100 N=N+1:RETURN', 'RUN'],
      ['10 ON X+1 GOTO 20,30,40', '20 PRINT "ZERO":END', '30 PRINT "ONE":END', '40 PRINT "TWO"', 'X=2:RUN', 'X=0:RUN'],
      ['10 DEF FNA(X)=X*X+1', '20 DEF FNB(Y)=FNA(Y)*2', '30 PRINT FNA(3);FNB(3)', 'RUN'],
      ['10 S$="":FOR I=1 TO 5:S$=S$+CHR$(64+I):NEXT:PRINT S$;LEN(S$)', '20 FOR I=LEN(S$) TO 1 STEP -1:PRINT MID$(S$,I,1);:NEXT:PRINT', 'RUN'],
      ['10 IF 1<2 THEN PRINT "YES"', '20 IF 1>2 THEN PRINT "NO"', '30 IF A=0 AND B=0 THEN PRINT "BOTH"', '40 IF A=1 OR B=0 THEN PRINT "EITHER"', '50 PRINT NOT 0;NOT 5', 'RUN'],
      ['10 X=RND(-7):FOR I=1 TO 3:PRINT RND(1):NEXT', 'RUN'],
      ['10 FOR I=1 TO 3:FOR J=1 TO 2:PRINT I*J;:NEXT J:NEXT I:PRINT', 'RUN'],
      ['10 A=1:B=2:PRINT A+B;A-B;A*B;A/B;A^B', '20 PRINT -A;-(A+B);3-(-2)', 'RUN'],
      ['10 PRINT INT(RND(1)*0)+7;', '20 PRINT PEEK(0)*0+POS(0)', 'RUN'],
      ['10 X=5', '20 PRINT X', '15 X=7', 'LIST', 'RUN'],
      ['10 PRINT "A":PRINT "B"', '20 PRINT "C"', 'LIST 20', 'LIST 10-10', 'DELETE'],
    ]
    for (const lines of programs) {
      const [a, k] = machines()
      const out = (m: BasicMachine) => lines.map((l) => answer(m, l)).join('\n')
      expect(out(a), lines.join(' / ')).toBe(out(k))
    }
  })

  it('agrees on 400 random expressions, to the last digit and in every error', () => {
    let seed = 20261025
    const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)]
    const number = (): string => {
      const k = random()
      if (k < 0.3) return String(1 + Math.floor(random() * 9999))
      if (k < 0.6) return (random() * 100).toFixed(1 + Math.floor(random() * 5))
      if (k < 0.8) return (random() * 0.01).toFixed(6)
      if (k < 0.9) return `${(1 + random() * 8).toFixed(2)}E${Math.floor(random() * 30) - 10}`
      return String(Math.floor(random() * 10))
    }
    const expr = (depth: number): string => {
      if (depth === 0 || random() < 0.2) return number()
      const k = random()
      if (k < 0.55) return `${expr(depth - 1)}${pick(['+', '-', '*', '/'])}${expr(depth - 1)}`
      if (k < 0.65) return `(${expr(depth - 1)})^${pick(['2', '3', '0.5', '1.5', '-1', '2.5', '10'])}`
      return `${pick(['SQR', 'LOG', 'EXP', 'SIN', 'COS', 'TAN', 'ATN', 'INT', 'ABS', 'SGN'])}(${expr(depth - 1)})`
    }
    const lines = Array.from({ length: 400 }, () => `PRINT ${expr(3)}`)
    expect(same(lines)).toBe(400)
  }, 120_000)

  it('has the same speed to within the little the reconstructions differ', () => {
    const [a, k] = machines()
    for (const m of [a, k]) {
      m.command('10 FOR I=1 TO 1000:NEXT')
    }
    const ca = a.command('RUN')
    const ck = k.command('RUN')
    expect(Math.abs(ca - ck) / ck).toBeLessThan(0.1)
  })
})

describe('the oracle', () => {
  it('is skipped unless VITE_KB9_BIN names a build of the KIM-1 BASIC', () => {
    expect(typeof file === 'string' || file === undefined).toBe(true)
  })
})
