import { expect, test } from '@playwright/test'
import { fresh, place, wire, chooseTool, tableRows } from './helpers'

test('challenges: start one, check it fails, solve it, and the progress is remembered', async ({ page }) => {
  await fresh(page)
  await chooseTool(page, 'Challenges')
  const list = page.getByRole('dialog', { name: 'Challenges' })
  await expect(list).toContainText('0 of 17 solved')
  await list.getByTestId('challenge-wire').click()

  const panel = page.getByRole('region', { name: 'Challenge' })
  await expect(panel).toContainText('1. Make the light follow the switch')
  await expect(page.locator('.comp')).toHaveCount(2)
  expect(await tableRows(page, 'Goal')).toEqual([['0', '0'], ['1', '1']])

  // Nothing is wired yet.
  await panel.getByTestId('challenge-check').click()
  await expect(panel).toContainText('Not yet')
  await expect(panel.getByRole('table', { name: 'Differences' })).toBeVisible()
  await panel.getByRole('button', { name: 'Hint' }).click()
  await expect(panel).toContainText('Drag from the little pin')

  await wire(page, ['switch1', 'Q'], ['led2', 'A'])
  await expect(panel).toContainText('The circuit has changed since it was last checked')
  await panel.getByTestId('challenge-check').click()
  await expect(panel).toContainText('Solved!')
  await panel.getByRole('button', { name: /^Next:/ }).click()
  await expect(panel).toContainText('2. Invert the signal')

  // Progress survives a reload.
  await page.reload({ waitUntil: 'networkidle' })
  await chooseTool(page, 'Challenges')
  await expect(page.getByRole('dialog', { name: 'Challenges' })).toContainText('1 of 17 solved')
  await expect(page.getByTestId('challenge-wire').getByLabel('Solved')).toBeVisible()
})

test('challenges: rules, labels, solutions and memory steps', async ({ page }) => {
  await fresh(page)
  await chooseTool(page, 'Challenges')
  await page.getByTestId('challenge-or-from-nand').click()
  const panel = page.getByRole('region', { name: 'Challenge' })
  await expect(panel).toContainText('Only these gates: NAND')

  // A correct circuit that uses the wrong part is turned down.
  await place(page, 'or', 250, 100)
  await panel.getByTestId('challenge-check').click()
  await expect(panel.getByRole('list', { name: 'Problems' })).toContainText('only allows NAND gates, but the circuit uses OR')

  // The solution follows the rules.
  await panel.getByRole('button', { name: 'Show a solution' }).click()
  await panel.getByTestId('challenge-check').click()
  await expect(panel).toContainText('Solved!')

  // A memory challenge is checked step by step.
  await page.getByRole('button', { name: 'All challenges' }).click()
  await page.getByTestId('challenge-sr-latch').click()
  expect((await tableRows(page, 'Steps')).length).toBe(6)
  await panel.getByTestId('challenge-check').click()
  await expect(panel).toContainText('Not yet')
  await panel.getByRole('button', { name: 'Show a solution' }).click()
  await panel.getByTestId('challenge-check').click()
  await expect(panel).toContainText('All 6 steps came out right')
})
