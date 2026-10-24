import { useEffect } from 'react'
import { closeChallengeList, resetProgress, startChallenge, useChallenges } from '../../app/challenges'
import { CHALLENGES, challengeGroups } from '../../model/challenges'

/** All the challenges by group, with the ones already solved ticked. Picking one puts its starting circuit on the canvas. */
export function ChallengeList() {
  const open = useChallenges((s) => s.listOpen)
  const solved = useChallenges((s) => s.solved)
  const current = useChallenges((s) => s.current)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeChallengeList()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeChallengeList()}>
      <div className="modal challenges" role="dialog" aria-modal="true" aria-label="Challenges">
        <header className="modal-head">
          <strong>Challenges</strong>
          <span className="challenge-count">
            {solved.length} of {CHALLENGES.length} solved
          </span>
          <button className="modal-close" onClick={closeChallengeList} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <p className="challenge-intro">
            Short lessons, each ending in something to build. Your circuit is checked automatically by trying every combination of the switches. Each challenge has a circuit of its own: what you had stays in your library, and coming back to a challenge brings back what you built.
          </p>
          {challengeGroups().map(({ group, challenges }) => (
            <section key={group} className="challenge-group">
              <h3>{group}</h3>
              <ul>
                {challenges.map((c) => (
                  <li key={c.id}>
                    <button className={`challenge-item${c.id === current ? ' current' : ''}`} onClick={() => startChallenge(c.id)} data-testid={`challenge-${c.id}`}>
                      <span className="tick" aria-label={solved.includes(c.id) ? 'Solved' : 'Not solved yet'}>
                        {solved.includes(c.id) ? '✔' : ''}
                      </span>
                      <span className="what">
                        <b>{c.title}</b>
                        <small>{c.task}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {solved.length > 0 && (
            <button className="link-button" onClick={resetProgress}>
              Forget my progress
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
