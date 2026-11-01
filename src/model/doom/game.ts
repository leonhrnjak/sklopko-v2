import { DOOR, EXIT, SCREEN_H, screenWidth } from './tables'
import { LEVELS, LEVEL_COUNT, MAX_ENEMIES, PATROL } from './levels'
import { renderDepth, type Pose } from './reference'
import { drawSprites, project, type Drawn } from './sprites'
import { SPRITE_EQUATES, spriteCode, spriteTables } from './spritecode'
import { ART_BASE, artBankSource, enemyFrame, WALK_FRAMES } from './sprites'
import { drawGun, GUN_FRAMES, GUN_RECORD, GUN_W, GUN_X, GUN_Y, gunBytes, gunFrame, RECOIL_FROM } from './gun'
import { drawFace, FACE_ART, faceBytes, faceFrame, FACE_BYTES, FACE_FRAMES, FACE_W, FACE_X, FACE_Y, HURT_TICKS } from './face'

/**
 * The game's rules, in TypeScript (the reference) and as 65C02 assembly (the program): one *tick* of 1/60 s changes the pose from the
 * buttons held. The program runs as many ticks before each picture as timer interrupts have come since the last one, so the walking
 * speed does not depend on how long a picture takes.
 *
 * Buttons (the gamepad register, bits 0 to 5): up, down, left, right, A, B. Up and down walk, left and right turn, A held makes left and
 * right strafe, B opens the door in front of you, presses the exit switch, or (with neither in reach) fires the gun.
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

/** Ticks between shots; hits an enemy takes (by kind: 1 patrol, 2 chaser); a touch's damage and the ticks before the same enemy can hurt again. */
export const FIRE_DELAY = 18
export const ENEMY_HP = [0, 2, 3]
export const ENEMY_DAMAGE = [0, 5, 10]
export const ATTACK_DELAY = 45
/** Ticks a killed enemy's fall lasts (its cooldown counts them), before it is a corpse. */
export const DEATH_TICKS = 20
/** A chaser comes for the player within this distance (|dx| + |dy| in 1/16 cells); a touch is closer than this on both axes. */
export const CHASE_RANGE = 160
export const TOUCH = 12

export interface Enemy {
  /** 0: none (no enemy in this slot), 1: patrol, 2: chaser. A killed enemy keeps its kind, with no hit points, and lies there as a corpse. */
  kind: number
  /** Position in 1/16 cells. */
  x: number
  y: number
  hp: number
  /** Bit 0: walking the negative way; bit 1: along y. */
  aux: number
  /** Ticks until it can hurt again; for a killed enemy, the ticks left of its fall. */
  cd: number
}

/** What the last picture showed of an enemy: its `q` (0: not seen) and the columns it covered. */
export interface Seen8 {
  q: number
  left: number
  right: number
}

export interface GameState {
  pose: Pose
  map: number[]
  level: number
  health: number
  ammo: number
  state: number
  stimer: number
  enemies: Enemy[]
  seen: Seen8[]
  /** The wall's `q` in the middle column of the last picture: a sprite nearer than that can be shot. */
  zq80: number
  firecd: number
  /** A shot not yet seen in a picture: the next picture shows the flash, however many ticks passed since (a picture takes several ticks, so the flash would often fall between pictures). */
  flash: boolean
  /** Ticks left of the face's wince after a hit. */
  hurt: number
  /** Ticks played, counted modulo 256: the enemies move on some of them. */
  gt: number
  kills: number
}

/** The level `s.level` begins: its map, enemies and start, a full load of ammunition, and some health back. */
export function loadLevel(s: GameState): void {
  const l = LEVELS[s.level]
  s.map = [...l.map]
  s.pose = { xCell: l.start.xCell, xFrac: 128, yCell: l.start.yCell, yFrac: 128, angle: l.start.angle }
  s.ammo = START_AMMO
  s.health = Math.min(MAX_HEALTH, s.health + HEAL)
  s.enemies = Array.from({ length: MAX_ENEMIES }, (_, i) => {
    const e = l.enemies[i]
    return e ? { kind: e.kind, x: e.x, y: e.y, hp: ENEMY_HP[e.kind], aux: e.aux, cd: 0 } : { kind: 0, x: 0, y: 0, hp: 0, aux: 0, cd: 0 }
  })
  s.seen = Array.from({ length: MAX_ENEMIES }, () => ({ q: 0, left: 0, right: 0 }))
  s.firecd = 0
  s.flash = false
}

/** Level one, full health. */
export function startGame(s: GameState): void {
  s.level = 0
  s.health = MAX_HEALTH
  s.state = STATE.play
  s.stimer = 0
  s.hurt = 0
  loadLevel(s)
}

export const newGame = (): GameState => {
  const s: GameState = { pose: { xCell: 0, xFrac: 0, yCell: 0, yFrac: 0, angle: 0 }, map: [], level: 0, health: 0, ammo: 0, state: 0, stimer: 0, enemies: [], seen: [], zq80: 0, firecd: 0, flash: false, hurt: 0, gt: 0, kills: 0 }
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
  s.gt = (s.gt + 1) & 255
  if (s.firecd) s.firecd--
  if (s.hurt) s.hurt--
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
    else if (s.map[i] === EXIT) {
      pressExit(s)
      return
    } else fire(s)
  }
  updateEnemies(s)
}

/** B with nothing to open: a shot, if there is ammunition and the gun is ready. It hits the nearest enemy in the middle column of the last picture. */
function fire(s: GameState): void {
  if (s.ammo === 0 || s.firecd) return
  s.ammo--
  s.firecd = FIRE_DELAY
  s.flash = true
  let best = -1
  let bestQ = 0
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const e = s.enemies[i]
    const v = s.seen[i]
    if (e.kind && e.hp && v.q > s.zq80 && v.q > bestQ && v.left <= 80 && v.right >= 80) {
      best = i
      bestQ = v.q
    }
  }
  if (best < 0) return
  const e = s.enemies[best]
  if (--e.hp === 0) {
    e.cd = DEATH_TICKS
    s.kills++
  }
}

/** The player's place in 1/16 cells. */
export const playerCell = (p: Pose): [number, number] => [(p.xCell << 4) | (p.xFrac >> 4), (p.yCell << 4) | (p.yFrac >> 4)]

/** Move an enemy to (x, y) if that cell is empty. */
function tryMove(s: GameState, e: Enemy, x: number, y: number): boolean {
  if (s.map[((y >> 4) << 4) | (x >> 4)]) return false
  e.x = x
  e.y = y
  return true
}

/** One tick of every enemy: a patrol walks along its axis and turns round at a wall, a chaser near the player steps toward him; both hurt on touch. */
function updateEnemies(s: GameState): void {
  const [px, py] = playerCell(s.pose)
  for (const e of s.enemies) {
    if (!e.kind) continue
    if (!e.hp) {
      if (e.cd) e.cd--
      continue
    }
    const dx = px - e.x
    const dy = py - e.y
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)
    const sx = Math.sign(dx)
    const sy = Math.sign(dy)
    if (e.kind === PATROL) {
      if ((s.gt & 7) === 0) {
        const step = e.aux & 1 ? -1 : 1
        const along = e.aux & 2
        if (!tryMove(s, e, (e.x + (along ? 0 : step)) & 255, (e.y + (along ? step : 0)) & 255)) e.aux ^= 1
      }
    } else if ((s.gt & 3) === 0 && adx + ady < CHASE_RANGE) {
      const moveX = () => sx !== 0 && tryMove(s, e, (e.x + sx) & 255, e.y)
      const moveY = () => sy !== 0 && tryMove(s, e, e.x, (e.y + sy) & 255)
      if (adx >= ady) {
        if (!moveX()) moveY()
      } else if (!moveY()) moveX()
    }
    if (e.cd) e.cd--
    else if (adx < TOUCH && ady < TOUCH) {
      const damage = ENEMY_DAMAGE[e.kind]
      if (s.health <= damage) {
        s.health = 0
        s.state = STATE.dead
        s.stimer = END_DELAY
      } else s.health -= damage
      s.hurt = HURT_TICKS
      e.cd = ATTACK_DELAY
    }
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

/** The picture the program draws now: the walls, the sprites, the crosshair and the HUD while playing, stripes after the end. Playing it also records what the picture showed of each enemy (`seen`, `zq80`), which the gun uses. 160×100 colours, row by row. */
export function renderGame(s: GameState): Uint8Array {
  const w = screenWidth(160)
  if (s.state !== STATE.play) {
    const out = new Uint8Array(w * SCREEN_H)
    const base = (s.state - 1) * 2
    for (let y = 0; y < SCREEN_H; y++) for (let x = 0; x < w; x++) out[y * w + x] = END_COLOURS[base + ((x >> 3) & 1)]
    return out
  }
  const { pixels: out, zq } = renderDepth(s.pose, 160, s.map)
  s.zq80 = zq[80]
  const drawn: Drawn[] = []
  s.enemies.forEach((e, i) => {
    const seen = e.kind ? project(s.pose, e.x, e.y) : null
    s.seen[i] = seen ? { q: seen.q, left: Math.max(0, seen.left), right: Math.min(159, seen.right) } : { q: 0, left: 0, right: 0 }
    if (seen) drawn.push({ kind: e.kind, frame: enemyFrame(e.hp, e.cd, e.x, e.y), seen })
  })
  drawSprites(out, zq, drawn)
  // The crosshair: a white bar, two columns wide and four rows tall, in the middle.
  for (const x of [79, 80]) for (let y = 48; y < 52; y++) out[y * w + x] = 15
  const [top, bottom] = hudColours(s)
  for (let x = 0; x < w; x++) {
    out[HUD_ROW * w + x] = out[(HUD_ROW + 1) * w + x] = top[x]
    out[(HUD_ROW + 2) * w + x] = out[(HUD_ROW + 3) * w + x] = bottom[x]
  }
  drawFace(out, w, faceFrame(s.health, s.hurt))
  drawGun(out, w, gunFrame(s.firecd, s.flash))
  s.flash = false
  return out
}

/** Where the levels are in bank 0 (a map every 256 bytes, then the start of each) and the page the bank latch is at. */
export const LEVEL_BASE = 0x8000
export const LEVEL_STARTS = LEVEL_BASE + 256 * LEVEL_COUNT
/** The enemies of each level: five slots of kind, x, y and aux (20 bytes a level). */
export const LEVEL_ENEMIES = LEVEL_STARTS + 16

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
ENT = $0500
ENX = $0508
ENY = $0510
ENH = $0518
ENA = $0520
ENC = $0528
ARTH = $0590
SEQ = $0530
SEL = $0538
SER = $0540
SLLO = $0548
SLHI = $0550
TQ = $0558
UPLO = $0568
UPHI = $0570
STYA = $0578
ORDER = $0580
YVT = $0700
SPMASK = $0800
LSTART = $${LEVEL_STARTS.toString(16)}
LENEMY = $${LEVEL_ENEMIES.toString(16)}
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
HURT = $B8
FPTR = $B9
GPTR = $BB
GCNT = $BD
FLASHP = $BE
TMP1 = $6C
TMP2 = $6D
GT = $6E
FIRECD = $6F
KILLS = $70
BEST = $71
NX = $72
NY = $73
STEPV = $74
PX16 = $75
PY16 = $76
ADX = $77
ADY = $78
SPX = $79
SPY = $7A
${SPRITE_EQUATES}
`

/** Where the program keeps what a test reads: frames drawn (16 bits), the pose and tick count of the last finished picture, and the game's counters. */
export const GAME_CELLS = { frames: 0x56, shown: 0x60, shownTicks: 0x65, ticks: 0x51, pad: 0x50, used: 0x54, health: 0x66, ammo: 0x67, level: 0x68, state: 0x69, stimer: 0x6a, gt: 0x6e, firecd: 0x6f, hurt: 0xb8, kills: 0x70, pose: 0x10, enemies: 0x500, seen: 0x530 } as const

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
  INC GT
  LDA FIRECD
  BEQ LNOCD
  DEC FIRECD
LNOCD:
  LDA HURT
  BEQ LNOHURT
  DEC HURT
LNOHURT:
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
  BEQ LEXIT
  JSR FIRE
  BRA LDONE
LEXIT:
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
  JMP ENEMIES
${ENEMY_CODE}

NEWGAME:
  STZ LEVEL
  LDA #${MAX_HEALTH}
  STA HEALTH
  STZ STATE
  STZ STIMER
  STZ HURT
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
  STZ FIRECD
  STZ FLASHP
  LDA LEVEL
  ASL A
  ASL A
  STA TMP1
  ASL A
  ASL A
  CLC
  ADC TMP1
  TAY
  LDX #0
LLEN:
  LDA LENEMY,Y
  STA ENT,X
  STA TMP2
  LDA LENEMY+1,Y
  STA ENX,X
  LDA LENEMY+2,Y
  STA ENY,X
  LDA LENEMY+3,Y
  STA ENA,X
  STZ ENC,X
  STZ SEQ,X
  PHX
  LDX TMP2
  LDA HPTAB,X
  PLX
  STA ENH,X
  INY
  INY
  INY
  INY
  INX
  CPX #${MAX_ENEMIES}
  BNE LLEN
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

; The face to show (FPTR): the wince while HURT counts, else by health.
FACEPREP:
  LDX #${FACE_FRAMES - 1}
  LDA HURT
  BNE FPSET
  LDA HEALTH
  LDX #0
  CMP #70
  BCS FPSET
  INX
  CMP #40
  BCS FPSET
  INX
  CMP #20
  BCS FPSET
  INX
FPSET:
  LDA FACELO,X
  STA FPTR
  LDA FACEHI,X
  STA FPTR+1
  RTS

; The gun's frame (GPTR): the flash in the first picture after a shot (FLASHP), then the recoil, then at rest.
GUNPREP:
  LDX #0
  LDA FIRECD
  CMP #${RECOIL_FROM}
  BCC GNFL
  LDX #2
GNFL:
  LDA FLASHP
  BEQ GNSET
  STZ FLASHP
  LDX #1
GNSET:
  LDA GUNLO,X
  STA GPTR
  LDA GUNHI,X
  STA GPTR+1
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
  STZ GT
  STZ KILLS
  LDA #>${ART_BASE}
  STA RPTR+1
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
  LDA HUDDIRTY
  BEQ HUDOK
  JSR HUDBUILD
  STZ HUDDIRTY
HUDOK:
  JSR FACEPREP
  JSR GUNPREP
  JSR SPRPREP
  LDA ANYSPR
  BEQ NOART
  LDA #1
  STA BANKREG
NOART:
  JSR RENDER
  STZ BANKREG
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
${logic}
${spriteCode()}`
}

/** The tables the rules read, as assembler lines. */
export function gameTables(): string[] {
  const rows = (name: string, values: number[]) => {
    const out = [`${name}:`]
    for (let i = 0; i < values.length; i += 16) out.push(`  .byte ${values.slice(i, i + 16).map((v) => v & 255).join(',')}`)
    return out
  }
  const guns = Array.from({ length: GUN_FRAMES }, (_, f) => gunBytes(f))
  const faces = FACE_ART.map((_, f) => faceBytes(f))
  const hud = Array.from({ length: 160 }, (_, x) => 50 * x + 48)
  return [
    ...rows('MVX', MVX),
    ...rows('MVY', MVY),
    ...rows('RCHX', RCHX),
    ...rows('RCHY', RCHY),
    ...rows('HUDLO', hud.map((v) => v & 255)),
    ...rows('HUDHI', hud.map((v) => v >> 8)),
    ...rows('ENDCOL', END_COLOURS),
    'FACELO:',
    `  .byte ${faces.map((_, f) => `<FACE${f}`).join(',')}`,
    'FACEHI:',
    `  .byte ${faces.map((_, f) => `>FACE${f}`).join(',')}`,
    ...rows('FALO', Array.from({ length: FACE_W }, (_, u) => 50 * (FACE_X + u) + FACE_Y / 2)),
    ...rows('FAHI', Array.from({ length: FACE_W }, (_, u) => (50 * (FACE_X + u) + FACE_Y / 2) >> 8)),
    'GUNLO:',
    `  .byte ${guns.map((_, f) => `<GUN${f}`).join(',')}`,
    'GUNHI:',
    `  .byte ${guns.map((_, f) => `>GUN${f}`).join(',')}`,
    ...rows('GOFF', Array.from({ length: GUN_W }, (_, u) => u * GUN_RECORD)),
    ...rows('GALO', Array.from({ length: GUN_W }, (_, u) => 50 * (GUN_X + u) + GUN_Y / 2)),
    ...rows('GAHI', Array.from({ length: GUN_W }, (_, u) => (50 * (GUN_X + u) + GUN_Y / 2) >> 8)),
    ...guns.flatMap((g, n) => [`GUN${n}:`, ...rows('', g).slice(1)]),
    ...rows('FAOFF', Array.from({ length: FACE_W }, (_, u) => u * FACE_BYTES)),
    ...faces.flatMap((f, n) => [`FACE${n}:`, ...rows('', f).slice(1)]),
    ...rows('HPTAB', ENEMY_HP),
    ...rows('WALKF', WALK_FRAMES),
    ...spriteTables(),
  ]
}

/** Bank 0 of the game board: the five maps, then each level's start (x cell, y cell, angle). */
export function levelBankSource(): string {
  const lines = ['  .org $8000']
  for (const l of LEVELS) for (let i = 0; i < 256; i += 16) lines.push(`  .byte ${l.map.slice(i, i + 16).join(',')}`)
  lines.push(`  .org $${LEVEL_STARTS.toString(16)}`)
  for (const l of LEVELS) lines.push(`  .byte ${l.start.xCell},${l.start.yCell},${l.start.angle}`)
  lines.push(`  .org $${LEVEL_ENEMIES.toString(16)}`)
  for (const l of LEVELS) {
    const slots = Array.from({ length: MAX_ENEMIES }, (_, i) => l.enemies[i] ?? { kind: 0, x: 0, y: 0, aux: 0 })
    lines.push(`  .byte ${slots.flatMap((e) => [e.kind, e.x, e.y, e.aux]).join(',')}`)
  }
  return lines.join('\n')
}


/** The gun and the enemies as assembly: `FIRE` is `fire`, `ENEMIES` is `updateEnemies`. */
const ENEMY_CODE = `
FIRE:
  LDA AMMO
  BEQ FIREX
  LDA FIRECD
  BNE FIREX
  DEC AMMO
  LDA #${FIRE_DELAY}
  STA FIRECD
  LDA #1
  STA FLASHP
  LDA #1
  STA HUDDIRTY
  LDA ZQ80
  STA TMP1
  STZ TMP2
  LDX #0
FLP:
  LDA ENT,X
  BEQ FNEXT
  LDA ENH,X
  BEQ FNEXT
  LDA SEQ,X
  CMP TMP1
  BEQ FNEXT
  BCC FNEXT
  CMP TMP2
  BEQ FNEXT
  BCC FNEXT
  LDA SEL,X
  CMP #81
  BCS FNEXT
  LDA SER,X
  CMP #80
  BCC FNEXT
  LDA SEQ,X
  STA TMP2
  STX BEST
FNEXT:
  INX
  CPX #${MAX_ENEMIES}
  BNE FLP
  LDA TMP2
  BEQ FIREX
  LDX BEST
  DEC ENH,X
  BNE FIREX
  LDA #${DEATH_TICKS}
  STA ENC,X
  INC KILLS
FIREX:
  RTS

; Move the enemy X to (NX, NY) if that cell is empty. Carry set: it moved.
TRYMOVE:
  LDA NY
  AND #$F0
  STA TMP1
  LDA NX
  LSR A
  LSR A
  LSR A
  LSR A
  ORA TMP1
  TAY
  LDA MAP,Y
  BNE TMBLK
  LDA NX
  STA ENX,X
  LDA NY
  STA ENY,X
  SEC
  RTS
TMBLK:
  CLC
  RTS

CHX:
  LDA SPX
  BEQ CHNO
  CLC
  ADC ENX,X
  STA NX
  LDA ENY,X
  STA NY
  JMP TRYMOVE
CHY:
  LDA SPY
  BEQ CHNO
  CLC
  ADC ENY,X
  STA NY
  LDA ENX,X
  STA NX
  JMP TRYMOVE
CHNO:
  CLC
  RTS

ENEMIES:
  LDA POSXF
  LSR A
  LSR A
  LSR A
  LSR A
  STA TMP1
  LDA POSXH
  ASL A
  ASL A
  ASL A
  ASL A
  ORA TMP1
  STA PX16
  LDA POSYF
  LSR A
  LSR A
  LSR A
  LSR A
  STA TMP1
  LDA POSYH
  ASL A
  ASL A
  ASL A
  ASL A
  ORA TMP1
  STA PY16
  LDX #0
ELP:
  LDA ENT,X
  BEQ ESKIP
  LDA ENH,X
  BNE EGO
  LDA ENC,X
  BEQ ESKIP
  DEC ENC,X
ESKIP:
  JMP ENEXT
EGO:
  SEC
  LDA PX16
  SBC ENX,X
  BEQ EDX0
  BCS EDXP
  EOR #$FF
  INC A
  STA ADX
  LDA #$FF
  STA SPX
  BRA EDXD
EDXP:
  STA ADX
  LDA #1
  STA SPX
  BRA EDXD
EDX0:
  STA ADX
  STZ SPX
EDXD:
  SEC
  LDA PY16
  SBC ENY,X
  BEQ EDY0
  BCS EDYP
  EOR #$FF
  INC A
  STA ADY
  LDA #$FF
  STA SPY
  BRA EDYD
EDYP:
  STA ADY
  LDA #1
  STA SPY
  BRA EDYD
EDY0:
  STA ADY
  STZ SPY
EDYD:
  LDA ENT,X
  CMP #${PATROL}
  BNE ECHASE
  LDA GT
  AND #7
  BNE EATK
  LDA ENX,X
  STA NX
  LDA ENY,X
  STA NY
  LDA ENA,X
  AND #1
  BEQ EPPOS
  LDA #$FF
  BRA EPSTEP
EPPOS:
  LDA #1
EPSTEP:
  STA STEPV
  LDA ENA,X
  AND #2
  BNE EPYA
  CLC
  LDA NX
  ADC STEPV
  STA NX
  BRA EPT
EPYA:
  CLC
  LDA NY
  ADC STEPV
  STA NY
EPT:
  JSR TRYMOVE
  BCS EATK
  LDA ENA,X
  EOR #1
  STA ENA,X
  BRA EATK
ECHASE:
  LDA GT
  AND #3
  BNE EATK
  CLC
  LDA ADX
  ADC ADY
  BCS EATK
  CMP #${CHASE_RANGE}
  BCS EATK
  LDA ADX
  CMP ADY
  BCC ECY1
  JSR CHX
  BCS EATK
  JSR CHY
  BRA EATK
ECY1:
  JSR CHY
  BCS EATK
  JSR CHX
EATK:
  LDA ENC,X
  BEQ EA2
  DEC ENC,X
  BRA ENEXT
EA2:
  LDA ADX
  CMP #${TOUCH}
  BCS ENEXT
  LDA ADY
  CMP #${TOUCH}
  BCS ENEXT
  LDA ENT,X
  CMP #${PATROL}
  BNE ED10
  LDA #${ENEMY_DAMAGE[1]}
  BRA EDM
ED10:
  LDA #${ENEMY_DAMAGE[2]}
EDM:
  STA TMP1
  LDA HEALTH
  CMP TMP1
  BEQ EDEAD
  BCC EDEAD
  SEC
  SBC TMP1
  STA HEALTH
  BRA EDH
EDEAD:
  STZ HEALTH
  LDA #${STATE.dead}
  STA STATE
  LDA #${END_DELAY}
  STA STIMER
EDH:
  LDA #${HURT_TICKS}
  STA HURT
  LDA #${ATTACK_DELAY}
  STA ENC,X
  LDA #1
  STA HUDDIRTY
ENEXT:
  INX
  CPX #${MAX_ENEMIES}
  BEQ EDONE
  JMP ELP
EDONE:
  RTS`

/** Bank 1 of the game board: the sprites' art and the texture-column table. */
export const ART_BANK_SOURCE = artBankSource()
