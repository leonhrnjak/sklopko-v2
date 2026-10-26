import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * How many steps the learning path has, counted from the chapter files (`src/model/path/steps/ch*.ts`) at build time: a step is a
 * line `    id: '...'` at the indent of a step object. It is injected as `__PATH_STEP_COUNT__` (see `vite.config.ts`), so the main
 * chunk knows the number without loading the steps, and nobody has to keep it in step by hand; `path.test.ts` checks it against
 * the real `STEPS`.
 */
export function pathStepCount(stepsDir: string): number {
  return readdirSync(stepsDir)
    .filter((f) => /^ch\d+\.ts$/.test(f))
    .reduce((n, f) => n + (readFileSync(join(stepsDir, f), 'utf8').match(/^ {4}id: '/gm)?.length ?? 0), 0)
}
