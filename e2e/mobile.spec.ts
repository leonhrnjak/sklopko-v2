import { devices, expect, test, type Page } from '@playwright/test'

// Phone emulation in Chromium (the device's default WebKit isn't needed for layout and touch checks).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone } = devices['iPhone 13']
test.use(iphone)

async function fresh(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
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

test('Edit opens the inspector as a bottom sheet', async ({ page }) => {
  await fresh(page)
  const sw = page.locator('.comp[data-id^="button"] > g')
  const b = (await sw.boundingBox())!
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
  await page.locator('.action-bar').getByRole('button', { name: 'Edit' }).tap()
  await expect(page.locator('.inspector.open')).toBeVisible()
  await expect(page.locator('.inspector.open h2')).toHaveText('Push button')
  await page.getByRole('button', { name: 'Close' }).tap()
  await expect(page.locator('.inspector.open')).toHaveCount(0)
})
