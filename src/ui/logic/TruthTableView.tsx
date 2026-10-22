import { rowBits, rowCount, type Cell, type TruthTable } from '../../logic/table'

const show = (c: Cell) => (c === 2 ? '?' : String(c))

/** A truth table: the inputs' combinations on the left, each output's value on the right. */
export function TruthTableView({ table, label = 'Truth table' }: { table: TruthTable; label?: string }) {
  const n = table.inputs.length
  return (
    <div className="truth-wrap">
      <table className="truth" aria-label={label}>
        <thead>
          <tr>
            {table.inputs.map((name) => (
              <th key={`i${name}`} className="in">
                {name}
              </th>
            ))}
            {table.outputs.map((name) => (
              <th key={`o${name}`} className="out">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount(table) }, (_, row) => (
            <tr key={row}>
              {rowBits(row, n).map((bit, i) => (
                <td key={i} className="in">
                  {bit}
                </td>
              ))}
              {table.values.map((v, o) => (
                <td key={o} className={`out v${v[row]}`}>
                  {show(v[row])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
