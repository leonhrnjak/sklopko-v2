import { create } from 'zustand'

/** The longest share link (in characters) that chat and mail tools can be expected to carry whole. */
export const SHARE_LIMIT = 2000

/** Is this link too long to share as a link? */
export const tooLong = (url: string) => url.length > SHARE_LIMIT

/** What the "too big for a link" dialog is about: the text that would have been copied, and what it is. */
export interface LongShare {
  what: 'link' | 'embed code'
  /** What *Copy anyway* puts on the clipboard. */
  text: string
  /** The link's own length, for the message. */
  length: number
  toast: string
}

export const useLongShare = create<{ pending: LongShare | null }>(() => ({ pending: null }))
export const closeLongShare = () => useLongShare.setState({ pending: null })
