/**
 * The BASIC of the BASIC computer, as a reference: Microsoft BASIC 1.1 (1978) with the terminal code of this project. Every word is
 * checked against the keyword table in the built image (`basic-reference.test.ts`), and every example with a `shows` is run on the bare
 * core: what it prints must be what the page says.
 */
export type BasicKind = 'statement' | 'function' | 'operator' | 'word'

export interface BasicEntry {
  /** As it is in the keyword table: `TAB(`, `LEFT$`, `+`. */
  word: string
  kind: BasicKind
  /** How it is written. */
  syntax: string
  text: string
  /** A line to type in direct mode, and what it prints (as `BasicMachine.answer` reports it). */
  try?: string
  shows?: string
}

const s = (word: string, syntax: string, text: string, ex?: [string, string]): BasicEntry => ({ word, kind: 'statement', syntax, text, ...(ex ? { try: ex[0], shows: ex[1] } : {}) })
const f = (word: string, syntax: string, text: string, ex?: [string, string]): BasicEntry => ({ word, kind: 'function', syntax, text, ...(ex ? { try: ex[0], shows: ex[1] } : {}) })
const o = (word: string, syntax: string, text: string, ex?: [string, string]): BasicEntry => ({ word, kind: 'operator', syntax, text, ...(ex ? { try: ex[0], shows: ex[1] } : {}) })
const w = (word: string, syntax: string, text: string, ex?: [string, string]): BasicEntry => ({ word, kind: 'word', syntax, text, ...(ex ? { try: ex[0], shows: ex[1] } : {}) })

export const BASIC_ENTRIES: BasicEntry[] = [
  s('END', 'END', 'Stops the program and says OK. Variables and the program stay: CONT goes on.'),
  s('FOR', 'FOR v = a TO b [STEP c]', 'Starts a loop that counts v from a to b. The body always runs once, even when a is already past b: the test is at NEXT.'),
  s('NEXT', 'NEXT [v [, v …]]', 'Ends a loop: adds the step to v and goes back to the FOR, or goes on after the last turn.'),
  s('DATA', 'DATA item, item, …', 'Numbers and strings that READ takes, in order, from every DATA line of the program.'),
  s('INPUT', 'INPUT ["prompt";] v [, v …]', 'Asks for values: it prints the prompt and a question mark, and waits for a line. A program only (not in direct mode).'),
  s('DIM', 'DIM v(n) [, v(n, m) …]', 'Makes an array with the subscripts 0 to n. Without DIM an array has 11 elements (0 to 10).', ['DIM A(3):A(2)=5:PRINT A(2)', ' 5 ']),
  s('READ', 'READ v [, v …]', 'Puts the next values of the DATA lines into variables. ?OD ERROR when they have run out.'),
  s('LET', '[LET] v = expression', 'Gives a variable a value. The word LET can be left out.'),
  s('GOTO', 'GOTO line', 'Goes on at a line number. GO TO, with a space, is the same.'),
  s('RUN', 'RUN [line]', 'Starts the program at its first line (or at the line), after clearing the variables.'),
  s('IF', 'IF condition THEN line | statements', 'Does what follows THEN when the condition is true (not 0), and goes to the next line when it is not. IF … GOTO line also works.'),
  s('RESTORE', 'RESTORE', 'Makes READ start from the first DATA again.'),
  s('GOSUB', 'GOSUB line', 'Calls a subroutine that ends with RETURN.'),
  s('RETURN', 'RETURN', 'Goes back to the statement after the GOSUB. ?RG ERROR without one.'),
  s('REM', 'REM text', 'A remark: the rest of the line is ignored.'),
  s('STOP', 'STOP', 'Stops the program and says BREAK IN line. CONT goes on.'),
  s('ON', 'ON expression GOTO | GOSUB line, line, …', 'Jumps to the first line when the expression is 1, the second when it is 2, and so on; does nothing when it is out of range.'),
  s('NULL', 'NULL n', 'Sends n null characters after each line break, for printers that need time. Leave it at 0: the terminal here does not.'),
  s('WAIT', 'WAIT address, mask [, flip]', 'Waits until a memory byte, exclusive-ORed with flip and ANDed with mask, is not 0. Reading the terminal’s status at 20481 is its use here.'),
  s('DEF', 'DEF FNx(v) = expression', 'Defines a function of one variable, called as FNx(value). A program only.'),
  s('POKE', 'POKE address, value', 'Writes a byte into memory. The address is 0 to 65535: the RAM is 0 to 16383.', ['POKE 1000,65:PRINT PEEK(1000)', ' 65 ']),
  s('PRINT', 'PRINT item [; | , item …]', 'Prints numbers and strings. A semicolon joins them, a comma moves to the next print zone of 14 columns, and a ; or , at the end keeps the cursor on the line. ? is short for PRINT.', ['PRINT "A";1;"B"', 'A 1 B']),
  s('CONT', 'CONT', 'Goes on after END, STOP or Control+C.'),
  s('LIST', 'LIST [first] [- last]', 'Prints the program, or the lines from first to last.'),
  s('CLEAR', 'CLEAR', 'Throws away every variable and array.'),
  s('GET', 'GET v$', 'Reads one key without waiting: the empty string when none was typed. A program only.'),
  s('NEW', 'NEW', 'Throws away the program and the variables.'),

  w('TAB(', 'TAB(column)', 'In PRINT: moves to a column (0 is the left one) before printing the next item.', ['PRINT TAB(5);"X"', '     X']),
  w('TO', 'FOR v = a TO b', 'Part of FOR.'),
  w('FN', 'FNx(value)', 'Calls a function made with DEF.'),
  w('SPC(', 'SPC(n)', 'In PRINT: prints n spaces.', ['PRINT "A";SPC(3);"B"', 'A   B']),
  w('THEN', 'IF … THEN …', 'Part of IF.'),
  w('NOT', 'NOT x', 'Bitwise NOT of a 16-bit whole number. True is -1 and false is 0, so NOT of a comparison turns it round.', ['PRINT NOT 0', '-1 ']),
  w('STEP', 'FOR … STEP c', 'The amount a FOR loop counts by (1 if left out; it can be negative).'),
  w('GO', 'GO TO line', 'GO TO is written as two words; the same as GOTO.'),

  o('+', 'a + b', 'Adds numbers, or joins two strings.', ['PRINT "AB"+"CD"', 'ABCD']),
  o('-', 'a - b, -a', 'Subtracts, or changes the sign.'),
  o('*', 'a * b', 'Multiplies.'),
  o('/', 'a / b', 'Divides. ?/0 ERROR when b is 0.', ['PRINT 7/2', ' 3.5 ']),
  o('^', 'a ^ b', 'Raises a to the power b.', ['PRINT 2^10', ' 1024 ']),
  o('AND', 'a AND b', 'Bitwise AND of two 16-bit whole numbers; with comparisons it is the logical AND.', ['PRINT 5 AND 3', ' 1 ']),
  o('OR', 'a OR b', 'Bitwise OR; with comparisons it is the logical OR.', ['PRINT 5 OR 3', ' 7 ']),
  o('>', 'a > b', 'Greater than: -1 when true and 0 when not. Strings compare in alphabetical order.'),
  o('=', 'a = b', 'Equal, in an expression and a condition; also the assignment.'),
  o('<', 'a < b', 'Less than: -1 when true and 0 when not.', ['PRINT 1<2;2<1', '-1  0 ']),

  f('SGN', 'SGN(x)', 'The sign of x: -1, 0 or 1.', ['PRINT SGN(-4)', '-1 ']),
  f('INT', 'INT(x)', 'The whole number at or below x (INT(-3.5) is -4).', ['PRINT INT(-3.5)', '-4 ']),
  f('ABS', 'ABS(x)', 'x without its sign.', ['PRINT ABS(-2)', ' 2 ']),
  f('USR', 'USR(x)', 'Calls a machine-language routine: BASIC jumps to $000A, where a JMP sits. POKE 11 and 12 with the address of yours (low byte first). Until then, ?FC ERROR.'),
  f('FRE', 'FRE(0)', 'How many bytes of memory are free.'),
  f('POS', 'POS(0)', 'The column the cursor is in (0 is the left one).', ['PRINT POS(0)', ' 0 ']),
  f('SQR', 'SQR(x)', 'The square root.', ['PRINT SQR(2)', ' 1.41421356 ']),
  f('RND', 'RND(x)', 'A random number from 0 up to but not including 1. RND(1) the next one; RND(0) the last again; a negative x starts a new series from x. After a Reset the series is the same again.'),
  f('LOG', 'LOG(x)', 'The natural logarithm.', ['PRINT LOG(10)', ' 2.30258509 ']),
  f('EXP', 'EXP(x)', 'e raised to the power x.', ['PRINT EXP(1)', ' 2.71828183 ']),
  f('COS', 'COS(x)', 'The cosine, x in radians.', ['PRINT COS(1)', ' .540302306 ']),
  f('SIN', 'SIN(x)', 'The sine, x in radians.', ['PRINT SIN(1)', ' .841470985 ']),
  f('TAN', 'TAN(x)', 'The tangent, x in radians.', ['PRINT TAN(1)', ' 1.55740772 ']),
  f('ATN', 'ATN(x)', 'The arctangent, in radians.', ['PRINT 4*ATN(1)', ' 3.14159266 ']),
  f('PEEK', 'PEEK(address)', 'The byte at an address, 0 to 255. PEEK(20481) is the terminal’s status register.', ['POKE 1000,7:PRINT PEEK(1000)', ' 7 ']),
  f('LEN', 'LEN(a$)', 'The number of characters in a string.', ['PRINT LEN("ABC")', ' 3 ']),
  f('STR$', 'STR$(x)', 'A number as a string, with a space in front of a positive one.', ['PRINT STR$(5)', ' 5']),
  f('VAL', 'VAL(a$)', 'The number at the start of a string (0 when there is none).', ['PRINT VAL("12")', ' 12 ']),
  f('ASC', 'ASC(a$)', 'The character code of the first character.', ['PRINT ASC("A")', ' 65 ']),
  f('CHR$', 'CHR$(n)', 'The character with the code n.', ['PRINT CHR$(66)', 'B']),
  f('LEFT$', 'LEFT$(a$, n)', 'The first n characters.', ['PRINT LEFT$("HELLO",2)', 'HE']),
  f('RIGHT$', 'RIGHT$(a$, n)', 'The last n characters.', ['PRINT RIGHT$("HELLO",2)', 'LO']),
  f('MID$', 'MID$(a$, start [, n])', 'n characters from position start (1 is the first); to the end if n is left out.', ['PRINT MID$("HELLO",2,3)', 'ELL']),
]

/** The two-letter error codes BASIC prints as `?NF ERROR`, what each means. */
export const BASIC_ERRORS: [string, string][] = [
  ['NF', 'NEXT without FOR'],
  ['SN', 'Syntax error: BASIC cannot make sense of the line'],
  ['RG', 'RETURN without GOSUB'],
  ['OD', 'Out of data: READ found no more DATA'],
  ['FC', 'Illegal function call: a value out of range, such as SQR of a negative number'],
  ['OV', 'Overflow: a number too big'],
  ['OM', 'Out of memory'],
  ['US', 'Undefined statement: a GOTO or GOSUB to a line that is not there'],
  ['BS', 'Bad subscript: outside the array'],
  ['DD', 'An array dimensioned twice'],
  ['/0', 'Division by zero'],
  ['ID', 'Illegal direct: this statement is for programs only (INPUT, GET, DEF)'],
  ['TM', 'Type mismatch: a number where a string belongs, or the other way round'],
  ['LS', 'String too long (more than 255 characters)'],
  ['ST', 'String formula too complex'],
  ['CN', 'Cannot continue: CONT after an error or a change'],
  ['UF', 'Undefined function: FN without DEF'],
]
