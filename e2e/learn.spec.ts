import { expect, test, type Page } from '@playwright/test'
import { fresh, place, wire } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Step' })
const map = (page: Page) => page.getByRole('dialog', { name: 'Learn' })

/** Open a step from the map: the chapter, then the step. */
async function openStep(page: Page, chapter: string, step: string) {
  await page.getByTestId('learn-button').click()
  await page.getByTestId(`learn-chapter-${chapter}`).click()
  await page.getByTestId(`learn-step-${step}`).click()
}

test('learn: the map, a gate built by hand goes into the kit, and the next step uses it', async ({ page }) => {
  await fresh(page)
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText('0 of 8 steps')
  await expect(map(page).getByTestId('learn-continue')).toContainText('Start: 1.1 Make the light follow the switch')
  await expect(map(page).getByTestId('learn-chapter-memory')).toContainText('soon')
  await page.getByTestId('learn-chapter-nand').click()
  await page.getByTestId('learn-step-not-from-nand').click()

  // The step: its panel, and a parts list with just what it offers.
  await expect(map(page)).toBeHidden()
  await expect(panel(page)).toContainText('2.1 NOT, from one NAND')
  await expect(page).toHaveURL(/\/learn\/not-from-nand$/)
  await expect(page.locator('.palette-item')).toHaveCount(3)
  await expect(page.locator('.palette-item[data-type="nand"]')).toBeVisible()
  await expect(page.locator('.comp')).toHaveCount(2)

  // Nothing is wired yet.
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Not yet')

  const nand = await place(page, 'nand', 250, 100)
  await wire(page, ['switch1', 'Q'], [nand, 'A'])
  await wire(page, ['switch1', 'Q'], [nand, 'B'])
  await wire(page, [nand, 'Y'], ['led2', 'A'])
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('chip-earned')).toContainText('NOT is in your kit')

  // The next step has it in Your kit, and the parts list says so.
  await panel(page).getByTestId('step-next').click()
  await expect(panel(page)).toContainText('2.2 AND, from NAND and your NOT')
  await expect(page.getByTestId('ic-section')).toContainText('Your kit')
  const chip = page.locator('.palette-item[data-type="ic:kit:not-from-nand"]')
  await expect(chip).toBeVisible()
  await expect(page.getByTestId('step-ours')).toHaveCount(0)
  await expect(page.getByTestId('ic-section').getByRole('button', { name: /Delete|Rename|Edit/ })).toHaveCount(0)

  const g = await place(page, 'nand', 200, 80)
  const inv = await place(page, 'ic:kit:not-from-nand', 340, 80)
  await wire(page, ['switch1', 'Q'], [g, 'A'])
  await wire(page, ['switch2', 'Q'], [g, 'B'])
  await wire(page, [g, 'Y'], [inv, 'A'])
  await wire(page, [inv, 'Y'], ['led3', 'A'])
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')

  // Progress, the kit and the work survive a reload; the address brings the step back.
  await page.waitForTimeout(800) // the autosave of the circuit
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/learn\/and-from-nand$/)
  await expect(panel(page)).toContainText('2.2 AND, from NAND and your NOT')
  await expect(page.locator('.comp')).toHaveCount(5) // two switches, the LED, the NAND and the NOT
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText('2 of 8 steps')
  await expect(map(page).getByTestId('kit-chip')).toHaveCount(2)
  await expect(map(page).getByTestId('learn-step-and-from-nand')).toContainText('chip: AND')
})

test('learn: a link to a step, Show a solution counts as shown, a read step, and forgetting', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/and-from-nand', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('2.2 AND, from NAND and your NOT')
  // The learner has not built a NOT, so the step has ours, and says so.
  await expect(page.getByTestId('step-ours')).toContainText('You haven’t built NOT yet, so this step uses ours')
  await expect(page.locator('.palette-item[data-type="ic:kit:not-from-nand"]')).toBeVisible()

  await panel(page).getByRole('button', { name: 'Hint' }).click()
  await expect(panel(page)).toContainText('Wire A and B to a NAND')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  // The solution we showed is not the learner's work: the step is "shown", not solved.
  await panel(page).getByRole('button', { name: 'Map' }).click()
  const row = map(page).getByTestId('learn-step-and-from-nand')
  await expect(row.getByLabel('Solution shown')).toBeVisible()
  await expect(map(page).getByTestId('kit-chip')).toContainText('AND')
  await expect(map(page)).toContainText('1 of 8 steps')

  // A read step is done when the learner says so, and leads on.
  await page.getByTestId('learn-chapter-signals').click()
  await page.getByTestId('learn-step-binary').click()
  await expect(panel(page)).toContainText('Counting with four bits')
  await expect(page.getByRole('table').first()).toContainText('4 + 2 = 6')
  await panel(page).getByTestId('step-next').click()
  await expect(panel(page)).toContainText('NOT, from one NAND')
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText('2 of 8 steps')

  // Closing the step takes the panel away and the parts list is whole again.
  await map(page).getByRole('button', { name: 'Close' }).click()
  await panel(page).getByRole('button', { name: 'Close step' }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  expect(await page.locator('.palette-item').count()).toBeGreaterThan(20)
})

test('learn: /learn opens the map, and Forget my progress clears the steps and the kit', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn', { waitUntil: 'networkidle' })
  await expect(map(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(map(page)).toBeHidden()
  await expect(page).toHaveURL(/\/$/)

  await openStep(page, 'nand', 'not-from-nand')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByRole('button', { name: 'Map' }).click()
  await expect(map(page)).toContainText('1 of 8 steps')
  await expect(map(page).getByTestId('kit-chip')).toHaveCount(1)
  await map(page).getByTestId('learn-forget').click()
  await map(page).getByTestId('learn-forget-yes').click()
  await expect(map(page)).toContainText('0 of 8 steps')
  await expect(map(page).getByTestId('kit-chip')).toHaveCount(0)
  // The address is /learn while the map is open, so a reload opens it again.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(map(page)).toContainText('0 of 8 steps')
})

test('learn: another document ends the step, and the palette has every part again', async ({ page }) => {
  await fresh(page)
  await openStep(page, 'nand', 'not-from-nand')
  await expect(page.locator('.palette-item')).toHaveCount(3)
  await page.getByRole('button', { name: 'File ▾' }).click()
  await page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'New', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  expect(await page.locator('.palette-item').count()).toBeGreaterThan(20)
})

test('learn: after finishing a chapter the map opens on it, and a skipped step is offered as going back', async ({ page }) => {
  await fresh(page)
  const done = Object.fromEntries(['wire', 'not-from-nand', 'and-from-nand', 'or-from-nand', 'nor-from-kit', 'xor-from-kit', 'nand-recap'].map((id) => [id, { at: 1, how: 'solved' }]))
  await page.evaluate((d) => localStorage.setItem('sklopko.path.v1', JSON.stringify({ v: 1, done: d, current: 'nand-recap', quiz: {} })), done)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('learn-button').click()
  // Chapter 2 is the one on show, not chapter 1 where the skipped step is.
  await expect(map(page).getByTestId('learn-step-nand-recap')).toBeVisible()
  await expect(map(page).getByTestId('learn-continue')).toContainText('Go back to a step you skipped: 1.2 Counting with four bits')
  await map(page).getByTestId('learn-chapter-signals').click()
  await expect(map(page).getByTestId('learn-step-binary')).toContainText('skipped')
})
