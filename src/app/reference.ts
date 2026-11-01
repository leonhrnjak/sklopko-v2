import { create } from 'zustand'

export type ReferenceTab = 'start' | 'format' | 'instructions' | 'ports' | 'signals' | 'examples'

/** The sections of the 6502 reference. */
export type Reference6502Tab = 'start' | 'instructions' | 'modes' | 'map'

/** Which chip the 6502 reference describes. */
export type Chip6502 = 'nmos' | 'cmos'

/** The sections of the BASIC reference. */
export type ReferenceBasicTab = 'start' | 'statements' | 'functions' | 'programs'

/** The sections of the reference for the 6502 built from parts. */
export type ReferenceParts6502Tab = 'machine' | 'cycles'

/** The sections of the Doom-like guide. */
export type ReferenceDoomTab = 'play' | 'machine'

type Language = 'skasm' | '6502' | 'basic' | 'parts6502' | 'doom'

/** The language references: a window that can be opened from the toolbar, the help panel and a program ROM. */
export const useReference = create<{ open: boolean; language: Language; tab: string; chip: Chip6502 }>(() => ({ open: false, language: 'skasm', tab: 'start', chip: 'nmos' }))

const show = (language: Language, tab?: string, chip?: Chip6502) =>
  useReference.setState((s) => ({ open: true, language, tab: tab ?? (s.language === language ? s.tab : 'start'), chip: chip ?? s.chip }))

/** Open the SKASM reference. */
export const openReference = (tab?: ReferenceTab) => show('skasm', tab)
/** Open the 6502 reference (for the NMOS 6502 or the 65C02; the one shown last if not said). */
export const open6502Reference = (tab?: Reference6502Tab, chip?: Chip6502) => show('6502', tab, chip)
/** Open the BASIC reference. */
export const openBasicReference = (tab?: ReferenceBasicTab) => show('basic', tab)
/** Open the guide to the 6502 built from parts (its blocks, and an instruction cycle by cycle). */
export const openParts6502Reference = (tab?: ReferenceParts6502Tab) => show('parts6502', tab ?? 'machine')
/** Open the guide to the Doom-like example. */
export const openDoomReference = (tab?: ReferenceDoomTab) => show('doom', tab ?? 'play')
export const closeReference = () => useReference.setState({ open: false })
export const setReferenceTab = (tab: ReferenceTab | Reference6502Tab | ReferenceBasicTab | ReferenceParts6502Tab | ReferenceDoomTab) => useReference.setState({ tab })
export const setReferenceChip = (chip: Chip6502) => useReference.setState({ chip })
