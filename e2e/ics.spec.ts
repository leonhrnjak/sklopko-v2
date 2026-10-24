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

/** The inverter IC, made from the circuit, and an instance of it between a new switch and a new LED. */
async function inverterInUse(page: Page) {
  const made = await inverterCircuit(page)
  await chooseTool(page, 'Make IC…')
  await dialog(page).getByLabel('IC name').fill('Inverter')
  await dialog(page).getByRole('button', { name: 'Make IC' }).click()
  const sw = await place(page, 'switch', 120, 330)
  const ic = await place(page, 'ic:inverter', 300, 330)
  const led = await place(page, 'led', 480, 330)
  await wire(page, [sw, 'Q'], [ic, 'A'])
  await wire(page, [ic, 'Y'], [led, 'A'])
  await expect.poll(() => ledOn(page, led)).toBe(true)
  return { ...made, sw2: sw, ic, led2: led }
}

test('edit the inside of an IC: the instance changes with it, the way back is shown, and undo goes through the levels', async ({ page }) => {
  const { sw2, ic, led2, inv } = await inverterInUse(page)
  // Open it from the inspector (the instance is selected after wiring: select it by clicking).
  await clickComp(page, ic)
  await page.getByRole('button', { name: 'Edit IC' }).click()
  const crumbs = page.getByTestId('crumbs')
  await expect(crumbs).toContainText('Main')
  await expect(crumbs.locator('[aria-current]')).toHaveText('Inverter')
  // Inside is the circuit it was made from: a switch, the inverter and an LED, each live, with no instance around.
  await expect(page.locator('.comp')).toHaveCount(3)
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toHaveCount(0)
  // Take the inverter out and join the switch to the LED.
  await page.locator(`.comp[data-id="${inv}"]`).click({ button: 'right' })
  await page.keyboard.press('Delete')
  await expect(page.locator('.comp')).toHaveCount(2)
  const [a, b] = await page.locator('.comp').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!))
  const first = await page.locator(`.comp[data-id="${a}"] .comp-label`).textContent()
  const [from, to] = first === 'A' ? [a, b] : [b, a]
  await wire(page, [from, 'Q'], [to, 'A'])
  await page.getByRole('button', { name: '← Back' }).click()
  await expect(crumbs).toHaveCount(0)
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toBeVisible()
  // The instance is a plain wire now: LED off with the switch off, on with it on.
  await expect.poll(() => ledOn(page, led2)).toBe(false)
  await clickComp(page, sw2)
  await expect.poll(() => ledOn(page, led2)).toBe(true)

  // Undo goes back through the levels: first into the IC again, as it was when it was left.
  await page.keyboard.press('Control+z')
  await expect(crumbs).toBeVisible()
  await expect(page.locator('.wire-group')).toHaveCount(1)
  await page.keyboard.press('Control+z') // the wire
  await expect(page.locator('.wire-group')).toHaveCount(0)
  await expect(page.locator('.comp')).toHaveCount(2)
  await page.keyboard.press('Control+z') // the inverter comes back
  await expect(page.locator('.comp')).toHaveCount(3)
})

test('a double-click opens an instance, and the way back can be taken from the breadcrumb', async ({ page }) => {
  const { ic } = await inverterInUse(page)
  const b = (await page.locator(`.comp[data-id="${ic}"] > g`).boundingBox())!
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
  await expect(page.getByTestId('crumbs').locator('[aria-current]')).toHaveText('Inverter')
  await page.getByTestId('crumbs').getByRole('button', { name: 'Main' }).click()
  await expect(page.getByTestId('crumbs')).toHaveCount(0)
  await expect(page.locator(`.comp[data-id="${ic}"]`)).toBeVisible()
})

test('an IC gone from the pins: changing a pin inside removes the wire to it, and says so', async ({ page }) => {
  const { ic, led, sw } = await inverterInUse(page)
  void led
  void sw
  await page.getByTestId('ic-section').getByTestId('ic-edit-inverter').click()
  await expect(page.getByTestId('crumbs')).toBeVisible()
  // Change the label of the output LED inside: the pin is not called Y any more.
  const leds = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Y$/ }) })
  await leds.first().click()
  await page.getByLabel('Label', { exact: true }).fill('Z')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '← Back' }).click()
  await expect(page.locator('.toast')).toContainText('1 wire was removed')
  await clickComp(page, ic)
  await expect(page.locator('.inspector')).toContainText('Outputs: Z')
})

test('rename and delete ICs from the parts list: a used one is kept', async ({ page }) => {
  const { ic } = await inverterInUse(page)
  const item = page.getByTestId('ic-section')
  await item.getByRole('button', { name: 'Rename Inverter' }).click()
  await item.getByLabel('New name for Inverter').fill('Not gate')
  await page.keyboard.press('Enter')
  await expect(item.locator('.palette-name')).toHaveText('Not gate')
  await clickComp(page, ic)
  await expect(page.locator('.inspector h2')).toHaveText('Not gate')

  await item.getByRole('button', { name: 'Delete Not gate' }).click()
  await expect(page.locator('.toast')).toContainText('is in use')
  await expect(item.locator('.palette-name')).toHaveText('Not gate')
  // With the instance gone it can be deleted, and the toast brings it back.
  await page.locator(`.comp[data-id="${ic}"]`).click({ button: 'right' })
  await page.keyboard.press('Delete')
  await item.getByRole('button', { name: 'Delete Not gate' }).click()
  await expect(page.getByTestId('ic-section')).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('ic-section').locator('.palette-name')).toHaveText('Not gate')
})

test('collapse selected parts into an IC: they become one block, wired as they were, in one undo step', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 120, 150)
  await page.getByLabel('Label', { exact: true }).fill('A')
  await page.keyboard.press('Enter')
  const n1 = await place(page, 'not', 300, 150)
  const n2 = await place(page, 'not', 460, 150)
  const led = await place(page, 'led', 640, 150)
  await wire(page, [sw, 'Q'], [n1, 'A'])
  await wire(page, [n1, 'Y'], [n2, 'A'])
  await wire(page, [n2, 'Y'], [led, 'A'])
  await expect.poll(() => ledOn(page, led)).toBe(false)
  // Select the two gates.
  await page.keyboard.press('Escape')
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + 250, canvas.y + 90)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 560, canvas.y + 230, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.comp.selected')).toHaveCount(2)
  await page.getByRole('button', { name: 'Collapse into IC…' }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByLabel(/Replace the selected parts/)).toBeChecked()
  await expect(dialog(page).getByTestId('ic-inputs')).toHaveText('A')
  await expect(dialog(page).getByTestId('ic-outputs')).toHaveText('out1')
  await dialog(page).getByLabel('IC name').fill('Buffer')
  await dialog(page).getByRole('button', { name: 'Make IC' }).click()
  await expect(page.locator(`.comp[data-id="${n1}"]`)).toHaveCount(0)
  await expect(page.locator('.comp')).toHaveCount(3) // the switch, the block and the LED
  await expect(page.locator('.comp.selected')).toHaveCount(1)
  await expect(page.getByTestId('ic-section').locator('.palette-name')).toHaveText('Buffer')
  // It still works: the LED follows the switch.
  await clickComp(page, sw)
  await expect.poll(() => ledOn(page, led)).toBe(true)
  await clickComp(page, sw)
  await expect.poll(() => ledOn(page, led)).toBe(false)
  // One undo brings the gates back.
  await page.keyboard.press('Control+z')
  await expect(page.locator(`.comp[data-id="${n1}"]`)).toBeVisible()
  await expect(page.locator('.comp')).toHaveCount(4)
})

test('the examples with custom ICs open: a 4-bit adder of nested ICs, and the computer as blocks', async ({ page }) => {
  await page.goto('/ic-adder', { waitUntil: 'networkidle' })
  const section = page.getByTestId('ic-section')
  await expect(section.locator('.palette-name')).toHaveText(['Half adder', 'Full adder', '4-bit adder'])
  // Inside the 4-bit adder are four full adders, each an IC.
  await page.getByTestId('ic-edit-4-bit-adder').click()
  await expect(page.getByTestId('crumbs').locator('[aria-current]')).toHaveText('4-bit adder')
  await expect(page.locator('.comp[data-id^="ic"]')).toHaveCount(4)
  await page.getByRole('button', { name: '← Back' }).click()

  await page.goto('/computer-blocks', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp[data-id^="c-b"]')).toHaveCount(7)
  await expect(page.getByTestId('ic-section').locator('.palette-name')).toHaveText(['Fetch', 'Program ROM', 'Instruction fields', 'Control', 'Data memory', 'ALU', 'Accumulator'])
  // It runs: the decimal display shows a number after a few seconds.
  const seg = page.locator('.comp polygon.seg.on')
  await expect.poll(async () => seg.count(), { timeout: 15000 }).toBeGreaterThan(0)
})
