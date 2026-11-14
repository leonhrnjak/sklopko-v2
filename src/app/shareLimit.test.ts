import { describe, expect, it } from 'vitest'
import { SHARE_LIMIT, tooLong } from './shareLimit'

describe('the longest share link', () => {
  it('is 2,000 characters: a link of exactly that is fine, one more is too long', () => {
    expect(SHARE_LIMIT).toBe(2000)
    expect(tooLong('x'.repeat(2000))).toBe(false)
    expect(tooLong('x'.repeat(2001))).toBe(true)
  })
})
