import { useEffect } from 'react'
import { closeReference, setReferenceTab, useReference, type ReferenceDoomTab } from '../app/reference'

const TABS: [ReferenceDoomTab, string][] = [
  ['play', 'Playing'],
  ['machine', 'The machine'],
]

function Play() {
  return (
    <div className="ref-text">
      <p>
        Open the example <b>Doom-like</b> (Examples → Doom-like). A 6502 draws a 3D view of a corridor, 160 columns wide, by casting a ray for every column. Click the
        gamepad once so the keys go to it, or use the buttons on the gamepad itself (a touch screen can press them).
      </p>
      <h3>Controls</h3>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Button</th>
              <th>Keys</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>▲ ▼</td><td>↑ ↓ or W S</td><td>Walk forward and back.</td></tr>
            <tr><td>◀ ▶</td><td>← → or A D</td><td>Turn. With button A held, step sideways instead.</td></tr>
            <tr><td>A</td><td>Z</td><td>Strafe (with ◀ ▶).</td></tr>
            <tr><td>B</td><td>X</td><td>Opens the door in front of you, presses the exit switch (the cyan wall at the end of a level), and otherwise fires the gun.</td></tr>
          </tbody>
        </table>
      </div>
      <h3>The game</h3>
      <ul>
        <li>Five levels. Press the cyan exit switch at the end of a level to start the next; a new level adds 40 health (at most 100) and refills the ammunition (50).</li>
        <li>Two kinds of monster: a <b>patrol</b> (two hits) walks up and down its corridor, a <b>chaser</b> (three hits) follows you once you are within ten cells. A touch costs 5 or 10 health, and the monster then waits a moment.</li>
        <li>The gun fires about three shots a second at the monster in the middle of the view (the white mark), unless a wall or a closed door is nearer.</li>
        <li>The strip at the bottom shows health (green, red when low), ammunition (yellow) and a light for each level. The face shows how hurt you are and winces when you are hit.</li>
        <li>At zero health the screen turns red and black; after the last exit it turns yellow and green. B starts again.</li>
      </ul>
      <h3>Speed, and phones</h3>
      <p>
        A picture takes about 100,000 to 150,000 cycles of the 6502, so at its real 1 MHz the game draws <b>8 to 9 pictures a second</b> (5 at worst, face to face with a
        monster). Walking speed does not depend on that: a 60 Hz timer interrupt counts the time, and each picture catches up on the ticks it missed. On a phone or a
        slow computer the simulation may not keep 1 MHz; the game then runs in slow motion, and stays correct.
      </p>
    </div>
  )
}

function Machine() {
  return (
    <div className="ref-text">
      <p>The board is a <code>cpu6502</code> in 65C02 mode at 1 MHz, and every part of it is in the circuit. The program is 65C02 assembly (<code>src/model/doom/</code>).</p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>What is there</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>$0000–$3FFF</code></td><td>RAM (the map is copied to <code>$0200</code>, so a door can open).</td></tr>
            <tr><td><code>$4000–$400F</code></td><td>The video chip: a 160 × 100, 16-colour picture, written through an auto-incrementing port; it can also fill a whole wall column in one command.</td></tr>
            <tr><td><code>$5000</code></td><td>The gamepad register (read): up 1, down 2, left 4, right 8, A 16, B 32.</td></tr>
            <tr><td><code>$5001</code></td><td>The ROM bank latch (write; bit 0 picks which ROM is seen at <code>$8000</code>).</td></tr>
            <tr><td><code>$6000</code></td><td>The 6522 VIA: timer 1 interrupts 60 times a second, the game’s clock.</td></tr>
            <tr><td><code>$8000–$BFFF</code></td><td>Banked ROM: bank 0 the five maps and monsters, bank 1 the sprites’ art.</td></tr>
            <tr><td><code>$C000–$FFFF</code></td><td>Fixed ROM: the engine, the tables, the face and the gun, the vectors.</td></tr>
          </tbody>
        </table>
      </div>
      <h3>How a picture is made</h3>
      <ol>
        <li>The program waits for the timer, then runs the game’s rules once for each tick that has passed (at most 12): walking, doors, monsters, the gun.</li>
        <li>It projects each monster (its distance, its column, its size) and sorts them far to near.</li>
        <li>For each of 160 columns it casts a ray through the map, works out the wall’s height and shade, and fills the column with one video command. Straight after, it draws the parts of monsters that are nearer than the wall in that column, the crosshair, the gun, the face and the HUD. The video chip has one buffer, so everything of a column is drawn together; drawing the sprites after all the walls would make them flicker.</li>
      </ol>
      <p>
        Everything is checked against a TypeScript renderer: the tests play the five levels on the program and compare all 16,000 pixels after every picture. There are no
        textures (the frame rate would drop under 8 a second) and the five levels share one floor plan, turned and furnished five ways. The code and the numbers are in
        <code> docs/plan-doom-like.md</code>.
      </p>
    </div>
  )
}

/** The guide to the Doom-like example: how to play it, and the board and program behind it. */
export function ReferenceDoom() {
  const open = useReference((s) => s.open && s.language === 'doom')
  const tab = useReference((s) => s.tab as ReferenceDoomTab)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeReference()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeReference()}>
      <div className="modal ref" role="dialog" aria-modal="true" aria-label="Doom-like guide">
        <header className="modal-head">
          <strong>Doom-like guide</strong>
          <div className="seg" role="tablist" aria-label="Reference sections">
            {TABS.map(([id, name]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setReferenceTab(id)}>
                {name}
              </button>
            ))}
          </div>
          <button className="modal-close" onClick={closeReference} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{tab === 'machine' ? <Machine /> : <Play />}</div>
      </div>
    </div>
  )
}
