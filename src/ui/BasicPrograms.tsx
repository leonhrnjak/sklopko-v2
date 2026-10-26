import { typeOnTerminal } from '../app/terminal'
import { showToast } from '../app/store'
import { BASIC_PROGRAMS, programText } from '../model/basic-programs'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('Copied. Click the terminal’s screen and paste it.')
  } catch {
    showToast('Could not copy: the browser did not allow it.')
  }
}

/** Programs to type in on the BASIC computer, each to copy, or to type in through the terminal's keyboard buffer when there is a terminal. */
export function BasicPrograms({ terminalId, hasLcd = false, hideUnavailable = false }: { terminalId?: string; hasLcd?: boolean; hideUnavailable?: boolean }) {
  const typeIn = (id: string) => {
    const p = BASIC_PROGRAMS.find((q) => q.id === id)!
    const text = programText(p)
    const taken = terminalId ? typeOnTerminal(terminalId, text) : 0
    if (taken < text.length) showToast(`The keyboard holds 8,000 characters: ${taken} of ${text.length} were taken.`)
  }
  return (
    <div className="basic-programs">
      {BASIC_PROGRAMS.filter((p) => !(hideUnavailable && p.needs === 'lcd' && !hasLcd)).map((p) => (
        <div key={p.id} className="basic-program" data-program={p.id}>
          <h4>{p.title}</h4>
          <p className="desc">{p.about}</p>
          <pre className="ref-code">{p.lines.join('\n')}</pre>
          <div className="row">
            <button onClick={() => copy(programText(p))}>Copy</button>
            {terminalId && (p.needs !== 'lcd' || hasLcd) && (
              <button onClick={() => typeIn(p.id)} title={`Types the lines and ${p.run} on the terminal, as if from the keyboard`}>
                Type it in
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
