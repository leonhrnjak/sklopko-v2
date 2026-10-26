import { create } from 'zustand'
import { KIT_KEY, parseKit, type Kit, type KitEntry } from '../model/path/chips'

/**
 * The learner's kit: the passing circuit of every chip step they have solved (or been shown), kept in this browser. It is a few tens
 * of kB, so it is read when the map or a step is first opened, not at startup. See `model/path/chips.ts`.
 */

function loadKit(): Kit {
  try {
    return parseKit(JSON.parse(localStorage.getItem(KIT_KEY) ?? 'null'))
  } catch {
    // Storage unavailable or corrupt: an empty kit, and the steps use our chips.
    return {}
  }
}

export const useKit = create<{ kit: Kit }>(() => ({ kit: loadKit() }))

function save(kit: Kit) {
  useKit.setState({ kit })
  try {
    localStorage.setItem(KIT_KEY, JSON.stringify(kit))
  } catch {
    // Not remembered after a reload.
  }
}

/** Put a step's chip into the kit; a chip already there for that step is replaced. */
export const putChip = (stepId: string, entry: KitEntry) => save({ ...useKit.getState().kit, [stepId]: entry })

/** Add chips (from a backup) to the kit. */
export const addChips = (chips: Kit) => save({ ...useKit.getState().kit, ...chips })

export function clearKit() {
  useKit.setState({ kit: {} })
  try {
    localStorage.removeItem(KIT_KEY)
  } catch {
    // Nothing stored anyway.
  }
}
