import { expect, test, type Page } from '@playwright/test'
import LZString from 'lz-string'
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

/** A document as the library holds it: name, parts. */
const names = async (page: Page) => (await records(page)).map((r) => r.name).sort()

/** Start from an empty browser, with the welcome example showing. */
async function fresh(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await clearStorage(page)
  await page.reload({ waitUntil: 'networkidle' })
}

/** Click a part in the palette, then the canvas. */
async function addPart(page: Page, type: string, x: number, y: number) {
  await page.locator(`.palette-item[data-type="${type}"]`).click()
  await page.getByTestId('canvas').click({ position: { x, y } })
}

const tiny = JSON.stringify({
  app: 'sklopko',
  version: 1,
  comps: [
    { id: 's1', type: 'switch', x: 0, y: 0, params: {} },
    { id: 'l1', type: 'led', x: 120, y: 0, params: {} },
  ],
  wires: [],
})

test('a circuit is kept in the library, and a reload brings it back', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.locator('.comp')).toHaveCount(0)
  await page.waitForTimeout(700)
  expect(await records(page)).toEqual([]) // a blank circuit that is left alone is not worth keeping

  await addPart(page, 'switch', 300, 200)
  await expect(page.locator('.comp')).toHaveCount(1)

  await expect.poll(async () => (await records(page)).map((r) => [r.name, r.kind, r.comps])).toEqual([['Untitled 1', 'circuit', 1]])
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
  await fresh(page)
  await page.getByRole('button', { name: 'New' }).click()
  await addPart(page, 'switch', 300, 200)
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

test('an example is not saved until it is edited; the edit makes a copy, and what you had stays', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'New' }).click()
  await addPart(page, 'switch', 300, 200)
  await expect.poll(() => names(page)).toEqual(['Untitled 1'])

  await page.selectOption('select[aria-label="Load an example"]', 'dice')
  await expect(page.locator('.comp[data-id^="dicedisp"]')).toHaveCount(1)
  expect(new URL(page.url()).pathname).toBe('/dice')
  await page.waitForTimeout(900)
  expect(await names(page)).toEqual(['Untitled 1']) // looking is not editing

  await page.locator('.comp').first().click({ button: 'right' })
  await page.keyboard.press('Delete')
  await expect.poll(() => names(page)).toEqual(['Electronic dice (copy)', 'Untitled 1'])
  expect(new URL(page.url()).pathname).toBe('/')

  // A reload brings back the copy; the first circuit is still in the library.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('.comp[data-id^="dicedisp"]')).toHaveCount(1)
  expect((await records(page)).find((r) => r.name === 'Untitled 1')?.comps).toBe(1)
})

test('visiting an example link does not touch the circuit you were working on', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'New' }).click()
  await addPart(page, 'switch', 300, 200)
  await expect.poll(() => names(page)).toEqual(['Untitled 1'])

  await page.goto('/intersection', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  expect(await records(page)).toHaveLength(1)
  expect((await records(page))[0].comps).toBe(1)
})

test('a shared link and an opened file each become a document of their own, at once', async ({ page }) => {
  await fresh(page)
  await page.goto('about:blank')
  await page.goto('/#c=' + LZString.compressToEncodedURIComponent(tiny), { waitUntil: 'networkidle' })
  expect(await partCount(page)).toBe(2)
  await expect.poll(() => names(page)).toEqual(['Shared circuit'])

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await chooser).setFiles({ name: 'half-adder.sklopko.json', mimeType: 'application/json', buffer: Buffer.from(tiny) })
  await expect.poll(() => names(page)).toEqual(['Shared circuit', 'half-adder'])
})

test('a challenge keeps your work: leave it, come back, and your circuit is there', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Challenges', exact: true }).click()
  await page.getByTestId('challenge-wire').click()
  const panel = page.getByRole('region', { name: 'Challenge' })
  await expect(page.locator('.comp')).toHaveCount(2)
  await addPart(page, 'or', 300, 200)
  await expect(page.locator('.comp')).toHaveCount(3)
  await expect.poll(() => names(page)).toEqual(['Challenge: Make the light follow the switch'])

  // Somewhere else, and back: the same document, with the part you added.
  await page.selectOption('select[aria-label="Load an example"]', 'gates')
  await expect(page.locator('.comp')).not.toHaveCount(3)
  await page.getByRole('button', { name: 'Challenges', exact: true }).click()
  await page.getByTestId('challenge-wire').click()
  await expect(page.locator('.comp')).toHaveCount(3)
  expect(await records(page)).toHaveLength(1)

  // Start over is an edit like any other: undo brings the work back.
  await panel.getByRole('button', { name: 'Start over' }).click()
  await expect(page.locator('.comp')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.comp')).toHaveCount(3)
})
