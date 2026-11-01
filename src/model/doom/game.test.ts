import { describe, expect, it } from 'vitest'
import { board6502Builder } from '../board6502'
import { flatten } from '../buses'
import { Simulator } from '../../engine/simulator'
import { openFor } from '../../engine/wasmengine'
import { loadEngine } from '../../engine/wasm'
import { assemble6502 } from '../../engine/asm6502'
import { doomSource } from './source'
import { ART_BANK_SOURCE, ATTACK_DELAY, BUTTON, END_DELAY, ENEMY_HP, FIRE_DELAY, GAME_CELLS, hudColours, levelBankSource, loadLevel, MAX_HEALTH, MAX_TICKS, newGame, renderGame, START_AMMO, STATE, tick, type GameState } from './game'
import { columnRuns, project, spriteWidth, texelRow } from './sprites'
import { CHASE, PATROL } from './levels'
import { GameMachine } from './gamemachine'
import { LEVELS, LEVEL_COUNT } from './levels'
import { unpackColumns } from './reference'
import { DOOR, EXIT, screenWidth } from './tables'
import type { CpuState } from '../../engine/components/cpu'
import type { VideoState } from '../../engine/components/video'

const { up, down, left, right, a, b } = BUTTON
const cell = (x: number, y: number) => y * 16 + x

describe('the levels', () => {
  it('there are five, 16 × 16, walled in, with an empty start, a door or more, and one exit switch', () => {
    expect(LEVEL_COUNT).toBe(5)
    for (const [n, l] of LEVELS.entries()) {
      expect(l.map, `level ${n + 1}`).toHaveLength(256)
      for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) expect(l.map[cell(x, y)], `level ${n + 1} edge ${x},${y}`).not.toBe(0)
      expect(l.map[cell(l.start.xCell, l.start.yCell)]).toBe(0)
      expect(l.map.filter((v) => v === EXIT)).toHaveLength(1)
      expect(l.map.filter((v) => v === DOOR).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('the exit can be reached from the start by walking through doors', () => {
    for (const [n, l] of LEVELS.entries()) {
      const seen = new Set<number>([cell(l.start.xCell, l.start.yCell)])
      const todo = [cell(l.start.xCell, l.start.yCell)]
      let exit = false
      while (todo.length) {
        const c = todo.pop()!
        for (const d of [1, -1, 16, -16]) {
          const m = c + d
          if (m < 0 || m > 255 || seen.has(m)) continue
          if (l.map[m] === EXIT) exit = true
          else if (l.map[m] === 0 || l.map[m] === DOOR) {
            seen.add(m)
            todo.push(m)
          }
        }
      }
      expect(exit, `level ${n + 1}`).toBe(true)
    }
  })

  it('the exit is straight ahead of the start: the corridor between them has nothing but floor and doors', () => {
    for (const [n, l] of LEVELS.entries()) {
      const dx = Math.round(Math.cos((2 * Math.PI * l.start.angle) / 256))
      const dy = Math.round(Math.sin((2 * Math.PI * l.start.angle) / 256))
      let x = l.start.xCell
      let y = l.start.yCell
      while (l.map[cell(x, y)] === 0 || l.map[cell(x, y)] === DOOR) {
        x += dx
        y += dy
      }
      expect(l.map[cell(x, y)], `level ${n + 1}`).toBe(EXIT)
    }
  })
})

describe('the rules (TypeScript reference)', () => {
  it('walks forward, and stops a margin short of a wall', () => {
    const g = newGame()
    for (let i = 0; i < 400; i++) tick(g, up)
    // Facing east along the corridor of level one: the door at cell 6 is the first solid cell, so x stops short of 6.0 by the margin.
    expect(g.pose.xCell).toBe(5)
    expect(g.pose.xFrac).toBeGreaterThan(200)
    expect(g.pose.xFrac).toBeLessThanOrEqual(255 - 32 + 7)
  })

  it('opens the door in front of it, and only a door', () => {
    const g = newGame()
    for (let i = 0; i < 400; i++) tick(g, up)
    expect(g.map[cell(6, 8)]).toBe(DOOR)
    tick(g, b)
    expect(g.map[cell(6, 8)]).toBe(0)
    for (let i = 0; i < 60; i++) tick(g, up)
    expect(g.pose.xCell).toBeGreaterThanOrEqual(6)
    const h = newGame()
    for (let i = 0; i < 20; i++) tick(h, b)
    expect(h.map).toEqual(LEVELS[0].map)
  })

  it('turns, and strafes with A', () => {
    const g = newGame()
    for (let i = 0; i < 64; i++) tick(g, right)
    expect(g.pose.angle).toBe(64)
    const h = newGame()
    h.pose.angle = 192
    const y0 = h.pose.yFrac
    for (let i = 0; i < 10; i++) tick(h, a | right)
    expect(h.pose.yFrac).toBeGreaterThan(y0 - 1)
    expect(h.pose.angle).toBe(192)
  })

  it('B on the exit switch starts the next level, with full ammunition and some health back; after the last the game is won, and B starts again', () => {
    const g = newGame()
    g.health = 50
    g.ammo = 3
    g.pose = { xCell: 14, xFrac: 200, yCell: 8, yFrac: 128, angle: 0 }
    g.map[cell(6, 8)] = 0
    tick(g, b)
    expect(g.level).toBe(1)
    expect(g.ammo).toBe(START_AMMO)
    expect(g.health).toBe(90)
    expect(g.map).toEqual(LEVELS[1].map)
    expect(g.pose.xCell).toBe(LEVELS[1].start.xCell)
    g.level = LEVEL_COUNT - 1
    g.map = [...LEVELS[LEVEL_COUNT - 1].map]
    g.pose = { xCell: 14, xFrac: 200, yCell: 7, yFrac: 128, angle: 0 }
    tick(g, b)
    expect(g.state).toBe(STATE.won)
    for (let i = 0; i < END_DELAY; i++) tick(g, b)
    expect(g.state).toBe(STATE.won)
    tick(g, b)
    expect(g.state).toBe(STATE.play)
    expect(g.level).toBe(0)
    expect(g.health).toBe(MAX_HEALTH)
  })

  it('a sprite straight ahead is in the middle, as tall as a wall at that distance; one behind, or far to the side, is not seen', () => {
    const p = { xCell: 1, xFrac: 128, yCell: 8, yFrac: 128, angle: 0 }
    const ahead = project(p, 5 * 16 + 8, 8 * 16 + 8)!
    expect(ahead.q).toBeGreaterThan(3)
    expect(ahead.left + (ahead.width >> 1)).toBe(80)
    expect(ahead.width).toBe(spriteWidth(ahead.q))
    const near = project(p, 3 * 16 + 8, 8 * 16 + 8)!
    expect(near.q).toBeGreaterThan(ahead.q)
    expect(project(p, 8, 8 * 16 + 8)).toBeNull()
    expect(project(p, 5 * 16 + 8, 2 * 16 + 8)).toBeNull()
    const left = project(p, 5 * 16 + 8, 8 * 16 + 8 - 24)!
    const right = project(p, 5 * 16 + 8, 8 * 16 + 8 + 24)!
    expect(left.left).toBeLessThan(ahead.left)
    expect(right.left).toBeGreaterThan(ahead.left)
  })

  it('the art: every texture column is a few runs inside the sprite, and texel rows are even', () => {
    for (const kind of [0, 1])
      for (let u = 0; u < 8; u++) {
        const runs = columnRuns(kind, u)
        expect(runs.length).toBeLessThanOrEqual(5)
        for (const r of runs) expect(r.to).toBeGreaterThan(r.from)
      }
    for (let q = 1; q <= 25; q++) for (let v = 0; v <= 16; v++) expect(texelRow(q, v) % 2).toBe(0)
    expect(texelRow(25, 16)).toBe(100)
  })

  /** A game with the one enemy given, a clear corridor of level one, and the player looking at it. */
  function duel(kind: number, at = 8): GameState {
    const g = newGame()
    g.map[cell(6, 8)] = 0
    g.enemies = g.enemies.map((e) => ({ ...e, kind: 0 }))
    g.enemies[0] = { kind, x: at * 16 + 8, y: 8 * 16 + 8, hp: ENEMY_HP[kind], aux: 0, cd: 0 }
    renderGame(g)
    return g
  }

  it('the gun hits the enemy in the middle of the screen, takes two shots to kill a patrol and three a chaser, and uses ammunition', () => {
    for (const [kind, shots] of [[PATROL, 2], [CHASE, 3]]) {
      const g = duel(kind)
      expect(g.seen[0].q).toBeGreaterThan(0)
      for (let n = 1; n <= shots; n++) {
        tick(g, b)
        expect(g.ammo).toBe(START_AMMO - n)
        expect(g.firecd).toBe(FIRE_DELAY)
        for (let i = 0; i < FIRE_DELAY; i++) tick(g, 0)
        expect(g.enemies[0].hp).toBe(ENEMY_HP[kind] - n)
        renderGame(g)
      }
      expect(g.enemies[0].kind).toBe(0)
      expect(g.kills).toBe(1)
    }
  })

  it('a shot does nothing without ammunition, while the gun is not ready, at nothing, or at an enemy behind a wall', () => {
    const g = duel(PATROL)
    g.ammo = 0
    tick(g, b)
    expect(g.enemies[0].hp).toBe(2)
    g.ammo = 5
    tick(g, b)
    tick(g, b)
    expect(g.ammo).toBe(4)
    const h = duel(PATROL)
    h.pose.angle = 20
    renderGame(h)
    tick(h, b)
    expect(h.enemies[0].hp).toBe(2)
    expect(h.ammo).toBe(START_AMMO - 1)
    const w = duel(PATROL)
    w.map[cell(4, 8)] = 1
    renderGame(w)
    tick(w, b)
    expect(w.enemies[0].hp).toBe(2)
  })

  it('a patrol walks along the corridor and turns round at a wall; a chaser comes for the player, but only within ten cells', () => {
    const g = duel(PATROL, 13)
    g.pose = { xCell: 1, xFrac: 128, yCell: 1, yFrac: 128, angle: 0 }
    let reversed = false
    const xs: number[] = []
    for (let i = 0; i < 700; i++) {
      tick(g, 0)
      xs.push(g.enemies[0].x)
      if (g.enemies[0].aux & 1) reversed = true
    }
    expect(reversed).toBe(true)
    expect(Math.max(...xs)).toBeGreaterThan(13 * 16 + 8)
    expect(Math.max(...xs)).toBeLessThan(15 * 16)
    expect(Math.min(...xs)).toBeLessThan(13 * 16)
    const far = duel(CHASE, 14)
    far.pose = { xCell: 1, xFrac: 128, yCell: 1, yFrac: 128, angle: 0 }
    for (let i = 0; i < 60; i++) tick(far, 0)
    expect(far.enemies[0].x).toBe(14 * 16 + 8)
    const near = duel(CHASE, 9)
    for (let i = 0; i < 60; i++) tick(near, 0)
    expect(near.enemies[0].x).toBeLessThan(9 * 16 + 8)
  })

  it('a touch hurts (5 from a patrol, 10 from a chaser) once, then not again until the delay has passed; health 0 is death, and B starts again', () => {
    const g = duel(PATROL, 1)
    g.enemies[0].x = 1 * 16 + 12
    tick(g, 0)
    expect(g.health).toBe(95)
    for (let i = 0; i < ATTACK_DELAY; i++) tick(g, 0)
    expect(g.health).toBe(95)
    tick(g, 0)
    expect(g.health).toBe(90)
    const c = duel(CHASE, 1)
    c.enemies[0].x = 1 * 16 + 12
    c.health = 10
    tick(c, 0)
    expect(c.health).toBe(0)
    expect(c.state).toBe(STATE.dead)
    for (let i = 0; i < END_DELAY; i++) tick(c, b)
    expect(c.state).toBe(STATE.dead)
    tick(c, b)
    expect(c.state).toBe(STATE.play)
    expect(c.level).toBe(0)
    expect(c.health).toBe(MAX_HEALTH)
    loadLevel(c)
  })

  it('the HUD shows health, ammunition and the level', () => {
    const g = newGame()
    const [top, bottom] = hudColours(g)
    expect(top[4]).toBe(4)
    expect(top[53]).toBe(4)
    expect(top[54]).toBe(0)
    expect(bottom[4]).toBe(12)
    expect(bottom[53]).toBe(12)
    expect(top[100]).toBe(12)
    expect(top[108]).toBe(9)
    g.health = 30
    g.ammo = 10
    g.level = 2
    const [t2, b2] = hudColours(g)
    expect(t2[18]).toBe(6)
    expect(t2[19]).toBe(9)
    expect(b2[13]).toBe(12)
    expect(b2[14]).toBe(9)
    expect(t2[116]).toBe(12)
    expect(t2[124]).toBe(9)
  })
})

/** The program and the reference side by side: after every picture the pose and the counters in RAM, and all 16,000 pixels, must agree. */
function compare(m: GameMachine, ref: GameState, what: string) {
  const r = m.ram
  const expected = renderGame(ref)
  const c = GAME_CELLS
  const pose = Array.from(r.slice(0x10, 0x15))
  expect(pose, `${what}: pose`).toEqual([ref.pose.xFrac, ref.pose.xCell, ref.pose.yFrac, ref.pose.yCell, ref.pose.angle])
  expect([r[c.level], r[c.health], r[c.ammo], r[c.state]], `${what}: level, health, ammo, state`).toEqual([ref.level, ref.health, ref.ammo, ref.state])
  expect(Array.from(r.slice(0x200, 0x300)), `${what}: map`).toEqual(ref.map)
  expect([r[c.gt], r[c.firecd], r[c.kills]], `${what}: tick count, gun delay, kills`).toEqual([ref.gt, ref.firecd, ref.kills])
  const field = (base: number, i: number) => r[c.enemies + base + i]
  for (let i = 0; i < ref.enemies.length; i++) {
    const e = ref.enemies[i]
    expect([field(0, i), field(8, i), field(16, i), field(32, i), field(40, i)], `${what}: enemy ${i} (kind, x, y, aux, cooldown)`).toEqual([e.kind, e.x, e.y, e.aux, e.cd])
    if (e.kind) expect(field(24, i), `${what}: enemy ${i} hit points`).toBe(e.hp)
    if (ref.state === STATE.play) {
      expect(r[c.seen + i], `${what}: enemy ${i} seen q`).toBe(ref.seen[i].q)
      if (ref.seen[i].q) expect([r[c.seen + 8 + i], r[c.seen + 16 + i]], `${what}: enemy ${i} seen (first, last column)`).toEqual([ref.seen[i].left, ref.seen[i].right])
    }
  }
  expect(Array.from(m.picture()), `${what}: picture`).toEqual(Array.from(expected))
}

describe('the game on the bare core', () => {
  it('fits: the fixed ROM leaves room, and the banks hold the levels', () => {
    const m = new GameMachine()
    expect(m.bytes).toBeLessThanOrEqual(16384)
    const r = assemble6502(levelBankSource(), 0x4000, true)
    expect(r.errors).toEqual([])
    expect(assemble6502(ART_BANK_SOURCE, 0x4000, true).errors).toEqual([])
  })

  it('a recorded run (Up and B held) kills both kinds of monster, takes damage and reaches the exit of every level; every picture is the reference\'s', () => {
    const m = new GameMachine()
    const ref = newGame()
    const record: number[] = []
    const killed = [0, 0, 0]
    const exits: number[] = []
    let minHealth = MAX_HEALTH
    let pictures = 0
    let t0 = 0
    m.runTo('PADRD')
    for (let f = 0; f < 3000 && ref.state === STATE.play; f++) {
      // The pad is read right after this point; the ticks of the coming picture are already known.
      const pad = up | b
      record.push(pad)
      m.pad = pad
      const used = m.ram[GAME_CELLS.used]
      expect(used).toBeGreaterThanOrEqual(1)
      expect(used).toBeLessThanOrEqual(MAX_TICKS)
      for (let i = 0; i < used; i++) {
        const kinds = ref.enemies.map((e) => e.kind)
        const kills = ref.kills
        const level = ref.level
        tick(ref, pad)
        if (ref.kills > kills) killed[kinds.find((k, j) => k && !ref.enemies[j].kind)!]++
        if (ref.level > level) exits.push(level)
        minHealth = Math.min(minHealth, ref.health)
      }
      if (f === 0) t0 = m.cycles
      m.runTo('PADRD')
      pictures++
      compare(m, ref, `picture ${f}`)
    }
    console.log(`bare core: ${pictures} pictures, ${Math.round((m.cycles - t0) / pictures)} cycles a picture on average; killed ${killed[1]} patrols and ${killed[2]} chasers; lowest health ${minHealth}`)
    expect(ref.state).toBe(STATE.won)
    expect(exits).toEqual([0, 1, 2, 3, 4])
    expect(killed[1]).toBeGreaterThan(0)
    expect(killed[2]).toBeGreaterThan(0)
    expect(minHealth).toBeLessThan(MAX_HEALTH)
    expect(minHealth).toBeGreaterThan(0)
    expect(record.every((p) => p === (up | b))).toBe(true)
    // The win screen: stripes. B restarts after the delay.
    expect(Array.from(m.picture().slice(0, 16))).toEqual([12, 12, 12, 12, 12, 12, 12, 12, 4, 4, 4, 4, 4, 4, 4, 4])
  }, 600_000)

  it('after the win screen B starts again at level one', () => {
    const m = new GameMachine()
    const ref = newGame()
    // Put the program at the last exit by playing, then hold B.
    m.runTo('PADRD')
    for (let f = 0; f < 3000 && ref.state === STATE.play; f++) {
      m.pad = up | b
      for (let i = 0; i < m.ram[GAME_CELLS.used]; i++) tick(ref, up | b)
      m.runTo('PADRD')
      renderGame(ref)
    }
    expect(m.ram[GAME_CELLS.state]).toBe(STATE.won)
    for (let f = 0; f < 200 && ref.state !== STATE.play; f++) {
      m.pad = b
      for (let i = 0; i < m.ram[GAME_CELLS.used]; i++) tick(ref, b)
      m.runTo('PADRD')
      compare(m, ref, `end screen ${f}`)
    }
    expect(ref.state).toBe(STATE.play)
    m.pad = 0
    for (let i = 0; i < m.ram[GAME_CELLS.used]; i++) tick(ref, 0)
    m.runTo('PADRD')
    compare(m, ref, 'new game')
    expect(m.ram[GAME_CELLS.level]).toBe(0)
  }, 600_000)

  it('the player dies when the enemies reach him: red and black stripes, and B starts again', () => {
    const m = new GameMachine()
    const ref = newGame()
    m.runTo('PADRD')
    let died = 0
    for (let f = 0; f < 3000; f++) {
      // Fire through levels one to three, open the first door of level four, then walk into the enemies without firing.
      const doors = ref.map.filter((v) => v === DOOR).length
      const pad = ref.state === STATE.dead ? (died++ > 4 ? b : 0) : ref.level < 3 || (ref.level === 3 && doors === 2) ? up | b : up
      m.pad = pad
      for (let i = 0; i < m.ram[GAME_CELLS.used]; i++) tick(ref, pad)
      m.runTo('PADRD')
      compare(m, ref, `picture ${f}`)
      if (ref.state === STATE.play && died) break
    }
    expect(died).toBeGreaterThan(0)
    expect(ref.state).toBe(STATE.play)
    expect(ref.level).toBe(0)
  }, 600_000)

  it('turns and strafes like the reference, and the door in front opens on B', () => {
    const m = new GameMachine()
    const ref = newGame()
    // Walk toward the door of level one, turn away, slide, back up, stand still.
    const script: [number, number][] = [[up, 25], [up | b, 6], [right, 4], [up | a | left, 5], [down, 4], [left, 6], [0, 3]]
    m.runTo('PADRD')
    for (const [pad, pictures] of script)
      for (let f = 0; f < pictures; f++) {
        m.pad = pad
        for (let i = 0; i < m.ram[GAME_CELLS.used]; i++) tick(ref, pad)
        m.runTo('PADRD')
        compare(m, ref, `pad ${pad} picture ${f}`)
      }
  }, 300_000)
})

async function engine() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
}

/** The game ROM on the game board in the Rust engine, without history, as the example runs it. */
export async function gameBoard() {
  const x = await engine()
  const source = doomSource(160, 'fill', true)
  const r = assemble6502(source, 0x4000, true)
  if (r.errors.length) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n'))
  const { b: builder, keys } = board6502Builder({ hz: 1_000_000, memory: 'big', chip: 'cmos', game: true, source, bankSources: [levelBankSource(), ART_BANK_SOURCE] })
  const sim = new Simulator()
  sim.setFast(true)
  sim.setHistory(false)
  sim.setWasm(openFor(x))
  sim.load(flatten(builder.build(false)))
  sim.settle()
  const cycles = () => (sim.state(keys.cpu) as CpuState).cpu.cycles
  const ram = () => (sim.state(keys.ram) as { mem: Uint8Array }).mem
  const frames = () => {
    const m = ram()
    return m[GAME_CELLS.frames] + 256 * m[GAME_CELLS.frames + 1]
  }
  const run = (n: number) => {
    const to = cycles() + n
    while (cycles() < to) sim.advance(0.1, performance.now() + 10000)
  }
  const pad = (keysHeld: number) => sim.setState(keys.gamepad, { keys: keysHeld })
  const picture = () => unpackColumns(Uint8Array.from((sim.state(keys.video) as VideoState).px), screenWidth(160))
  return { sim, keys, cycles, ram, frames, run, pad, picture, size: r.bytes.length }
}

describe('the game on the board', () => {
  it('draws what the reference draws, picture after picture, through the first level, its door and its exit', async () => {
    const g = await gameBoard()
    const ref = newGame()
    // Up and B held all the time: walk the corridor, open the door, walk on, press the exit switch.
    g.pad(up | b)
    const t0 = g.cycles()
    let pictures = 0
    for (let f = 0; f < 200 && ref.level === 0; f++) {
      while (g.frames() <= f) g.run(100)
      const m = g.ram()
      const ticks = m[GAME_CELLS.shownTicks]
      expect(ticks, `picture ${f}`).toBeGreaterThanOrEqual(1)
      expect(ticks).toBeLessThanOrEqual(MAX_TICKS)
      for (let i = 0; i < ticks; i++) tick(ref, up | b)
      pictures++
      if (ref.level !== 0) break
      expect(Array.from(m.slice(GAME_CELLS.shown, GAME_CELLS.shown + 5)), `picture ${f}: pose`).toEqual([ref.pose.xFrac, ref.pose.xCell, ref.pose.yFrac, ref.pose.yCell, ref.pose.angle])
      expect([m[GAME_CELLS.health], m[GAME_CELLS.ammo]], `picture ${f}: health and ammo`).toEqual([ref.health, ref.ammo])
      expect(Array.from(g.picture()), `picture ${f}: picture`).toEqual(Array.from(renderGame(ref)))
    }
    console.log(`board: ${Math.round((g.cycles() - t0) / pictures)} cycles a picture on average over ${pictures} pictures`)
    expect(ref.level).toBe(1)
    // The program loaded level two from bank 0: wait for its next picture, and look at the map in RAM.
    const f1 = g.frames()
    while (g.frames() <= f1 + 1) g.run(100)
    expect(Array.from(g.ram().slice(0x200, 0x300))).toEqual(LEVELS[1].map)
    expect(g.ram()[GAME_CELLS.level]).toBe(1)
  }, 600_000)
})
