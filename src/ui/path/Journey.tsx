import { usePath } from '../../app/path'
import { useKit } from '../../app/pathKit'
import { startStep } from '../../app/pathWork'
import { CHAPTERS } from '../../model/path/chapters'
import { isDone } from '../../model/path/progress'
import { STEPS, stepsOf } from '../../model/path/steps'
import { chapterNumber } from './numbers'

/** The end of the path: every chip the learner built, and how far they got in each chapter. Nothing here is a score: it is what they made. */
export function Journey() {
  const progress = usePath((s) => s.progress)
  const kit = useKit((s) => s.kit)
  const chips = Object.entries(kit).map(([id, e]) => ({ id, name: e.name }))
  const done = STEPS.filter((s) => isDone(progress, s.id))
  const programs = done.filter((s) => s.kind === 'program').length
  const solved = done.filter((s) => progress.done[s.id].how === 'solved').length
  return (
    <div className="journey" data-testid="journey">
      <p className="step-lesson">
        You have done <b>{done.length}</b> of the {STEPS.length} steps ({solved} solved by yourself, {done.length - solved} read or shown), and written <b>{programs}</b> program{programs === 1 ? '' : 's'}.
      </p>
      <ul className="goals">
        {CHAPTERS.map((c) => {
          const ids = stepsOf(c.id)
          const n = ids.filter((s) => isDone(progress, s.id)).length
          const next = ids.find((s) => !isDone(progress, s.id))
          return (
            <li key={c.id} className={n === ids.length && ids.length ? 'goal on' : 'goal'}>
              <span aria-hidden>{n === ids.length && ids.length ? '✔' : n ? '◕' : '○'}</span> {chapterNumber(c.id)} {c.title} <small>{n}/{ids.length}</small>
              {next && (
                <>
                  {' '}
                  <button className="link-button inline" onClick={() => startStep(next.id)}>
                    {n ? 'Continue' : 'Start'} →
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <p className="step-lesson">
        {chips.length ? (
          <>
            Your kit holds <b>{chips.length}</b> chips that you built: {chips.map((c) => c.name).join(', ')}.
          </>
        ) : (
          'Your kit is empty: the chips of the steps you built are kept there.'
        )}
      </p>
    </div>
  )
}
