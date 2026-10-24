import { expect, test, type Page } from '@playwright/test'
import { clearStorage } from './storage'

/** The records of the library database, read the way the page itself would. */
async function records(page: Page): Promise<{ id: string; name: string; kind: string; comps: number }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('sklopko')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('docs').objectStore('docs').getAll()
          all.onsuccess = () => {
            db.close()
            resolve(all.result.map((r) => ({ id: r.id, name: r.name, kind: r.kind, comps: r.data.comps.length })))
          }
        }
      }),
  )
}

const partCount = (page: Page) => page.locator('.comp').count()

test('a circuit is kept in the library, and a reload brings it back', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await clearStorage(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.locator('.comp')).toHaveCount(0)

  const palette = page.locator('.palette-item[data-type="switch"]')
  await palette.click()
  await page.getByTestId('canvas').click({ position: { x: 300, y: 200 } })
  await expect(page.locator('.comp')).toHaveCount(1)

  await expect.poll(async () => (await records(page)).map((r) => [r.name, r.kind, r.comps])).toEqual([['My circuit', 'circuit', 1]])
  await page.reload({ waitUntil: 'networkidle' })
  expect(await partCount(page)).toBe(1)
  expect(await records(page)).toHaveLength(1) // reopened, not copied
})

test('the single saved circuit of earlier versions becomes the first document', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await clearStorage(page)
  const old = JSON.stringify({ app: 'sklopko', version: 1, comps: [{ id: 'x', type: 'switch', x: 0, y: 0, params: {} }], wires: [] })
  await page.evaluate((s) => localStorage.setItem('sklopko.circuit.v1', s), old)
  await page.reload({ waitUntil: 'networkidle' })
  expect(await partCount(page)).toBe(1)
  await expect.poll(async () => (await records(page)).map((r) => [r.name, r.comps])).toEqual([['My circuit', 1]])
  // The old copy is left as it was.
  expect(await page.evaluate(() => localStorage.getItem('sklopko.circuit.v1'))).toBe(old)
})

test('a new tab opens the document last used', async ({ page, context }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await clearStorage(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('.palette-item[data-type="switch"]').click()
  await page.getByTestId('canvas').click({ position: { x: 300, y: 200 } })
  await expect.poll(async () => (await records(page)).map((r) => r.comps)).toEqual([1])

  const other = await context.newPage()
  await other.goto('/', { waitUntil: 'networkidle' })
  expect(await partCount(other)).toBe(1)
})

test('embed mode never opens the library', async ({ page }) => {
  await page.goto('/gates?embed=1', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900) // longer than the autosave delay
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  expect(names).not.toContain('sklopko')
})

test('without a usable database the circuit still works, and the visitor is told it will not be kept', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined })
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.locator('.toast')).toContainText('will not keep your circuits')
  expect(await partCount(page)).toBeGreaterThan(3) // the welcome example, running
})
