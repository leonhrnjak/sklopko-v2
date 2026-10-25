import { aciaBreak, aciaKey, aciaType, type AciaState } from '../engine/acia'
import { sim } from './sim'
import { useStore } from './store'

/**
 * What typing on the terminal does, apart from the page: the keys that are not characters, the text that arrives with an `input`
 * event (a phone's on-screen keyboard sends no usable `keydown`), and a paste. They put the codes into the part's keyboard buffer
 * (`acia.ts`); the chip delivers them one at a time, as the program reads them.
 */

/** The part of a keyboard event the terminal looks at. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** Capitals is a setting of the part (on by default, and Microsoft BASIC knows its words only in capitals). */
export const capitalsOn = (id: string) => useStore.getState().circuit.comps[id]?.params.capitals !== false

/** A key that is not a character. Returns true if it was taken (the page must not act on it as well). */
export function terminalKey(st: AciaState, e: KeyLike): boolean {
  if (e.metaKey || e.altKey) return false
  if (e.ctrlKey) {
    // Control+C is the break; the other combinations (Control+V pastes) are left to the browser.
    if (e.key.toLowerCase() !== 'c') return false
    aciaBreak(st)
    return true
  }
  switch (e.key) {
    case 'Enter':
      aciaKey(st, 13)
      return true
    case 'Backspace':
      aciaKey(st, 8)
      return true
    case 'Delete':
      aciaKey(st, 127)
      return true
    case 'Escape':
      aciaBreak(st)
      return true
    default:
      return false // letters arrive as input events; Tab leaves the terminal
  }
}

/** Text from an `input` event: typed characters (a phone sends them this way), a line break, or a Backspace that had no `keydown`. */
export function terminalInput(st: AciaState, text: string, inputType: string, capitals: boolean) {
  if (inputType === 'deleteContentBackward') aciaKey(st, 8)
  else aciaType(st, text, capitals)
}

const stateOf = (id: string) => sim.state(id) as AciaState | undefined

/** The terminal's hidden text box for this part, if it is on the page. */
const boxOf = (id: string) => document.querySelector<HTMLTextAreaElement>(`textarea[data-terminal-input="${id}"]`)

/**
 * Send the keyboard's focus to the terminal (a click on its screen), so that what is typed goes to it. After a touch the browser
 * sends its mouse events once the finger is up, and the mouse-down among them moves the focus away again: so a touch waits for the
 * click that ends them (and gives up if none comes), which is still inside the tap, so a phone opens its keyboard.
 */
export function focusTerminal(id: string, touch = false) {
  const focus = () => boxOf(id)?.focus({ preventScroll: true })
  if (!touch) return focus()
  const go = () => {
    window.clearTimeout(giveUp)
    focus()
  }
  const giveUp = window.setTimeout(() => window.removeEventListener('click', go), 600)
  window.addEventListener('click', go, { once: true })
}

export function keyOnTerminal(id: string, e: KeyLike): boolean {
  const st = stateOf(id)
  return !!st && terminalKey(st, e)
}

export function inputOnTerminal(id: string, text: string, inputType: string) {
  const st = stateOf(id)
  if (st) terminalInput(st, text, inputType, capitalsOn(id))
}

/** Text typed or pasted into the box in the inspector, or pasted on the screen. Returns how many characters were taken. */
export function typeOnTerminal(id: string, text: string): number {
  const st = stateOf(id)
  return st ? aciaType(st, text, capitalsOn(id)) : 0
}

export function breakOnTerminal(id: string) {
  const st = stateOf(id)
  if (st) aciaBreak(st)
}
