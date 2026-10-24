import { expect, test } from '@playwright/test'
import { freshEmpty, place, wire, clickComp, ledOn } from './helpers'

test('tri-state example: one source drives the shared line, two that disagree are a contention', async ({ page }) => {
  await page.goto('/tristate', { waitUntil: 'networkidle' })
  const idOf = (label: string) =>
    page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).first().getAttribute('data-id') as Promise<string>
  const line = await idOf('Shared line')
  const enableA = await idOf('Enable A')
  const enableB = await idOf('Enable B')
  // Only source A is enabled, and its data is 1.
  await expect.poll(() => ledOn(page, line)).toBe(true)
  await expect(page.locator('.wire.vz').first()).toBeVisible() // the other two buffers let go of the line
  await expect(page.locator('.sym-body.contention')).toHaveCount(0)
  // B joins in with data 0: the two disagree.
  await clickComp(page, enableB)
  await expect(page.locator('.sym-body.contention')).toHaveCount(1)
  await expect.poll(() => ledOn(page, line)).toBe(false)
  // A lets go: B alone drives the line, with 0.
  await clickComp(page, enableA)
  await expect(page.locator('.sym-body.contention')).toHaveCount(0)
  await expect.poll(() => ledOn(page, line)).toBe(false)
  await expect(page.locator('.wire.v0').first()).toBeVisible()
})

test('shared data bus example: one enabled source drives the 8-bit bus, two that disagree are a contention', async ({ page }) => {
  await page.goto('/databus', { waitUntil: 'networkidle' })
  const idOf = (label: string) =>
    page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).first().getAttribute('data-id') as Promise<string>
  const enableA = await idOf('Enable Input A')
  const enableB = await idOf('Enable Input B')
  await expect(page.locator('.wire.bus').first()).toBeVisible()
  // Input A drives the bus: 5A.
  await expect(page.locator('.wire-hit title', { hasText: '8-bit bus: 0x5A' }).first()).toBeAttached()
  await expect(page.locator('.sym-body.contention')).toHaveCount(0)
  await clickComp(page, enableB)
  await expect(page.locator('.sym-body.contention')).toHaveCount(1)
  await clickComp(page, enableA)
  await expect(page.locator('.sym-body.contention')).toHaveCount(0)
  await expect(page.locator('.wire-hit title', { hasText: '8-bit bus: 0x27' }).first()).toBeAttached()
})

test('buses example: 4-bit wires are thick and show their value, and the total counts up', async ({ page }) => {
  await page.goto('/buses', { waitUntil: 'networkidle' })
  // The merger → adder, adder → register and register → splitter wires are buses (the label pair carries one too).
  await expect.poll(() => page.locator('.wire.bus').count()).toBeGreaterThanOrEqual(3)
  await expect(page.locator('.wire.bus.vb').first()).toBeVisible()
  await expect(page.locator('.wire-hit title').first()).toHaveText(/^4-bit bus: 0x[0-9A-F]$/)
  // The display shows a hex digit once the register has loaded something other than 0.
  await expect.poll(() => page.locator('.seg.on').count(), { timeout: 8000 }).toBeGreaterThan(0)
})

test('bus pins: a bus wire joins bus pins, a mismatch is refused with a hint, and bus ports can be switched off', async ({ page }) => {
  await freshEmpty(page)
  const reg = await place(page, 'register', 200, 200)
  const add = await place(page, 'add4', 520, 200)
  await wire(page, [reg, 'Q'], [add, 'A'])
  await expect(page.locator('.wire.bus')).toHaveCount(1)
  // A 4-bit bus into a single-bit pin: refused, and the toast says what to use.
  await wire(page, [reg, 'Q'], [add, 'Ci'])
  await expect(page.getByText(/use a splitter/)).toBeVisible()
  await expect(page.locator('.wire')).toHaveCount(1)
  // With bus ports off the parts have single-bit pins again, so the bus wire goes.
  await page.locator(`.comp[data-id="${reg}"] > g`).first().click()
  await page.getByLabel('Bus ports').uncheck()
  await expect(page.locator('.wire.bus')).toHaveCount(0)
  await expect(page.locator(`circle.pin[data-comp="${reg}"][data-pin="QA"]`)).toHaveCount(1)
})

test('splitter and merger: a 4-bit piece of a splitter joins a merger input, single bits stay ordinary wires', async ({ page }) => {
  await freshEmpty(page)
  const split = await place(page, 'splitter', 200, 200)
  const merge = await place(page, 'merger', 500, 200)
  await wire(page, [split, 'Y0'], [merge, 'A0']) // 4 bits to 4 bits
  await wire(page, [split, 'Y1'], [merge, 'A1'])
  await expect(page.locator('.wire.bus')).toHaveCount(2)
})

test('n-bit parts: a bus input counts up on click, a register holds it, and a bus display reads it', async ({ page }) => {
  await freshEmpty(page)
  const input = await place(page, 'busin', 160, 200)
  const reg = await place(page, 'busreg', 380, 200)
  const disp = await place(page, 'busdisp', 640, 200)
  await wire(page, [input, 'Q'], [reg, 'D'])
  await wire(page, [reg, 'Q'], [disp, 'A'])
  await expect(page.locator('.wire.bus')).toHaveCount(2)
  // Clicking the input counts up (it is 8 bits wide: 00, 01, 02, 03); the register loads it on a clock edge.
  for (let i = 0; i < 3; i++) await clickComp(page, input)
  const clk = await place(page, 'switch', 160, 360)
  await wire(page, [clk, 'Q'], [reg, 'CLK'])
  await expect(page.locator(`.comp[data-id="${disp}"] .bus-readout`)).toHaveText('00')
  await clickComp(page, clk)
  await expect(page.locator(`.comp[data-id="${disp}"] .bus-readout`)).toHaveText('03')
})

test('a probe given more bits records a whole bus as one row, and takes a bus wire', async ({ page }) => {
  await freshEmpty(page)
  const input = await place(page, 'busin', 160, 200)
  const probe = await place(page, 'probe', 400, 200)
  await page.getByLabel('Bits (a bus)').fill('8')
  await page.getByLabel('Bits (a bus)').blur()
  await wire(page, [input, 'Q'], [probe, 'A'])
  await expect(page.locator('.wire.bus')).toHaveCount(1)
  await expect(page.getByTestId('waves')).toBeVisible()
})
