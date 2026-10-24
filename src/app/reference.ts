import { create } from 'zustand'

export type ReferenceTab = 'start' | 'format' | 'instructions' | 'ports' | 'examples'

/** The sections of the 6502 reference. */
export type Reference6502Tab = 'start' | 'instructions' | 'modes' | 'map'

/** Which chip the 6502 reference describes. */
export type Chip6502 = 'nmos' | 'cmos'

type Language = 'skasm' | '6502'

/** The language references: a window that can be opened from the toolbar, the help panel and a program ROM. */
export const useReference = create<{ open: boolean; language: Language; tab: string; chip: Chip6502 }>(() => ({ open: false, language: 'skasm', tab: 'start', chip: 'nmos' }))

const show = (language: Language, tab?: string, chip?: Chip6502) =>
  useReference.setState((s) => ({ open: true, language, tab: tab ?? (s.language === language ? s.tab : 'start'), chip: chip ?? s.chip }))

/** Open the SKASM reference. */
export const openReference = (tab?: ReferenceTab) => show('skasm', tab)
/** Open the 6502 reference (for the NMOS 6502 or the 65C02; the one shown last if not said). */
export const open6502Reference = (tab?: Reference6502Tab, chip?: Chip6502) => show('6502', tab, chip)
export const closeReference = () => useReference.setState({ open: false })
export const setReferenceTab = (tab: ReferenceTab | Reference6502Tab) => useReference.setState({ tab })
export const setReferenceChip = (chip: Chip6502) => useReference.setState({ chip })
