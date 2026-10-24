import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { flatten } from './buses'
import { EXAMPLES } from './examples'

/**
 * The simulator's behaviour, pinned for every example: a fingerprint of every net after each of the first ticks, and after
 * each of a few stretches of simulated time. Changing how the simulator schedules its work must not change any of them.
 * To rebuild the file after a change that is meant to change behaviour: `npx vitest run src/model/sim-golden -u`.
 */

/** FNV-1a over the nets, with the tick count, as a short string. */
function fingerprint(sim: Simulator): string {
  const values = (sim as unknown as { values: Uint8Array }).values
  let h = 0x811c9dc5
  for (let i = 0; i < values.length; i++) h = Math.imul(h ^ values[i], 0x01000193)
  h = Math.imul(h ^ sim.ticks, 0x01000193)
  return (h >>> 0).toString(16)
}

function run(build: () => ReturnType<(typeof EXAMPLES)[number]['build']>): string[] {
  const sim = new Simulator()
  sim.load(flatten(build()))
  const out: string[] = []
  for (let i = 0; i < 40; i++) {
    sim.tick()
    out.push(fingerprint(sim))
  }
  sim.settle()
  out.push(fingerprint(sim))
  for (let i = 0; i < 4; i++) {
    sim.advance(25)
    sim.settle()
    out.push(fingerprint(sim))
  }
  sim.reset()
  sim.settle()
  out.push(fingerprint(sim))
  return out
}

describe('simulator fingerprints', () => {
  it('are what they were for every example', { timeout: 120000 }, async () => {
    const found: Record<string, string[]> = {}
    for (const ex of EXAMPLES) found[ex.id] = run(ex.build)
    const text = '{\n' + Object.entries(found).map(([id, f]) => `${JSON.stringify(id)}:${JSON.stringify(f)}`).join(',\n') + '\n}\n'
    await expect(text).toMatchFileSnapshot('./sim-golden.json')
  })
})
