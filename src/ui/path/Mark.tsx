import type { How } from '../../model/path/progress'

/** ✔ done, ◐ done with the solution shown. */
export function Mark({ how }: { how: How }) {
  return how === 'shown' ? <span aria-label="Solution shown">◐</span> : <span aria-label="Done">✔</span>
}
