import { DOOR, GAME_MAP, screenWidth, START_POSE } from './tables'
import type { Pose } from './reference'

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

export interface GameState {
  pose: Pose
  map: number[]
}

export const newGame = (): GameState => ({ pose: { ...START_POSE }, map: [...GAME_MAP] })

/** One tick with `pad` held. The program's `LOGIC` does exactly this. */
export function tick(s: GameState, pad: number): void {
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
  }
}

/** The zero-page cells and registers the program uses on the game board. */
export const GAME_EQUATES = `
PADREG = $5000
T1CL = $6004
T1CH = $6005
ACR = $600B
IER = $600E
MAP = $0200
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
`

/** Where the program keeps what a test reads: frames drawn (16 bits), the pose and tick count of the last finished picture. */
export const GAME_CELLS = { frames: 0x56, shown: 0x60, shownTicks: 0x65, ticks: 0x51, pad: 0x50 } as const


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
  BNE LDONE
  LDA #0
  STA MAP,X
LDONE:
  RTS`
  return `
START:
  SEI
  CLD
  LDX #$FF
  TXS
  LDX #0
CPMAP:
  LDA MAPROM,X
  STA MAP,X
  INX
  BNE CPMAP
  LDA #${START_POSE.xFrac}
  STA POSXF
  LDA #${START_POSE.xCell}
  STA POSXH
  LDA #${START_POSE.yFrac}
  STA POSYF
  LDA #${START_POSE.yCell}
  STA POSYH
  LDA #${START_POSE.angle}
  STA ANG
  STZ TICKS
  STZ LAST
  STZ FRAMES
  STZ FRAMES+1
  LDA #${screenWidth(columns) / columns}
  STA CMW
  LDA #${sky}
  STA CMSKY
  LDA #${floor}
  STA CMFLOOR
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
  LDA PADREG
  STA PAD
  LDA USED
  STA CNT
TICKLP:
  JSR LOGIC
  DEC CNT
  BNE TICKLP
  JSR RENDER
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
  return [...rows('MVX', MVX), ...rows('MVY', MVY), ...rows('RCHX', RCHX), ...rows('RCHY', RCHY)]
}
