import { RECV, SEND } from '../engine/netlabels'
import type { Circuit } from './circuit'

export const isLabel = (type: string) => type === SEND || type === RECV

/** The Send and Receive labels that share a name (none for an empty name). */
export function labelsNamed(c: Circuit, name: string): { sends: string[]; recvs: string[] } {
  const sends: string[] = []
  const recvs: string[] = []
  if (name)
    for (const k of Object.values(c.comps)) {
      if (k.params.name !== name) continue
      if (k.type === SEND) sends.push(k.id)
      else if (k.type === RECV) recvs.push(k.id)
    }
  return { sends, recvs }
}

/** Every name in use by some label, sorted; for suggestions while naming a new one. */
export function labelNames(c: Circuit): string[] {
  const names = new Set<string>()
  for (const k of Object.values(c.comps)) if (isLabel(k.type) && k.params.name) names.add(String(k.params.name))
  return [...names].sort()
}

/** The probes of each group, in circuit order. */
export function probeGroups(c: Circuit): Map<string, Circuit['comps'][string][]> {
  const groups = new Map<string, Circuit['comps'][string][]>()
  for (const k of Object.values(c.comps)) {
    const name = k.type === 'probe' ? String(k.params.group ?? '') : ''
    if (name) groups.set(name, [...(groups.get(name) ?? []), k])
  }
  return groups
}
