/**
 * The characters of the LCD: 5 × 7 dots, one number per row (bit 4 is the dot on the left). Drawn for this project in the style of the
 * HD44780's own character ROM; codes 0x20–0x7F, with the ROM's three oddities (0x5C is a yen sign, 0x7E and 0x7F are arrows). The eighth row of a
 * character is the cursor's. Codes 0x80 and up (the ROM has katakana and symbols there) are drawn as a box.
 */
const ROWS: Record<string, string> = {
  ' ': '00 00 00 00 00 00 00',
  '!': '04 04 04 04 04 00 04',
  '"': '0A 0A 0A 00 00 00 00',
  '#': '0A 0A 1F 0A 1F 0A 0A',
  $: '04 0F 14 0E 05 1E 04',
  '%': '18 19 02 04 08 13 03',
  '&': '0C 12 14 08 15 12 0D',
  "'": '0C 04 08 00 00 00 00',
  '(': '02 04 08 08 08 04 02',
  ')': '08 04 02 02 02 04 08',
  '*': '00 04 15 0E 15 04 00',
  '+': '00 04 04 1F 04 04 00',
  ',': '00 00 00 00 0C 04 08',
  '-': '00 00 00 1F 00 00 00',
  '.': '00 00 00 00 00 0C 0C',
  '/': '00 01 02 04 08 10 00',
  '0': '0E 11 13 15 19 11 0E',
  '1': '04 0C 04 04 04 04 0E',
  '2': '0E 11 01 02 04 08 1F',
  '3': '1F 02 04 02 01 11 0E',
  '4': '02 06 0A 12 1F 02 02',
  '5': '1F 10 1E 01 01 11 0E',
  '6': '06 08 10 1E 11 11 0E',
  '7': '1F 01 02 04 08 08 08',
  '8': '0E 11 11 0E 11 11 0E',
  '9': '0E 11 11 0F 01 02 0C',
  ':': '00 0C 0C 00 0C 0C 00',
  ';': '00 0C 0C 00 0C 04 08',
  '<': '02 04 08 10 08 04 02',
  '=': '00 00 1F 00 1F 00 00',
  '>': '08 04 02 01 02 04 08',
  '?': '0E 11 01 02 04 00 04',
  '@': '0E 11 17 15 17 10 0E',
  A: '0E 11 11 1F 11 11 11',
  B: '1E 11 11 1E 11 11 1E',
  C: '0E 11 10 10 10 11 0E',
  D: '1C 12 11 11 11 12 1C',
  E: '1F 10 10 1E 10 10 1F',
  F: '1F 10 10 1E 10 10 10',
  G: '0E 11 10 17 11 11 0F',
  H: '11 11 11 1F 11 11 11',
  I: '0E 04 04 04 04 04 0E',
  J: '07 02 02 02 02 12 0C',
  K: '11 12 14 18 14 12 11',
  L: '10 10 10 10 10 10 1F',
  M: '11 1B 15 15 11 11 11',
  N: '11 11 19 15 13 11 11',
  O: '0E 11 11 11 11 11 0E',
  P: '1E 11 11 1E 10 10 10',
  Q: '0E 11 11 11 15 12 0D',
  R: '1E 11 11 1E 14 12 11',
  S: '0F 10 10 0E 01 01 1E',
  T: '1F 04 04 04 04 04 04',
  U: '11 11 11 11 11 11 0E',
  V: '11 11 11 11 11 0A 04',
  W: '11 11 11 15 15 15 0A',
  X: '11 11 0A 04 0A 11 11',
  Y: '11 11 11 0A 04 04 04',
  Z: '1F 01 02 04 08 10 1F',
  '[': '0E 08 08 08 08 08 0E',
  '\\': '11 11 0A 1F 04 1F 04', // the ROM has a yen sign here
  ']': '0E 02 02 02 02 02 0E',
  '^': '04 0A 11 00 00 00 00',
  _: '00 00 00 00 00 00 1F',
  '`': '08 04 02 00 00 00 00',
  a: '00 00 0E 01 0F 11 0F',
  b: '10 10 16 19 11 11 1E',
  c: '00 00 0E 10 10 11 0E',
  d: '01 01 0D 13 11 11 0F',
  e: '00 00 0E 11 1F 10 0E',
  f: '06 09 08 1C 08 08 08',
  g: '00 0F 11 11 0F 01 0E',
  h: '10 10 16 19 11 11 11',
  i: '04 00 0C 04 04 04 0E',
  j: '02 00 06 02 02 12 0C',
  k: '10 10 12 14 18 14 12',
  l: '0C 04 04 04 04 04 0E',
  m: '00 00 1A 15 15 11 11',
  n: '00 00 16 19 11 11 11',
  o: '00 00 0E 11 11 11 0E',
  p: '00 00 1E 11 1E 10 10',
  q: '00 00 0D 13 0F 01 01',
  r: '00 00 16 19 10 10 10',
  s: '00 00 0F 10 0E 01 1E',
  t: '08 08 1C 08 08 09 06',
  u: '00 00 11 11 11 13 0D',
  v: '00 00 11 11 11 0A 04',
  w: '00 00 11 11 15 15 0A',
  x: '00 00 11 0A 04 0A 11',
  y: '00 00 11 11 0F 01 0E',
  z: '00 00 1F 02 04 08 1F',
  '{': '02 04 04 08 04 04 02',
  '|': '04 04 04 04 04 04 04',
  '}': '08 04 04 02 04 04 08',
  '~': '00 04 02 1F 02 04 00', // the ROM has a right arrow here
}

const parse = (s: string) => s.split(' ').map((h) => parseInt(h, 16))

/** The seven rows of the character with this code in the ROM (0x20–0x7F), or a box for the codes the ROM has other things at. */
const BOX = [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f]
const LEFT_ARROW = '00 04 08 1F 08 04 00'

const TABLE: number[][] = Array.from({ length: 256 }, (_, code) => {
  if (code === 0x7f) return parse(LEFT_ARROW)
  if (code >= 0x20 && code < 0x7f) return parse(ROWS[String.fromCharCode(code)])
  return BOX
})

export const romGlyph = (code: number): number[] => TABLE[code & 255]
