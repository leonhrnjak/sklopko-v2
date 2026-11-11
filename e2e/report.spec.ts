import { expect, test } from '@playwright/test'
import { fresh } from './helpers'

test('Report a problem opens a pre-filled GitHub issue with the recent errors', async ({ page }) => {
  await fresh(page)
  await page.evaluate(() => {
    ;(window as unknown as { opened: string[] }).opened = []
    window.open = (url) => {
      ;(window as unknown as { opened: string[] }).opened.push(String(url))
      return null
    }
    setTimeout(() => {
      throw new Error('test-boom')
    }, 0)
  })
  if (!(await page.getByTestId('report-problem').isVisible())) await page.getByTestId('help-toggle').click()
  await page.getByTestId('report-problem').click()
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened)
  expect(opened).toHaveLength(1)
  const url = new URL(opened[0])
  expect(url.origin + url.pathname).toBe('https://github.com/leonhrnjak/sklopko-v2/issues/new')
  expect(url.href.length).toBeLessThan(8000)
  const body = url.searchParams.get('body')!
  expect(body).toMatch(/Version: \d+\.\d+\.\d+/)
  expect(body).toContain('test-boom')
})
