import { ART_BASE, DCOS, DSIN, FRAME_DIE_A, FRAME_STRIKE, UTAB_BASE } from './sprites'
import { FACE_BYTES, FACE_X } from './face'
import { GUN_W, GUN_X } from './gun'

/** The cells the sprite code uses (the zero page from $80 up, and a few pages of RAM named in `GAME_EQUATES`). */
export const SPRITE_EQUATES = `
SQ = $80
SLL = $81
SLH = $82
SW = $83
STOP = $84
STYP = $85
NCOL = $86
XL = $87
XH = $88
UPTR = $89
RPTR = $8B
RCNT = $8D
Y0 = $8E
NB = $8F
RCOL = $90
SBEST = $91
M1L = $92
M1H = $93
M2 = $94
RL = $95
RH = $96
SG = $97
RXL = $98
RXH = $99
RYL = $9A
RYH = $9B
DPL = $9C
DPH = $9D
LTL = $9E
LTH = $9F
QNL = $A0
QNH = $A1
QDL = $A2
QDH = $A3
QRL = $A4
QRH = $A5
T1L = $A6
T1H = $A7
T2L = $A8
CL = $A9
CH = $AA
RRL = $AB
RRH = $AC
CC = $AD
SS = $AE
NEGF = $AF
ACL = $B0
ACH = $B1
ZQ80 = $B2
ANYSPR = $B3
NRANK = $B4
YBASE = $B5
SMASK = $B6
RANK = $B7
`

const code = `
; Where is enemy X on the screen? Sets SEQ, SEL, SER (its q and first and last column, clipped) and SLLO, SLHI (first column, signed),
; or leaves SEQ at 0 when it is not seen. Keeps X.
PROJECT:
  LDA ENX,X
  LSR A
  LSR A
  LSR A
  LSR A
  STA T1H
  LDA ENX,X
  ASL A
  ASL A
  ASL A
  ASL A
  STA T1L
  SEC
  LDA T1L
  SBC POSXF
  STA RXL
  LDA T1H
  SBC POSXH
  STA RXH
  JSR SAR2
  LDA RXH
  CLC
  ADC #2
  CMP #4
  BCC PY1
  RTS
PY1:
  LDA ENY,X
  LSR A
  LSR A
  LSR A
  LSR A
  STA T1H
  LDA ENY,X
  ASL A
  ASL A
  ASL A
  ASL A
  STA T1L
  SEC
  LDA T1L
  SBC POSYF
  STA RYL
  LDA T1H
  SBC POSYH
  STA RYH
  LDA RYH
  CMP #$80
  ROR A
  STA RYH
  ROR RYL
  LDA RYH
  CMP #$80
  ROR A
  STA RYH
  ROR RYL
  LDA RYH
  CLC
  ADC #2
  CMP #4
  BCC PY2
  RTS
PY2:
  LDY ANG
  LDA DCOS,Y
  STA CC
  LDA DSIN,Y
  STA SS
  LDA RXL
  STA M1L
  LDA RXH
  STA M1H
  LDA CC
  JSR SMUL
  LDA RL
  STA DPL
  LDA RH
  STA DPH
  LDA RYL
  STA M1L
  LDA RYH
  STA M1H
  LDA SS
  JSR SMUL
  CLC
  LDA DPL
  ADC RL
  STA DPL
  LDA DPH
  ADC RH
  STA DPH
  LDA RXL
  STA M1L
  LDA RXH
  STA M1H
  LDA SS
  JSR SMUL
  LDA RL
  STA LTL
  LDA RH
  STA LTH
  LDA RYL
  STA M1L
  LDA RYH
  STA M1H
  LDA CC
  JSR SMUL
  SEC
  LDA LTL
  SBC RL
  STA LTL
  LDA LTH
  SBC RH
  STA LTH
  LDY #3
PDIST:
  LDA DPH
  CMP #$80
  ROR A
  STA DPH
  ROR DPL
  DEY
  BNE PDIST
  LDA DPH
  BMI PGONE
  BNE PD1
  LDA DPL
  CMP #64
  BCS PD1
PGONE:
  RTS
PD1:
  LDA DPL
  STA QDL
  LDA DPH
  STA QDH
  LDA DPH
  CMP #4
  BCS PFAR
  LSR DPH
  ROR DPL
  LSR DPH
  ROR DPL
  LDY DPL
  LDA QNEAR,Y
  BRA PQ
PFAR:
  LDY #4
PFSH:
  LSR DPH
  ROR DPL
  DEY
  BNE PFSH
  LDY DPL
  LDA QFAR,Y
PQ:
  STA SQ
  STZ NEGF
  LDA LTH
  BPL PLAT
  LDA #1
  STA NEGF
  SEC
  LDA #0
  SBC LTL
  STA LTL
  LDA #0
  SBC LTH
  STA LTH
PLAT:
  LDY #3
PLS:
  LSR LTH
  ROR LTL
  DEY
  BNE PLS
  LDY #4
PLU:
  ASL LTL
  ROL LTH
  DEY
  BNE PLU
  LDA LTL
  STA QNL
  LDA LTH
  STA QNH
  JSR DIVIDE
  LDA QNH
  BEQ PT1
  RTS
PT1:
  LDA QNL
  STA T1L
  STZ T1H
  ASL T1L
  ROL T1H
  ASL T1L
  ROL T1H
  ASL T1L
  ROL T1H
  LDA QNL
  LSR A
  LSR A
  STA T2L
  LDA QNL
  LSR A
  LSR A
  LSR A
  CLC
  ADC T2L
  STA T2L
  SEC
  LDA T1L
  SBC T2L
  STA T1L
  LDA T1H
  SBC #0
  STA T1H
  BNE PT2
  LDA T1L
  CMP #201
  BCC PT3
PT2:
  RTS
PT3:
  LDA NEGF
  BNE PRIGHT
  SEC
  LDA #80
  SBC T1L
  STA CL
  LDA #0
  SBC #0
  STA CH
  BRA PW
PRIGHT:
  CLC
  LDA #80
  ADC T1L
  STA CL
  LDA #0
  ADC #0
  STA CH
PW:
  LDA SQ
  ASL A
  STA SW
  LDA SQ
  LSR A
  CLC
  ADC SW
  STA SW
  LSR A
  STA T2L
  SEC
  LDA CL
  SBC T2L
  STA SLL
  LDA CH
  SBC #0
  STA SLH
  LDA SW
  SEC
  SBC #1
  STA T2L
  CLC
  LDA SLL
  ADC T2L
  STA RRL
  LDA SLH
  ADC #0
  STA RRH
  LDA RRH
  BMI PGONE2
  LDA SLH
  BMI PLEFTOK
  BNE PGONE2
  LDA SLL
  CMP #160
  BCC PLEFTOK
PGONE2:
  RTS
PLEFTOK:
  LDA SQ
  STA SEQ,X
  LDA SLL
  STA SLLO,X
  LDA SLH
  STA SLHI,X
  LDA SLH
  BPL PCL
  LDA #0
  BRA PCS
PCL:
  LDA SLL
PCS:
  STA SEL,X
  LDA RRH
  BNE PRCLIP
  LDA RRL
  CMP #160
  BCC PRS
PRCLIP:
  LDA #159
PRS:
  STA SER,X
  RTS

; RX or RY arithmetic shift right twice: RX here.
SAR2:
  LDA RXH
  CMP #$80
  ROR A
  STA RXH
  ROR RXL
  LDA RXH
  CMP #$80
  ROR A
  STA RXH
  ROR RXL
  RTS

; Signed multiply: (M1L, M1H) times A (signed bytes) gives (RL, RH). Keeps X.
SMUL:
  STA M2
  STZ SG
  LDA M1H
  BPL SM1
  SEC
  LDA #0
  SBC M1L
  STA M1L
  LDA #0
  SBC M1H
  STA M1H
  LDA #1
  STA SG
SM1:
  LDA M2
  BPL SM2
  EOR #$FF
  INC A
  STA M2
  LDA SG
  EOR #1
  STA SG
SM2:
  STZ RL
  STZ RH
  LDY #8
SML:
  LSR M2
  BCC SMS
  CLC
  LDA RL
  ADC M1L
  STA RL
  LDA RH
  ADC M1H
  STA RH
SMS:
  ASL M1L
  ROL M1H
  DEY
  BNE SML
  LDA SG
  BEQ SMX
  SEC
  LDA #0
  SBC RL
  STA RL
  LDA #0
  SBC RH
  STA RH
SMX:
  RTS

; Unsigned divide: (QNL, QNH) by (QDL, QDH) gives the quotient in (QNL, QNH). Keeps X.
DIVIDE:
  STZ QRL
  STZ QRH
  LDY #16
DVL:
  ASL QNL
  ROL QNH
  ROL QRL
  ROL QRH
  SEC
  LDA QRL
  SBC QDL
  STA T2L
  LDA QRH
  SBC QDH
  BCC DVS
  STA QRH
  LDA T2L
  STA QRL
  INC QNL
DVS:
  DEY
  BNE DVL
  RTS

; Project every living enemy and put the ones that are seen in order, far to near: ORDER holds their numbers, SPMASK has a bit for each
; of them in every column they cover, and each has its table of pixel rows (YVT), its table of texture columns (UPLO, UPHI) and its art (STYA).
SPRPREP:
  STZ ANYSPR
  STZ NRANK
  LDX #0
SPL:
  STZ SEQ,X
  LDA ENT,X
  BEQ SPN
  JSR PROJECT
SPN:
  INX
  CPX #5
  BNE SPL
  LDX #4
SPT:
  LDA SEQ,X
  BNE SPT1
  LDA #255
SPT1:
  STA TQ,X
  DEX
  BPL SPT
SPLOOP:
  LDA #255
  STA TMP1
  LDX #0
SPF:
  LDA TQ,X
  CMP TMP1
  BCS SPG
  STA TMP1
  STX SBEST
SPG:
  INX
  CPX #5
  BNE SPF
  LDA TMP1
  CMP #255
  BEQ SPEND
  LDX SBEST
  LDA #255
  STA TQ,X
  LDY NRANK
  TXA
  STA ORDER,Y
  JSR PREPSPR
  INC NRANK
  LDA #1
  STA ANYSPR
  BRA SPLOOP
SPEND:
  RTS

; Get enemy X ready to be drawn as the NRANKth sprite.
PREPSPR:
  LDA SEQ,X
  STA SQ
  LDA ENH,X
  BNE PSALIVE
  LDA ENC,X
  LDY #${FRAME_DIE_A}
  CMP #14
  BCS PSFRM
  INY
  CMP #7
  BCS PSFRM
  INY
  BRA PSFRM
PSALIVE:
  LDA ENC,X
  LDY #${FRAME_STRIKE}
  CMP #40
  BCS PSFRM
  INY
  CMP #34
  BCS PSFRM
  LDA ENX,X
  CLC
  ADC ENY,X
  AND #3
  TAY
  LDA WALKF,Y
  TAY
PSFRM:
  TYA
  CLC
  ADC #>${ART_BASE}
  STA ARTH,X
  LDA ENT,X
  DEC A
  LSR A
  LDA #0
  ROR A
  STA STYA,X
  TXA
  ASL A
  ASL A
  ASL A
  ASL A
  ASL A
  STA YBASE
  LDA SQ
  ASL A
  STA T1L
  LDA #50
  SEC
  SBC T1L
  STA STOP
  STZ ACL
  STZ ACH
  LDY #0
BYL:
  LDA ACH
  LSR A
  STA T1H
  LDA ACL
  ROR A
  LSR T1H
  ROR A
  CLC
  ADC STOP
  AND #$FE
  PHA
  TYA
  CLC
  ADC YBASE
  TAX
  PLA
  STA YVT,X
  CLC
  LDA ACL
  ADC SQ
  STA ACL
  LDA ACH
  ADC #0
  STA ACH
  INY
  CPY #17
  BNE BYL
  LDX SBEST
  LDA SQ
  LSR A
  LSR A
  CLC
  ADC #>${UTAB_BASE}
  STA UPHI,X
  LDA SQ
  AND #3
  ASL A
  ASL A
  ASL A
  ASL A
  ASL A
  ASL A
  STA UPLO,X
  LDY NRANK
  LDA BITS,Y
  STA TMP2
  LDY SEL,X
  LDA SER,X
  CLC
  ADC #1
  STA T2L
PMLP:
  LDA SPMASK,Y
  ORA TMP2
  STA SPMASK,Y
  INY
  CPY T2L
  BNE PMLP
  RTS

; Called after the wall of column COL is filled: the sprites that cover it (far to near), the crosshair, and the HUD bytes.
COLEXTRA:
  LDX COL
  LDA SPMASK,X
  BEQ CEX
  STZ SPMASK,X
  STA SMASK
  STZ RANK
CERL:
  LSR SMASK
  BCC CERN
  JSR SPRCOL
CERN:
  INC RANK
  LDA SMASK
  BNE CERL
CEX:
  LDA COL
  CMP #80
  BNE CEC
  LDA Q
  STA ZQ80
  BRA CEH
CEC:
  CMP #79
  BNE CEHUD
CEH:
  LDX COL
  CLC
  LDA COLLOT,X
  ADC #24
  STA VADDRL
  LDA COLHIT,X
  ADC #0
  STA VADDRH
  LDA #$FF
  STA VDATA
  STA VDATA
CEHUD:
  LDX COL
  LDA HUDLO,X
  STA VADDRL
  LDA HUDHI,X
  STA VADDRH
  LDA HUD1,X
  STA VDATA
  LDA HUD2,X
  STA VDATA
  CPX #${FACE_X}
  BCC CEXX
  CPX #${GUN_X + GUN_W}
  BCS CEXX
  CPX #${GUN_X}
  BCS CEGUN
  TXA
  SEC
  SBC #${FACE_X}
  TAX
  LDA FALO,X
  STA VADDRL
  LDA FAHI,X
  STA VADDRH
  LDY FAOFF,X
${Array.from({ length: FACE_BYTES }, () => '  LDA (FPTR),Y\n  STA VDATA').join('\n  INY\n')}
  RTS
CEGUN:
  TXA
  SEC
  SBC #${GUN_X}
  TAX
  LDY GOFF,X
  LDA (GPTR),Y
  BEQ CEXX
  STA GCNT
  INY
  LDA (GPTR),Y
  CLC
  ADC GALO,X
  STA VADDRL
  LDA GAHI,X
  ADC #0
  STA VADDRH
  INY
  LDX GCNT
CEGL:
  LDA (GPTR),Y
  STA VDATA
  INY
  DEX
  BNE CEGL
CEXX:
  RTS

; The sprite of rank RANK, in screen column COL (it covers it), if it is nearer than the wall there.
SPRCOL:
  LDX RANK
  LDA ORDER,X
  TAX
  LDA SEQ,X
  CMP Q
  BEQ SCX
  BCC SCX
  SEC
  LDA COL
  SBC SLLO,X
  TAY
  LDA UPLO,X
  STA UPTR
  LDA UPHI,X
  STA UPTR+1
  LDA (UPTR),Y
  ASL A
  ASL A
  ASL A
  ASL A
  ORA STYA,X
  STA RPTR
  LDA ARTH,X
  STA RPTR+1
  TXA
  ASL A
  ASL A
  ASL A
  ASL A
  ASL A
  STA YBASE
  LDY #0
  LDA (RPTR),Y
  BEQ SCX
  STA RCNT
  INY
DCRUN:
  LDA (RPTR),Y
  CLC
  ADC YBASE
  TAX
  LDA YVT,X
  STA Y0
  INY
  LDA (RPTR),Y
  CLC
  ADC YBASE
  TAX
  LDA YVT,X
  INY
  SEC
  SBC Y0
  STA NB
  LDA (RPTR),Y
  STA RCOL
  INY
  LDA NB
  BEQ DCNEXT
  LSR A
  STA NB
  LDA Y0
  LSR A
  LDX COL
  CLC
  ADC COLLOT,X
  STA VADDRL
  LDA COLHIT,X
  ADC #0
  STA VADDRH
  LDX NB
  LDA RCOL
DCW:
  STA VDATA
  DEX
  BNE DCW
DCNEXT:
  DEC RCNT
  BNE DCRUN
SCX:
  RTS`


export const spriteCode = () => code

/** The tables the sprite code reads: the view direction, and the video address of the top of every column. */
export function spriteTables(): string[] {
  const rows = (name: string, values: number[]) => {
    const out = [`${name}:`]
    for (let i = 0; i < values.length; i += 16) out.push(`  .byte ${values.slice(i, i + 16).map((v) => v & 255).join(',')}`)
    return out
  }
  const col = Array.from({ length: 160 }, (_, x) => 50 * x)
  return [...rows('BITS', [1, 2, 4, 8, 16]), ...rows('DCOS', DCOS), ...rows('DSIN', DSIN), ...rows('COLLOT', col.map((v) => v & 255)), ...rows('COLHIT', col.map((v) => v >> 8))]
}

