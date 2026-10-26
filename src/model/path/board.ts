import type { Circuit } from '../circuit'
import { labelled } from './goals'

/** The circuit with every wire that touches one of the parts labelled in `labels` taken off: the parts stay where they are, for the learner to wire. */
export function cutWires(c: Circuit, labels: readonly string[]): Circuit {
  const ids = new Set(labels.map((l) => labelled(c, l)?.id).filter((id): id is string => !!id))
  return { ...c, wires: Object.fromEntries(Object.entries(c.wires).filter(([, w]) => !ids.has(w.from.comp) && !ids.has(w.to.comp))) }
}
