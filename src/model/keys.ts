import type { Circuit } from './circuit'

/** The switches whose *Key* is this keyboard key (a digit from 1 to 9 or a letter, either case). */
export function keyedSwitches(c: Circuit, key: string): string[] {
  if (!/^[1-9A-Za-z]$/.test(key)) return []
  const k = key.toLowerCase()
  return Object.values(c.comps)
    .filter((x) => x.type === 'switch' && String(x.params.key ?? '').toLowerCase() === k)
    .map((x) => x.id)
}
