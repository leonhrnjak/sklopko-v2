import { expect, test, type Page } from '@playwright/test'
import { chooseTool, clickComp, freshEmpty, ledOn, place, wire } from './helpers'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Make IC' })

/** A switch labelled A, an inverter and an LED labelled Y, wired in a row. */
async function inverterCircuit(page: Page) {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 120, 150)
  await page.getByLabel('Label', { exact: true }).fill('A')
  await page.keyboard.press('Enter')
  const inv = await place(page, 'not', 300, 150)
  const led = await place(page, 'led', 480, 150)
  await page.getByLabel('Label', { exact: true }).fill('Y')
  await page.keyboard.press('Enter')
  await wire(page, [sw, 'Q'], [inv, 'A'])
  await wire(page, [inv, 'Y'], [led, 'A'])
  return { sw, inv, led }
}

test('make an IC from the circuit, place it from the parts list, wire it up and run it', async ({ page }) => {
  await inverterCircuit(page)
  await chooseTool(page, 'Make IC…')
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByTestId('ic-inputs')).toHaveText('A')
  await expect(dialog(page).getByTestId('ic-outputs')).toHaveText('Y')
  await dialog(page).getByLabel('IC name').fill('Inverter')
  await dialog(page).getByRole('button', { name: 'Make IC' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('IC “Inverter” made')
  // The canvas is as it was, and the list of parts has a section for the IC.
  await expect(page.locator('.comp')).toHaveCount(3)
  const section = page.getByTestId('ic-section')
  await expect(section).toContainText('ICs in this circuit')
  await expect(section.locator('.palette-name')).toHaveText('Inverter')

  // Place it, with a switch and an LED of its own, and wire them.
  const sw2 = await place(page, 'switch', 120, 330)
  const ic = await place(page, 'ic:inverter', 300, 330)
  const led2 = await place(page, 'led', 480, 330)
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toBeVisible()
  await wire(page, [sw2, 'Q'], [ic, 'A'])
  await wire(page, [ic, 'Y'], [led2, 'A'])
  await expect(page.locator('.wire-group')).toHaveCount(4)
  // An inverter: the LED is on while the switch is off, and off when it is on.
  await expect.poll(() => ledOn(page, led2)).toBe(true)
  await clickComp(page, sw2)
  await expect.poll(() => ledOn(page, led2)).toBe(false)
  await clickComp(page, sw2)
  await expect.poll(() => ledOn(page, led2)).toBe(true)

  // The IC is part of the document: a reload brings it back, still working.
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('ic-section').locator('.palette-name')).toHaveText('Inverter')
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toBeVisible()
  await expect.poll(() => ledOn(page, led2)).toBe(true)
})

test('an IC needs inputs and outputs: the window says what is missing and does not make one', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'and', 300, 200)
  await chooseTool(page, 'Make IC…')
  await expect(dialog(page).getByRole('alert')).toHaveCount(2)
  await expect(dialog(page)).toContainText('no inputs')
  await expect(dialog(page)).toContainText('no outputs')
  await expect(dialog(page).getByRole('button', { name: 'Make IC' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
})

test('an IC made from the selected parts only, with a warning for a button inside', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 120, 150)
  const g = await place(page, 'not', 300, 150)
  const led = await place(page, 'led', 480, 150)
  await place(page, 'button', 120, 330)
  await wire(page, [sw, 'Q'], [g, 'A'])
  await wire(page, [g, 'Y'], [led, 'A'])
  // Select the three parts of the row with a marquee, leaving the button out.
  await page.keyboard.press('Escape')
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + 60, canvas.y + 90)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 560, canvas.y + 230, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.comp.selected')).toHaveCount(3)
  await chooseTool(page, 'Make IC…')
  await expect(dialog(page)).toContainText('3 selected parts')
  await expect(dialog(page).getByTestId('ic-inputs')).toHaveText('in1')
  await expect(dialog(page).getByRole('alert')).toHaveCount(0)
  await expect(dialog(page)).not.toContainText('cannot be operated')
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()

  // With the button in the circuit, the whole-circuit IC warns about it.
  await page.mouse.click(canvas.x + 700, canvas.y + 500)
  await chooseTool(page, 'Make IC…')
  await expect(dialog(page)).toContainText('Push button inside cannot be operated')
})

test('an instance can be expanded back into its parts, in one undo step', async ({ page }) => {
  await inverterCircuit(page)
  await chooseTool(page, 'Make IC…')
  await dialog(page).getByLabel('IC name').fill('Inverter')
  await dialog(page).getByRole('button', { name: 'Make IC' }).click()
  const ic = await place(page, 'ic:inverter', 300, 330)
  await expect(page.locator('.comp')).toHaveCount(4)
  // The new instance is selected: the inspector names its pins.
  await expect(page.locator('.inspector')).toContainText('Inputs: A')
  await expect(page.locator('.inspector')).toContainText('Outputs: Y')
  await page.getByRole('button', { name: 'Expand into parts' }).click()
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toHaveCount(0)
  // A NOT gate came out of the box; the switch and LED inside were its pins, so they are gone.
  await expect(page.locator('.comp')).toHaveCount(4)
  await page.keyboard.press('Control+z')
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toBeVisible()
  await expect(page.locator('.comp')).toHaveCount(4)
})
