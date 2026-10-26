/**
 * The learning path as the main chunk knows it: how many steps there are (for the button's ring) and its addresses. Nothing else,
 * on purpose: `scripts/check-bundle.mjs` keeps the startup chunk under budget. The steps, their order, titles, lessons and checks
 * are in `steps/`, which load when the map or a step is opened; `path.test.ts` keeps the count in step with them.
 */

/** How many steps the path has. */
export const PATH_STEP_COUNT = 64

/** `/learn` is the map, `/learn/<id>` a step: a link a teacher can hand out. */
export const LEARN_ROOT = '/learn'

export const learnUrl = (step?: string | null) => (step ? `${LEARN_ROOT}/${step}` : LEARN_ROOT)

/** Is this address the path's? `step` is the id it names, if any (it may not exist: the map opens instead). */
export function learnFromPath(pathname: string): { step: string | null } | undefined {
  const m = /^\/learn(?:\/([^/]*))?\/?$/i.exec(pathname)
  return m ? { step: m[1]?.toLowerCase() || null } : undefined
}
