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

test('net labels: a switch drives an LED through a send/receive pair, and renaming breaks the link', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 120, 150)
  // A new label asks for its name straight away.
  const tx = await place(page, 'netsend', 300, 150)
  await page.keyboard.type('GO')
  await page.keyboard.press('Enter')
  const rx = await place(page, 'netrecv', 300, 320)
  await page.keyboard.type('GO')
  await page.keyboard.press('Enter')
  const led = await place(page, 'led', 520, 320)
  await expect(page.locator('.net-name', { hasText: 'GO' })).toHaveCount(2)

  await wire(page, [sw, 'Q'], [tx, 'A'])
  await wire(page, [rx, 'Y'], [led, 'A'])
  await expect(page.locator('.wire-group')).toHaveCount(2) // and nothing between the two labels

  expect(await ledOn(page, led)).toBe(false)
  await clickComp(page, sw)
  await expect.poll(() => ledOn(page, led)).toBe(true)

  // Selecting a label says what it is linked to.
  await clickComp(page, rx)
  await expect(page.locator('.inspector')).toContainText('“GO”: 1 send, 1 receive.')
  // Rename the receiving end: it no longer hears the sender.
  await page.getByLabel('Name', { exact: true }).fill('NOPE')
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector')).toContainText('“NOPE”: 0 sends, 1 receive.')
  await expect(page.locator('.inspector')).toContainText('No Send label has this name yet')
  await expect.poll(() => ledOn(page, led)).toBe(false)
  // And back again.
  await page.getByLabel('Name', { exact: true }).fill('GO')
  await page.keyboard.press('Enter')
  await expect.poll(() => ledOn(page, led)).toBe(true)
})

test('net labels example: the counter shows on a display with no wires between them', async ({ page }) => {
  await page.goto('/labels', { waitUntil: 'networkidle' })
  await expect(page.locator('.net-name', { hasText: 'BIT3' })).toHaveCount(3) // one send, two receives
  await page.locator('.comp', { has: page.locator('.net-name', { hasText: 'BIT3' }) }).first().click({ position: { x: 20, y: 10 }, force: true })
  await expect(page.locator('.inspector')).toContainText('“BIT3”: 1 send, 2 receives.')
  await expect(page.locator('.rel-outline')).toHaveCount(2)
  await page.getByRole('button', { name: /Select all 3/ }).click()
  await expect(page.locator('.comp.selected')).toHaveCount(3)
})

/** Select a part by the label shown above it. */
async function pickByLabel(page: Page, label: string) {
  const g = page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).locator('> g').first()
  const b = (await g.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

test('program editor: errors show as you type, the program applies on blur, and the listing follows the PC', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'Program')
  const source = page.getByLabel('Program source')
  await expect(source).toHaveValue(/loop:\s+LDA 1/)
  await expect(page.locator('.inspector')).toContainText('15 of 16 instructions.')

  // The listing marks the instruction being read, and follows the PC.
  const step = async () => page.getByRole('button', { name: 'Clock step' }).click() // one clock edge: the PC moves on every other click
  await expect(page.locator('.row-listing.current .text')).toHaveText('LDI 0')
  await step()
  await expect(page.locator('.row-listing.current .text')).toHaveText('STA 0')
  await step()
  await step()
  await expect(page.locator('.row-listing.current .text')).toHaveText('STA 15')
  await step()
  await step()
  await expect(page.locator('.row-listing.current .text')).toHaveText('LDI 1')

  // Mistakes are reported by line while typing, and nothing is applied.
  await source.fill('LDI 5\nFOO 1\nSTA 99')
  await expect(page.getByLabel('Errors')).toContainText('Line 2: Unknown instruction “FOO”.')
  await expect(page.getByLabel('Errors')).toContainText('Line 3: STA: the address 99 is out of range')
  await expect(page.getByLabel('Errors')).toContainText('keeps running the last program')
  await page.locator('.inspector h2').click() // click away: the text is kept, but the circuit still runs the old program
  await expect(page.locator('.row-listing .text').first()).toHaveText('LDI 0')
  await expect(page.locator('.row-listing .text').nth(14)).toHaveText('HALT')

  // A good program is applied when you click away.
  await source.fill('LDI 7\nSTA 1\nHALT')
  await expect(page.locator('.inspector')).toContainText('3 of 16 instructions. Applies when you click outside')
  await page.locator('.inspector h2').click()
  await expect(page.locator('.row-listing .text').nth(0)).toHaveText('LDI 7')
  await expect(page.locator('.row-listing .word').nth(0)).toHaveText('0700')
  await expect(page.locator('.row-listing .text').nth(2)).toHaveText('HALT')
  await expect(page.locator('.inspector')).toContainText('3 of 16 instructions.')
})

test('program files: save the source, open another program', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await pickByLabel(page, 'Program')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save…' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('program.asm')
  const saved = readFileSync((await file.path())!, 'utf8')
  expect(saved).toContain('Fibonacci')
  expect(saved).toContain('loop:')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open…' }).click()
  await (await chooser).setFiles({ name: 'seven.asm', mimeType: 'text/plain', buffer: Buffer.from('LDI 7\nSTA 15\nHALT\n') })
  await expect(page.locator('.row-listing .text').nth(1)).toHaveText('STA 15')
  await expect(page.getByLabel('Program source')).toHaveValue('LDI 7\nSTA 15\nHALT\n')
  await expect(page.locator('.toast')).toContainText('Opened seven.asm.')
})

test('RAM editor: change words while paused, Escape cancels, Reset clears', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Data RAM')
  const word = (i: number) => page.locator('.ram-word').nth(i)
  // Running: the words are shown but locked.
  await expect(word(3).locator('.val')).toBeDisabled()
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(word(3).locator('.val')).toBeEnabled()

  await word(3).locator('.val').click()
  await page.keyboard.type('a5')
  await page.keyboard.press('Enter')
  await expect(word(3).locator('.val')).toHaveText('A5')
  // Escape leaves the word alone.
  await word(3).locator('.val').click()
  await page.keyboard.type('ff')
  await page.keyboard.press('Escape')
  await expect(word(3).locator('.val')).toHaveText('A5')
  // Not hex: ignored.
  await word(4).locator('.val').click()
  await page.keyboard.type('zz')
  await page.keyboard.press('Enter')
  await expect(word(4).locator('.val')).toHaveText('00')

  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(word(3).locator('.val')).toHaveText('00')
  await word(3).locator('.val').click()
  await page.keyboard.type('7')
  await page.keyboard.press('Enter')
  await expect(word(3).locator('.val')).toHaveText('07')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(word(3).locator('.val')).toHaveText('00')
})

test('RAM editor: words written by the running program show up in the grid', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await pickByLabel(page, 'Data RAM')
  // Fibonacci keeps the numbers in the first three words; the last sum written is 121, the carry's wrapped result.
  await expect(page.locator('.ram-word').nth(2).locator('.val')).toHaveText('79', { timeout: 25000 })
  await expect(page.locator('.ram-word').nth(0).locator('.val')).toHaveText('E9')
})

test('a ROM can switch from hex words to a program, keeping what it held', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'rom', 300, 200)
  await page.getByLabel('Data bits').selectOption('8')
  await page.locator('.field', { hasText: 'Contents (hex words)' }).locator('textarea').fill('00 30 70')
  await page.locator('.inspector h2').click()
  // Choosing a program turns the ROM into 16 bits and starts from the words it holds (here: nothing sensible at 16 bits).
  await page.getByLabel('Contents are').selectOption('sk8')
  await expect(page.getByLabel('Data bits')).toHaveValue('16')
  await expect(page.getByLabel('Program source')).toBeVisible()
  await page.getByLabel('Program source').fill('LDI 1\nHALT')
  await page.locator('.inspector h2').click()
  await expect(page.locator('.row-listing .text').nth(0)).toHaveText('LDI 1')
  await expect(page.locator('.row-listing .text').nth(1)).toHaveText('HALT')
  // And back to hex words: the words stay.
  await page.getByLabel('Contents are').selectOption('none')
  await expect(page.locator('.field', { hasText: 'Contents (hex words)' }).locator('textarea')).toHaveValue(/0100 0070/)
})

test('Back: steps the computer back one clock edge at a time, to the very start', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'Program')
  const back = page.getByRole('button', { name: '◀ Back' })
  await expect(back).toBeDisabled() // nothing to go back to yet
  const current = page.locator('.row-listing.current .text')
  const step = async () => page.getByRole('button', { name: 'Clock step' }).click()
  await step() // rising edge: PC 1
  await step() // falling edge
  await step() // rising edge: PC 2
  await expect(current).toHaveText('STA 15')
  await expect(back).toBeEnabled()
  await back.click() // after the falling edge: still PC 1
  await expect(current).toHaveText('STA 0')
  await back.click() // after the first rising edge
  await expect(current).toHaveText('STA 0')
  await back.click() // the start
  await expect(current).toHaveText('LDI 0')
  await expect(back).toBeDisabled()
  // Forward again from there behaves as before.
  await step()
  await expect(current).toHaveText('STA 0')
})

test('Back while running pauses the simulation', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('button', { name: '◀ Back' })).toBeEnabled({ timeout: 5000 })
  await page.getByRole('button', { name: '◀ Back' }).click()
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible() // it is paused now
})

test('breakpoint: the computer pauses by itself when it reaches HALT', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible({ timeout: 30000 }) // the label of the button while paused
  await expect(page.locator('.toast')).toContainText('Paused at breakpoint “Pause at HALT”.')
  const halted = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Halted$/ }) }).locator('.led-fill.on')
  await expect(halted).toHaveCount(1)
  // The stop sign shows that its condition holds, and Run carries on without stopping again.
  await expect(page.locator('.break-body.met')).toHaveCount(1)
  await page.getByRole('button', { name: 'Run' }).click()
  await page.waitForTimeout(1200)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('breakpoint: place one, wire it to a counter, and Run stops where it says', async ({ page }) => {
  await freshEmpty(page)
  const clk = await place(page, 'clock', 120, 150)
  const cnt = await place(page, 'counter', 320, 150)
  const bp = await place(page, 'breakpoint', 560, 150)
  await wire(page, [clk, 'Q'], [cnt, 'CLK'])
  await wire(page, [cnt, 'A'], [bp, 'A'])
  await expect(page.locator('.wire-group')).toHaveCount(2)
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await expect(page.locator('.toast')).toContainText('Paused at breakpoint “Breakpoint”.', { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible()
})

test('grouping probes: two probes become one trace showing a number', async ({ page }) => {
  await freshEmpty(page)
  const a = await place(page, 'probe', 200, 150)
  await page.getByPlaceholder('optional').fill('B1')
  await page.keyboard.press('Enter')
  const b = await place(page, 'probe', 200, 260)
  await page.getByPlaceholder('optional').fill('B0')
  await page.keyboard.press('Enter')
  const canvas = page.getByTestId('wave-canvas')
  await expect(canvas).toHaveCSS('height', `${2 * 38 + 24}px`) // two rows
  // Select both and group them.
  await clickComp(page, a)
  await page.keyboard.down('Shift')
  await clickComp(page, b)
  await page.keyboard.up('Shift')
  await expect(page.locator('.inspector')).toContainText('2 selected')
  await page.getByLabel('Group name').fill('BUS')
  await page.getByRole('button', { name: 'Group 2 probes' }).click()
  await expect(canvas).toHaveCSS('height', `${38 + 24}px`) // one row
  await expect(page.getByLabel('Number format')).toBeVisible()
  // B0 is the least significant bit, whatever the order they were placed in.
  await clickComp(page, b)
  await expect(page.getByLabel('Bit in the group (0 = least significant)')).toHaveValue('0')
  await expect(page.locator('.inspector')).toContainText('“BUS”: 2 probes, bits 0, 1.')
  await clickComp(page, a)
  await expect(page.getByLabel('Bit in the group (0 = least significant)')).toHaveValue('1')
})

test('the computer shows PC and ACC as numbers: four rows in the waveform panel', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('wave-canvas')).toHaveCSS('height', `${4 * 38 + 24}px`) // CLK, PC, ACC, Carry
  await expect(page.getByLabel('Number format')).toBeVisible()
})

test('tracing a signal: selecting a wire lights up everything it reaches, through net labels', async ({ page }) => {
  await page.goto('/labels', { waitUntil: 'networkidle' })
  // Any wire that leaves a receive label belongs to the BIT signal it carries.
  const wires = page.locator('.wire-group')
  const count = await wires.count()
  let found = false
  for (let i = 0; i < count && !found; i++) {
    await wires.nth(i).locator('.wire-hit').first().click({ force: true })
    found = (await page.locator('.inspector').innerText()).includes('reaches 5 pins')
  }
  expect(found).toBe(true)
  await expect(page.locator('.wire-trace.net')).toHaveCount(3) // into the send label, and out of two receive labels
  await expect(page.locator('.trace-ring')).toHaveCount(6)
  await expect(page.locator('.trace-ring.source')).toHaveCount(1)
  await expect(page.locator('.wire-trace.cone')).toHaveCount(0)
  // Also show what feeds it: the clock, one wire away (a counter is a register, so the cone stops there).
  await page.getByLabel(/Also show what feeds it/).check()
  await expect(page.locator('.wire-trace.cone')).toHaveCount(1)
  // Deselecting clears it all.
  await page.getByTestId('canvas').click({ position: { x: 700, y: 20 } })
  await expect(page.locator('.wire-trace')).toHaveCount(0)
  await expect(page.locator('.trace-ring')).toHaveCount(0)
})

test('exporting waveforms: a VCD file with the groups as buses, and a PNG', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await page.waitForTimeout(2500) // a few seconds of simulated time to record
  await page.getByRole('button', { name: 'Pause' }).click()

  const vcdDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'VCD', exact: true }).click()
  const vcd = await vcdDownload
  expect(vcd.suggestedFilename()).toBe('waveforms.vcd')
  const text = readFileSync((await vcd.path())!, 'utf8')
  expect(text).toContain('$timescale 1 us $end')
  expect(text).toContain('$var wire 1 ! CLK $end')
  expect(text).toContain('$var wire 4 " PC $end')
  expect(text).toContain('$var wire 8 # ACC $end')
  expect(text).toContain('$enddefinitions $end')
  expect(text).toMatch(/\nb\d{4} "\n/) // the 4-bit PC changed at least once

  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  const png = await pngDownload
  expect(png.suggestedFilename()).toBe('waveforms.png')
  const bytes = readFileSync((await png.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]) // the PNG signature
})

const boxOf = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!

test('frames: drag one by its title bar and what is inside comes along; the inside stays free to click', async ({ page }) => {
  await freshEmpty(page)
  const frame = await place(page, 'frame', 300, 260)
  const area = () => boxOf(page, `.comp[data-id="${frame}"] .frame-hit`)
  const a = await area()
  const gate = await place(page, 'and', a.x + a.width / 2 - (await page.getByTestId('canvas').boundingBox())!.x, a.y + a.height / 2 - (await page.getByTestId('canvas').boundingBox())!.y)
  const outside = await place(page, 'and', 700, 560)
  const gateBefore = await boxOf(page, `.comp[data-id="${gate}"] > g`)
  const outsideBefore = await boxOf(page, `.comp[data-id="${outside}"] > g`)

  // Clicking inside the frame's empty area does not select the frame (it starts a marquee instead).
  await page.mouse.click(a.x + 20, a.y + a.height - 20)
  await expect(page.locator('.comp.frame.selected')).toHaveCount(0)

  // Dragging the title bar moves the frame and the gate inside it, but not the gate outside.
  const bar = await boxOf(page, `.comp[data-id="${frame}"] .frame-bar`)
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
  await page.mouse.down()
  await page.mouse.move(bar.x + bar.width / 2 + 80, bar.y + bar.height / 2 + 50, { steps: 8 })
  await page.mouse.up()
  const moved = await area()
  expect(moved.x - a.x).toBeGreaterThan(60) // (the drag snaps to the grid, and the view may be zoomed)
  expect(moved.y - a.y).toBeGreaterThan(30)
  const gateAfter = await boxOf(page, `.comp[data-id="${gate}"] > g`)
  expect(gateAfter.x - gateBefore.x).toBeCloseTo(moved.x - a.x, 0) // the gate inside moved exactly as far as the frame
  expect(gateAfter.y - gateBefore.y).toBeCloseTo(moved.y - a.y, 0)
  const outsideAfter = await boxOf(page, `.comp[data-id="${outside}"] > g`)
  expect(outsideAfter.x).toBe(outsideBefore.x)

  // The corner handle resizes it.
  await expect(page.locator('.resize-handle')).toHaveCount(1)
  const h = await boxOf(page, '.resize-handle')
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2 + 40, { steps: 6 })
  await page.mouse.up()
  const resized = await area()
  expect(resized.width - moved.width).toBeGreaterThan(40)
  expect(resized.height - moved.height).toBeGreaterThan(20)
  await expect(page.locator('.inspector')).toContainText('Frame')
})

test('notes: the text wraps at the width you choose', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'note', 300, 200)
  const text = page.locator('.inspector textarea').first()
  await text.fill('one two three four five six seven eight nine ten')
  await page.locator('.inspector h2').click()
  const lines = page.getByTestId('canvas').locator('.note-text')
  const wide = await lines.count()
  await page.getByLabel('Width (characters per line)').fill('12')
  await expect.poll(() => lines.count()).toBeGreaterThan(wide)
  await expect(lines.first()).toHaveText('one two')
  // No rotate or flip for a note, and no label.
  await expect(page.getByRole('button', { name: /Rotate/ })).toHaveCount(0)
  await expect(page.getByPlaceholder('optional')).toHaveCount(0)
})

test('the welcome example explains itself with a note', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/counter', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('canvas').locator('.note-text').first()).toBeVisible()
})

test('embed mode: just the circuit and a few controls; switches work, nothing can be edited', async ({ page }) => {
  await page.goto('/gates?embed=1', { waitUntil: 'networkidle' })
  // No editor around it.
  await expect(page.locator('.toolbar')).toHaveCount(0)
  await expect(page.locator('.palette')).toHaveCount(0)
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.getByTestId('canvas')).toBeVisible()
  const bar = page.getByRole('toolbar', { name: 'Simulation controls' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('link', { name: /Open in Sklopko/ })).toHaveAttribute('href', '/gates')

  // Switches work.
  const knob = page.locator('.comp', { has: page.locator('.switch-track') })
  const led = page.locator('.comp', { has: page.locator('.led-fill') })
  const lit = async () => led.locator('.led-fill.on').count()
  const before = await lit()
  const sw = knob.first().locator('> g')
  const b = (await sw.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await expect.poll(lit).not.toBe(before)

  // Nothing can be edited: dragging a gate, deleting and undoing do nothing.
  // (Dragging a part pans the view, the only thing a drag does here: so look at where it is relative to another part.)
  const gate = page.locator('.comp', { has: page.locator('.gate-sym, .sym-body') }).nth(2)
  const other = page.locator('.comp').first()
  const parts = await page.locator('.comp').count()
  const apart = async () => {
    const [p, q] = [(await gate.boundingBox())!, (await other.boundingBox())!]
    return [Math.round(p.x - q.x), Math.round(p.y - q.y)]
  }
  const before2 = await apart()
  const g = (await gate.boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + g.width / 2 + 100, g.y + g.height / 2 + 100, { steps: 6 })
  await page.mouse.up()
  expect(await apart()).toEqual(before2)
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.comp')).toHaveCount(parts)
  await expect(page.locator('.comp.selected')).toHaveCount(0)
  // The controls: Run/Pause.
  await expect(bar.getByRole('button', { name: /Pause/ })).toBeVisible()
  await bar.getByRole('button', { name: /Pause/ }).click()
  await expect(bar.getByRole('button', { name: /Run/ })).toBeVisible()
})

test('embed mode neither reads nor writes the visitor\'s saved circuit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const saved = JSON.stringify({ app: 'sklopko', version: 1, comps: [{ id: 'x', type: 'switch', x: 0, y: 0, params: {} }], wires: [] })
  await page.evaluate((s) => localStorage.setItem('sklopko.circuit.v1', s), saved)
  await page.goto('/?embed=1', { waitUntil: 'networkidle' })
  // Not the one saved part: the welcome example.
  expect(await page.locator('.comp').count()).toBeGreaterThan(3)
  // Operate something and give the autosave time to run: the saved circuit is untouched.
  const sw = page.locator('.comp', { has: page.locator('.button-cap') }).first().locator('> g')
  const b = (await sw.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(900)
  expect(await page.evaluate(() => localStorage.getItem('sklopko.circuit.v1'))).toBe(saved)
})

test('embed code: the toolbar copies an iframe for this circuit', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/gates', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Embed' }).click()
  await expect(page.locator('.toast')).toContainText('Embed code copied')
  const html = await page.evaluate(() => navigator.clipboard.readText())
  expect(html).toContain('<iframe src="')
  expect(html).toContain('/gates?embed=1"')
  expect(html).toContain('title="Sklopko circuit"')
})

test('picture export: SVG of the whole circuit, and of what is on screen; PNG', async ({ page }) => {
  await page.goto('/labels', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const save = async (value: string) => {
    const download = page.waitForEvent('download')
    await page.getByLabel('Export a picture').selectOption(value)
    return download
  }
  const svgFile = await save('svg-all')
  expect(svgFile.suggestedFilename()).toBe('circuit.svg')
  const svg = readFileSync((await svgFile.path())!, 'utf8')
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="[-\d. ]+" width="\d+" height="\d+">/)
  expect(svg).toContain('BIT0') // the labels
  expect(svg).toContain('joined') // the note
  expect(svg).toMatch(/stroke: rgb\(/) // looks come with the file, not from this app's CSS
  // Editing marks are left out.
  for (const marks of ['sel-outline', 'wire-hit', 'class="pin"', 'trace-ring', 'resize-handle']) expect(svg).not.toContain(marks)
  const viewBox = (s: string) => s.match(/viewBox="([-\d. ]+)"/)![1].split(' ').map(Number)
  const [, , wAll, hAll] = viewBox(svg)

  // What is on screen is the window as it is: zoom in and it is much smaller than the whole circuit.
  await page.getByRole('button', { name: 'Fit' }).click()
  await page.getByTestId('canvas').hover()
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  const viewFile = await save('svg-view')
  const [, , wView, hView] = viewBox(readFileSync((await viewFile.path())!, 'utf8'))
  expect(wView * hView).toBeLessThan(wAll * hAll)

  const png = await save('png-all')
  expect(png.suggestedFilename()).toBe('circuit.png')
  const bytes = readFileSync((await png.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(bytes.length).toBeGreaterThan(2000)
})

/** The cells of a truth table in the Logic panel, row by row (outputs only, or all columns). */
const tableRows = async (page: Page, label: string) =>
  page.getByRole('table', { name: label }).locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent?.trim() ?? '')))

test('logic: analyze a circuit: truth table, smallest expression and Karnaugh map', async ({ page }) => {
  await page.goto('/gates', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Logic…' }).click()
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
  await page.getByRole('button', { name: 'Logic…' }).click()
  await expect(page.getByRole('dialog')).toContainText('Put at least one Switch and one LED on the canvas')
})

test('logic: build a circuit from an expression, put it on the canvas, and analyze what was built', async ({ page }) => {
  await freshEmpty(page)
  await page.getByRole('button', { name: 'Logic…' }).click()
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
  await page.getByRole('button', { name: 'Logic…' }).click()
  await page.getByRole('tab', { name: 'Analyze circuit' }).click()
  expect((await tableRows(page, 'Truth table')).map((r) => r.at(-1))).toEqual(['1', '0', '1', '0', '1', '0', '1', '1'])
  await expect(page.getByLabel('Expressions')).toContainText('Y = A·B + ¬C')
})

test('logic: the circuit built from an expression really works when you flip its switches', async ({ page }) => {
  await freshEmpty(page)
  await page.getByRole('button', { name: 'Logic…' }).click()
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
  await page.getByRole('button', { name: 'Logic…' }).click()
  await page.getByRole('tab', { name: 'Build circuit' }).click()
  await page.getByLabel('Expressions').fill('Y = A·B')
  await page.getByRole('button', { name: 'Build circuit' }).click()
  await expect(page.locator('.comp')).toHaveCount(4) // two switches, an AND, an LED
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.comp')).toHaveCount(0)
})

test('logic: build from a truth table you fill in, with a don’t care', async ({ page }) => {
  await freshEmpty(page)
  await page.getByRole('button', { name: 'Logic…' }).click()
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
  await page.getByRole('button', { name: 'Logic…' }).click()
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
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const saved = readFileSync((await (await download).path())!)
  await page.getByRole('button', { name: 'Logic…' }).click()
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

test('challenges: start one, check it fails, solve it, and the progress is remembered', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Challenges' }).click()
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
  await page.getByRole('button', { name: 'Challenges' }).click()
  await expect(page.getByRole('dialog', { name: 'Challenges' })).toContainText('1 of 17 solved')
  await expect(page.getByTestId('challenge-wire').getByLabel('Solved')).toBeVisible()
})

test('challenges: rules, labels, solutions and memory steps', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Challenges' }).click()
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

test('devices: the computer prints on its console, and the console can be read in the inspector', async ({ page }) => {
  await page.goto('/computer2-count', { waitUntil: 'networkidle' })
  // It pauses by itself when the program reaches HALT.
  await expect(page.getByText('Paused at breakpoint')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.console-text').last()).toContainText('')
  const console_ = page.locator('.comp[data-id^="console"]')
  const box = (await console_.locator('> g').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6)
  await expect(page.getByLabel('Console text')).toHaveText(/^0123456789\s*$/)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByLabel('Console text')).toHaveText(/^\s*$/)
})

test('devices: the keypad is read by the computer, one key at a time', async ({ page }) => {
  await page.goto('/computer2-keys', { waitUntil: 'networkidle' })
  await page.getByTestId('run').click() // (it runs already: this pauses it)
  await page.getByTestId('run').click()
  const key = async (label: string) => {
    const k = page.locator(`.comp[data-id^="keypad"] [data-key="${parseInt(label, 16)}"]`).first()
    const b = (await k.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(900)
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
  await key('7')
  await key('A')
  const console_ = page.locator('.comp[data-id^="console"]')
  const box = (await console_.locator('> g').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6)
  await expect(page.getByLabel('Console text')).toHaveText(/^7A\s*$/)
})

test('devices: a lookup table is edited cell by cell, and a speaker is muted with a click', async ({ page }) => {
  await freshEmpty(page)
  const lut = await place(page, 'lut', 300, 200)
  await expect(page.getByRole('table', { name: 'Lookup table' }).locator('tbody tr')).toHaveCount(8)
  // Majority of three to begin with: rows 3, 5, 6, 7 are 1.
  const values = () => page.getByRole('table', { name: 'Lookup table' }).locator('td.out').allTextContents()
  expect(await values()).toEqual(['0', '0', '0', '1', '0', '1', '1', '1'])
  await page.getByRole('button', { name: 'Row 0, Y' }).click()
  await page.getByRole('button', { name: 'Row 7, Y' }).click()
  expect(await values()).toEqual(['1', '0', '0', '1', '0', '1', '1', '0'])
  await page.getByRole('button', { name: 'All 0' }).click()
  expect(await values()).toEqual(Array(8).fill('0'))
  await page.getByLabel('Inputs').selectOption('4')
  await expect(page.getByRole('table', { name: 'Lookup table' }).locator('tbody tr')).toHaveCount(16)
  expect(lut).toBeTruthy()

  const speaker = await place(page, 'speaker', 600, 300)
  await expect(page.locator(`.comp[data-id="${speaker}"] .speaker-muted`)).toHaveCount(0)
  await clickComp(page, speaker)
  await expect(page.locator(`.comp[data-id="${speaker}"] .speaker-muted`)).toHaveCount(1)
  await clickComp(page, speaker)
  await expect(page.locator(`.comp[data-id="${speaker}"] .speaker-muted`)).toHaveCount(0)
})

test('devices: RAM and ROM can have 8 address bits', async ({ page }) => {
  await freshEmpty(page)
  const ram = await place(page, 'ram', 300, 200)
  await page.getByLabel('Address bits').selectOption('8')
  await expect(page.locator(`circle.pin[data-comp="${ram}"][data-pin="A7"]`)).toHaveCount(1)
  await expect(page.locator(`.comp[data-id="${ram}"]`)).toContainText('RAM 256×4')
  await expect(page.locator('.ram-word')).toHaveCount(256)
})
