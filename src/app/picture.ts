import { create } from 'zustand'

/** The "Save a picture" window: one entry in the File menu, with the choices (format, how much) inside. */
export const usePicture = create<{ open: boolean }>(() => ({ open: false }))

export const openPicture = () => usePicture.setState({ open: true })
export const closePicture = () => usePicture.setState({ open: false })
