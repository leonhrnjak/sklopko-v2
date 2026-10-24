import { describe, expect, it } from 'vitest'
import { MAX_THUMB } from '../app/library'
import { EXAMPLES } from './examples'
import { exampleFiles, exampleIds } from './example-files'
import { deserialize, serialize } from './serialize'

describe('the files the build writes for the examples', () => {
  it('cover every example, and none is called "examples", which is the folder they live in', () => {
    expect(exampleIds()).toEqual(EXAMPLES.map((e) => e.id))
    expect(exampleIds()).not.toContain('examples')
    expect(exampleFiles('nope')).toBeUndefined()
  })

  it('open as the circuit the builder makes, with the wires as routed, and a thumbnail that fits the library', { timeout: 60000 }, () => {
    for (const ex of EXAMPLES) {
      const files = exampleFiles(ex.id)!
      const opened = deserialize(JSON.parse(files.json))
      const built = ex.build()
      // Same parts and same wires, every wire on the path the builder routed: opening needs no routing.
      expect(serialize(opened), ex.id).toEqual(serialize(built))
      expect(files.svg.length, ex.id).toBeLessThanOrEqual(MAX_THUMB)
    }
  })
})
