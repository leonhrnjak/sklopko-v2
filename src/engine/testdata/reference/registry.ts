import { getDef as realDef, hasDef } from '../../registry'
import type { ComponentDef } from '../../types'
import { nbit } from './nbit'
import { arithmetic, coding, memoryRom, routing } from './combinational'
import { gates } from './gates'
import { sequential, memoryRam } from './sequential'

/**
 * The part definitions as they were before the speed work (tier 1 in docs/spec-sim-speed-tier1.md): the behaviour of these parts is
 * frozen here, and the current registry's pins, layouts and bus modes are kept. `reference-lockstep.test.ts` checks the real
 * simulator against `ReferenceSimulator` with these.
 */
const frozen = new Map<string, ComponentDef>([...gates, ...sequential, ...memoryRam, ...arithmetic, ...memoryRom, ...routing, ...coding, ...nbit].map((d) => [d.type, d]))

export function getDef(type: string): ComponentDef {
  const d = realDef(type)
  const f = frozen.get(type)
  return f ? { ...d, evaluate: f.evaluate, init: f.init } : d
}
export { hasDef }
