import { expect, test, type Page } from '@playwright/test'
import { chooseExample, chooseFile, fresh, freshEmpty, place } from './helpers'

const gallery = (page: Page) => page.getByRole('dialog', { name: 'Examples' })

test('the gallery shows every example as a card with a picture, in groups, and a search narrows it', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await expect(gallery(page)).toBeVisible()
  await expect(page.getByLabel('Search examples')).toBeFocused() // on a computer, typing searches right away
  // It opens on the first category; the others are a tap away, and so is the whole list.
  const tabs = gallery(page).getByRole('navigation', { name: 'Categories' })
  await expect(tabs.getByRole('button', { pressed: true })).toHaveText(/Start here\s*3/)
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(3)
  await tabs.getByRole('button', { name: /^Arithmetic/ }).click()
  await expect(tabs.getByRole('button', { pressed: true })).toHaveText(/Arithmetic/)
  const arithmetic = await gallery(page).locator('.gallery-card').count()
  expect(arithmetic).toBeGreaterThan(1)
  expect(arithmetic).toBeLessThan(15)
  await expect(gallery(page).locator('.gallery-card b').first()).not.toHaveText('Basic gates')
  await tabs.getByRole('button', { name: /^All/ }).click()
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(62)
  await expect(gallery(page).locator('.gallery-group h3')).toHaveCount(12)
  await tabs.getByRole('button', { name: /^Start here/ }).click()
  await expect(gallery(page).getByTestId('example-gates')).toContainText('Basic gates')
  await expect(gallery(page).getByTestId('example-gates')).toContainText('AND, OR, NOT')

  // The first pictures are drawn (an SVG that failed to load has no size).
  const thumb = gallery(page).getByTestId('example-counter').locator('img')
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  const search = page.getByLabel('Search examples')
  await search.fill('latch') // a search looks through every category
  await expect(tabs.getByRole('button', { pressed: true })).toHaveText(/^All/)
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(4) // the two latches, the flip-flop made of latches, the debouncer
  await expect(gallery(page)).toContainText('4 of 62')
  await search.fill('gamepad computers')
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(3) // pong, snake and the raycaster
  await search.fill('zzzz')
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(0)
  await expect(gallery(page)).toContainText('No example matches')
  await page.keyboard.press('Escape')
  await expect(gallery(page)).toHaveCount(0)
})

test('the BASIC computer has a category of its own, with the BASIC computer first and the terminal examples that lead up to it', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  const tabs = gallery(page).getByRole('navigation', { name: 'Categories' })
  await tabs.getByRole('button', { name: /^BASIC computer/ }).click()
  await expect(gallery(page).locator('.gallery-card')).toHaveCount(5)
  await expect(gallery(page).locator('.gallery-card b').first()).toContainText('BASIC computer')
  await expect(gallery(page).getByTestId('example-6502-echo')).toBeVisible()
  // The 6502 category no longer holds them.
  await tabs.getByRole('button', { name: /^6502/ }).click()
  await expect(gallery(page).getByTestId('example-6502-basic')).toHaveCount(0)
  await expect(gallery(page).getByTestId('example-6502-hello')).toBeVisible()
})

test('opening a card opens the example and keeps the circuit you were working on', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'switch', 200, 200)
  await expect(page.getByRole('button', { name: 'Circuit name: Untitled 1' })).toBeVisible()

  await chooseExample(page, 'dice')
  await expect(gallery(page)).toHaveCount(0)
  expect(await page.locator('.comp').count()).toBeGreaterThan(5)

  await chooseFile(page, 'My circuits')
  await expect(page.getByRole('dialog', { name: 'My circuits' }).locator('.library-row')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'My circuits' })).toContainText('Untitled 1')
})

test('a card has a button that copies the example’s short link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await fresh(page)
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByLabel('Search examples').fill('dice')
  await page.getByRole('button', { name: 'Copy link to Electronic dice' }).click()
  await expect(page.locator('.toast')).toContainText('Link to “Electronic dice” copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/dice$/)
  await expect(gallery(page)).toBeVisible() // copying a link does not open the example
})
