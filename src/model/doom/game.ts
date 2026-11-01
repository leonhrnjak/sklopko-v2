import { DOOR, EXIT, SCREEN_H, screenWidth } from './tables'
import { LEVELS, LEVEL_COUNT } from './levels'
import { render, type Pose } from './reference'

/**
 * The game's rules, in TypeScript (the reference) and as 65C02 assembly (the program): one *tick* of 1/60 s changes the pose from the
 * buttons held. The program runs as many ticks before each picture as timer interrupts have come since the last one, so the walking
 * speed does not depend on how long a picture takes.
 *
 * Buttons (the gamepad register, bits 0 to 5): up, down, left, right, A, B. Up and down walk, left and right turn, A held makes left and
 * right strafe, B opens the door in front of you.
 */
export const BUTTON = { up: 1, down: 2, left: 4, right: 8, a: 16, b: 32 } as const

/** Steps a tick walks (1/256 cells), how close to a wall the player may come, and how far ahead a door can be opened. */
export const MOVE = 7
export const MARGIN = 32
export const REACH = 112
/** The most ticks one picture catches up on. */
export const MAX_TICKS = 12

const dirTable = (amp: number, f: (a: number) => number) => Array.from({ length: 256 }, (_, a) => Math.round(amp * f((2 * Math.PI * a) / 256)))
/** Signed bytes: the step for each angle (x and y), and the reach for the door test. */
export const MVX = dirTable(MOVE, Math.cos)
export const MVY = dirTable(MOVE, Math.sin)
export const RCHX = dirTable(REACH, Math.cos)
export const RCHY = dirTable(REACH, Math.sin)

/** Health at the start and the most there is, what a new level adds back, and the ammunition every level starts with. */
export const MAX_HEALTH = 100
export const HEAL = 40
export const START_AMMO = 50
/** After winning or losing, ticks before B starts a new game (so a held B does not skip the screen). */
export const END_DELAY = 90

/** What the game is doing: playing, won (past the last exit), or dead. */
export const STATE = { play: 0, won: 1, dead: 2 } as const

export interface GameState {
  pose: Pose
  map: number[]
  level: number
  health: number
  ammo: number
  state: number
  stimer: number
}

/** The level `s.level` begins: its map and start, a full load of ammunition, and some health back. */
export function loadLevel(s: GameState): void {
  const l = LEVELS[s.level]
  s.map = [...l.map]
  s.pose = { xCell: l.start.xCell, xFrac: 128, yCell: l.start.yCell, yFrac: 128, angle: l.start.angle }
  s.ammo = START_AMMO
  s.health = Math.min(MAX_HEALTH, s.health + HEAL)
}

/** Level one, full health. */
export function startGame(s: GameState): void {
  s.level = 0
  s.health = MAX_HEALTH
  s.state = STATE.play
  s.stimer = 0
  loadLevel(s)
}

export const newGame = (): GameState => {
  const s = { pose: { xCell: 0, xFrac: 0, yCell: 0, yFrac: 0, angle: 0 }, map: [] as number[], level: 0, health: 0, ammo: 0, state: 0, stimer: 0 }
  startGame(s)
  return s
}

/** B on an exit switch: the next level, or the win screen after the last. */
function pressExit(s: GameState): void {
  s.level++
  if (s.level >= LEVEL_COUNT) {
    s.state = STATE.won
    s.stimer = END_DELAY
  } else loadLevel(s)
}

/** One tick with `pad` held. The program's `LOGIC` does exactly this. */
export function tick(s: GameState, pad: number): void {
  if (s.state !== STATE.play) {
    if (s.stimer) s.stimer--
    else if (pad & BUTTON.b) startGame(s)
    return
  }
  const p = s.pose
  let dx = 0
  let dy = 0
  const a = p.angle
  if (pad & BUTTON.up) {
    dx = MVX[a]
    dy = MVY[a]
  }
  if (pad & BUTTON.down) {
    dx -= MVX[a]
    dy -= MVY[a]
  }
  if (pad & BUTTON.a) {
    if (pad & BUTTON.right) {
      dx -= MVY[a]
      dy += MVX[a]
    }
    if (pad & BUTTON.left) {
      dx += MVY[a]
      dy -= MVX[a]
    }
  } else {
    if (pad & BUTTON.left) p.angle = (p.angle - 1) & 255
    if (pad & BUTTON.right) p.angle = (p.angle + 1) & 255
  }
  if (dx) {
    const nx = ((p.xCell << 8) | p.xFrac) + dx
    const probe = ((nx + (dx < 0 ? -MARGIN : MARGIN)) >> 8) & 255
    if (!s.map[((p.yCell << 4) & 255) | probe]) {
      p.xCell = (nx >> 8) & 255
      p.xFrac = nx & 255
    }
  }
  if (dy) {
    const ny = ((p.yCell << 8) | p.yFrac) + dy
    const probe = ((ny + (dy < 0 ? -MARGIN : MARGIN)) >> 8) & 255
    if (!s.map[((probe << 4) & 255) | p.xCell]) {
      p.yCell = (ny >> 8) & 255
      p.yFrac = ny & 255
    }
  }
  if (pad & BUTTON.b) {
    const px = (((p.xCell << 8) | p.xFrac) + RCHX[p.angle]) >> 8
    const py = (((p.yCell << 8) | p.yFrac) + RCHY[p.angle]) >> 8
    const i = (((py << 4) & 255) | (px & 255)) & 255
    if (s.map[i] === DOOR) s.map[i] = 0
    else if (s.map[i] === EXIT) pressExit(s)
  }
}

/** The HUD's two rows of colours (rows 96 to 99 of the picture: each colour is two pixels tall), a colour for each of the 160 columns. */
export const HUD_ROW = SCREEN_H - 4
export function hudColours(s: GameState): [number[], number[]] {
  const top = Array<number>(160).fill(0)
  const bottom = Array<number>(160).fill(0)
  for (let x = 4; x < 54; x++) top[x] = bottom[x] = 9
  const healthLen = s.health >> 1
  for (let x = 4; x < 4 + healthLen; x++) top[x] = s.health >= 31 ? 4 : 6
  for (let x = 4; x < 4 + s.ammo; x++) bottom[x] = 12
  for (let i = 0; i < 5; i++) for (let x = 100 + 8 * i; x < 106 + 8 * i; x++) top[x] = i <= s.level ? 12 : 9
  return [top, bottom]
}

/** The colours of the two stripes of the end screen: yellow and green for a win, red and black for a loss. */
export const END_COLOURS = [12, 4, 6, 0]

/** The picture the program draws now: the walls and the HUD while playing, stripes after the end. 160×100 colours, row by row. */
export function renderGame(s: GameState): Uint8Array {
  const w = screenWidth(160)
  if (s.state !== STATE.play) {
    const out = new Uint8Array(w * SCREEN_H)
    const base = (s.state - 1) * 2
    for (let y = 0; y < SCREEN_H; y++) for (let x = 0; x < w; x++) out[y * w + x] = END_COLOURS[base + ((x >> 3) & 1)]
    return out
  }
  const out = render(s.pose, 160, s.map)
  const [top, bottom] = hudColours(s)
  for (let x = 0; x < w; x++) {
    out[HUD_ROW * w + x] = out[(HUD_ROW + 1) * w + x] = top[x]
    out[(HUD_ROW + 2) * w + x] = out[(HUD_ROW + 3) * w + x] = bottom[x]
  }
  return out
}

/** Where the levels are in bank 0 (a map every 256 bytes, then the start of each) and the page the bank latch is at. */
export const LEVEL_BASE = 0x8000
export const LEVEL_STARTS = LEVEL_BASE + 256 * LEVEL_COUNT

/** The zero-page cells and registers the program uses on the game board. */
export const GAME_EQUATES = `
PADREG = $5000
BANKREG = $5001
T1CL = $6004
T1CH = $6005
ACR = $600B
IER = $600E
MAP = $0200
HUD1 = $0300
HUD2 = $0400
LSTART = $${LEVEL_STARTS.toString(16)}
PAD = $50
TICKS = $51
LAST = $52
NOW = $53
USED = $54
CNT = $55
FRAMES = $56
DXV = $58
DYV = $59
NEWF = $5A
NEWH = $5B
PROBE = $5C
PROBEY = $5D
SHOWN = $60
SHUSED = $65
HEALTH = $66
AMMO = $67
LEVEL = $68
STATE = $69
STIMER = $6A
HUDDIRTY = $6B
TMP1 = $6C
TMP2 = $6D
`

/** Where the program keeps what a test reads: frames drawn (16 bits), the pose and tick count of the last finished picture, and the game's counters. */
export const GAME_CELLS = { frames: 0x56, shown: 0x60, shownTicks: 0x65, ticks: 0x51, pad: 0x50, used: 0x54, health: 0x66, ammo: 0x67, level: 0x68, state: 0x69, stimer: 0x6a, pose: 0x10 } as const

/** One axis of the walk: add the step to the position, look at the cell `MARGIN` ahead, and move only if it is empty. */
function walkAxis(axis: 'X' | 'Y'): string {
  const frac = axis === 'X' ? 'POSXF' : 'POSYF'
  const cell = axis === 'X' ? 'POSXH' : 'POSYH'
  const d = axis === 'X' ? 'DXV' : 'DYV'
  const other = axis === 'X' ? 'POSYH' : 'POSXH'
  const index =
    axis === 'X'
      ? `  LDA ${other}\n  ASL A\n  ASL A\n  ASL A\n  ASL A\n  ORA PROBE`
      : `  LDA PROBE\n  ASL A\n  ASL A\n  ASL A\n  ASL A\n  ORA ${other}`
  return `
  LDA ${d}
  BEQ W${axis}D
  BMI W${axis}N
  CLC
  LDA ${frac}
  ADC ${d}
  STA NEWF
  LDA ${cell}
  ADC #0
  STA NEWH
  CLC
  LDA NEWF
  ADC #${MARGIN}
  LDA NEWH
  ADC #0
  BRA W${axis}T
W${axis}N:
  CLC
  LDA ${frac}
  ADC ${d}
  STA NEWF
  LDA ${cell}
  ADC #$FF
  STA NEWH
  SEC
  LDA NEWF
  SBC #${MARGIN}
  LDA NEWH
  SBC #0
W${axis}T:
  STA PROBE
${index}
  TAX
  LDA MAP,X
  BNE W${axis}D
  LDA NEWF
  STA ${frac}
  LDA NEWH
  STA ${cell}
W${axis}D:`
}

/** The door probe on one axis: the cell `REACH` ahead of the player, left in `into`. */
function reachAxis(axis: 'X' | 'Y', into: string): string {
  const frac = axis === 'X' ? 'POSXF' : 'POSYF'
  const cell = axis === 'X' ? 'POSXH' : 'POSYH'
  return `
  LDA RCH${axis},X
  BMI R${axis}N
  CLC
  ADC ${frac}
  LDA ${cell}
  ADC #0
  BRA R${axis}D
R${axis}N:
  CLC
  ADC ${frac}
  LDA ${cell}
  ADC #$FF
R${axis}D:
  STA ${into}`
}

/** The main loop, the timer interrupt and the rules (`tick`) as assembly. `RENDER` is the renderer's entry, which returns with RTS. */
export function gameCode(columns: number): string {
  const sky = 1
  const floor = 2
  const logic = `
LOGIC:
  LDA STATE
  BEQ LPLAY
  LDA STIMER
  BEQ LEND1
  DEC STIMER
  RTS
LEND1:
  LDA PAD
  AND #$20
  BEQ LEND2
  JSR NEWGAME
LEND2:
  RTS
LPLAY:
  STZ DXV
  STZ DYV
  LDX ANG
  LDA PAD
  AND #1
  BEQ LNOFWD
  LDA MVX,X
  STA DXV
  LDA MVY,X
  STA DYV
LNOFWD:
  LDA PAD
  AND #2
  BEQ LNOBACK
  SEC
  LDA DXV
  SBC MVX,X
  STA DXV
  SEC
  LDA DYV
  SBC MVY,X
  STA DYV
LNOBACK:
  LDA PAD
  AND #$10
  BNE LSTRAFE
  LDA PAD
  AND #4
  BEQ LNOLEFT
  DEC ANG
LNOLEFT:
  LDA PAD
  AND #8
  BEQ LMOVE
  INC ANG
  BRA LMOVE
LSTRAFE:
  LDA PAD
  AND #8
  BEQ LNORIGHT
  SEC
  LDA DXV
  SBC MVY,X
  STA DXV
  CLC
  LDA DYV
  ADC MVX,X
  STA DYV
LNORIGHT:
  LDA PAD
  AND #4
  BEQ LMOVE
  CLC
  LDA DXV
  ADC MVY,X
  STA DXV
  SEC
  LDA DYV
  SBC MVX,X
  STA DYV
LMOVE:${walkAxis('X')}${walkAxis('Y')}
  LDA PAD
  AND #$20
  BEQ LDONE
  LDX ANG${reachAxis('X', 'PROBE')}${reachAxis('Y', 'PROBEY')}
  LDA PROBEY
  ASL A
  ASL A
  ASL A
  ASL A
  ORA PROBE
  TAX
  LDA MAP,X
  CMP #${DOOR}
  BEQ LOPEN
  CMP #${EXIT}
  BNE LDONE
  INC LEVEL
  LDA LEVEL
  CMP #${LEVEL_COUNT}
  BCS LWON
  JMP LOADLEVEL
LWON:
  LDA #${STATE.won}
  STA STATE
  LDA #${END_DELAY}
  STA STIMER
  RTS
LOPEN:
  STZ MAP,X
LDONE:
  RTS

NEWGAME:
  STZ LEVEL
  LDA #${MAX_HEALTH}
  STA HEALTH
  STZ STATE
  STZ STIMER
LOADLEVEL:
  LDA LEVEL
  CLC
  ADC #$${(LEVEL_BASE >> 8).toString(16)}
  STA PTR+1
  STZ PTR
  LDY #0
LLCOPY:
  LDA (PTR),Y
  STA MAP,Y
  INY
  BNE LLCOPY
  LDA LEVEL
  ASL A
  CLC
  ADC LEVEL
  TAX
  LDA LSTART,X
  STA POSXH
  LDA LSTART+1,X
  STA POSYH
  LDA LSTART+2,X
  STA ANG
  LDA #128
  STA POSXF
  STA POSYF
  LDA #${START_AMMO}
  STA AMMO
  LDA HEALTH
  CLC
  ADC #${HEAL}
  CMP #${MAX_HEALTH + 1}
  BCC LLHEAL
  LDA #${MAX_HEALTH}
LLHEAL:
  STA HEALTH
  LDA #1
  STA HUDDIRTY
  RTS

; The HUD's colours for each column (two bytes a column, rows 96 to 99), rebuilt when the health, ammunition or level changed.
HUDBUILD:
  LDX #0
HBCLR:
  STZ HUD1,X
  STZ HUD2,X
  INX
  CPX #160
  BNE HBCLR
  LDX #4
  LDA #$99
HBTRK:
  STA HUD1,X
  STA HUD2,X
  INX
  CPX #54
  BNE HBTRK
  LDA HEALTH
  LSR A
  BEQ HBAMMO
  CLC
  ADC #4
  STA TMP1
  LDA HEALTH
  CMP #31
  LDA #$44
  BCS HBHC
  LDA #$66
HBHC:
  LDX #4
HBH1:
  STA HUD1,X
  INX
  CPX TMP1
  BNE HBH1
HBAMMO:
  LDA AMMO
  BEQ HBPIPS
  CLC
  ADC #4
  STA TMP1
  LDA #$CC
  LDX #4
HBA1:
  STA HUD2,X
  INX
  CPX TMP1
  BNE HBA1
HBPIPS:
  LDY #0
HBP0:
  TYA
  ASL A
  ASL A
  ASL A
  CLC
  ADC #100
  TAX
  CLC
  ADC #6
  STA TMP1
  CPY LEVEL
  BCC HBPL
  BEQ HBPL
  LDA #$99
  BRA HBP1
HBPL:
  LDA #$CC
HBP1:
  STA HUD1,X
  INX
  CPX TMP1
  BNE HBP1
  INY
  CPY #5
  BNE HBP0
  RTS

; Copy the HUD to the bottom two bytes of every column.
HUDDRAW:
  LDX #0
HDLP:
  LDA HUDLO,X
  STA VADDRL
  LDA HUDHI,X
  STA VADDRH
  LDA HUD1,X
  STA VDATA
  LDA HUD2,X
  STA VDATA
  INX
  CPX #160
  BNE HDLP
  RTS

; The end screen: 20 stripes of 8 columns, two colours.
ENDDRAW:
  LDA #8
  STA CMW
  LDA #255
  STA CMTOP
  STA CMBOT
  LDA STATE
  DEC A
  ASL A
  STA TMP2
  LDX #0
EDLP:
  TXA
  AND #1
  ORA TMP2
  TAY
  LDA ENDCOL,Y
  STA CMSKY
  TXA
  ASL A
  ASL A
  ASL A
  STA CMX
  STZ CMCOL
  INX
  CPX #20
  BNE EDLP
  RTS`
  return `
START:
  SEI
  CLD
  LDX #$FF
  TXS
  STZ BANKREG
  STZ TICKS
  STZ LAST
  STZ FRAMES
  STZ FRAMES+1
  JSR NEWGAME
  LDA #$40
  STA ACR
  LDA #$19
  STA T1CL
  LDA #$41
  STA T1CH
  LDA #$C0
  STA IER
  CLI
LOOP:
WAIT:
  LDA TICKS
  STA NOW
  SEC
  SBC LAST
  BEQ WAIT
  CMP #${MAX_TICKS + 1}
  BCC CAPOK
  LDA #${MAX_TICKS}
CAPOK:
  STA USED
  LDA NOW
  STA LAST
PADRD:
  LDA PADREG
  STA PAD
  LDA USED
  STA CNT
TICKLP:
  JSR LOGIC
  DEC CNT
  BNE TICKLP
  LDA STATE
  BNE ENDSCR
  LDA #${screenWidth(columns) / columns}
  STA CMW
  LDA #${sky}
  STA CMSKY
  LDA #${floor}
  STA CMFLOOR
  JSR RENDER
  LDA HUDDIRTY
  BEQ HUDOK
  JSR HUDBUILD
  STZ HUDDIRTY
HUDOK:
  JSR HUDDRAW
  BRA SNAPSHOT
ENDSCR:
  JSR ENDDRAW
SNAPSHOT:
  LDX #4
SNAP:
  LDA POSXF,X
  STA SHOWN,X
  DEX
  BPL SNAP
  LDA USED
  STA SHUSED
  INC FRAMES
  BNE LOOP
  INC FRAMES+1
  BRA LOOP

IRQ:
  PHA
  LDA T1CL
  INC TICKS
  PLA
  RTI
${logic}`
}

/** The tables the rules read, as assembler lines. */
export function gameTables(): string[] {
  const rows = (name: string, values: number[]) => {
    const out = [`${name}:`]
    for (let i = 0; i < values.length; i += 16) out.push(`  .byte ${values.slice(i, i + 16).map((v) => v & 255).join(',')}`)
    return out
  }
  const hud = Array.from({ length: 160 }, (_, x) => 50 * x + 48)
  return [
    ...rows('MVX', MVX),
    ...rows('MVY', MVY),
    ...rows('RCHX', RCHX),
    ...rows('RCHY', RCHY),
    ...rows('HUDLO', hud.map((v) => v & 255)),
    ...rows('HUDHI', hud.map((v) => v >> 8)),
    ...rows('ENDCOL', END_COLOURS),
  ]
}

/** Bank 0 of the game board: the five maps, then each level's start (x cell, y cell, angle). */
export function levelBankSource(): string {
  const lines = ['  .org $8000']
  for (const l of LEVELS) for (let i = 0; i < 256; i += 16) lines.push(`  .byte ${l.map.slice(i, i + 16).join(',')}`)
  lines.push(`  .org $${LEVEL_STARTS.toString(16)}`)
  for (const l of LEVELS) lines.push(`  .byte ${l.start.xCell},${l.start.yCell},${l.start.angle}`)
  return lines.join('\n')
}

/** Bank 1: the sprites' art (nothing yet). */
export const ART_BANK_SOURCE = '  .org $8000\n  .byte 0'
