/**
 * Programs to type in on the BASIC computer. Each is checked and timed by `basic-programs.test.ts`, on the bare core and on the board:
 * every one prints within a few seconds at the speed the app reaches (see `docs/plan-basic-computer.md`). Everything is in capitals; a line may be
 * longer than the 40 columns of the screen (it wraps as it is typed) but not than the 72 characters BASIC takes.
 */
export interface BasicProgram {
  id: string
  title: string
  /** What it shows, in a line or two. */
  about: string
  /** The lines, one per row, without a final Enter. */
  lines: string[]
  /** What to type after it, to start it. */
  run: string
  /** It needs a part of the board that only some BASIC computers have: it POKEs the LCD on the VIA. */
  needs?: 'lcd'
}

export const BASIC_PROGRAMS: BasicProgram[] = [
  {
    id: 'maze',
    title: 'The endless maze',
    about: 'One line: a slash or a backslash at random, again and again. Stop it with Control+C (the Break button).',
    lines: ['10 PRINT MID$("/\\",INT(RND(1)*2)+1,1);:GOTO 10'],
    run: 'RUN',
  },
  {
    id: 'table',
    title: 'Multiplication table',
    about: 'Two loops, one inside the other. TAB and LEN(STR$()) line the columns up on their right edge. A row takes a second or two, the whole table about fifteen seconds.',
    lines: ['10 FOR I=1 TO 9', '20 FOR J=1 TO 9', '30 PRINT TAB(J*4-LEN(STR$(I*J))+1);I*J;', '40 NEXT J', '50 PRINT', '60 NEXT I'],
    run: 'RUN',
  },
  {
    id: 'guess',
    title: 'Guess the number',
    about: 'INPUT and RND. BASIC has no clock to start RND from, so after a Reset it thinks of the same numbers again.',
    lines: [
      '10 N=INT(RND(1)*100)+1',
      '20 PRINT "I AM THINKING OF A NUMBER FROM 1 TO 100"',
      '30 INPUT "YOUR GUESS";G',
      '35 T=T+1',
      '40 IF G<N THEN PRINT "TOO LOW":GOTO 30',
      '50 IF G>N THEN PRINT "TOO HIGH":GOTO 30',
      '60 PRINT "YES! YOU NEEDED";T;"GUESSES"',
    ],
    run: 'RUN',
  },
  {
    id: 'primes',
    title: 'Primes up to 100',
    about: 'Tries every odd number against every divisor up to its square root, and prints each prime as it finds it; all 25 take about half a minute. (A FOR loop in this BASIC always runs its body once, which is why 2 is printed first.)',
    lines: ['10 PRINT 2;', '20 FOR N=3 TO 100 STEP 2', '30 FOR D=2 TO SQR(N)', '40 IF N/D=INT(N/D) THEN 60', '50 NEXT D', '55 PRINT N;', '60 NEXT N'],
    run: 'RUN',
  },
  {
    id: 'lcd',
    title: 'Hello on the LCD',
    about: 'For the BASIC computer with the VIA and the LCD (not the plain one: there $6000 is the terminal). Port B ($6000 = 24576) is the LCD’s data pins, and PA5, PA6 and PA7 of port A ($6001) are RS, R/W and E. It sets the ports, sends the four set-up instructions, and writes two lines; nothing waits for the busy flag, because BASIC is slower than the LCD.',
    lines: [
      '10 REM LCD ON THE VIA: PB IS THE DATA BUS',
      '20 POKE 24578,255:POKE 24579,224',
      '30 FOR I=1 TO 4:READ C:GOSUB 100:NEXT I',
      '40 DATA 56,14,6,1',
      '50 T$="HELLO FROM BASIC":GOSUB 200',
      '60 C=192:GOSUB 100',
      '70 T$="ON A 6502":GOSUB 200',
      '80 END',
      '100 POKE 24576,C:POKE 24577,0:POKE 24577,128:POKE 24577,0',
      '110 FOR D=1 TO 5:NEXT D:RETURN',
      '200 FOR I=1 TO LEN(T$):C=ASC(MID$(T$,I,1))',
      '210 POKE 24576,C:POKE 24577,32:POKE 24577,160:POKE 24577,32',
      '220 NEXT I:RETURN',
    ],
    run: 'RUN',
    needs: 'lcd',
  },
]

/** The text to type for a program: its lines, each followed by Enter (the terminal turns line breaks into Enter). */
export const programText = (p: BasicProgram, withRun = true) => p.lines.join('\n') + '\n' + (withRun ? p.run + '\n' : '')

/** Does this ROM's hex text hold Microsoft BASIC? (Its banner, `MICROSOFT`, in ASCII.) */
export const hasBasic = (romData: unknown) => typeof romData === 'string' && romData.toUpperCase().includes('4D 49 43 52 4F 53 4F 46 54')
