import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrors, recentErrors } from './errors'
import { clearSimFailure, reportSimFailure, useSimHealth } from './simHealth'

describe('simHealth', () => {
  beforeEach(() => {
    clearErrors()
    clearSimFailure()
  })

  it('shows the reason and logs the failure for Report a problem', () => {
    reportSimFailure(new Error('the engine did not load'))
    expect(useSimHealth.getState().failed).toBe('the engine did not load')
    expect(recentErrors().some((e) => e.message.includes('the engine did not load'))).toBe(true)
  })
})
