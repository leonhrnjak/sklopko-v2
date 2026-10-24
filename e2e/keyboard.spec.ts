import { expect, test } from '@playwright/test'
import { freshEmpty, ledOn, place, wire } from './helpers'

test('a switch with a Key flips when that key is pressed, and shows the key under it', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 160, 160)
  const led = await place(page, 'led', 420, 160)
  await wire(page, [sw, 'Q'], [led, 'A'])
  await page.locator(`.comp[data-id="${sw}"] > g`).click({ button: 'right' })
  await page.getByLabel('Key', { exact: true }).fill('k')
  await page.keyboard.press('Enter')
  await expect(page.locator(`.comp[data-id="${sw}"] .switch-key`)).toHaveText('K')

  await page.getByTestId('canvas').click({ position: { x: 700, y: 400 } }) // click the empty canvas, so nothing is selected
  expect(await ledOn(page, led)).toBe(false)
  await page.keyboard.press('k')
  await expect.poll(() => ledOn(page, led)).toBe(true)
  await page.keyboard.press('K')
  await expect.poll(() => ledOn(page, led)).toBe(false)
  // A modifier makes it a shortcut, not the switch's key.
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(150)
  expect(await ledOn(page, led)).toBe(false)
  // The key does nothing while a field has the keyboard: type it into the label.
  await page.locator(`.comp[data-id="${sw}"] > g`).click({ button: 'right' })
  await page.getByLabel('Label', { exact: true }).fill('k')
  await page.waitForTimeout(150)
  expect(await ledOn(page, led)).toBe(false)
  await expect(page.getByLabel('Label', { exact: true })).toHaveValue('k')
})

test('a switch key that is also a shortcut (R) wins over rotating', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 160, 160)
  await page.getByLabel('Key', { exact: true }).fill('r')
  await page.keyboard.press('Enter')
  const before = await page.locator(`.comp[data-id="${sw}"] > g`).getAttribute('transform')
  await page.keyboard.press('r')
  expect(await page.locator(`.comp[data-id="${sw}"] > g`).getAttribute('transform')).toBe(before)
})

test('the keyboard presses the keys of a keypad', async ({ page }) => {
  await freshEmpty(page)
  const pad = await place(page, 'keypad', 160, 200)
  const k0 = await place(page, 'led', 520, 160)
  const p = await place(page, 'led', 520, 260)
  await wire(page, [pad, 'K0'], [k0, 'A'])
  await wire(page, [pad, 'P'], [p, 'A'])
  await page.getByTestId('canvas').click({ position: { x: 800, y: 480 } })
  await page.keyboard.down('5') // 0101: K0 is 1
  await expect.poll(() => ledOn(page, k0)).toBe(true)
  await expect.poll(() => ledOn(page, p)).toBe(true) // P is 1 while a key is held
  await page.keyboard.up('5')
  await expect.poll(() => ledOn(page, p)).toBe(false)
  expect(await ledOn(page, k0)).toBe(true) // the code stays
  await page.keyboard.press('4') // 0100
  await expect.poll(() => ledOn(page, k0)).toBe(false)
  await page.keyboard.press('b') // 1011: a hex digit
  await expect.poll(() => ledOn(page, k0)).toBe(true)
})
