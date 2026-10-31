import { keypadCodeOfKey } from '../engine/components/devices'
import type { SimApi } from './sim'
import { buttonOfKey } from './gamepad'
import { useStore } from './store'

/**
 * Let the keyboard press the keypad while the page has one: digits and A–F on a hex keypad; digits, + - * / = (or Enter) and C on
 * the calculator keypad. A key is only taken when nothing is being typed, and the letters A–F are left to the editor's shortcuts
 * (F flips a selected part) while something is selected, and to a gamepad if there is one.
 */
export function installKeypadKeys(sim: Pick<SimApi, 'idsOfType' | 'setState'>, target: Window = window) {
  let down: string | null = null
  const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, select, textarea, [contenteditable="true"]')
  const press = (e: KeyboardEvent, on: boolean) => {
    const pads = sim.idsOfType('keypad')
    if (!pads.length || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return false
    const { circuit, selection } = useStore.getState()
    let used = false
    for (const id of pads) {
      const code = keypadCodeOfKey(String(circuit.comps[id]?.params.layout ?? 'hex'), e.key)
      if (code === undefined) continue
      // A letter that is also a shortcut or a gamepad button stays that.
      if (/^[a-z]$/i.test(e.key) && (selection.length > 0 || (sim.idsOfType('gamepad').length > 0 && buttonOfKey(e.key) >= 0))) continue
      sim.setState(id, on ? { pressed: true, tapped: true, key: code } : { pressed: false })
      used = true
    }
    return used
  }
  target.addEventListener('keydown', (e) => {
    if (e.repeat) return
    if (press(e, true)) {
      down = e.key
      e.preventDefault()
    }
  })
  target.addEventListener('keyup', (e) => {
    if (down === e.key) {
      down = null
      press(e, false)
    }
  })
  target.addEventListener('blur', () => {
    if (down === null) return
    down = null
    for (const id of sim.idsOfType('keypad')) sim.setState(id, { pressed: false })
  })
}
