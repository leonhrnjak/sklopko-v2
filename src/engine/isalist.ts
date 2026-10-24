/**
 * The instruction sets a ROM can hold a program in, by id and name only. The ROM part and the loader of saved files need this at
 * startup; the assemblers themselves (`isa.ts` and the others) are big, and load with the panels that use them.
 */

export interface IsaChoice {
  id: string
  name: string
}

/** The choices of a ROM's *Contents are*, after *Hex words*. Each has an assembler with the same id (see `isa.ts`; the 6502's is `asm6502.ts`). */
export const ISA_CHOICES: IsaChoice[] = [
  { id: 'skasm', name: 'SKASM' },
  { id: '6502', name: '6502 assembly' },
  { id: '65c02', name: '65C02 assembly' },
]

/** Ids that circuits saved before SKASM used for a ROM's instruction set; they all mean SKASM now. */
const LEGACY_IDS: Record<string, string> = { sk8: 'skasm', sk82: 'skasm' }

/** The id a saved ROM should have today (an old instruction set's id becomes `skasm`; anything else stays as it is). */
export const currentIsaId = (id: string): string => LEGACY_IDS[id] ?? id
