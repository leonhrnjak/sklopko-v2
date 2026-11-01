import { GAMEPAD_BUTTONS } from '../engine/components/devices'
import type { SimApi } from './sim'

/** The button a keyboard key presses, by bit number (letters in lower case), or -1. */
export function buttonOfKey(key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key
  return GAMEPAD_BUTTONS.findIndex((b) => (b.keys as readonly string[]).includes(k))
}

/**
 * Let the keyboard press the gamepad while the page has one: the arrow keys or W A S D for the direction pad, Z and X (or the space bar for B) for
 * A and B. A key tapped for less than `minHoldMs` stays down until that time is up, because a slow program may look at the pad
 * only now and then. The keys are only taken (so the page does not scroll) when a gamepad is in the circuit and nothing is being typed.
 */
export function installGamepadKeys(sim: Pick<SimApi, 'idsOfType' | 'setState'>, target: Window = window, minHoldMs = 0) {
  let held = 0
  const pressedAt: number[] = []
  const release = new Map<number, ReturnType<typeof setTimeout>>()
  const apply = () => {
    for (const id of sim.idsOfType('gamepad')) sim.setState(id, { keys: held })
  }
  const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, select, textarea, [contenteditable="true"]')
  target.addEventListener('keydown', (e) => {
    const bit = buttonOfKey(e.key)
    if (bit < 0 || e.metaKey || e.ctrlKey || e.altKey || typing(e) || !sim.idsOfType('gamepad').length) return
    e.preventDefault()
    // A new press cancels a release that was waiting for the minimum time.
    const pending = release.get(bit)
    if (pending !== undefined) clearTimeout(pending)
    release.delete(bit)
    if (!(held & (1 << bit))) pressedAt[bit] = Date.now()
    held |= 1 << bit
    apply()
  })
  target.addEventListener('keyup', (e) => {
    const bit = buttonOfKey(e.key)
    if (bit < 0 || !(held & (1 << bit))) return
    const letGo = () => {
      release.delete(bit)
      held &= ~(1 << bit)
      apply()
    }
    // A slow program looks at the pad only now and then; a short tap is kept down long enough to be seen.
    const wait = minHoldMs - (Date.now() - pressedAt[bit])
    if (wait > 0) release.set(bit, setTimeout(letGo, wait))
    else letGo()
  })
  // Keys let go while the page is not looking would stay held for ever.
  target.addEventListener('blur', () => {
    for (const t of release.values()) clearTimeout(t)
    release.clear()
    held = 0
    apply()
  })
}
