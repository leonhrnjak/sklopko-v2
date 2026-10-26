import type { Challenge } from '../../model/challenges'

/** The rules as a sentence, or nothing. */
export function rulesText(ch: Challenge): string | null {
  if (!ch.rules) return null
  const parts: string[] = []
  if (ch.rules.only) parts.push(`Only these gates: ${ch.rules.only.map((t) => t.toUpperCase()).join(', ')}.`)
  if (ch.rules.maxParts) parts.push(`At most ${ch.rules.maxParts} gate${ch.rules.maxParts === 1 ? '' : 's'}.`)
  return parts.join(' ')
}
