import { answerQuiz } from '../../app/pathWork'
import { usePath } from '../../app/path'
import type { Question } from '../../model/path/types'

/** Questions in a lesson: choose an answer and see at once whether it is right. A wrong choice can be changed; none of it blocks going on. */
export function Quiz({ stepId, questions }: { stepId: string; questions: Question[] }) {
  const given = usePath((s) => s.progress.quiz[stepId])
  return (
    <div className="quiz">
      {questions.map((q, i) => {
        const choice = given?.[i] ?? -1
        const right = choice === q.answer
        return (
          <fieldset key={i} className="quiz-q" data-testid={`quiz-${i}`}>
            <legend>{q.q}</legend>
            {q.options.map((o, k) => (
              <label key={k} className={choice === k ? (right ? 'quiz-opt right' : 'quiz-opt wrong') : 'quiz-opt'}>
                <input type="radio" name={`${stepId}-${i}`} checked={choice === k} onChange={() => answerQuiz(stepId, i, k, questions)} /> {o}
              </label>
            ))}
            {choice >= 0 && (
              <p className={right ? 'quiz-says right' : 'quiz-says wrong'} role="status">
                {right ? `✔ ${q.why}` : 'Not quite. Have another look and try again.'}
              </p>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}
