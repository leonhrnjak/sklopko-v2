import { getChallenge, type Challenge } from '../challenges'
import type { Circuit, ICDef } from '../circuit'
import { placedICs } from '../ic'
import { deserialize, serialize, type SavedCircuit } from '../serialize'
import type { BuildStep, Step } from './types'

/**
 * The kit: every build step with a `chip` turns the learner's passing circuit into a custom IC, and later steps that `use` it get
 * it. The kit is kept in `localStorage` under `sklopko.path.kit.v1` as `{ [stepId]: { name, circuit } }`.
 *
 * A kit circuit is stored with the chips it contains (a circuit that places an IC cannot be read without its definition), but when
 * a starting circuit is made, those are not used: the chips it contains are found by id (`kit:<stepId>`) in the kit, or, for a
 * chip the learner has not built, among our own, the reference chips. So a table never holds two versions of one chip, and a
 * chip the learner solves again reaches every chip made of it.
 */

export const KIT_KEY = 'sklopko.path.kit.v1'

export interface KitEntry {
  name: string
  circuit: SavedCircuit
}
export type Kit = Record<string, KitEntry>

/** The id of the IC that a step's chip is. */
export const chipId = (stepId: string) => `kit:${stepId}`
export const stepOfChip = (id: string) => (id.startsWith('kit:') ? id.slice(4) : undefined)

/** A stored value as a kit. An entry that is broken, or whose circuit does not read, is left out. */
export function parseKit(raw: unknown): Kit {
  const kit: Kit = {}
  if (!raw || typeof raw !== 'object') return kit
  for (const [id, e] of Object.entries(raw)) {
    const entry = e as Partial<KitEntry> | null
    if (!entry || typeof entry.name !== 'string' || !entry.name || !entry.circuit || typeof entry.circuit !== 'object') continue
    try {
      deserialize(entry.circuit)
    } catch {
      continue
    }
    kit[id] = { name: entry.name, circuit: entry.circuit }
  }
  return kit
}

/** The circuit as a chip's body: its parts and wires, not the table of ICs, tests or anything about where it was open. */
export const chipBody = (c: Circuit): Circuit => ({ comps: c.comps, wires: c.wires })

/** The ICs of a circuit's table that it places, and those they place. */
function neededICs(c: Circuit): Record<string, ICDef> {
  const out: Record<string, ICDef> = {}
  const visit = (circuit: Circuit) => {
    for (const id of placedICs(circuit)) {
      const def = c.ics?.[id]
      if (!def || out[id]) continue
      out[id] = def
      visit(def.circuit)
    }
  }
  visit(c)
  return out
}

/** What goes into the kit when a circuit passes a chip step. */
export const snapshot = (name: string, c: Circuit): KitEntry => {
  const ics = neededICs(c)
  return { name, circuit: serialize({ ...chipBody(c), ...(Object.keys(ics).length ? { ics } : {}) }) }
}

/** A kit entry as the IC it is (its body; the chips inside come from `chipTable`). */
export const defOf = (stepId: string, e: KitEntry): ICDef => ({ id: chipId(stepId), name: e.name, circuit: chipBody(deserialize(e.circuit)) })

// ---- The reference chips ----------------------------------------------------------------------------------

const steps = new Map<string, Step>()

/** The steps whose reference chips `referenceDef` can make. Called once, by `steps/index.ts`. */
export function registerSteps(all: readonly Step[]) {
  steps.clear()
  for (const s of all) steps.set(s.id, s)
}

export const chipStep = (id: string): (BuildStep & { chip: string }) | undefined => {
  const s = steps.get(id)
  return s && s.kind === 'build' && s.chip ? (s as BuildStep & { chip: string }) : undefined
}

/** The challenge a build step is checked against: one of the existing ones, or the one written for the step. */
export function challengeOf(s: BuildStep): Challenge {
  if (typeof s.challenge !== 'string') return s.challenge
  const ch = getChallenge(s.challenge)
  if (!ch) throw new Error(`Step ${s.id}: no challenge ${s.challenge}`)
  return ch
}

/** A circuit that solves the step, with the chips it uses in its table of ICs. */
export const solutionOf = (s: BuildStep): Circuit => (s.solution ? s.solution() : challengeOf(s).solution())

/** Our own chip for a step: the body of the step's reference solution. */
export function referenceDef(stepId: string): ICDef | undefined {
  const s = chipStep(stepId)
  return s ? { id: chipId(stepId), name: s.chip, circuit: chipBody(solutionOf(s)) } : undefined
}

/** The ids of the chips a circuit places directly. */
const placedChipSteps = (c: Circuit) => placedICs(c).flatMap((id) => stepOfChip(id) ?? [])

/**
 * The table of ICs for a circuit that uses these chips: each from the kit when the learner has built it, else ours, and every
 * chip those contain. A chip nobody can make is left out.
 */
export function chipTable(uses: readonly string[], kit: Kit): Record<string, ICDef> {
  const table: Record<string, ICDef> = {}
  const add = (stepId: string) => {
    if (table[chipId(stepId)]) return
    const e = kit[stepId]
    const def = e ? defOf(stepId, e) : referenceDef(stepId)
    if (!def) return
    table[def.id] = def
    for (const inner of placedChipSteps(def.circuit)) add(inner)
  }
  for (const id of uses) add(id)
  return table
}

/** The ids of the steps in `uses` whose chips the learner has not built: the circuit has ours. */
export const notBuilt = (uses: readonly string[], kit: Kit) => uses.filter((id) => !kit[id])

/**
 * A circuit with the chips in its table brought up to date: each chip of the kit replaces whatever version the table had. A
 * circuit made before the learner built a chip (so it holds ours) gets theirs, since the pins are the same.
 */
export function refreshChips(c: Circuit, uses: readonly string[], kit: Kit): Circuit {
  if (!uses.length) return c
  return { ...c, ics: { ...c.ics, ...chipTable(uses, kit) } }
}
