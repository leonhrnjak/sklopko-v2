import { expect, test, type Page } from '@playwright/test'
import { clearStorage } from './storage'
import { fresh, freshEmpty, place, pinCenter, wire, clickComp, ledOn, chooseFile, toggleTool, chooseExample } from './helpers'

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
  await chooseExample(page, 'gates')
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
  await chooseFile(page, 'New')
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
  await clearStorage(page)
  await page.goto('/counter', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('canvas').locator('.note-text').first()).toBeVisible()
})

test('a part has a delay that can be set, and "realistic delays" fills them in', async ({ page }) => {
  await freshEmpty(page)
  const g = await place(page, 'and', 300, 200)
  const delay = page.getByLabel('Delay (gate delays)')

  await clickComp(page, g)
  await expect(delay).toHaveValue('1')
  await delay.fill('9')
  await expect(delay).toHaveValue('9')

  // With nothing selected, the help panel offers real-chip delays for every part: an AND takes 3.
  await page.getByTestId('canvas').click({ position: { x: 60, y: 420 } })
  await page.getByRole('button', { name: 'Realistic delays' }).click()
  await clickComp(page, g)
  await expect(delay).toHaveValue('3')

  await page.getByTestId('canvas').click({ position: { x: 60, y: 420 } })
  await page.getByRole('button', { name: 'Set all to 1' }).click()
  await clickComp(page, g)
  await expect(delay).toHaveValue('1')
})

test('signal colours: orange 1 and blue 0 for people who confuse red and green, remembered across a reload', async ({ page }) => {
  await fresh(page)
  const one = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wire-1').trim())
  const classic = await one()
  await page.getByTestId('settings').click()
  await page.getByTestId('setting-colors').selectOption('blue-orange')
  await expect.poll(one).not.toBe(classic)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('html')).toHaveAttribute('data-wires', 'blue-orange')
  await page.getByTestId('settings').click()
  await page.getByTestId('setting-colors').selectOption('classic')
  await expect.poll(one).toBe(classic)
})

test('several selected parts can be rotated, flipped and duplicated from the inspector', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'switch', 200, 120)
  await place(page, 'led', 400, 120)
  await page.keyboard.press('ControlOrMeta+a')
  const inspector = page.locator('.inspector')
  await expect(inspector.getByRole('heading', { name: '2 selected' })).toBeVisible()
  await expect(inspector.getByRole('button', { name: /Flip/ })).toBeVisible()
  await inspector.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('.comp')).toHaveCount(4)
})

test('an empty canvas says how to start, in one block of text', async ({ page }) => {
  await freshEmpty(page)
  const hint = page.locator('.empty-hint p')
  await expect(hint).toContainText('Drag parts from the left')
  await expect(hint).toContainText('Examples above.')
})

test('right-click opens a menu for the part, the wire or the canvas under the pointer', async ({ page }) => {
  await page.goto('/gates', { waitUntil: 'networkidle' })
  await clearStorage(page)
  await page.reload({ waitUntil: 'networkidle' })
  const menu = page.getByRole('menu', { name: 'Canvas actions' })
  const items = menu.getByRole('menuitem')
  const count = () => page.locator('.comp').count()
  const before = await count()

  // A part: it is selected, the menu acts on it, and Escape closes the menu.
  await page.locator('.comp[data-id^="xor"] .sym-body').first().click({ button: 'right' })
  await expect(items).toHaveText([/Rotate/, /Flip/, /Duplicate/, /Copy/, /Delete/])
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await page.locator('.comp[data-id^="xor"] .sym-body').first().click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /Duplicate/ }).click()
  await expect(menu).toHaveCount(0)
  expect(await count()).toBe(before + 1)

  // A wire: auto-route and delete.
  const onWire = await page.locator('path.wire').last().evaluate((el: SVGPathElement) => {
    const p = el.getPointAtLength(el.getTotalLength() / 2)
    const m = el.getScreenCTM()!
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }
  })
  await page.mouse.click(onWire.x, onWire.y, { button: 'right' })
  await expect(items).toHaveText([/Auto-route/, /Delete/])
  // Empty canvas: it clears the selection and offers the canvas actions; Paste uses what was copied.
  await page.getByTestId('canvas').click({ button: 'right', position: { x: 60, y: 560 } })
  await expect(items).toHaveText([/Paste/, /Select all/, /Fit to screen/])
  await menu.getByRole('menuitem', { name: /Paste/ }).click()
  expect(await count()).toBe(before + 2) // the duplicate above copied the part, so there was something to paste
  // Clicking elsewhere closes it.
  await page.getByTestId('canvas').click({ position: { x: 400, y: 560 } })
  await expect(menu).toHaveCount(0)
})

test('zoom buttons, the percentage and the + and - keys', async ({ page }) => {
  await fresh(page)
  const level = page.getByTestId('zoom-level')
  await level.click()
  await expect(level).toHaveText('100%')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(level).toHaveText('125%')
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(level).toHaveText('80%')
  await page.getByTestId('canvas').click({ position: { x: 600, y: 500 } })
  await page.keyboard.press('+')
  await expect(level).toHaveText('100%')
  await page.keyboard.press('-')
  await expect(level).toHaveText('80%')
  await level.click()
  await expect(level).toHaveText('100%')
})

test('the toolbar stays on one row at laptop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await fresh(page)
  expect((await page.locator('.toolbar').boundingBox())!.height).toBeLessThan(70)
})

test('the toolbar is one row, and Tools and File are menus that close after a choice, on Escape and on a click elsewhere', async ({ page }) => {
  await fresh(page)
  const height = (await page.locator('.toolbar').boundingBox())!.height
  expect(height).toBeLessThan(70)

  const tools = page.getByRole('menu', { name: 'Tools' })
  await expect(tools).toHaveCount(0)
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await expect(tools.getByRole('menuitem')).toHaveText(['Logic…', 'State machines…', 'Make IC…', 'Tests…', 'Challenges', 'SKASM…', '6502…'])
  await expect(tools.getByRole('menuitemcheckbox')).toHaveText(['Step-back history', 'Waveforms', 'Timing'])
  await page.keyboard.press('Escape')
  await expect(tools).toHaveCount(0)

  // Another menu replaces the open one, and so does a click on the canvas.
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await page.getByRole('button', { name: 'File ▾' }).click()
  await expect(tools).toHaveCount(0)
  const file = page.getByRole('menu', { name: 'File' })
  await expect(file.getByRole('menuitem')).toHaveText([
    'New',
    'My circuits',
    'Open file',
    'Save file',
    'Embed code',
    'Clear wires',
    'Save picture…',
  ])
  await page.getByTestId('canvas').click({ position: { x: 600, y: 400 } })
  await expect(file).toHaveCount(0)

  // Choosing an entry does its job and closes the menu; a checkbox entry shows its state.
  await toggleTool(page, 'timing-toggle')
  await expect(page.getByTestId('timing')).toBeVisible()
  await expect(page.getByRole('menu', { name: 'Tools' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await expect(page.getByTestId('timing-toggle')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('waves-toggle')).toHaveAttribute('aria-checked', 'false')
})

test('the help panel is open at first, can be hidden, comes back with the ? button, and the choice is remembered', async ({ page }) => {
  await fresh(page)
  const help = page.getByRole('heading', { name: 'How to' })
  await expect(help).toBeVisible()
  const width = async () => (await page.locator('.stage').boundingBox())!.width
  const open = await width()

  await page.getByRole('button', { name: 'Hide help' }).click()
  await expect(help).toBeHidden()
  expect(await width()).toBeGreaterThan(open + 200)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(help).toBeHidden()

  // Selecting a part still shows its settings; the ? button brings the help back (and clears the selection).
  await page.locator('.comp').first().click({ button: 'right' })
  await expect(page.locator('.inspector')).toBeVisible()
  await expect(help).toBeHidden()
  await page.getByTestId('help-toggle').click()
  await expect(help).toBeVisible()
  expect(await width()).toBe(open)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(help).toBeVisible()
})
