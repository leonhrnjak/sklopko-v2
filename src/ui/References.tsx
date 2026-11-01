import { SkasmReference } from './SkasmReference'
import { Reference6502 } from './Reference6502'
import { ReferenceBasic } from './ReferenceBasic'
import { ReferenceDoom } from './ReferenceDoom'
import { ReferenceParts6502 } from './ReferenceParts6502'

/** The language references, in one chunk: each shows itself only while its own language is the one that was opened. */
export function References() {
  return (
    <>
      <SkasmReference />
      <Reference6502 />
      <ReferenceBasic />
      <ReferenceParts6502 />
      <ReferenceDoom />
    </>
  )
}
