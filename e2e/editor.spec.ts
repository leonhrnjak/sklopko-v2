import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

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
  await item.scrollIntoViewIfNeeded()
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
  await expect(page.locator('.version')).toHaveText(`v${pkg.version}`)
  const seg = page.locator('.comp polygon.seg.on')
  // The decade counter runs at 2 Hz: the lit segments change within a second or two.
  const first = await seg.count()
  await expect.poll(async () => seg.count(), { timeout: 4000 }).not.toBe(first)
  for (const ex of ['gates', 'sr-latch', 'd-latch', 'shift-register', 'ripple-counter', 'adder', 'mux', 'oscillator', 'intersection', 'dice', 'clock']) {
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

test('switches operate on click; long-press, right-click or drag selects them instead', async ({ page }) => {
  await fresh(page)
  await page.selectOption('select[aria-label="Load an example"]', 'gates')
  const a = page.locator('.comp[data-id="switch1"]')
  const knob = () => a.locator('.switch-track').getAttribute('class')
  const box = (await a.locator('> g').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // Click: toggles, nothing gets selected.
  expect(await knob()).toContain('f0')
  await page.mouse.click(cx, cy)
  expect(await knob()).toContain('f1')
  await expect(page.locator('.comp.selected')).toHaveCount(0)
  await expect(page.locator('.inspector h2').first()).toHaveText('How to')

  // Long-press: selects, does not toggle.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(800)
  await page.mouse.up()
  expect(await knob()).toContain('f1')
  await expect(a).toHaveClass(/selected/)
  await expect(page.locator('.inspector h2')).toHaveText('Switch')

  // Right-click the other switch: selects it, no toggle.
  const b = page.locator('.comp[data-id="switch2"]')
  const bb = (await b.locator('> g').boundingBox())!
  const before = await b.locator('.switch-track').getAttribute('class')
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' })
  await expect(b).toHaveClass(/selected/)
  expect(await b.locator('.switch-track').getAttribute('class')).toBe(before)

  // Drag: moves and selects, no toggle.
  await page.keyboard.press('Escape')
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy - 60, { steps: 8 })
  await page.mouse.up()
  await expect(a).toHaveClass(/selected/)
  expect(await knob()).toContain('f1')
  expect((await a.locator('> g').boundingBox())!.y).toBeLessThan(box.y - 30)
})

test('examples have short links that open them directly', async ({ page }) => {
  await page.goto('/intersection', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp[data-id^="led"]')).toHaveCount(16)
  expect(new URL(page.url()).pathname).toBe('/intersection')

  // Choosing an example from the menu shows its link in the address bar.
  await page.selectOption('select[aria-label="Load an example"]', 'dice')
  await expect(page.locator('.comp[data-id^="dicedisp"]')).toHaveCount(1)
  expect(new URL(page.url()).pathname).toBe('/dice')

  // Editing leaves the example: back to the plain root, so a reload keeps the edit.
  await page.locator('.comp').first().click({ button: 'right' })
  await page.keyboard.press('Delete')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')

  // Unknown paths just open the app.
  await page.goto('/no-such-example', { waitUntil: 'networkidle' })
  await expect(page.locator('.canvas')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
})

test('settings: IEC gate symbols and wire hops', async ({ page }) => {
  await freshEmpty(page)
  const gate = await place(page, 'and', 300, 120)
  const gateBody = page.locator(`.comp[data-id="${gate}"] .sym-body`)
  expect(await gateBody.evaluate((n) => n.tagName)).toBe('path')

  await page.getByTestId('settings').click()
  await page.getByTestId('setting-gates').selectOption('iec')
  expect(await gateBody.evaluate((n) => n.tagName)).toBe('rect')
  await expect(page.locator(`.comp[data-id="${gate}"] .title`)).toHaveText('&')
  // The choice survives a reload (after the debounced autosave of the circuit).
  await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator(`.comp[data-id="${gate}"]`)).toHaveCount(1)
  expect(await gateBody.evaluate((n) => n.tagName)).toBe('rect')
  await page.getByTestId('settings').click()
  await page.getByTestId('setting-gates').selectOption('us')
  await expect.poll(() => gateBody.evaluate((n) => n.tagName)).toBe('path')

  // Two wires that have to cross: the horizontal one hops over the other.
  await page.getByRole('button', { name: 'New' }).click()
  const s1 = await place(page, 'switch', 120, 120)
  const s2 = await place(page, 'switch', 120, 320)
  const l1 = await place(page, 'led', 520, 320)
  const l2 = await place(page, 'led', 520, 120)
  await wire(page, [s1, 'Q'], [l1, 'A'])
  await wire(page, [s2, 'Q'], [l2, 'A'])
  const hasHop = () => page.locator('path.wire').evaluateAll((ps) => ps.some((p) => / A4,4 /.test(p.getAttribute('d') ?? '')))
  await expect.poll(hasHop).toBe(true)

  await page.getByTestId('settings').click()
  await page.getByTestId('setting-hops').selectOption('off')
  await expect.poll(hasHop).toBe(false)
})

test('ROM: contents are edited as hex text in the inspector and shown in the table', async ({ page }) => {
  await freshEmpty(page)
  const rom = await place(page, 'rom', 300, 200)
  const cell = (n: number) => page.locator(`.comp[data-id="${rom}"] .mem-cell`).nth(n)
  await expect(cell(3)).toHaveText('3')

  const box = page.getByLabel('Contents (hex words)')
  await box.fill('A B xyz')
  await expect(page.getByText('Only hexadecimal digits')).toBeVisible()
  await page.getByLabel('Label').click() // blur: invalid text is not applied
  await expect(cell(0)).toHaveText('0')

  await box.fill('A B C')
  await page.getByLabel('Label').click()
  await expect(cell(0)).toHaveText('A')
  await expect(cell(2)).toHaveText('C')
  await expect(cell(3)).toHaveText('0')
})

test('dot matrix example: the scanned image shows as a steady smiley', async ({ page }) => {
  await page.goto('/matrix', { waitUntil: 'networkidle' })
  const lit = page.locator('.comp[data-id^="matrix"] circle.seg.on')
  // 26 pixels make up the smiley; they stay lit thanks to persistence although only one row is on at a time.
  await expect.poll(() => lit.count(), { timeout: 5000 }).toBe(26)
  await page.waitForTimeout(300)
  expect(await lit.count()).toBe(26)
  // Paused: simulated time stops, so the image is frozen rather than fading away.
  await page.getByTestId('run').click()
  await page.waitForTimeout(500)
  const frozen = await lit.count()
  await page.waitForTimeout(500)
  expect(await lit.count()).toBe(frozen)
  expect(frozen).toBeGreaterThan(0)
})

test('waveforms: a probe on a clock opens the panel and draws its edges', async ({ page }) => {
  await freshEmpty(page)
  await expect(page.getByTestId('waves')).toHaveCount(0)
  const clk = await place(page, 'clock', 120, 120)
  await page.getByLabel('Frequency (Hz)').selectOption('16')
  const probe = await place(page, 'probe', 420, 130)
  // The first probe opens the panel by itself.
  await expect(page.getByTestId('waves')).toBeVisible()
  await wire(page, [clk, 'Q'], [probe, 'A'])
  await page.waitForTimeout(1500)

  /** Number of vertical edges in the first trace: runs of coloured pixels half way between the two levels. */
  const edges = () =>
    page.getByTestId('wave-canvas').evaluate((c: HTMLCanvasElement) => {
      const dpr = c.width / c.getBoundingClientRect().width
      const y = Math.round(19 * dpr)
      const row = c.getContext('2d')!.getImageData(0, y, c.width, 1).data
      let runs = 0
      let inRun = false
      for (let x = 0; x < c.width; x++) {
        const on = row[x * 4 + 3] > 128 && row[x * 4 + 1] + row[x * 4] > 0 && x > 130 * dpr
        if (on && !inRun) runs++
        inRun = on
      }
      return runs
    })
  await expect.poll(edges).toBeGreaterThanOrEqual(6)

  // Window, clear and hide.
  await page.getByLabel('Time window').selectOption('2000')
  await page.getByTestId('waves').getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByTestId('waves-toggle').click()
  await expect(page.getByTestId('waves')).toHaveCount(0)
  await page.getByTestId('waves-toggle').click()
  await expect(page.getByTestId('waves')).toBeVisible()

  // Paused: dragging scrolls back in time and "Live" returns to the present.
  await page.getByTestId('run').click()
  await page.waitForTimeout(300)
  const c = (await page.getByTestId('wave-canvas').boundingBox())!
  await page.mouse.move(c.x + 400, c.y + 20)
  await page.mouse.down()
  await page.mouse.move(c.x + 600, c.y + 20, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('button', { name: /Live/ }).click()
  await expect(page.getByRole('button', { name: /Live/ })).toHaveCount(0)
})

test('calculator example: changing the operation changes the ALU', async ({ page }) => {
  await page.goto('/calculator', { waitUntil: 'networkidle' })
  const aluTitle = page.locator('.comp .title', { hasText: /^ADD$/ })
  await expect(aluTitle).toHaveCount(1)
  // Click the "Operation" input once: it counts up from 0 (ADD) to 1 (SUB).
  const op = page.locator('.comp', { has: page.locator('.comp-label', { hasText: 'Operation 0–7' }) })
  const box = (await op.locator('> g').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.comp .title', { hasText: /^SUB$/ })).toHaveCount(1)
})

test('8-bit computer example: runs its program to the HALT instruction', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  const halted = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Halted$/ }) }).locator('.led-fill.on')
  await expect(halted).toHaveCount(0)
  // 122 clock cycles at 4 Hz × 4 speed.
  await expect(halted).toHaveCount(1, { timeout: 25000 })
  // The waveform panel showed up with the example's probes.
  await expect(page.getByTestId('waves')).toBeVisible()
})
