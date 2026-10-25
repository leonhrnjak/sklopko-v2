import { describe, expect, it } from 'vitest'
import { MAX_WORK_MS, MIN_WORK_MS, workBudget } from './workbudget'

describe('the work budget of a frame', () => {
  it('stays at 10 ms for a circuit that keeps up, however long the frame took', () => {
    expect(workBudget(false, 5)).toBe(MIN_WORK_MS)
    expect(workBudget(false, 200)).toBe(MIN_WORK_MS)
  })

  it('is as much as the rest of the frame took for a circuit that cannot keep up, between 10 and 100 ms', () => {
    expect(workBudget(true, 3)).toBe(MIN_WORK_MS)
    expect(workBudget(true, 16.4)).toBe(16)
    expect(workBudget(true, 60)).toBe(60)
    expect(workBudget(true, 400)).toBe(MAX_WORK_MS)
  })
})
