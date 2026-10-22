import type { Comparison } from '../../logic/compare'

/** The rows where two tables disagree, with each side's value. */
export function Differences({ c, aName, bName }: { c: Comparison; aName: string; bName: string }) {
  return (
    <>
      <div className="truth-wrap">
        <table className="truth" aria-label="Differences">
          <thead>
            <tr>
              {c.inputs.map((n) => (
                <th key={n} className="in">
                  {n}
                </th>
              ))}
              <th>Output</th>
              <th>{aName}</th>
              <th>{bName}</th>
            </tr>
          </thead>
          <tbody>
            {c.mismatches.map((m, i) => (
              <tr key={i}>
                {c.inputs.map((n) => (
                  <td key={n} className="in">
                    {m.inputs[n]}
                  </td>
                ))}
                <td>{m.output}</td>
                <td className={`out v${m.a}`}>{m.a === 2 ? '?' : m.a}</td>
                <td className={`out v${m.b}`}>{m.b === 2 ? '?' : m.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.mismatchCount > c.mismatches.length && <small>The first {c.mismatches.length} are shown.</small>}
    </>
  )
}
