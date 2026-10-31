import { annotation } from './components/annotation'
import { withBusModes } from './busmodes'
import { withTiming } from './timing'
import { buses } from './components/buses'
import { cpus } from './components/cpu'
import { arithmetic, coding, memoryRom, routing } from './components/combinational'
import { devices } from './components/devices'
import { terminals } from './components/terminal'
import { lcds } from './components/lcd'
import { vias } from './components/via'
import { gates } from './components/gates'
import { ic } from './components/ic'
import { tristate } from './components/tristate'
import { breakpoint, display, io, probe } from './components/io'
import { nbit } from './components/nbit'
import { memoryRam, sequential } from './components/sequential'
import type { Category, ComponentDef } from './types'

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'io', name: 'Input / output' },
  { id: 'gates', name: 'Logic gates' },
  { id: 'sequential', name: 'Flip-flops & counters' },
  { id: 'arithmetic', name: 'Arithmetic' },
  { id: 'memory', name: 'Memory' },
  { id: 'cpu', name: 'Processors' },
  { id: 'routing', name: 'Multiplexers' },
  { id: 'buses', name: 'Buses' },
  { id: 'coding', name: 'Encoders & decoders' },
  { id: 'display', name: 'Displays' },
  { id: 'annotation', name: 'Notes & frames' },
]

export const DEFS: ComponentDef[] = withTiming(withBusModes([
  ...io,
  probe,
  breakpoint,
  ...gates,
  ...sequential,
  ...arithmetic,
  ...memoryRom,
  ...memoryRam,
  ...routing,
  ...tristate,
  ...buses,
  ...nbit,
  ...coding,
  ...display,
  ...ic,
  ...cpus,
  ...devices,
  ...terminals,
  ...vias,
  ...lcds,
  ...annotation,
]))

const byType = new Map(DEFS.map((d) => [d.type, d]))

export function getDef(type: string): ComponentDef {
  const d = byType.get(type)
  if (!d) throw new Error(`Unknown component type: ${type}`)
  return d
}

export const hasDef = (type: string) => byType.has(type)
