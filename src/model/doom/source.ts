import { angleTables, COLUMN_BYTES, hi, lo, MAP, Q_FAR, Q_NEAR, quarterSquare, RECIP, screenWidth, SHADE, SKY, FLOOR } from './tables'

/** How the picture gets to the screen: not at all (the rays alone), byte by byte through the video port, or by the column-fill command. */
export type DrawMode = 'none' | 'port' | 'fill'

export const ROM_BASE = 0xc000
export const ROM_SIZE = 0x4000

/** The zero-page cells the harness fills in before a frame. */
export const POSE = { xFrac: 0x10, xCell: 0x11, yFrac: 0x12, yCell: 0x13, angle: 0x14 } as const

/** The addresses of the video port and of the column-fill command (a model of the part: D1b built it, with the same registers). */
export const VIDEO = { addrLo: 0x4000, addrHi: 0x4001, data: 0x4002, ctrl: 0x4003, cx: 0x4004, top: 0x4005, bottom: 0x4006, colour: 0x4007, width: 0x4008, sky: 0x4009, floor: 0x400a } as const

const bytes = (name: string, values: number[], perLine = 16): string[] => {
  const rows: string[] = [`${name}:`]
  for (let i = 0; i < values.length; i += perLine) rows.push(`  .byte ${values.slice(i, i + perLine).join(',')}`)
  return rows
}

/** The code for one axis of the ray set-up: the sign of the direction, the cell step, the distance to the first edge and the step between edges. */
function axis(a: 'X' | 'Y', negStep: number, posStep: number): string {
  const L = a
  const frac = a === 'X' ? 'POSXF' : 'POSYF'
  return `
  LDA RD${L}H
  BMI ${L}NEG
  TAX
  LDA #${posStep}
  STA I${L}S
  LDA ${frac}
  EOR #$FF
  BRA ${L}DONE
${L}NEG:
  EOR #$FF
  INC A
  TAX
  LDA #${negStep}
  STA I${L}S
  LDA ${frac}
${L}DONE:
  STA MA
  LDA RECHI,X
  STA D${L}H
  STA MB
  LDA RECLO,X
  STA D${L}L
  JSR MUL
  LDA PRL
  STA SD${L}L
  LDA PRH
  STA SD${L}H
  LDA D${L}L
  STA MB
  JSR MUL
  LDA SD${L}L
  CLC
  ADC PRH
  STA SD${L}L
  BCC ${L}NC
  INC SD${L}H
${L}NC:`
}

/** Drawing a column through the port: sky bytes, wall bytes, floor bytes, each as a jump into a run of `STA VDATA`. */
function drawPort(repeat: number): string {
  return `
  LDA #25
  SEC
  SBC Q
  STA N1
  LDA Q
  ASL A
  STA N2
${repeat > 1 ? `  LDA #${repeat}\n  STA REP\nDRW:` : ''}
  LDX N1
  LDA #$${(SKY | (SKY << 4)).toString(16)}
  JSR RUN
  LDX N2
  LDA PAIR
  JSR RUN
  LDX N1
  LDA #$${(FLOOR | (FLOOR << 4)).toString(16)}
  JSR RUN
${repeat > 1 ? '  DEC REP\n  BNE DRW' : ''}`
}

/** Drawing a column by the fill command: the column, where the wall starts and ends in pixels, and its colour (the last write starts the fill). */
function drawFill(repeat: number): string {
  return `
  LDA COL
${repeat > 1 ? '  ASL A\n' : ''}  STA CMX
  LDA Q
  ASL A
  STA N2
  LDA #50
  SEC
  SBC N2
  STA CMTOP
  LDA #50
  CLC
  ADC N2
  STA CMBOT
  LDA PAIR
  AND #$0F
  STA CMCOL`
}

/**
 * The spike renderer in 65C02 assembly (`reference.ts` does the same in TypeScript): one frame of `columns` rays from the pose in the
 * zero page, then it stops at `FRAMEEND`. The harness measures the cycles from `RENDER` to `FRAMEEND`.
 */
export function doomSource(columns: number, draw: DrawMode): string {
  const t = angleTables(columns)
  const repeat = screenWidth(columns) / columns
  const out: string[] = []
  const emit = (...lines: string[]) => out.push(...lines)

  emit(`
POSXF = $10
POSXH = $11
POSYF = $12
POSYH = $13
ANG = $14
RDXL = $20
RDXH = $21
RDYL = $22
RDYH = $23
RSXL = $24
RSXH = $25
RSYL = $26
RSYH = $27
DXL = $28
DXH = $29
DYL = $2A
DYH = $2B
SDXL = $2C
SDXH = $2D
SDYL = $2E
SDYH = $2F
IDX = $30
IXS = $31
IYS = $32
IDX0 = $33
COL = $34
Q = $35
MA = $36
MB = $37
PRL = $38
PRH = $39
DISTL = $3A
DISTH = $3B
PAIR = $3C
N1 = $3D
N2 = $3E
REP = $3F
PTR = $40
TMPA = $42
VDATA = $4002
VADDRL = $4000
VADDRH = $4001
CMX = $4004
CMTOP = $4005
CMBOT = $4006
CMCOL = $4007
CMW = $4008
CMSKY = $4009
CMFLOOR = $400A

  .org $C000
RENDER:
  SEI
  CLD
${draw === 'port' ? '  STZ VADDRL\n  STZ VADDRH' : ''}${draw === 'fill' ? `  LDA #${repeat}\n  STA CMW\n  LDA #${SKY}\n  STA CMSKY\n  LDA #${FLOOR}\n  STA CMFLOOR` : ''}
  LDX ANG
  LDA R0XT,X
  STA RDXH
  STZ RDXL
  LDA R0YT,X
  STA RDYH
  STZ RDYL
  LDA STXL,X
  STA RSXL
  LDA STXH,X
  STA RSXH
  LDA STYL,X
  STA RSYL
  LDA STYH,X
  STA RSYH
  LDA POSYH
  ASL A
  ASL A
  ASL A
  ASL A
  ORA POSXH
  STA IDX0
  STZ COL
COLUMN:
  LDA IDX0
  STA IDX`)
  emit(axis('X', 255, 1), axis('Y', 240, 16))
  emit(`
DDA:
  LDA SDXH
  CMP SDYH
  BCC STEPX
  BNE STEPY
  LDA SDXL
  CMP SDYL
  BCC STEPX
STEPY:
  CLC
  LDA SDYL
  ADC DYL
  STA SDYL
  LDA SDYH
  ADC DYH
  STA SDYH
  LDA IDX
  CLC
  ADC IYS
  STA IDX
  TAX
  LDA MAP,X
  BNE HITY
  BRA DDA
STEPX:
  CLC
  LDA SDXL
  ADC DXL
  STA SDXL
  LDA SDXH
  ADC DXH
  STA SDXH
  LDA IDX
  CLC
  ADC IXS
  STA IDX
  TAX
  LDA MAP,X
  BEQ DDA
  SEC
  LDA SDXL
  SBC DXL
  STA DISTL
  LDA SDXH
  SBC DXH
  STA DISTH
  LDA #0
  BRA HIT
HITY:
  SEC
  LDA SDYL
  SBC DYL
  STA DISTL
  LDA SDYH
  SBC DYH
  STA DISTH
  LDA #32
HIT:
  STA TMPA
  LDA DISTH
  CMP #4
  BCS FAR
  LSR DISTH
  ROR DISTL
  LSR DISTH
  ROR DISTL
  LDX DISTL
  LDA QNEAR,X
  BRA GOT
FAR:
  LSR DISTH
  ROR DISTL
  LSR DISTH
  ROR DISTL
  LSR DISTH
  ROR DISTL
  LSR DISTH
  ROR DISTL
  LDX DISTL
  LDA QFAR,X
GOT:
  STA Q
  ORA TMPA
  TAX
  LDA SHADE,X
  STA PAIR`)
  if (draw === 'port') emit(drawPort(repeat))
  if (draw === 'fill') emit(drawFill(repeat))
  emit(`
  CLC
  LDA RDXL
  ADC RSXL
  STA RDXL
  LDA RDXH
  ADC RSXH
  STA RDXH
  CLC
  LDA RDYL
  ADC RSYL
  STA RDYL
  LDA RDYH
  ADC RSYH
  STA RDYH
  INC COL
  LDA COL
  CMP #${columns}
  BEQ FRAMEEND
  JMP COLUMN
FRAMEEND:
  JMP FRAMEEND

; A * B (MA, MB) = PR, by quarter squares: sq(a+b) - sq(a-b)
MUL:
  LDA MA
  SEC
  SBC MB
  BCS MABS
  EOR #$FF
  ADC #1
MABS:
  TAY
  LDA MA
  CLC
  ADC MB
  TAX
  BCS MBIG
  LDA SQLOA,X
  SEC
  SBC SQLOA,Y
  STA PRL
  LDA SQHIA,X
  SBC SQHIA,Y
  STA PRH
  RTS
MBIG:
  LDA SQLOB,X
  SEC
  SBC SQLOA,Y
  STA PRL
  LDA SQHIB,X
  SBC SQHIA,Y
  STA PRH
  RTS`)
  if (draw === 'port') {
    emit(`
; A run of X bytes of A through the video port: jump into a row of stores, which ends in RTS
RUN:
  STA TMPA
  LDA RUNLO,X
  STA PTR
  LDA RUNHI,X
  STA PTR+1
  LDA TMPA
  JMP (PTR)`)
    for (let n = COLUMN_BYTES; n >= 1; n--) emit(`CH${n}:\n  STA VDATA`)
    emit('CH0:\n  RTS')
    const seq = Array.from({ length: COLUMN_BYTES + 1 }, (_, n) => n)
    emit(`RUNLO:\n  .byte ${seq.map((n) => `<CH${n}`).join(',')}`, `RUNHI:\n  .byte ${seq.map((n) => `>CH${n}`).join(',')}`)
  }

  const n256 = Array.from({ length: 256 }, (_, i) => i)
  emit(...bytes('SQLOA', n256.map((n) => lo(quarterSquare(n)))))
  emit(...bytes('SQHIA', n256.map((n) => hi(quarterSquare(n)))))
  emit(...bytes('SQLOB', n256.map((n) => lo(quarterSquare(n + 256)))))
  emit(...bytes('SQHIB', n256.map((n) => hi(quarterSquare(n + 256)))))
  emit(...bytes('RECLO', RECIP.map(lo)))
  emit(...bytes('RECHI', RECIP.map(hi)))
  emit(...bytes('QNEAR', Q_NEAR))
  emit(...bytes('QFAR', Q_FAR))
  emit(...bytes('SHADE', SHADE))
  emit(...bytes('R0XT', t.r0x.map(lo)))
  emit(...bytes('R0YT', t.r0y.map(lo)))
  emit(...bytes('STXL', t.stepX.map(lo)))
  emit(...bytes('STXH', t.stepX.map(hi)))
  emit(...bytes('STYL', t.stepY.map(lo)))
  emit(...bytes('STYH', t.stepY.map(hi)))
  emit(...bytes('MAP', MAP))
  emit('  .org $FFFA', '  .word RENDER', '  .word RENDER', '  .word RENDER')
  return out.join('\n')
}
