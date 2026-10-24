import { Suspense, useState, type ReactNode } from 'react'

/**
 * Mounts `children` (a lazy panel) from the first time `open` is true, and keeps it mounted after that, so the panel's
 * code loads when it is first asked for and not with the page.
 */
export function OnDemand({ open, children }: { open: boolean; children: ReactNode }) {
  const [wanted, setWanted] = useState(open)
  if (open && !wanted) setWanted(true)
  return wanted ? <Suspense fallback={null}>{children}</Suspense> : null
}
