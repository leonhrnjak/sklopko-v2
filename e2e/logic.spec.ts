import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { freshEmpty, tableRows, chooseTool, chooseFile } from './helpers'


test('logic: analyze a circuit: truth table, smallest expression and Karnaugh map', async ({ page }) => {
  await page.goto('/gates', { waitUntil: 'networkidle' })
  await chooseTool(page, 'Logic…')
  const panel = page.getByRole('dialog', { name: 'Logic tools' })
  await expect(panel).toBeVisible()
  // Inputs A, B; four outputs (the labels become names).
  await expect(panel.getByRole('checkbox', { name: 'A', exact: true })).toBeChecked()
  expect(await tableRows(page, 'Truth table')).toEqual([
    ['0', '0', '0', '0', '0', '1'],
    ['0', '1', '0', '1', '1', '1'],
    ['1', '0', '0', '1', '1', '1'],
    ['1', '1', '1', '1', '0', '0'],
  ])
  const expressions = panel.getByLabel('Expressions')
  await expect(expressions).toContainText('A_AND_B = A·B')
  await expect(expressions).toContainText('A_OR_B = A + B')
  await expect(expressions).toContainText('A_XOR_B = A·¬B + ¬A·B')
  await expect(expressions).toContainText('A_NAND_B = ¬A + ¬B')
  // The Karnaugh map of the first output: one 1, in one group.
  const map = panel.getByRole('table', { name: 'Karnaugh map of A_AND_B' })
  await expect(map.locator('.kcell.v1')).toHaveCount(1)
  await expect(panel.locator('.klegend')).toContainText('A·B')
  await panel.getByLabel('Map of output').selectOption({ label: 'A_OR_B' })
  await expect(page.getByRole('table', { name: 'Karnaugh map of A_OR_B' }).locator('.kcell.v1')).toHaveCount(3)
  await expect(panel.locator('.klegend li')).toHaveCount(2) // A and B

  // Fewer outputs, fewer columns.
  for (const name of ['A_AND_B', 'A_OR_B', 'A_NAND_B']) await panel.getByRole('checkbox', { name, exact: true }).uncheck()
  expect(await tableRows(page, 'Truth table')).toEqual([['0', '0', '0'], ['0', '1', '1'], ['1', '0', '1'], ['1', '1', '0']])
  // Escape closes it.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('logic: an empty canvas explains what to do', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'Logic…')
  await expect(page.getByRole('dialog')).toContainText('Put at least one Switch and one LED on the canvas')
})

test('logic: build a circuit from an expression, put it on the canvas, and analyze what was built', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'Logic…')
  const panel = page.getByRole('dialog', { name: 'Logic tools' })
  await panel.getByRole('tab', { name: 'Build circuit' }).click()
  const box = panel.getByLabel('Expressions')
  // Mistakes are explained, by line.
  await box.fill('Y = A·B +\nZ = (A')
  await expect(panel.getByLabel('Errors')).toContainText('Line 1')
  await expect(panel.getByLabel('Errors')).toContainText('The expression ends too early')
  await expect(panel.getByLabel('Errors')).toContainText('Line 2')
  await expect(panel.getByLabel('Errors')).toContainText('Missing “)”')
  await expect(panel.getByRole('button', { name: 'Build circuit' })).toHaveCount(0)
  await box.fill('A B')
  await expect(panel.getByLabel('Errors')).toContainText('Missing operator before “B”')
  // Symbol buttons insert at the cursor.
  await box.fill('Y = A')
  await panel.getByRole('button', { name: 'Insert ·' }).click()
  await page.keyboard.type('B')
  await panel.getByRole('button', { name: 'Insert +' }).click()
  await panel.getByRole('button', { name: 'Insert ¬' }).click()
  await page.keyboard.type('C')
  await expect(box).toHaveValue('Y = A·B+¬C')
  await box.fill('Y = A·B + ¬C')
  await expect(panel).toContainText('Inputs: A, B, C. Outputs: Y.')
  expect(await tableRows(page, 'Truth table')).toEqual([
    ['0', '0', '0', '1'], ['0', '0', '1', '0'], ['0', '1', '0', '1'], ['0', '1', '1', '0'],
    ['1', '0', '0', '1'], ['1', '0', '1', '0'], ['1', '1', '0', '1'], ['1', '1', '1', '1'],
  ])
  await panel.getByRole('button', { name: 'Build circuit' }).click()
  await expect(panel).toBeHidden()
  await expect(page.locator('.toast')).toContainText('Built the circuit')
  // On the canvas: three switches, an LED, the gates and the wires.
  const labels = page.getByTestId('canvas').locator('.comp-label')
  await expect(labels).toHaveText(['A', 'B', 'C', 'Y'])
  await expect(page.locator('.comp .switch-track')).toHaveCount(3)
  expect(await page.locator('.wire-group').count()).toBeGreaterThanOrEqual(6)

  // And it does what was asked: analyze it.
  await chooseTool(page, 'Logic…')
  await page.getByRole('tab', { name: 'Analyze circuit' }).click()
  expect((await tableRows(page, 'Truth table')).map((r) => r.at(-1))).toEqual(['1', '0', '1', '0', '1', '0', '1', '1'])
  await expect(page.getByLabel('Expressions')).toContainText('Y = A·B + ¬C')
})

test('logic: the circuit built from an expression really works when you flip its switches', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'Logic…')
  await page.getByRole('tab', { name: 'Build circuit' }).click()
  await page.getByLabel('Expressions').fill('Y = A ⊕ B')
  await page.getByRole('button', { name: 'Build circuit' }).click()
  const led = page.locator('.comp', { has: page.locator('.led-fill') })
  const sw = (label: string) => page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).locator('> g').first()
  const click = async (label: string) => {
    const b = (await sw(label).boundingBox())!
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  }
  const lit = () => led.locator('.led-fill.on').count()
  await expect.poll(lit).toBe(0)
  await click('A')
  await expect.poll(lit).toBe(1)
  await click('B')
  await expect.poll(lit).toBe(0)
  await click('A')
  await expect.poll(lit).toBe(1)
})

test('logic: undo removes a built circuit in one step', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'Logic…')
  await page.getByRole('tab', { name: 'Build circuit' }).click()
  await page.getByLabel('Expressions').fill('Y = A·B')
  await page.getByRole('button', { name: 'Build circuit' }).click()
  await expect(page.locator('.comp')).toHaveCount(4) // two switches, an AND, an LED
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.comp')).toHaveCount(0)
})

test('logic: build from a truth table you fill in, with a don’t care', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'Logic…')
  const panel = page.getByRole('dialog', { name: 'Logic tools' })
  await panel.getByRole('tab', { name: 'Build circuit' }).click()
  await panel.getByRole('radio', { name: 'Truth table' }).click()
  await panel.getByLabel('Number of inputs').selectOption('2')
  const cell = (row: number) => panel.getByRole('button', { name: `Row ${row}`, exact: true })
  await expect(cell(3)).toHaveText('0')
  await cell(3).click() // A·B = 1
  await expect(cell(3)).toHaveText('1')
  await expect(panel).toContainText('Y = A·B')
  await cell(2).click() // A·¬B = 1
  await expect(panel).toContainText('Y = A') // A·B + A·¬B simplifies to A
  await cell(2).click() // → X (don't care): A·¬B may be anything, so it can merge with A·B into plain A
  await expect(cell(2)).toHaveText('X')
  await expect(panel).toContainText('Y = A')
  await cell(2).click() // → 0 again
  await expect(cell(2)).toHaveText('0')
  await expect(panel).toContainText('Y = A·B')
  await panel.getByLabel('Output name').fill('Out')
  await panel.getByRole('button', { name: 'Build circuit' }).click()
  await expect(page.getByTestId('canvas').locator('.comp-label')).toHaveText(['A', 'B', 'Out'])
})

test('logic: compare a circuit with an expression, and with another circuit file', async ({ page }) => {
  await page.goto('/gates', { waitUntil: 'networkidle' })
  await chooseTool(page, 'Logic…')
  const panel = page.getByRole('dialog', { name: 'Logic tools' })
  await panel.getByRole('tab', { name: 'Compare' }).click()
  const box = panel.getByLabel('Expression to compare with')
  // De Morgan: NAND is ¬A + ¬B.
  await box.fill('A_NAND_B = ¬A + ¬B\nA_AND_B = ¬(¬A + ¬B)')
  await expect(panel.getByRole('status')).toContainText('✔ Equivalent')
  await expect(panel.getByRole('status')).toContainText('all 4 combinations')
  // A different function: the differing rows are listed.
  await box.fill('A_AND_B = A + B')
  await expect(panel.getByRole('status')).toContainText('✘ Not equivalent: they differ in 2 places')
  const diff = await tableRows(page, 'Differences')
  expect(diff).toEqual([['0', '1', 'A_AND_B', '0', '1'], ['1', '0', 'A_AND_B', '0', '1']])
  // Nothing in common.
  await box.fill('Q = A')
  await expect(panel.getByRole('status')).toContainText('No output has the same name')
  // A mistake in the expression.
  await box.fill('A_AND_B = A +')
  await expect(panel.getByLabel('Errors')).toContainText('The expression ends too early')

  // Another circuit: the same one, saved to a file, is equivalent to itself.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Close' }).click()
  await chooseFile(page, 'Save file')
  const saved = readFileSync((await (await download).path())!)
  await chooseTool(page, 'Logic…')
  await panel.getByRole('tab', { name: 'Compare' }).click()
  await panel.getByRole('radio', { name: 'A circuit file' }).click()
  const chooser = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: 'Open a circuit file…' }).click()
  await (await chooser).setFiles({ name: 'gates.json', mimeType: 'application/json', buffer: saved })
  await expect(panel.getByRole('status')).toContainText('✔ Equivalent')
  await expect(panel.getByRole('status')).toContainText('A_AND_B, A_OR_B, A_XOR_B, A_NAND_B')
  // A file that is not a circuit is explained.
  const bad = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: 'Open a circuit file…' }).click()
  await (await bad).setFiles({ name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await expect(panel.getByLabel('Errors')).toContainText('Could not read nope.json')
})

test('logic: analyze says when the circuit only has parts it cannot read (4-bit inputs, displays)', async ({ page }) => {
  await page.goto('/adder', { waitUntil: 'networkidle' })
  await chooseTool(page, 'Logic…')
  const panel = page.getByRole('dialog', { name: 'Logic tools' })
  await expect(panel).toContainText('which this tab does not read')
})
