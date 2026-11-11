import { describe, expect, it } from 'vitest'
import { opcodeTable } from './wasmengine'

/**
 * The Rust tests of the 6502 core (`cargo test` in `engine-rs/`) cannot ask the page for the opcode table, so they read this copy of it:
 * `engine-rs/testdata/opcode-table.txt`, 512 lines (256 opcodes of the NMOS chip, then of the 65C02) of the 7 numbers the page sends the
 * module. This test fails when the copy is out of date; `VITE_UPDATE_OPCODE_TABLE=1 npx vitest run src/engine/opcodetable.test.ts` rewrites it.
 */
const FILE = 'engine-rs/testdata/opcode-table.txt'

describe('the opcode table the Rust tests read', () => {
  it('is what the page sends the module', async () => {
    // (the app's tsconfig has no Node types, so the module is loaded by a name the compiler does not look at)
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
      readFileSync(path: string, enc: 'utf8'): string
      writeFileSync(path: string, text: string): void
    }
    const t = opcodeTable()
    const rows: string[] = []
    for (let i = 0; i < t.length; i += 7) rows.push(t.slice(i, i + 7).join(' '))
    const text = rows.join('\n') + '\n'
    // (a Vitest run starts in the repository's root)
    if (import.meta.env.VITE_UPDATE_OPCODE_TABLE) fs.writeFileSync(FILE, text)
    expect(fs.readFileSync(FILE, 'utf8'), `${FILE} is out of date: VITE_UPDATE_OPCODE_TABLE=1 npx vitest run src/engine/opcodetable.test.ts`).toBe(text)
  })
})
