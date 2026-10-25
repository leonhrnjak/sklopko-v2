import { SkasmReference } from './SkasmReference'
import { Reference6502 } from './Reference6502'
import { ReferenceBasic } from './ReferenceBasic'

/** The language references, in one chunk: each shows itself only while its own language is the one that was opened. */
export function References() {
  return (
    <>
      <SkasmReference />
      <Reference6502 />
      <ReferenceBasic />
    </>
  )
}
