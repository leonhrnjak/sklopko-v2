import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrors, recentErrors, recordError, reportUrl } from './errors'

const info = { version: '1.2.3', commit: 'abc1234', browser: 'TestBrowser/1', page: '/learn' }

describe('error log', () => {
  beforeEach(clearErrors)

  it('keeps only the last 20 errors', () => {
    for (let i = 0; i < 30; i++) recordError(new Error('e' + i))
    expect(recentErrors()).toHaveLength(20)
    expect(recentErrors()[0].message).toContain('e10')
  })

  it('builds a new-issue link with the version, browser, page and errors', () => {
    recordError(new Error('boom'))
    const url = new URL(reportUrl(info))
    expect(url.origin + url.pathname).toBe('https://github.com/leonhrnjak/sklopko-v2/issues/new')
    const body = url.searchParams.get('body')!
    for (const part of ['1.2.3', 'abc1234', 'TestBrowser/1', '/learn', 'Error: boom']) expect(body).toContain(part)
  })

  it('stays under 8,000 characters however much is logged', () => {
    for (let i = 0; i < 20; i++) recordError('x'.repeat(5000))
    const url = reportUrl(info)
    expect(url.length).toBeLessThanOrEqual(8000)
    expect(new URL(url).searchParams.get('body')).toContain('Version: 1.2.3')
  })

  it('works with nothing logged', () => {
    expect(new URL(reportUrl(info)).searchParams.get('body')).toContain('No errors were recorded')
  })
})
