/**
 * A raycaster for the 16×16 screen, written in SKASM: for each of the 16 screen columns a ray is marched through an 8×8 map
 * in half-cell steps until it hits a wall, and the distance gives the height of the wall bar drawn in that column.
 *
 * Numbers: a position is 7 bits, 1/16 of a cell, so the 8×8 map is 128 units across and wraps with `AND 127`. The direction
 * of a ray is two signed bytes (−8 to 8, half a cell per step) from tables of 64 angles. The tables, the map and the wall
 * heights are in the program's table ROM (`.byte`), read with LDT.
 */

/** Angles in a full turn. A column's ray is the player's angle plus its column number minus 8: a 90° field of view. */
export const ANGLES = 64
/** The map, 8×8, a byte per cell: 1 is a wall. */
export const MAP = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 1, 0, 1],
  [1, 1, 1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 1, 0, 1],
  [1, 0, 1, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
]
/** The longest ray, in half cells. */
export const MAX_STEPS = 20

/** Step of a ray at angle a, in 1/16 cells, as a signed number. */
export const stepX = (a: number) => Math.round(8 * Math.cos((2 * Math.PI * a) / ANGLES))
export const stepY = (a: number) => Math.round(8 * Math.sin((2 * Math.PI * a) / ANGLES))
/** Half the height of the wall bar (0 to 8 rows) for a ray that hit after n steps; n = 21 means no wall in range. */
export const halfHeight = (n: number) => (n > MAX_STEPS ? 0 : Math.min(8, Math.round(16 / n)))

const byte = (v: number) => v & 255
const tableBytes = [
  ...Array.from({ length: ANGLES }, (_, a) => byte(stepX(a))), //  0–63: cos
  ...Array.from({ length: ANGLES }, (_, a) => byte(stepY(a))), // 64–127: sin
  ...MAP.flat(), //                                              128–191: the map
  0,
  ...Array.from({ length: MAX_STEPS }, (_, i) => halfHeight(i + 1)), // 192–212: wall heights by distance (192 is unused)
]
/** The table as `.byte` lines of 16, each with a comment saying what the bytes are. */
const byteLines = () =>
  Array.from({ length: Math.ceil(tableBytes.length / 16) }, (_, r) => {
    const from = r * 16
    const what = from < 64 ? 'x step' : from < 128 ? 'y step' : from < 192 ? 'map' : 'half height'
    return `        .byte ${tableBytes.slice(from, from + 16).join(', ')}    ; ${from}: ${what}`
  }).join('\n')

export const RAYCASTER_SOURCE = `; A raycaster. Each of the 16 screen columns gets a ray, marched through the 8x8 map in half-cell steps until it hits a wall;
; the number of steps is the distance, and the distance gives the height of the wall bar drawn in that column.
; Positions are 7 bits (1/16 of a cell, 128 across); a ray's step is a signed byte from the table, and AND 127 wraps it.
; Table: 0-63 the x step per angle, 64-127 the y step, 128-191 the map (1 = wall), 192-212 half the wall height by distance.
; Left and right turn, up and down walk; the picture is drawn again after every move.
px = 0            ; the player
py = 1
ang = 2           ; 0 to 63, a full turn
col = 3           ; the screen column being drawn
rx = 4            ; the ray
ry = 5
dx = 6            ; the ray's step
dy = 7
n = 8             ; steps so far
h = 9             ; half the height of the wall bar
t = 10
y = 11            ; the row being drawn
u = 12            ; twice h
pos = 13          ; the screen position of the pixel being drawn
key = 14

        LDI 24
        STA px
        STA py          ; start in the middle of cell (1, 1)
        LDI 0
        STA ang         ; looking along x

; ---- draw the 16 columns ----
render: LDI 0
        STA col
column: LDA ang         ; the ray of this column: angle + column - 8
        ADD col
        ADDI 56
        ANDI 63
        TAX
        LDT
        STA dx
        TXA
        ADDI 64
        TAX
        LDT
        STA dy
        LDA px
        STA rx
        LDA py
        STA ry
        LDI 0
        STA n
march:  LDA rx          ; one step
        ADD dx
        ANDI 127
        STA rx
        LDA ry
        ADD dy
        ANDI 127
        STA ry
        LDA n
        ADDI 1
        STA n
        CALL probe      ; ACC = the map cell under the ray
        CMPI 0
        JNZ hit
        LDA n
        CMPI 20
        JNZ march
        LDI 0           ; nothing in range: no wall bar
        JMP bar
hit:    LDA n
        ADDI 192
        TAX
        LDT
bar:    STA h
        SHL
        STA u           ; the bar is the rows from 8 - h up to, not including, 8 + h
        LDI 0
        STA y
        LDA col
        STA pos
row:    LDA y
        ADD h
        SUBI 8
        CMP u           ; carry when (y + h - 8) < 2h: the row is in the bar
        LDA pos
        JC lit
        OUT PIXEL_OFF
        JMP next
lit:    OUT PIXEL_ON
next:   ADDI 16
        STA pos
        LDA y
        ADDI 1
        STA y
        CMPI 16
        JNZ row
        LDA col
        ADDI 1
        STA col
        CMPI 16
        JNZ column

; ---- wait for the pad: left and right turn, up and down walk ----
input:  IN PAD
        STA key
        CMPI 0
        JZ input
        ANDI 4
        JZ notleft
        LDA ang
        SUBI 1
        ANDI 63
        STA ang
notleft: LDA key
        ANDI 8
        JZ notright
        LDA ang
        ADDI 1
        ANDI 63
        STA ang
notright: LDA ang       ; the step in the direction the player faces
        TAX
        LDT
        STA dx
        TXA
        ADDI 64
        TAX
        LDT
        STA dy
        LDA key
        ANDI 1
        JNZ forward
        LDA key
        ANDI 2
        JZ render       ; only a turn
        LDI 0           ; backwards: the opposite step
        SUB dx
        STA dx
        LDI 0
        SUB dy
        STA dy
forward: LDA px         ; walk if the cell ahead is free
        ADD dx
        ANDI 127
        STA rx
        LDA py
        ADD dy
        ANDI 127
        STA ry
        CALL probe
        CMPI 0
        JNZ render      ; a wall: stay
        LDA rx
        STA px
        LDA ry
        STA py
        JMP render

; ---- the map cell at (rx, ry): row = ry / 16, column = rx / 16, in the table from 128 ----
probe:  LDA ry
        SHR
        ANDI 56
        STA t
        LDA rx
        SHR
        SHR
        SHR
        SHR
        ADD t
        ADDI 128
        TAX
        LDT
        RET

${byteLines()}
`
