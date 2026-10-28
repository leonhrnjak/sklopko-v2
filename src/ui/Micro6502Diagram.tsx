import { createContext, useContext, type ReactNode } from 'react'

/** The five colours of the block diagram (styled in index.css as .arch). */
export type BlockClass = 'seq' | 'regs' | 'alu' | 'addr' | 'mem'

const Pick = createContext<{
  shown: number
  lit: Set<number>
  onPick: (s: number) => void
}>({ shown: -1, lit: new Set(), onPick: () => {} })

function Block({ cls, s, label, children }: { cls: BlockClass; s: number; label: string; children: ReactNode }) {
  const { shown, lit, onPick } = useContext(Pick)
  return (
    <g
      className={`block ${cls}${shown === s ? ' sel' : ''}${lit.has(s) ? ' lit' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={() => onPick(s)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick(s)
        }
      }}
    >
      {children}
    </g>
  )
}

/** The block diagram of the 6502 built from parts: seven blocks, each one a section of the circuit (its number is the section's). */
export function Micro6502Diagram({ shown, lit, onPick }: { shown: number; lit: Set<number>; onPick: (s: number) => void }) {
  return (
    <Pick.Provider value={{ shown, lit, onPick }}>
      <svg viewBox="0 0 1000 612" role="group" aria-label="Block diagram of the CPU">
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="head" d="M0 0 L10 5 L0 10 z" />
          </marker>
        </defs>

        {/* wires, behind the blocks */}
        <path className="w" d="M150 82 H176" markerEnd="url(#ah)" />
        <path className="w" d="M396 82 H442" markerEnd="url(#ah)" />
        <path className="w" d="M662 82 H706" markerEnd="url(#ah)" />
        <text className="wl" x="404" y="70">
          opcode, T
        </text>
        <path className="w ctl" d="M846 150 V196" markerEnd="url(#ah)" />
        <path className="w ctl" d="M846 172 H236 V196" markerEnd="url(#ah)" />
        <text className="wl" x="600" y="166">
          control signals: LD_A, AIN, BIN, OP, ASEL …
        </text>
        <path className="w bus" d="M452 300 H508" markerEnd="url(#ah)" />
        <text className="wl" x="456" y="290">
          A, B
        </text>
        <path className="w bus" d="M508 396 H452" markerEnd="url(#ah)" />
        <text className="wl" x="456" y="414">
          R
        </text>
        <path className="w bus" d="M236 438 V478" markerEnd="url(#ah)" />
        <text className="wl" x="244" y="462">
          PC, TH:TL, SP
        </text>
        <path className="w bus" d="M452 530 H508" markerEnd="url(#ah)" />
        <text className="wl" x="450" y="520">
          address
        </text>
        <path className="w bus" d="M650 478 V438" markerEnd="url(#ah)" />
        <text className="wl" x="658" y="462">
          DI: what was read
        </text>
        <path className="w bus" d="M846 438 V478" markerEnd="url(#ah)" />
        <text className="wl" x="854" y="462">
          R: what is written
        </text>
        <path className="w ctl" d="M286 150 V172" />
        <path className="w ctl" d="M60 112 V196" markerEnd="url(#ah)" />

        {/* sequencing: blue */}
        <Block cls="seq" s={0} label="Sequencer">
          <rect className="box" x="20" y="22" width="130" height="120" rx="8" />
          <text className="title" x="34" y="44">
            Clock and Reset
          </text>
          <rect className="mini" x="34" y="58" width="102" height="30" rx="4" />
          <text className="m" x="46" y="78">
            Ready flag
          </text>
          <text className="s" x="34" y="108">
            PHI2 and RES in
          </text>
          <text className="s" x="34" y="123">
            from the board
          </text>
        </Block>
        <Block cls="seq" s={0} label="Sequencer: T and IR">
          <rect className="box" x="176" y="22" width="220" height="120" rx="8" />
          <text className="title" x="190" y="44">
            Sequencer
          </text>
          <rect className="mini" x="190" y="58" width="90" height="30" rx="4" />
          <text className="m" x="202" y="78">
            T 0…6
          </text>
          <rect className="mini" x="292" y="58" width="90" height="30" rx="4" />
          <text className="m" x="304" y="78">
            IR opcode
          </text>
          <text className="s" x="190" y="112">
            T counts the cycles of an
          </text>
          <text className="s" x="190" y="127">
            instruction; IR holds the opcode
          </text>
        </Block>
        <Block cls="seq" s={1} label="Microcode ROMs">
          <rect className="box" x="442" y="22" width="220" height="120" rx="8" />
          <text className="title" x="456" y="44">
            Microcode
          </text>
          <rect className="mini" x="456" y="58" width="44" height="26" rx="4" />
          <text className="m" x="466" y="76">
            ROM
          </text>
          <rect className="mini" x="506" y="58" width="44" height="26" rx="4" />
          <text className="m" x="516" y="76">
            ROM
          </text>
          <rect className="mini" x="556" y="58" width="44" height="26" rx="4" />
          <text className="m" x="566" y="76">
            ROM
          </text>
          <rect className="mini" x="606" y="58" width="44" height="26" rx="4" />
          <text className="m" x="616" y="76">
            ROM
          </text>
          <text className="s" x="456" y="106">
            4096 rows × 54 control bits
          </text>
          <text className="s" x="456" y="121">
            one row per cycle of each opcode
          </text>
        </Block>
        <Block cls="seq" s={2} label="Control logic">
          <rect className="box" x="706" y="22" width="280" height="128" rx="8" />
          <text className="title" x="720" y="44">
            Control
          </text>
          <text className="m" x="720" y="72">
            END BRANCH NOCROSS
          </text>
          <text className="m" x="720" y="92">
            XOP XEND PAGEFIX
          </text>
          <text className="s" x="720" y="116">
            splits the words into named wires and
          </text>
          <text className="s" x="720" y="131">
            decides when an instruction ends
          </text>
        </Block>

        {/* registers: green */}
        <Block cls="regs" s={3} label="Registers">
          <rect className="box" x="20" y="196" width="432" height="242" rx="8" />
          <text className="title" x="34" y="220">
            Registers
          </text>
          <rect className="mini" x="34" y="234" width="56" height="30" rx="4" />
          <text className="m" x="46" y="254">
            A
          </text>
          <rect className="mini" x="98" y="234" width="56" height="30" rx="4" />
          <text className="m" x="110" y="254">
            X
          </text>
          <rect className="mini" x="162" y="234" width="56" height="30" rx="4" />
          <text className="m" x="174" y="254">
            Y
          </text>
          <rect className="mini" x="226" y="234" width="66" height="30" rx="4" />
          <text className="m" x="238" y="254">
            SP
          </text>
          <rect className="mini" x="300" y="234" width="140" height="30" rx="4" />
          <text className="m" x="312" y="254">
            P NV–DIZC
          </text>
          <rect className="mini" x="34" y="276" width="76" height="30" rx="4" />
          <text className="m" x="46" y="296">
            PCH PCL
          </text>
          <rect className="mini" x="118" y="276" width="56" height="30" rx="4" />
          <text className="m" x="130" y="296">
            TL
          </text>
          <rect className="mini" x="182" y="276" width="56" height="30" rx="4" />
          <text className="m" x="194" y="296">
            TH
          </text>
          <rect className="mini" x="246" y="276" width="56" height="30" rx="4" />
          <text className="m" x="258" y="296">
            DL
          </text>
          <rect className="mini" x="310" y="276" width="130" height="30" rx="4" />
          <text className="m" x="322" y="296">
            CRS carry
          </text>
          <text className="s" x="34" y="334">
            A X Y: the programmer’s registers. SP: the stack pointer.
          </text>
          <text className="s" x="34" y="352">
            TL TH: an address built a byte at a time. DL: a value
          </text>
          <text className="s" x="34" y="370">
            being changed in memory. CRS: an index carried a page.
          </text>
          <text className="s" x="34" y="396">
            Every register loads R when its LD signal is on.
          </text>
          <text className="s" x="34" y="414">
            SP has its own +1 and −1 adders; TH has TH + CRS.
          </text>
        </Block>

        {/* ALU: amber */}
        <Block cls="alu" s={4} label="ALU and flags">
          <rect className="box" x="508" y="196" width="478" height="242" rx="8" />
          <text className="title" x="522" y="220">
            ALU and flags
          </text>
          <rect className="mini" x="522" y="234" width="130" height="34" rx="4" />
          <text className="m" x="534" y="256">
            A input ← AIN
          </text>
          <rect className="mini" x="522" y="278" width="130" height="34" rx="4" />
          <text className="m" x="534" y="300">
            B input ← BIN
          </text>
          <rect className="mini" x="670" y="234" width="170" height="78" rx="4" />
          <text className="m" x="682" y="258">
            adder A + B + C
          </text>
          <text className="m" x="682" y="278">
            AND OR EOR
          </text>
          <text className="m" x="682" y="298">
            shifter ASL LSR…
          </text>
          <rect className="mini" x="856" y="234" width="116" height="78" rx="4" />
          <text className="m" x="870" y="262">
            R
          </text>
          <text className="s" x="870" y="282">
            the result
          </text>
          <text className="s" x="870" y="298">
            of OP
          </text>
          <rect className="mini" x="522" y="324" width="450" height="30" rx="4" />
          <text className="m" x="534" y="344">
            flags: N Z C V I D (BIT, PLP, RTI)
          </text>
          <text className="s" x="522" y="380">
            B can be the data bus, TL, TH, DL or a constant, and can be inverted (SBC, CMP).
          </text>
          <text className="s" x="522" y="398">
            A load is 0 + data, a store is register + 0, INX is X + 1.
          </text>
          <text className="s" x="522" y="416">
            R goes to every register and, on a write, to memory.
          </text>
        </Block>

        {/* address bus: pink */}
        <Block cls="addr" s={5} label="Address bus">
          <rect className="box" x="20" y="478" width="432" height="112" rx="8" />
          <text className="title" x="34" y="502">
            Address bus
          </text>
          <rect className="mini" x="34" y="514" width="62" height="28" rx="4" />
          <text className="m" x="46" y="533">
            PC
          </text>
          <rect className="mini" x="104" y="514" width="86" height="28" rx="4" />
          <text className="m" x="116" y="533">
            TH:TL
          </text>
          <rect className="mini" x="198" y="514" width="80" height="28" rx="4" />
          <text className="m" x="210" y="533">
            01:SP
          </text>
          <rect className="mini" x="286" y="514" width="70" height="28" rx="4" />
          <text className="m" x="298" y="533">
            00:TL
          </text>
          <rect className="mini" x="364" y="514" width="76" height="28" rx="4" />
          <text className="m" x="376" y="533">
            $FFFx
          </text>
          <text className="s" x="34" y="566">
            One 16-bit multiplexer, ASEL, chooses the address of the cycle.
          </text>
          <text className="s" x="34" y="582">
            Fetching, an address being built, the stack, zero page, a vector.
          </text>
        </Block>

        {/* memory: teal */}
        <Block cls="mem" s={6} label="Memory">
          <rect className="box" x="508" y="478" width="478" height="112" rx="8" />
          <text className="title" x="522" y="502">
            Memory and devices
          </text>
          <rect className="mini" x="522" y="514" width="120" height="28" rx="4" />
          <text className="m" x="534" y="533">
            RAM
          </text>
          <rect className="mini" x="650" y="514" width="120" height="28" rx="4" />
          <text className="m" x="662" y="533">
            ROM
          </text>
          <rect className="mini" x="778" y="514" width="194" height="28" rx="4" />
          <text className="m" x="790" y="533">
            LEDs or terminal
          </text>
          <text className="s" x="522" y="566">
            A14 and A15 pick the part. A read comes back as DI (to the ALU and IR);
          </text>
          <text className="s" x="522" y="582">
            a write puts R on the data bus, and RAM or the device takes it at the clock rise.
          </text>
        </Block>
      </svg>
    </Pick.Provider>
  )
}
