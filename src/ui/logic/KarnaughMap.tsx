import { kmapOf } from '../../logic/kmap'
import type { Cell } from '../../logic/table'

/** Group colours: each group of the smallest sum of products gets one, drawn as a coloured border on its cells. */
const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be185d', '#65a30d']

/** The Karnaugh map of one output (1 to 4 inputs), with the groups of its smallest sum of products. */
export function KarnaughMap({ values, names, output }: { values: Cell[]; names: string[]; output: string }) {
  const map = kmapOf(values, names)
  if (!map) return null
  const groupsOf = (r: number, c: number) => map.groups.flatMap((g, i) => (g.cells.some(([gr, gc]) => gr === r && gc === c) ? [i] : []))
  const cols = map.colLabels.length
  return (
    <figure className="kmap-figure">
      <div className="kmap" role="table" aria-label={`Karnaugh map of ${output}`} style={{ gridTemplateColumns: `auto repeat(${cols}, 2.4em)` }}>
        <div className="kcorner">
          {map.rowVars.join('')}
          {map.rowVars.length ? ' \\ ' : ''}
          {map.colVars.join('')}
        </div>
        {map.colLabels.map((l, c) => (
          <div key={c} className="khead">
            {l}
          </div>
        ))}
        {map.cells.map((row, r) => [
          <div key={`h${r}`} className="khead">
            {map.rowLabels[r]}
          </div>,
          ...row.map((cell, c) => {
            const groups = groupsOf(r, c)
            return (
              <div
                key={`${r}-${c}`}
                className={`kcell v${cell.value}`}
                role="cell"
                data-groups={groups.join(',')}
                style={groups.length ? { boxShadow: groups.map((g, i) => `inset 0 0 0 ${2 + 3 * i}px ${COLORS[g % COLORS.length]}`).join(', ') } : undefined}
                title={`Row ${cell.row}`}
              >
                {cell.value === 2 ? 'X' : cell.value}
              </div>
            )
          }),
        ])}
      </div>
      <figcaption>
        {map.groups.length ? (
          <ul className="klegend">
            {map.groups.map((g, i) => (
              <li key={i}>
                <span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />
                <code>{g.term}</code> <small>({g.cells.length} {g.cells.length === 1 ? 'cell' : 'cells'})</small>
              </li>
            ))}
          </ul>
        ) : (
          <small>No 1s: {output} is always 0.</small>
        )}
      </figcaption>
    </figure>
  )
}
