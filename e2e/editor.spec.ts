import { expect, test, type Page } from '@playwright/test'

async function fresh(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
}

async function freshEmpty(page: Page) {
  await fresh(page)
  await page.getByRole('button', { name: 'New' }).click()
}

/** Drag a part from the palette and drop it at canvas-relative coordinates; returns its id. */
async function place(page: Page, type: string, x: number, y: number): Promise<string> {
  const item = page.locator(`.palette-item[data-type="${type}"]`)
  const canvas = await page.getByTestId('canvas').boundingBox()
  const box = (await item.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvas!.x + x, canvas!.y + y, { steps: 8 })
  await page.mouse.up()
  return (await page.locator('.comp.selected').getAttribute('data-id'))!
}

async function pinCenter(page: Page, comp: string, pin: string) {
  const b = (await page.locator(`circle.pin[data-comp="${comp}"][data-pin="${pin}"]`).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

async function wire(page: Page, from: [string, string], to: [string, string]) {
  const a = await pinCenter(page, ...from)
  const b = await pinCenter(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
}

async function clickComp(page: Page, id: string) {
  const b = (await page.locator(`.comp[data-id="${id}"] > g`).boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

const ledOn = (page: Page, id: string) => page.locator(`.comp[data-id="${id}"] .led-fill.on`).count().then((n) => n === 1)

test('build an AND circuit by drag and drop, then operate it', async ({ page }) => {
  await freshEmpty(page)
  const a = await place(page, 'switch', 120, 120)
  const b = await place(page, 'switch', 120, 260)
  const g = await place(page, 'and', 340, 190)
  const led = await place(page, 'led', 540, 190)
  await expect(page.locator('.comp')).toHaveCount(4)

  await wire(page, [a, 'Q'], [g, 'A'])
  await wire(page, [b, 'Q'], [g, 'B'])
  // Start from the input end this time: either direction works.
  await wire(page, [led, 'A'], [g, 'Y'])
  await expect(page.locator('.wire-group')).toHaveCount(3)

  expect(await ledOn(page, led)).toBe(false)
  await clickComp(page, a)
  await page.waitForTimeout(100)
  expect(await ledOn(page, led)).toBe(false)
  await clickComp(page, b)
  await expect.poll(() => ledOn(page, led)).toBe(true)
  await clickComp(page, a)
  await expect.poll(() => ledOn(page, led)).toBe(false)
})

test('moving a gate drags its wires along', async ({ page }) => {
  await freshEmpty(page)
  const s = await place(page, 'switch', 120, 150)
  const g = await place(page, 'not', 360, 150)
  await wire(page, [s, 'Q'], [g, 'A'])
  const path = page.locator('.wire-group path.wire')
  const before = await path.getAttribute('d')

  const body = (await page.locator(`.comp[data-id="${g}"] > g`).boundingBox())!
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width / 2 + 60, body.y + body.height / 2 + 120, { steps: 10 })
  await page.mouse.up()

  const after = await path.getAttribute('d')
  expect(after).not.toBe(before)
  // The wire still ends exactly at the gate's input pin.
  const pin = await pinCenter(page, g, 'A')
  const end = await page.evaluate(() => {
    const p = document.querySelector('.wire-group path.wire') as SVGPathElement
    const pt = p.getPointAtLength(p.getTotalLength())
    const m = p.getScreenCTM()!
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }
  })
  expect(Math.abs(end.x - pin.x)).toBeLessThan(1.5)
  expect(Math.abs(end.y - pin.y)).toBeLessThan(1.5)
})

test('dragging a wire segment reshapes it and survives a reload', async ({ page }) => {
  await freshEmpty(page)
  const s = await place(page, 'switch', 120, 120)
  const l = await place(page, 'led', 460, 280)
  await wire(page, [s, 'Q'], [l, 'A'])
  const original = await page.locator('path.wire').getAttribute('d')
  const vertical = page.locator('.wire-hit.v').first()
  const vb = (await vertical.boundingBox())!
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2)
  await page.mouse.down()
  await page.mouse.move(vb.x + vb.width / 2 - 120, vb.y + vb.height / 2, { steps: 8 })
  await page.mouse.up()
  const shaped = await page.locator('path.wire').getAttribute('d')
  expect(shaped).not.toBe(original)

  await page.waitForTimeout(600) // autosave debounce
  await page.reload()
  await expect(page.locator('path.wire')).toHaveAttribute('d', shaped!)
})

test('undo and redo restore the circuit', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'and', 200, 200)
  await place(page, 'or', 400, 200)
  await expect(page.locator('.comp')).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.comp')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('.comp')).toHaveCount(2)
  await clickComp(page, (await page.locator('.comp').first().getAttribute('data-id'))!)
  await page.keyboard.press('Delete')
  await expect(page.locator('.comp')).toHaveCount(1)
})

test('examples load and the welcome counter ticks', async ({ page }) => {
  await fresh(page)
  const seg = page.locator('.comp polygon.seg.on')
  // The decade counter runs at 2 Hz: the lit segments change within a second or two.
  const first = await seg.count()
  await expect.poll(async () => seg.count(), { timeout: 4000 }).not.toBe(first)
  for (const ex of ['gates', 'sr', 'dlatch', 'shift', 'ripple', 'adder', 'mux', 'osc']) {
    await page.selectOption('select[aria-label="Load an example"]', ex)
    await expect(page.locator('.comp').first()).toBeVisible()
  }
})

test('4-bit input cycles on click and the push button resets the counter while held', async ({ page }) => {
  await fresh(page)
  await page.selectOption('select[aria-label="Load an example"]', 'adder')
  const display = page.locator('.comp[data-id^="hexdisp"] polygon.seg.on')
  await expect(display).toHaveCount(5) // 5 + 9 = E
  await clickComp(page, 'hexin1')
  await expect(display).toHaveCount(4) // 6 + 9 = F

  await page.selectOption('select[aria-label="Load an example"]', 'counter')
  const seg = page.locator('.comp[data-id^="seg7"] polygon.seg.on')
  // Wait until the counter has moved off 0 ("0" lights 6 segments, "8" lights 7).
  await expect.poll(async () => seg.count(), { timeout: 4000 }).not.toBe(6)
  const btn = (await page.locator('.comp[data-id^="button"] > g').boundingBox())!
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1200) // held through several clock edges
  expect(await seg.count()).toBe(6)
  await page.mouse.up()
})

test('dropping a part so its pin touches another pin connects them; moving it away keeps the wire', async ({ page }) => {
  await freshEmpty(page)
  const g = await place(page, 'and', 200, 200)
  const n = await place(page, 'not', 420, 340)
  await expect(page.locator('.wire-group')).toHaveCount(0)

  // Drag the NOT so its input tip lands on the AND's output tip.
  const from = await pinCenter(page, n, 'A')
  const to = await pinCenter(page, g, 'Y')
  const body = (await page.locator(`.comp[data-id="${n}"] > g`).boundingBox())!
  const sx = body.x + body.width / 2
  const sy = body.y + body.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + to.x - from.x, sy + to.y - from.y, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.wire-group')).toHaveCount(1)

  // Pull it away: the connection stays, now as a routed wire.
  const b2 = (await page.locator(`.comp[data-id="${n}"] > g`).boundingBox())!
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2)
  await page.mouse.down()
  await page.mouse.move(b2.x + b2.width / 2 + 90, b2.y + b2.height / 2 + 120, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.wire-group')).toHaveCount(1)
  const d = (await page.locator('path.wire').getAttribute('d'))!
  expect(d.split('L').length).toBeGreaterThan(2)
})

test('the parts panel never scrolls sideways and can be resized', async ({ page }) => {
  await fresh(page)
  const overflow = () => page.locator('.palette-scroll').evaluate((e) => e.scrollWidth - e.clientWidth)
  expect(await overflow()).toBe(0)
  const panel = page.locator('.palette')
  const before = (await panel.boundingBox())!.width
  const handle = (await page.locator('.palette-resizer').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + 200, { steps: 6 })
  await page.mouse.up()
  expect((await panel.boundingBox())!.width).toBeGreaterThan(before + 100)
  expect(await overflow()).toBe(0)
  // Wider panel -> more columns.
  const cols = await page.locator('.palette-grid').first().evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)
  expect(cols).toBeGreaterThanOrEqual(3)
})
