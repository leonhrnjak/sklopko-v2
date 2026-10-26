import { useEffect, useState } from 'react'
import { closeMap, usePath } from '../../app/path'
import { forgetAll, startStep } from '../../app/pathWork'
import { useKit } from '../../app/pathKit'
import { CHAPTERS } from '../../model/path/chapters'
import { countDone, type Progress } from '../../model/path/progress'
import { PATH_STEPS, getStep, recommended, stepIdsOf, stepsOf } from '../../model/path/steps'
import type { Step, StepKind } from '../../model/path/types'
import { Mark } from './Mark'
import { numberOf } from './numbers'

const KIND: Record<StepKind, { icon: string; word: string }> = {
  read: { icon: '📖', word: 'Read' },
  explore: { icon: '🔍', word: 'Explore' },
  build: { icon: '🔧', word: 'Build' },
  project: { icon: '🏗', word: 'Project' },
  program: { icon: '⌨', word: 'Program' },
}

/** A chapter's state: done, in progress, or not started (or coming, when it has no steps yet). */
function chapterState(id: string, p: Progress): { done: number; total: number; mark: string } {
  const ids = stepIdsOf(id)
  const done = countDone(p, ids)
  const mark = ids.length === 0 ? '·' : done === ids.length ? '✔' : done > 0 ? '◕' : '○'
  return { done, total: ids.length, mark }
}

function StepRow({ step, progress, next, onOpen }: { step: Step; progress: Progress; next: boolean; onOpen: () => void }) {
  const done = progress.done[step.id]
  const kind = KIND[step.kind]
  return (
    <li>
      <button className={`learn-step${next ? ' next' : ''}`} onClick={onOpen} data-testid={`learn-step-${step.id}`}>
        <span className="learn-mark" aria-hidden={!done}>
          {done ? <Mark how={done.how} /> : next ? '●' : '○'}
        </span>
        <span className="learn-kind" title={kind.word} aria-label={kind.word}>
          {kind.icon}
        </span>
        <span className="what">
          <b>
            {numberOf(step)} {step.title}
            {done?.star && ' ⭐'}
            {next && <span className="learn-next-tag"> ← next</span>}
          </b>
          <small>{step.summary}</small>
        </span>
        {step.kind === 'build' && step.chip && <span className="learn-chip">chip: {step.chip}</span>}
      </button>
    </li>
  )
}

/** The map of the learning path: the chapters, the steps of the chosen chapter as a track, and the learner's kit. */
export function PathMap() {
  const open = usePath((s) => s.mapOpen)
  return open ? <MapView /> : null
}

function MapView() {
  const progress = usePath((s) => s.progress)
  const kit = useKit((s) => s.kit)
  const next = recommended(progress)
  const [picked, setPicked] = useState<string | null>(null)
  const [sure, setSure] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeMap()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const nextStepInfo = next ? getStep(next) : undefined
  const chapterId = picked ?? (nextStepInfo?.chapter ?? CHAPTERS[0].id)
  const chapter = CHAPTERS.find((c) => c.id === chapterId) ?? CHAPTERS[0]
  const steps = stepsOf(chapter.id)
  const done = countDone(progress, PATH_STEPS)
  const chips = PATH_STEPS.flatMap((id) => (kit[id] ? [{ id, name: kit[id].name, shown: progress.done[id]?.how === 'shown' }] : []))
  const any = done > 0 || chips.length > 0
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeMap()}>
      <div className="modal learn" role="dialog" aria-modal="true" aria-label="Learn">
        <header className="modal-head">
          <strong>
            Learn <span className="learn-sub">From NAND to a computer</span>
          </strong>
          <span className="challenge-count" data-testid="learn-count">
            {done} of {PATH_STEPS.length} steps
          </span>
          <progress className="learn-bar" max={PATH_STEPS.length} value={done} aria-label="Steps done" />
          <button className="modal-close" onClick={closeMap} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="learn-continue">
          {nextStepInfo ? (
            <button className="primary-action" onClick={() => startStep(nextStepInfo.id)} data-testid="learn-continue">
              {done > 0 ? 'Continue' : 'Start'}: {numberOf(nextStepInfo)} {nextStepInfo.title} →
            </button>
          ) : (
            <p className="verdict good">You have done every step there is so far. More chapters are on their way.</p>
          )}
        </div>
        <div className="learn-body">
          <nav className="learn-chapters" aria-label="Chapters">
            {CHAPTERS.map((c, i) => {
              const st = chapterState(c.id, progress)
              return (
                <button
                  key={c.id}
                  className={`learn-chapter${c.id === chapter.id ? ' current' : ''}${st.total === 0 ? ' soon' : ''}`}
                  onClick={() => setPicked(c.id)}
                  aria-current={c.id === chapter.id}
                  data-testid={`learn-chapter-${c.id}`}
                >
                  <span className="learn-mark">{st.mark}</span>
                  <span className="learn-chapter-name">
                    {i + 1} {c.title}
                  </span>
                  <span className="learn-chapter-count">{st.total ? `${st.done}/${st.total}` : 'soon'}</span>
                </button>
              )
            })}
          </nav>
          <section className="learn-track" aria-label={chapter.title}>
            <h3>
              {CHAPTERS.indexOf(chapter) + 1} {chapter.title}
            </h3>
            <p className="learn-blurb">{chapter.blurb}</p>
            {steps.length ? (
              <ul>
                {steps.map((s) => (
                  <StepRow key={s.id} step={s} progress={progress} next={s.id === next} onOpen={() => startStep(s.id)} />
                ))}
              </ul>
            ) : (
              <p className="learn-soon">This chapter is not written yet. It comes with a later update.</p>
            )}
          </section>
        </div>
        <footer className="learn-kit">
          <div className="learn-kit-row">
            <strong>Your kit</strong>
            {chips.length ? (
              chips.map((c) => (
                <span key={c.id} className="chipicon small" title={c.shown ? `${c.name}: the solution was shown` : `${c.name}: built by you`} data-testid="kit-chip">
                  {c.name}
                  {c.shown && '◐'}
                </span>
              ))
            ) : (
              <span className="learn-muted">Empty. Every gate you build goes here.</span>
            )}
            <span className="learn-muted">{chips.length ? `· ${chips.length} chip${chips.length === 1 ? '' : 's'}` : ''}</span>
          </div>
          {any && (
            <div className="learn-forget">
              {sure ? (
                <>
                  <span>Forget your progress and your kit? Your circuits stay in My circuits.</span>
                  <button
                    onClick={() => {
                      forgetAll()
                      setSure(false)
                      setPicked(null)
                    }}
                    data-testid="learn-forget-yes"
                  >
                    Yes, forget
                  </button>
                  <button onClick={() => setSure(false)}>Keep</button>
                </>
              ) : (
                <button className="link-button" onClick={() => setSure(true)} data-testid="learn-forget">
                  Forget my progress
                </button>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
