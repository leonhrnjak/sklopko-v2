import { EXAMPLES } from './examples'
import { serialize } from './serialize'
import { thumbnailSvg } from './thumbnail'

/**
 * What the build writes for each example, as `examples/<id>.json` (the saved circuit with its routed wires, so opening it needs
 * no routing) and `examples/<id>.svg` (its thumbnail). Built from the same builders the unit tests use.
 */
export interface ExampleFiles {
  json: string
  svg: string
}

export const exampleIds = (): string[] => EXAMPLES.map((e) => e.id)

export function exampleFiles(id: string): ExampleFiles | undefined {
  const ex = EXAMPLES.find((e) => e.id === id)
  if (!ex) return undefined
  const circuit = ex.build()
  return { json: JSON.stringify(serialize(circuit)), svg: thumbnailSvg(circuit) }
}
