import { expect, test, type Page } from '@playwright/test'
import { chooseFile, fresh, freshEmpty, place } from './helpers'

const gallery = (page: Page) => page.getByRole('dialog', { name: 'Examples' })

test('the gallery shows every example as a card with a picture, in groups, and a search narrows it', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await expect(gallery(page)).toBeVisible()
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(47)
  await expect(gallery(page).locator('.gallery-group h3')).toHaveCount(10)
  await expect(gallery(page).getByTestId('example-gates')).toContainText('Basic gates')
  await expect(gallery(page).getByTestId('example-gates')).toContainText('AND, OR, NOT')

  // The first pictures are drawn (an SVG that failed to load has no size).
  const thumb = gallery(page).getByTestId('example-counter').locator('img')
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  const search = page.getByLabel('Search examples')
  await expect(search).toBeFocused()
  await search.fill('latch')
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(4) // the two latches, the flip-flop made of latches, the debouncer
  await expect(gallery(page)).toContainText('4 of 47')
  await search.fill('gamepad computers')
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(3) // pong, snake and the raycaster
  await search.fill('zzzz')
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(0)
  await expect(gallery(page)).toContainText('No example matches')
  await page.keyboard.press('Escape')
  await expect(gallery(page)).toHaveCount(0)
})

test('opening a card opens the example and keeps the circuit you were working on', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'switch', 200, 200)
  await expect(page.getByRole('button', { name: 'Circuit name: Untitled 1' })).toBeVisible()

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByTestId('example-dice').click()
  await expect(gallery(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/dice$/)
  expect(await page.locator('.comp').count()).toBeGreaterThan(5)

  await chooseFile(page, 'My circuits')
  await expect(page.getByRole('dialog', { name: 'My circuits' }).locator('.library-row')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'My circuits' })).toContainText('Untitled 1')
})

test('a card has a button that copies the example’s short link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await fresh(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByRole('button', { name: 'Copy link to Electronic dice' }).click()
  await expect(page.locator('.toast')).toContainText('Link to “Electronic dice” copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/dice$/)
  await expect(gallery(page)).toBeVisible() // copying a link does not open the example
})
