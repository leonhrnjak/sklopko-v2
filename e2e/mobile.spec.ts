import { devices, expect, test, type Page } from '@playwright/test'
import { clearStorage } from './storage'

// Phone emulation in Chromium (the device's default WebKit isn't needed for layout and touch checks).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone } = devices['iPhone 13']
test.use(iphone)

async function fresh(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await clearStorage(page)
  await page.reload({ waitUntil: 'networkidle' })
}

test('nothing overflows the screen sideways', async ({ page }) => {
  await fresh(page)
  const { scrollW, width, outside } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    width: window.innerWidth,
    outside: [...document.querySelectorAll('.toolbar > *, .palette, .stage')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
      .map((el) => el.className),
  }))
  expect(scrollW).toBeLessThanOrEqual(width)
  expect(outside).toEqual([])
  // Every palette item fits inside the parts panel.
  const tooWide = await page.evaluate(() => {
    const panel = document.querySelector('.palette-scroll')!.getBoundingClientRect()
    return [...document.querySelectorAll('.palette-item')].filter((el) => el.getBoundingClientRect().right > panel.right + 0.5).length
  })
  expect(tooWide).toBe(0)
})

test('the overflow menu holds the secondary actions, and the example gallery fits a phone', async ({ page }) => {
  await fresh(page)
  await expect(page.locator('.toolbar > .wide-only').first()).toBeHidden()
  await page.getByRole('button', { name: 'More actions' }).tap()
  await expect(page.locator('.toolbar-menu').getByRole('menuitem', { name: 'Logic', exact: true })).toBeVisible()
  await expect(page.locator('.toolbar-menu').getByRole('menuitem', { name: 'Save file' })).toBeVisible()
  await page.locator('.toolbar-menu').getByRole('button', { name: 'Examples', exact: true }).tap()
  await expect(page.locator('.toolbar-menu')).toHaveCount(0)
  const dialog = page.getByRole('dialog', { name: 'Examples' })
  await expect(dialog).toBeVisible()
  const width = page.viewportSize()!.width
  for (const el of [dialog, dialog.locator('.gallery-card').first(), dialog.getByLabel('Search examples')]) {
    const box = (await el.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5)
  }
  // The keyboard stays closed until the search box is tapped, and the cards are rows, not full-screen pictures.
  await expect(dialog.getByLabel('Search examples')).not.toBeFocused()
  expect((await dialog.locator('.gallery-card').first().boundingBox())!.height).toBeLessThan(150)
  // The categories are one row to swipe, and choosing one swaps the list.
  expect((await dialog.getByRole('navigation', { name: 'Categories' }).boundingBox())!.height).toBeLessThan(70)
  await dialog.getByRole('button', { name: /^Logic basics/ }).tap()
  await expect(dialog.getByTestId('example-mux')).toBeVisible()
  await dialog.getByRole('button', { name: /^Start here/ }).tap()
  await dialog.getByTestId('example-gates').tap()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.comp')).toHaveCount(10)
})

test('the Examples button leads the menu, and the speed list does not span the screen', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  const menu = page.locator('.toolbar-menu')
  const examples = (await menu.getByRole('button', { name: 'Examples', exact: true }).boundingBox())!
  const first = (await menu.locator('button, select').first().boundingBox())!
  expect(examples.y).toBe(first.y)
  const speed = (await menu.getByLabel('Simulation speed').boundingBox())!
  expect(speed.width).toBeLessThan(page.viewportSize()!.width / 2)
})

test('the waveform panel can be closed with its X, and the picture export is one menu entry with a dialog', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByTestId('waves-toggle').tap()
  const close = page.getByRole('button', { name: 'Close waveforms' })
  await expect(close).toBeVisible()
  const box = (await close.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5)
  await close.tap()
  await expect(page.getByTestId('waves')).toHaveCount(0)

  await page.getByRole('button', { name: 'More actions' }).tap()
  await expect(page.locator('.toolbar-menu').getByRole('menuitem', { name: /^(SVG|PNG)/ })).toHaveCount(0)
  await page.locator('.toolbar-menu').getByRole('menuitem', { name: 'Save picture', exact: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'Save a picture' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('PNG').check()
  await expect(dialog.getByRole('button', { name: 'Save PNG' })).toBeVisible()
})

test('tap a part, tap the canvas to place it, then delete it from the action bar', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('menuitem', { name: 'New', exact: true }).tap()
  await expect(page.locator('.comp')).toHaveCount(0)

  await page.locator('.palette-item[data-type="and"]').tap()
  await expect(page.locator('.placing-hint')).toContainText('AND')
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await expect(page.locator('.comp')).toHaveCount(1)
  await expect(page.locator('.placing-hint')).toHaveCount(0)

  // The new part is selected; the action bar offers Delete.
  await page.locator('.action-bar').getByRole('button', { name: 'Delete' }).tap()
  await expect(page.locator('.comp')).toHaveCount(0)
})

test('tapping a control operates it; a long-press selects it for editing', async ({ page, context }) => {
  await fresh(page)
  const sw = page.locator('.comp[data-id^="button"] > g')
  const b = (await sw.boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2

  // A plain tap presses the button but doesn't select it.
  await page.touchscreen.tap(x, y)
  await expect(page.locator('.comp.selected')).toHaveCount(0)
  await expect(page.locator('.action-bar')).toHaveCount(0)

  // Long-press with real touch events.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await page.waitForTimeout(800)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.comp.selected')).toHaveCount(1)
  await page.locator('.action-bar').getByRole('button', { name: 'Edit' }).tap()
  await expect(page.locator('.inspector.open')).toBeVisible()
  await expect(page.locator('.inspector.open h2')).toHaveText('Push button')
  await page.getByRole('button', { name: 'Close' }).tap()
  await expect(page.locator('.inspector.open')).toHaveCount(0)
})

test('state machines: edit in the table on a phone, join states by tapping, and generate', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('menuitem', { name: 'State machines', exact: true }).tap()
  const panel = page.getByRole('dialog', { name: 'State machines' })
  await expect(panel).toBeVisible()
  // The diagram comes first on a narrow screen, and nothing sticks out sideways.
  await expect(panel.getByTestId('fsm-diagram')).toBeVisible()
  const wide = await page.evaluate(() => {
    const box = document.querySelector('.modal.fsm')!.getBoundingClientRect()
    return [...document.querySelectorAll('.modal.fsm *')].filter((el) => !el.closest('.fsm-scroll') && el.getBoundingClientRect().right > box.right + 1 && el.getBoundingClientRect().width > 0).map((el) => el.className.toString() || el.tagName)
  })
  expect(wide).toEqual([])

  // Tap + State, then + Transition and two states: a transition is added and its guard box is there to fill.
  await panel.getByRole('button', { name: '+ State' }).tap()
  await expect(panel.getByRole('region', { name: /^State S/ })).toBeVisible()
  await panel.getByRole('button', { name: '+ Transition' }).tap()
  await panel.getByRole('button', { name: 'State Start' }).tap()
  await panel.getByRole('button', { name: /^State S4/ }).tap()
  await expect(panel.getByRole('region', { name: 'Transition' })).toBeVisible()
  await panel.getByLabel('Guard').fill('X')
  await expect(panel.locator('.fsm-arrow')).toHaveCount(9)

  // The table edits the same machine.
  await panel.getByRole('tab', { name: 'Table' }).tap()
  await expect(panel.getByLabel('Condition of the transition Start to S4')).toHaveValue('X')
  await panel.getByLabel('Condition of the transition Start to One').fill('X &')
  await expect(panel.getByRole('complementary', { name: 'State machine settings' }).getByRole('list', { name: 'Problems' })).toContainText('does not make sense')
  await panel.getByLabel('Condition of the transition Start to One').fill('X & !X')
  await panel.getByRole('button', { name: 'Delete transition' }).last().tap()
  await expect(panel.getByRole('button', { name: 'Generate circuit' })).toBeEnabled()
  await panel.getByRole('button', { name: 'Generate circuit' }).tap()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.comp-label', { hasText: /^State bit 0$/ })).toHaveCount(1)
})

test('a bus wire can be drawn by touch between two bus pins', async ({ page, context }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('menuitem', { name: 'New', exact: true }).tap()
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  const put = async (type: string, x: number, y: number) => {
    const item = page.locator(`.palette-item[data-type="${type}"]`)
    await item.scrollIntoViewIfNeeded()
    await item.tap()
    await page.touchscreen.tap(canvas.x + x, canvas.y + y)
    return (await page.locator('.comp.selected').getAttribute('data-id'))!
  }
  const reg = await put('register', 40, 60)
  const add = await put('add4', 60, 220)
  const center = async (comp: string, pin: string) => {
    const b = (await page.locator(`circle.pin[data-comp="${comp}"][data-pin="${pin}"]`).boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const from = await center(reg, 'Q')
  const to = await center(add, 'A')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.wire.bus')).toHaveCount(1)
})

test('My circuits fits a phone, with the circuit name over the canvas', async ({ page }) => {
  await fresh(page)
  await expect(page.locator('.status .doc-name')).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('menuitem', { name: 'New', exact: true }).tap()
  await page.locator('.palette-item[data-type="and"]').tap()
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await expect(page.getByRole('button', { name: 'Circuit name: Untitled 1' })).toBeVisible()

  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('menuitem', { name: 'My circuits', exact: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'My circuits' })
  await expect(dialog.locator('.library-row')).toHaveCount(1)
  const width = page.viewportSize()!.width
  for (const el of [dialog, dialog.locator('.library-row'), dialog.getByRole('button', { name: 'Delete Untitled 1' })]) {
    const box = (await el.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5)
  }
  await expect(dialog.getByRole('button', { name: 'New circuit' })).toBeVisible()
})

test('the parts list folds down to its handle, folds away while a part waits to be placed, and comes back after', async ({ page }) => {
  await fresh(page)
  const handle = page.getByTestId('parts-handle')
  const canvasHeight = async () => (await page.getByTestId('canvas').boundingBox())!.height
  const open = await canvasHeight()
  await expect(page.locator('.palette .search')).toBeVisible()

  await handle.tap()
  await expect(page.locator('.palette .search')).toBeHidden()
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
  expect(await canvasHeight()).toBeGreaterThan(open + 100)

  await handle.tap()
  await expect(page.locator('.palette .search')).toBeVisible()
  await page.locator('.palette-item[data-type="and"]').tap()
  await expect(page.locator('.palette .search')).toBeHidden()
  await expect(page.locator('.placing-hint')).toContainText('AND')
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + 100)
  await expect(page.locator('.placing-hint')).toHaveCount(0)
  await expect(page.locator('.palette .search')).toBeVisible()
})

test('the terminal takes typing on a phone: tap it, then the keyboard goes to it', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('menuitem', { name: 'New', exact: true }).tap()
  await page.locator('.palette-item[data-type="acia6551"]').tap()
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  const term = page.locator('.comp').first()
  await expect(term).toHaveCount(1)
  const id = (await term.getAttribute('data-id'))!
  const keyboard = page.locator(`textarea[data-terminal-input="${id}"]`)
  await term.locator('.screen-body').tap()
  await expect(keyboard).toBeFocused()
  await page.keyboard.type('ok')
  await page.locator('.action-bar').getByRole('button', { name: 'Edit' }).tap()
  await expect(page.getByText('2 characters waiting on the keyboard.', { exact: true })).toBeVisible()
})

test('the BASIC computer on a phone: tap the terminal and run a program', async ({ page }) => {
  await page.goto('/6502-basic', { waitUntil: 'networkidle' })
  const term = page.locator('.comp', { has: page.locator('.screen-body') })
  const id = (await term.getAttribute('data-id'))!
  const keyboard = page.locator(`textarea[data-terminal-input="${id}"]`)
  await term.locator('.screen-body').tap()
  await expect(keyboard).toBeFocused()
  await page.keyboard.type('print 6*7')
  await page.keyboard.press('Enter')
  await page.locator('.action-bar').getByRole('button', { name: 'Edit' }).tap()
  await expect(page.getByLabel('Screen text')).toContainText(/PRINT 6\*7\s+42\s+OK/, { timeout: 60000 })
})

test('a control ROM on a phone: the listing fits, and a row is edited by its signals with taps', async ({ page }) => {
  await page.goto('/beginner', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).tap()
  const rom = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Control ROM$/ }) }).locator('> g').first()
  await rom.tap()
  await page.locator('.action-bar').getByRole('button', { name: 'Edit' }).tap()
  const listing = page.getByLabel('Listing')
  await expect(listing).toBeVisible()
  const row = (name: string) => listing.getByRole('row').filter({ has: page.locator('.text', { hasText: new RegExp(`^${name}$`) }) })
  await expect(row('ADD')).toContainText('LOAD_ACC, ACC_SRC=ADDER, SAVE_CARRY')
  // Nothing sticks out sideways: not the page, not the listing, not its rows.
  const out = await page.evaluate(() => {
    const width = window.innerWidth
    const box = document.querySelector('[aria-label="Listing"]')!.getBoundingClientRect()
    return { page: document.documentElement.scrollWidth - width, right: Math.round(box.right - width) }
  })
  expect(out.page).toBeLessThanOrEqual(0)
  expect(out.right).toBeLessThanOrEqual(0)
  // A tap on a row opens the editor under it; a tap on a signal changes the row and the hex word.
  await row('ADD').tap()
  const editor = page.getByRole('group', { name: 'Signals of row ADD' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('SAVE_CARRY').tap()
  await expect(row('ADD')).not.toContainText('SAVE_CARRY')
  await expect(row('ADD')).toContainText('LOAD_ACC, ACC_SRC=ADDER')
})

test('a step of Learn can be folded to its bar to use the parts list, and unfolded again', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/and-from-nand', { waitUntil: 'networkidle' })
  const panel = page.getByRole('region', { name: 'Step' })
  const fold = panel.getByTestId('sheet-fold')
  await expect(panel).toContainText('AND gives 1 only when both inputs are 1')
  await expect(fold).toHaveText('Parts ▾')
  const full = (await panel.boundingBox())!

  // Folded: only the bar is left, the step goes on, and the parts of the step (and the kit) can be reached.
  await fold.tap()
  await expect(fold).toHaveText('Lesson ▴')
  await expect(panel.locator('.challenge-body')).toBeHidden()
  const bar = (await panel.boundingBox())!
  expect(bar.height).toBeLessThan(full.height / 3)
  const chip = page.locator('.palette-item[data-type="ic:kit:not-from-nand"]')
  await expect(chip).toBeVisible()
  const c = (await chip.boundingBox())!
  expect(c.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1) // the bar is above the list, not over it
  await expect(panel).toContainText('2.3 AND, from NAND and your NOT')

  // One tap brings the lesson back; the step has not been closed or restarted in between.
  await fold.tap()
  await expect(fold).toHaveText('Parts ▾')
  await expect(panel).toContainText('AND gives 1 only when both inputs are 1')
  await expect(page).toHaveURL(/\/learn\/and-from-nand$/)
})

test('on a phone a step of Learn is checked and its verdict is on screen, a project step too, and nothing overflows sideways', async ({ page }) => {
  await fresh(page)
  await page.goto('/learn/not-from-nand', { waitUntil: 'networkidle' })
  const panel = page.getByRole('region', { name: 'Step' })
  await panel.getByRole('button', { name: 'Show a solution' }).tap()
  await panel.getByTestId('step-check').tap()
  await expect(panel).toContainText('Solved!')
  await expect(panel.getByTestId('chip-earned')).toBeVisible()
  const overflow = () =>
    page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, width: window.innerWidth, panelRight: document.querySelector('.step-panel')!.getBoundingClientRect().right }))
  let o = await overflow()
  expect(o.scrollW).toBeLessThanOrEqual(o.width)
  expect(o.panelRight).toBeLessThanOrEqual(o.width + 0.5)

  // The CPU project: its test programs are listed under the lesson, and a check ticks them.
  await page.goto('/learn/cpu-fetch', { waitUntil: 'networkidle' })
  await panel.getByRole('button', { name: 'Show a solution' }).tap()
  await panel.getByTestId('step-check').tap()
  await expect(panel).toContainText('Solved!')
  await expect(panel.getByTestId('project-lines')).toContainText('☑ after 5 ticks the PC is 5')
  o = await overflow()
  expect(o.scrollW).toBeLessThanOrEqual(o.width)
  expect(o.panelRight).toBeLessThanOrEqual(o.width + 0.5)
})

test('on a phone every chapter of the Learn map is on screen, with no sideways scrolling', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.locator('.toolbar-menu').getByText('Learn: from NAND to a computer').tap()
  const map = page.getByRole('dialog', { name: 'Learn' })
  await expect(map.getByTestId('learn-chapter-basic')).toBeVisible()
  const width = page.viewportSize()!.width
  const boxes = await map.locator('[data-testid^="learn-chapter-"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })))
  expect(boxes).toHaveLength(14)
  for (const b of boxes) {
    expect(b.l).toBeGreaterThanOrEqual(0)
    expect(b.r).toBeLessThanOrEqual(width + 0.5)
  }
})

test('the Doom-like example on a phone: the gamepad is on screen, a touch on its up button walks, and the guide fits', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/6502-doomlike', { waitUntil: 'networkidle' })
  const canvas = page.getByTestId('canvas').locator('canvas.video-canvas')
  await expect(canvas).toBeVisible()
  const sample = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let h = 0
      for (let i = 0; i < d.length; i += 4 * 7) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 5) | 0
      return h
    })
  // The first picture: the sky is on screen.
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(80, 2, 1, 1).data)), { timeout: 30000 })
    .toEqual([0x1b, 0x2a, 0x6b, 255])
  const before = await sample()
  // The gamepad's up button is a touch target inside the viewport.
  const up = page.locator('.comp [data-key="0"]').first()
  await expect(up).toBeVisible()
  const box = (await up.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  // Hold it for ten seconds of the page.
  await up.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 })
  await page.waitForTimeout(10_000)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', isPrimary: true })))
  await expect.poll(sample, { timeout: 20000 }).not.toBe(before)
  const { scrollW, width } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, width: window.innerWidth }))
  expect(scrollW).toBeLessThanOrEqual(width)
  // The guide opens from Tools and fits the screen.
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.locator('.toolbar-menu').getByRole('menuitem', { name: 'Doom-like' }).tap()
  const dialog = page.getByRole('dialog', { name: 'Doom-like guide' })
  await expect(dialog).toBeVisible()
  const d = (await dialog.boundingBox())!
  expect(d.x + d.width).toBeLessThanOrEqual(width + 0.5)
})
