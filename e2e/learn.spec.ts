import { expect, test, type Page } from '@playwright/test'
import { PATH_STEPS } from '../src/model/path/steps'
import { clickLabelled, fresh, pinCenter, place, wire } from './helpers'

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
  await expect(map(page)).toContainText(`0 of ${PATH_STEPS.length} steps`)
  await expect(map(page).getByTestId('learn-continue')).toContainText('Start: 1.1 A bit is a 0 or a 1')
  await expect(map(page).getByTestId('learn-chapter-programming')).toContainText('soon')
  await page.getByTestId('learn-chapter-nand').click()
  await page.getByTestId('learn-step-not-from-nand').click()

  // The step: its panel, and a parts list with just what it offers.
  await expect(map(page)).toBeHidden()
  await expect(panel(page)).toContainText('2.2 NOT, from one NAND')
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
  await expect(panel(page)).toContainText('2.3 AND, from NAND and your NOT')
  await expect(page.getByTestId('ic-section')).toContainText('Your kit')
  const chip = page.locator('.palette-item[data-type="ic:kit:not-from-nand"]')
  await expect(chip).toBeVisible()
  await expect(page.getByTestId('step-ours')).toHaveCount(0)
  await expect(page.getByTestId('ic-section').getByRole('button', { name: /Delete|Rename|Edit/ })).toHaveCount(0)

  const g = await place(page, 'nand', 200, 80)
  const inv = await place(page, 'ic:kit:not-from-nand', 340, 80)
  // The chip of a NOT is drawn as a NOT gate, not as a box.
  await expect(page.locator(`.comp[data-id="${inv}"] .ic-gate`)).toHaveCount(1)
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
  await expect(panel(page)).toContainText('2.3 AND, from NAND and your NOT')
  await expect(page.locator('.comp')).toHaveCount(5) // two switches, the LED, the NAND and the NOT
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText(`2 of ${PATH_STEPS.length} steps`)
  await expect(map(page).getByTestId('kit-chip')).toHaveCount(2)
  await expect(map(page).getByTestId('learn-step-and-from-nand')).toContainText('chip: AND')
})

test('learn: a link to a step, Show a solution counts as shown, a read step, and forgetting', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/and-from-nand', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('2.3 AND, from NAND and your NOT')
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
  await expect(map(page)).toContainText(`1 of ${PATH_STEPS.length} steps`)

  // A read step is done when the learner says so, and leads on.
  await page.getByTestId('learn-chapter-signals').click()
  await page.getByTestId('learn-step-binary').click()
  await expect(panel(page)).toContainText('Counting with four bits')
  await expect(page.getByRole('table').first()).toContainText('4 + 2 = 6')
  await panel(page).getByTestId('step-next').click()
  await expect(panel(page)).toContainText('Making numbers')
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText(`2 of ${PATH_STEPS.length} steps`)

  // Closing the step takes the panel away and the parts list is whole again.
  await map(page).getByRole('button', { name: 'Close' }).click()
  await panel(page).getByRole('button', { name: 'Close step' }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.locator('.palette-item').count()).toBeGreaterThan(20)
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
  await expect(map(page)).toContainText(`1 of ${PATH_STEPS.length} steps`)
  await expect(map(page).getByTestId('kit-chip')).toHaveCount(1)
  await map(page).getByTestId('learn-forget').click()
  await map(page).getByTestId('learn-forget-yes').click()
  await expect(map(page)).toContainText(`0 of ${PATH_STEPS.length} steps`)
  await expect(map(page).getByTestId('kit-chip')).toHaveCount(0)
  // The address is /learn while the map is open, so a reload opens it again.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(map(page)).toContainText(`0 of ${PATH_STEPS.length} steps`)
})

test('learn: another document ends the step, and the palette has every part again', async ({ page }) => {
  await fresh(page)
  await openStep(page, 'nand', 'not-from-nand')
  await expect(page.locator('.palette-item')).toHaveCount(3)
  await page.getByRole('button', { name: 'File ▾' }).click()
  await page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'New', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.locator('.palette-item').count()).toBeGreaterThan(20)
})

test('learn: after finishing a chapter the map opens on it, and a skipped step is offered as going back', async ({ page }) => {
  await fresh(page)
  // Everything is done but step 1.3, and the learner was last on the last step of the path.
  const last = PATH_STEPS[PATH_STEPS.length - 1]
  const done = Object.fromEntries(PATH_STEPS.filter((id) => id !== 'binary').map((id) => [id, { at: 1, how: 'solved' }]))
  await page.evaluate(({ d, current }) => localStorage.setItem('sklopko.path.v1', JSON.stringify({ v: 1, done: d, current, quiz: {} })), { d: done, current: last })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('learn-button').click()
  // The chapter of the last step is the one on show, not chapter 1 where the skipped step is.
  await expect(map(page).getByTestId(`learn-step-${last}`)).toBeVisible()
  await expect(map(page).getByTestId('learn-continue')).toContainText('Go back to a step you skipped: 1.3 Counting with four bits')
  await map(page).getByTestId('learn-chapter-signals').click()
  await expect(map(page).getByTestId('learn-step-binary')).toContainText('skipped')
})

test('learn: a quiz says at once what is right, chapter 3 shows the map, and the NAND-NAND step earns a star and leads back to XOR', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/table-to-sop', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('Every truth table is a circuit')
  // The 1-rows of the table are marked.
  await expect(panel(page).locator('table.truth tr.hl')).toHaveCount(4)

  const first = panel(page).getByTestId('quiz-0')
  await first.getByLabel('A·B·C').check()
  await expect(first.getByRole('status')).toContainText('Not quite')
  await first.getByLabel('A·¬B·C').check()
  await expect(first.getByRole('status')).toContainText('✔')
  // Reading is never blocked; all answers right marks the step read.
  await panel(page).getByTestId('quiz-1').getByLabel('Five').check()
  await page.waitForTimeout(200)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(panel(page).getByTestId('quiz-0').getByLabel('A·¬B·C')).toBeChecked()
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText(`1 of ${PATH_STEPS.length} steps`)
  await map(page).getByRole('button', { name: 'Close' }).click()

  // The Karnaugh map of the lesson: three groups for majority.
  await page.goto('/learn/kmap', { waitUntil: 'networkidle' })
  await expect(panel(page).locator('.kmap')).toBeVisible()
  await expect(panel(page).locator('.klegend li')).toHaveCount(3)

  // NAND-NAND: only NAND gates, so the plain AND-OR circuit is refused; the solution is four gates and earns the star.
  await page.goto('/learn/sop-nand', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('Majority in four NANDs')
  await expect(panel(page)).toContainText('Only these gates: NAND')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page)).toContainText('par of 4')
  await expect(panel(page).getByTestId('step-after')).toContainText('A⊕B')
  await panel(page).getByTestId('step-after').getByRole('button').click()
  await expect(panel(page)).toContainText('XOR, from your kit')
  await expect(page).toHaveURL(/\/learn\/xor-from-kit$/)
})

test('learn: an explore step ticks its goals while you play, and is done when they all are', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/bits', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('1.1 A bit is a 0 or a 1')
  const goals = panel(page).getByTestId('goals')
  await expect(goals.getByRole('listitem')).toHaveCount(2)
  await expect(goals).toContainText('☐ Y is lit')
  // The second goal waits for the first: "dark again" does not count while the LED has never been lit.
  await expect(panel(page)).toContainText('0 of 2')
  await clickLabelled(page, 'S')
  await expect(goals).toContainText('☑ Y is lit')
  await expect(goals).toContainText('☐ Y is dark again')
  await expect(panel(page).getByTestId('explore-done')).toHaveCount(0)
  await clickLabelled(page, 'S')
  await expect(goals).toContainText('☑ Y is dark again')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()

  // Done is remembered: the map counts it, and a reload shows the step done with its goals ticked.
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
  await expect(goals).toContainText('☑ Y is lit')
  await page.getByTestId('learn-button').click()
  await expect(map(page)).toContainText(`1 of ${PATH_STEPS.length} steps`)
  await map(page).getByRole('button', { name: 'Close' }).click()

  // Next goes on to the step after it.
  await panel(page).getByTestId('step-next').click()
  await expect(panel(page)).toContainText('Make the light follow the switch')
})

test('learn: the NAND gate to play with has one setting that makes it dark', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/meet-nand', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('2.1 Meet the NAND gate')
  await clickLabelled(page, 'A')
  await expect(panel(page).getByTestId('explore-done')).toHaveCount(0)
  await clickLabelled(page, 'B')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
  // Start over puts the circuit back; the step stays done.
  await panel(page).getByRole('button', { name: 'Start over' }).click()
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
})

test('learn: a part named in a lesson is outlined when pointed at, and brought forward and dimmed round when clicked', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/meet-nand', { waitUntil: 'networkidle' })
  const names = panel(page).locator('.spot-name')
  await expect(names).toHaveText(['A', 'B', 'Y'])
  const spot = page.getByTestId('spotlight')
  await expect(spot).toHaveCount(0)
  await names.nth(0).hover()
  await expect(spot).toHaveAttribute('data-label', 'A')
  await expect(spot).toHaveAttribute('data-dim', 'off')
  await expect(spot.locator('.spot-ring')).toHaveCount(1)
  // The ring is on the switch A.
  const ring = (await spot.locator('.spot-ring').boundingBox())!
  const sw = (await page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^A$/ }) }).boundingBox())!
  expect(ring.x).toBeLessThan(sw.x)
  expect(ring.x + ring.width).toBeGreaterThan(sw.x + sw.width)
  await page.mouse.move(5, 5)
  await expect(spot).toHaveCount(0)
  // A click dims the rest of the canvas for a moment, then lets go.
  await names.nth(2).click()
  await expect(spot).toHaveAttribute('data-label', 'Y')
  await expect(spot).toHaveAttribute('data-dim', 'on')
  await expect(spot.locator('.spot-dim')).toHaveCount(1)
  await page.mouse.move(5, 5)
  await expect(spot).toHaveCount(0, { timeout: 5000 })
})

test('learn: chapter 4 builds a decoder from the kit, and the 4-way multiplexer to play with ticks three goals in order', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/decoder', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('A line for each number')
  await expect(panel(page)).toContainText('You haven’t built NOT or AND yet')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('chip-earned')).toContainText('DEC2 is in your kit')

  await page.goto('/learn/mux4-tour', { waitUntil: 'networkidle' })
  const goals = panel(page).getByTestId('goals')
  await expect(goals.getByRole('listitem')).toHaveCount(3)
  await clickLabelled(page, 'D2')
  await expect(goals).toContainText('☐ Choose input 2')
  await clickLabelled(page, 'S1')
  await expect(goals).toContainText('☑ Choose input 2')
  await expect(goals).toContainText('☑ Turn D2 on while it is chosen')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
})

test('learn: a chip that is a gate sits in a chip frame with its name and a glyph that opens it', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/and-from-nand', { waitUntil: 'networkidle' })
  const inv = await place(page, 'ic:kit:not-from-nand', 340, 80)
  const chip = page.locator(`.comp[data-id="${inv}"]`)
  // A frame, a tab with the name, and the glyph, so it cannot be taken for the built-in gate.
  await expect(chip.locator('.chip-body')).toHaveCount(1)
  await expect(chip.locator('.chip-name')).toHaveText('NOT')
  await expect(chip.getByTestId('chip-open')).toHaveCount(1)
  // The legs are the pins: each pin dot sits 10 units outside the frame, level with the end of its leg, and a wire to it ends there.
  await wire(page, ['switch1', 'Q'], [inv, 'A'])
  const frame = (await chip.locator('.chip-body').boundingBox())!
  const dot = await pinCenter(page, inv, 'A')
  // The box measured includes half the 2.5 stroke on each side; the frame of a NOT is 50 wide.
  const zoom = frame.width / 52.5
  const left = frame.x + 1.25 * zoom
  const right = frame.x + frame.width - 1.25 * zoom
  expect(dot.x).toBeCloseTo(left - 10 * zoom, 0)
  const out = await pinCenter(page, inv, 'Y')
  expect(out.x).toBeCloseTo(right + 10 * zoom, 0)
  // The leg is drawn up to the dot: the line that ends at the pin starts inside the frame.
  const leg = (await chip.locator('line.sym-line').first().boundingBox())!
  expect(Math.abs(leg.x - dot.x)).toBeLessThan(2 * zoom) // the round end of the line is a little outside
  // Clicking the glyph opens the chip, without selecting or moving it.
  const g = (await chip.getByTestId('chip-open').boundingBox())!
  await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2)
  await expect(page.getByTestId('crumbs').locator('[aria-current]')).toHaveText('NOT')
})

test('learn: chapter 5 builds a half adder from the kit, ADD4 asks for nine inputs, and the carry to play with ticks two goals', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/half-adder', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('Add two bits')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('chip-earned')).toContainText('HA is in your kit')

  // The 4-bit adder is checked on all 512 rows.
  await page.goto('/learn/adder4', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp')).toHaveCount(14) // nine switches and five LEDs
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!', { timeout: 20_000 })
  await expect(panel(page).getByTestId('chip-earned')).toContainText('ADD4 is in your kit')

  await page.goto('/learn/ripple-tour', { waitUntil: 'networkidle' })
  const goals = panel(page).getByTestId('goals')
  await expect(goals.getByRole('listitem')).toHaveCount(2)
  await expect(goals).toContainText('☐ Cout is lit')
  // Taking A down to 0 shows a 0 too, but the sum goal waits for the carry out.
  await clickLabelled(page, 'A')
  await expect(goals).toContainText('☐ Sum shows 0')
  for (let i = 0; i < 15; i++) await clickLabelled(page, 'A') // back to 15
  await clickLabelled(page, 'B')
  await expect(goals).toContainText('☑ Cout is lit', { timeout: 10_000 })
  await expect(goals).toContainText('☑ Sum shows 0')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
})

test('learn: chapter 6 builds a zero detector and the ALU from the kit, and the built-in ALU ticks its two flag goals', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/is-zero', { waitUntil: 'networkidle' })
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('chip-earned')).toContainText('ZERO is in your kit')

  // The ALU: ten switches and six LEDs, checked on all 1024 rows.
  await page.goto('/learn/alu4', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp')).toHaveCount(16)
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!', { timeout: 30_000 })
  await expect(panel(page).getByTestId('chip-earned')).toContainText('ALU is in your kit')

  // Turning S1 on ANDs 6 and 9: no bit in common, so Z. Then 6 + 10 carries out.
  await page.goto('/learn/alu-tour', { waitUntil: 'networkidle' })
  const goals = panel(page).getByTestId('goals')
  await expect(goals.getByRole('listitem')).toHaveCount(2)
  await expect(goals).toContainText('☐ Z is lit')
  await clickLabelled(page, 'S1')
  await expect(goals).toContainText('☑ Z is lit')
  await expect(goals).toContainText('☐ C is lit')
  await clickLabelled(page, 'S1')
  await clickLabelled(page, 'B')
  await expect(goals).toContainText('☑ C is lit')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
})

test('learn: chapter 7 shows a gate that never settles, and a flip-flop is checked with clock pulses', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/feedback', { waitUntil: 'networkidle' })
  const goals = panel(page).getByTestId('goals')
  await expect(goals).toContainText('☐ The circuit never settles')
  await clickLabelled(page, 'Enable')
  await expect(goals).toContainText('☑ The circuit never settles')
  await clickLabelled(page, 'Enable')
  await expect(goals).toContainText('☑ Enable is off again')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()

  // The flip-flop's steps have pulses (⏉) on CLK; the unchanged starter fails, the solution passes.
  await page.goto('/learn/dff', { waitUntil: 'networkidle' })
  await expect(panel(page)).toContainText('⏉')
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Not yet')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('chip-earned')).toContainText('DFF is in your kit')
})

test('learn: finishing chapter 7 unlocks its built-in parts with a toast, and they are in the palette of a step that plays', async ({ page }) => {
  await fresh(page)
  const done = Object.fromEntries(PATH_STEPS.filter((id) => ['feedback', 'sr-latch', 'd-latch', 'dff', 'reg1'].includes(id)).map((id) => [id, { at: 1, how: 'solved' }]))
  await page.evaluate((d) => localStorage.setItem('sklopko.path.v1', JSON.stringify({ v: 1, done: d, quiz: {} })), done)
  await page.goto('/learn/reg4', { waitUntil: 'networkidle' })
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await expect(page.locator('.toast')).toContainText('Chapter 7 done')
  await expect(page.locator('.toast')).toContainText('D flip-flop')
  // An explore step offers them from now on.
  await page.goto('/learn/rom-ram-tour', { waitUntil: 'networkidle' })
  await expect(page.locator('.palette-item', { hasText: 'D flip-flop' })).toHaveCount(1)
})

test('learn: chapter 8 builds a counter from the kit, and the RAM and ROM to play with tick two goals', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/counter4', { waitUntil: 'networkidle' })
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!', { timeout: 30_000 })
  await expect(panel(page).getByTestId('chip-earned')).toContainText('COUNT4 is in your kit')

  await page.goto('/learn/rom-ram-tour', { waitUntil: 'networkidle' })
  const goals = panel(page).getByTestId('goals')
  await expect(goals.getByRole('listitem')).toHaveCount(2)
  for (let i = 0; i < 3; i++) await clickLabelled(page, 'Address')
  for (let i = 0; i < 9; i++) await clickLabelled(page, 'Data')
  await clickLabelled(page, 'WE')
  await clickLabelled(page, 'CLK')
  await expect(goals).toContainText('☑ RAM word 3 is 9')
  for (let i = 0; i < 2; i++) await clickLabelled(page, 'Address')
  await expect(goals).toContainText('☑ The ROM shows 9')
  await expect(panel(page).getByTestId('explore-done')).toBeVisible()
})

test('learn: chapter 9 shows an instruction word to click, and the CPU project is checked by running programs on it', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/cpu-plan', { waitUntil: 'networkidle' })
  const fig = panel(page).getByLabel('Instruction word')
  await expect(fig).toContainText('0300 is LDI 3')
  await fig.getByRole('button', { name: 'Bit 9' }).click()
  await expect(fig).toContainText('LDI 1')

  // The circuit starts as a clock and a ROM: the check says what is missing, then what is wrong.
  await page.goto('/learn/cpu-fetch', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp')).toHaveCount(2)
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('There is no part labelled “PC”')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('project-lines')).toContainText('☑ after 5 ticks the PC is 5')

  // The next step starts from this circuit, with the Control ROM given.
  await panel(page).getByTestId('step-next').click()
  await expect(panel(page)).toContainText('Decoding instructions')
  await expect(page.locator('.comp .comp-label', { hasText: 'Control ROM' })).toHaveCount(1)
  await expect(page.locator('.comp .comp-label', { hasText: /^PC$/ })).toHaveCount(1)
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('There is no part labelled “LOAD_ACC”')
})

test('learn: the later steps of the CPU project check RAM, the carry and jumps, and the last one confirms the whole computer', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/cpu-add', { waitUntil: 'networkidle' })
  // Started from the reference computer of the stage before it, because nothing before it was built here.
  await expect(page.locator('.comp .comp-label', { hasText: /^RAM$/ })).toHaveCount(1)
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('There is no part labelled “Carry”')
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await expect(panel(page).getByTestId('project-lines').last()).toContainText('☑ 12 + 7 is 19')

  await page.goto('/learn/cpu-jump', { waitUntil: 'networkidle' })
  await panel(page).getByRole('button', { name: 'Show a solution' }).click()
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
  await panel(page).getByTestId('step-next').click()
  await expect(panel(page)).toContainText('It is the beginner computer')
  await panel(page).getByTestId('step-check').click()
  await expect(panel(page)).toContainText('Solved!')
})
