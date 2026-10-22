import { annotation } from './components/annotation'
import { arithmetic, coding, memoryRom, routing } from './components/combinational'
import { gates } from './components/gates'
import { breakpoint, display, io, probe } from './components/io'
import { memoryRam, sequential } from './components/sequential'
import type { Category, ComponentDef } from './types'

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'io', name: 'Input / output' },
  { id: 'gates', name: 'Logic gates' },
  { id: 'sequential', name: 'Flip-flops & counters' },
  { id: 'arithmetic', name: 'Arithmetic' },
  { id: 'memory', name: 'Memory' },
  { id: 'routing', name: 'Multiplexers' },
  { id: 'coding', name: 'Encoders & decoders' },
  { id: 'display', name: 'Displays' },
  { id: 'annotation', name: 'Notes & frames' },
]

export const DEFS: ComponentDef[] = [...io, probe, breakpoint, ...gates, ...sequential, ...arithmetic, ...memoryRom, ...memoryRam, ...routing, ...coding, ...display, ...annotation]

const byType = new Map(DEFS.map((d) => [d.type, d]))

export function getDef(type: string): ComponentDef {
  const d = byType.get(type)
  if (!d) throw new Error(`Unknown component type: ${type}`)
  return d
}

export const hasDef = (type: string) => byType.has(type)
