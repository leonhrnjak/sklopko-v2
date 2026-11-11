import { expect, test, type Page } from '@playwright/test'
import { chooseExample, chooseTool, fresh, freshEmpty, place, wire } from './helpers'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Tests' })

/** Name the selected part. */
async function label(page: Page, text: string) {
  await page.getByLabel('Label', { exact: true }).fill(text)
  await page.keyboard.press('Enter')
}

/** A D flip-flop with switches D and CLK and an LED Q. */
async function flipFlop(page: Page) {
  await freshEmpty(page)
  const d = await place(page, 'switch', 120, 130)
  await label(page, 'D')
  const clk = await place(page, 'switch', 120, 260)
  await label(page, 'CLK')
  const ff = await place(page, 'dff', 320, 160)
  const q = await place(page, 'led', 540, 160)
  await label(page, 'Q')
  await wire(page, [d, 'Q'], [ff, 'D'])
  await wire(page, [clk, 'Q'], [ff, 'CLK'])
  await wire(page, [ff, 'Q'], [q, 'A'])
}

test('write steps for a circuit, run them, and see which fail and why; the steps are saved with the circuit', async ({ page }) => {
  await flipFlop(page)
  await chooseTool(page, 'Tests')
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByTestId('test-inputs')).toHaveText('D, CLK')
  await expect(dialog(page).getByTestId('test-outputs')).toHaveText('Q')
  await expect(dialog(page).getByRole('button', { name: 'Run tests' })).toBeDisabled()

  const steps = dialog(page).getByLabel('Test steps')
  await steps.fill('# a D flip-flop\nexpect Q=0\nD=1; pulse CLK; expect Q=1\nD=0; expect Q=1\npulse CLK; expect Q=0')
  await dialog(page).getByRole('button', { name: 'Run tests' }).click()
  await expect(dialog(page).getByTestId('test-summary')).toHaveText('All 4 steps passed.')

  // A step that is wrong: Q has not taken D until the clock pulses.
  await steps.fill('D=1; expect Q=1\npulse CLK; expect Q=1')
  await dialog(page).getByRole('button', { name: 'Run tests' }).click()
  await expect(dialog(page).getByTestId('test-summary')).toHaveText('1 of 2 steps did not pass.')
  const failing = dialog(page).getByRole('list', { name: 'Failing steps' })
  await expect(failing).toContainText('Line 1')
  await expect(failing).toContainText('D=1; expect Q=1')
  await expect(failing).toContainText('Q was 0, expected 1.')
  await expect(failing.getByRole('listitem')).toHaveCount(1)

  // Mistakes in the text, and names the circuit does not have.
  await steps.fill('D=2\nexpect')
  await dialog(page).getByRole('button', { name: 'Run tests' }).click()
  const errors = dialog(page).getByRole('list', { name: 'Errors' })
  await expect(errors).toContainText('Line 1: “D=2” is not NAME=0 or NAME=1')
  await expect(errors).toContainText('Line 2: expect needs what to expect')
  await steps.fill('X=1\nexpect Z=1')
  await dialog(page).getByRole('button', { name: 'Run tests' }).click()
  await expect(failing).toContainText('There is no switch called X.')
  await expect(failing).toContainText('There is no LED called Z.')

  // Saved with the circuit: close, reload, open again.
  await steps.fill('D=1; pulse CLK; expect Q=1')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: 'networkidle' })
  await chooseTool(page, 'Tests')
  await expect(dialog(page).getByLabel('Test steps')).toHaveValue('D=1; pulse CLK; expect Q=1')
  await dialog(page).getByRole('button', { name: 'Run tests' }).click()
  await expect(dialog(page).getByTestId('test-summary')).toHaveText('All 1 step passed.')
})

test('the testbench example comes with its tests saved in it, and they pass', async ({ page }) => {
  await fresh(page)
  await chooseExample(page, 'testbench')
  await chooseTool(page, 'Tests')
  await expect(dialog(page).getByLabel('Test steps')).toHaveValue(/Comparator/)
  await dialog(page).getByRole('button', { name: 'Run tests' }).click()
  await expect(dialog(page).getByTestId('test-summary')).toHaveText(/^All \d+ steps passed\.$/)
})
