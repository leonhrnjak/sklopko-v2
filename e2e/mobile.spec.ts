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

test('the overflow menu holds the secondary actions', async ({ page }) => {
  await fresh(page)
  await expect(page.locator('.toolbar > .wide-only').first()).toBeHidden()
  await page.getByRole('button', { name: 'More actions' }).tap()
  await expect(page.locator('.toolbar-menu select[aria-label="Load an example"]')).toBeVisible()
  await page.selectOption('.toolbar-menu select[aria-label="Load an example"]', 'gates')
  await expect(page.locator('.toolbar-menu')).toHaveCount(0)
  await expect(page.locator('.comp')).toHaveCount(10)
})

test('tap a part, tap the canvas to place it, then delete it from the action bar', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'More actions' }).tap()
  await page.getByRole('button', { name: 'New' }).tap()
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
  await page.getByRole('button', { name: 'State machines…' }).tap()
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
  await page.getByRole('button', { name: 'New' }).tap()
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
