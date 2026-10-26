import { useState } from 'react'
import { SKASM, disassemble, wordFields } from '../../engine/isa'

/** The groups of an instruction word, left to right. */
const GROUPS = [
  { from: 12, name: 'bits 12–15' },
  { from: 8, name: 'bits 8–11' },
  { from: 4, name: 'opcode' },
  { from: 0, name: 'bits 0–3' },
]

/** An instruction word as 16 bits to click: what the word means, and which bits mean it. */
export function InstructionWord({ initial }: { initial: number }) {
  const [word, setWord] = useState(initial)
  const info = wordFields(SKASM, word)
  return (
    <figure className="word-figure" aria-label="Instruction word">
      <div className="word-bits">
        {GROUPS.map((g) => (
          <div key={g.from} className="word-group">
            <span className="word-name">{g.name}</span>
            <span>
              {[3, 2, 1, 0].map((i) => {
                const bit = g.from + i
                const on = (word >> bit) & 1
                return (
                  <button key={bit} className={`word-bit${on ? ' on' : ''}`} onClick={() => setWord(word ^ (1 << bit))} aria-pressed={!!on} aria-label={`Bit ${bit}`} title={`Bit ${bit}`}>
                    {on}
                  </button>
                )
              })}
            </span>
          </div>
        ))}
      </div>
      <figcaption>
        <code>{word.toString(16).toUpperCase().padStart(4, '0')}</code> is <b>{disassemble(SKASM, word)}</b>
        {info ? (
          <>
            {' '}
            ({info.fields.map((f) => `${f.name} ${f.value}`).join(', ')})
          </>
        ) : (
          ' (not an instruction: a bit is set that the instruction does not use)'
        )}
      </figcaption>
    </figure>
  )
}
