import { test, expect } from '@playwright/test'
import { fresh, chooseTool } from './helpers'

// A lazy chunk answered with a page of HTML (what a server sends for a file a new deploy has removed) cannot be loaded as a module.
test('a panel that cannot load shows a card and the canvas stays', async ({ page }) => {
  await page.route(/LogicPanel[^/]*$/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }))
  await fresh(page)
  await chooseTool(page, 'Logic')
  await expect(page.getByText('This panel could not load.')).toBeVisible()
  await expect(page.getByTestId('canvas')).toBeVisible()
})

test('a preload error offers a reload', async ({ page }) => {
  await fresh(page)
  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')))
  await expect(page.getByText('A new version of Sklopko is available.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
  await expect(page.getByTestId('canvas')).toBeVisible()
})

test('a simulator engine that cannot load is announced, not "Running"', async ({ page }) => {
  await page.route(/engine[^/]*\.wasm/, (route) => route.fulfill({ status: 404, body: 'not found' }))
  await page.goto('/counter', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('sim-banner')).toBeVisible()
  await expect(page.getByTestId('run-state')).toHaveText('Simulator stopped')
  await expect(page.getByText('Running')).toHaveCount(0)
  await expect(page.getByTestId('canvas')).toBeVisible()
})
