import { GAMEPAD_BUTTONS } from '../engine/components/devices'
import type { Simulator } from '../engine/simulator'

/** The button a keyboard key presses, by bit number (letters in lower case), or -1. */
export function buttonOfKey(key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key
  return GAMEPAD_BUTTONS.findIndex((b) => (b.keys as readonly string[]).includes(k))
}

/**
 * Let the keyboard press the gamepad while the page has one: the arrow keys or W A S D for the direction pad, Z and X for
 * A and B. The keys are only taken (so the page does not scroll) when a gamepad is in the circuit and nothing is being typed.
 */
export function installGamepadKeys(sim: Simulator, target: Window = window) {
  let held = 0
  const apply = () => {
    for (const id of sim.idsOfType('gamepad')) sim.setState(id, { keys: held })
  }
  const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, select, textarea, [contenteditable="true"]')
  target.addEventListener('keydown', (e) => {
    const bit = buttonOfKey(e.key)
    if (bit < 0 || e.metaKey || e.ctrlKey || e.altKey || typing(e) || !sim.idsOfType('gamepad').length) return
    e.preventDefault()
    held |= 1 << bit
    apply()
  })
  target.addEventListener('keyup', (e) => {
    const bit = buttonOfKey(e.key)
    if (bit < 0 || !(held & (1 << bit))) return
    held &= ~(1 << bit)
    apply()
  })
  // Keys let go while the page is not looking would stay held for ever.
  target.addEventListener('blur', () => {
    held = 0
    apply()
  })
}
