import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
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
            resolve(all.result.map((r) => ({ id: r.id, name: r.name, kind: r.kind, comps: r.data.comps?.length ?? 0 })))
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

// ---- My circuits ------------------------------------------------------------------------------

const dialog = (page: Page) => page.getByRole('dialog', { name: 'My circuits' })
const row = (page: Page, name: string) => dialog(page).locator('.library-row', { has: page.getByText(name, { exact: true }) })

/** Two circuits in the library: "Untitled 1" (a switch) and "Electronic dice (copy)", which is open. */
async function twoCircuits(page: Page) {
  await fresh(page)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await addPart(page, 'switch', 300, 200)
  await expect.poll(() => names(page)).toEqual(['Untitled 1'])
  await page.selectOption('select[aria-label="Load an example"]', 'dice')
  await page.locator('.comp').first().click({ button: 'right' })
  await page.keyboard.press('Delete')
  await expect.poll(() => names(page)).toEqual(['Electronic dice (copy)', 'Untitled 1'])
}

const openLibrary = async (page: Page) => {
  await page.getByRole('button', { name: 'My circuits' }).click()
  await expect(dialog(page)).toBeVisible()
}

test('My circuits lists everything, shows which is open, and opens another one', async ({ page }) => {
  await twoCircuits(page)
  await openLibrary(page)
  await expect(dialog(page).locator('.library-row')).toHaveCount(2)
  await expect(row(page, 'Electronic dice (copy)')).toContainText('open now')
  await expect(row(page, 'Untitled 1')).not.toContainText('open now')

  await row(page, 'Untitled 1').locator('.library-open').click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.comp')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Circuit name: Untitled 1' })).toBeVisible()
  // Undo has nothing to go back to: the other circuit is in the library, not on the undo stack.
  await page.keyboard.press('Control+z')
  await expect(page.locator('.comp')).toHaveCount(1)

  // A reload brings back the one that was opened.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: 'Circuit name: Untitled 1' })).toBeVisible()
})

test('the name over the canvas is the library name: click it to rename', async ({ page }) => {
  await twoCircuits(page)
  await expect(page.getByRole('button', { name: 'Circuit name: Electronic dice (copy)' })).toBeVisible()
  await page.getByRole('button', { name: /^Circuit name:/ }).click()
  await page.getByLabel('Circuit name').fill('Dice game')
  await page.getByLabel('Circuit name').press('Enter')
  await expect(page.getByRole('button', { name: 'Circuit name: Dice game' })).toBeVisible()
  await expect.poll(() => names(page)).toEqual(['Dice game', 'Untitled 1'])

  // And a new circuit is "Untitled", in italics, until it is edited (then it is kept as "Untitled 2").
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.locator('.doc-name.unsaved')).toHaveText('Untitled')
  await addPart(page, 'switch', 300, 200)
  await expect(page.getByRole('button', { name: 'Circuit name: Untitled 2' })).toBeVisible()
  await expect(page.locator('.doc-name.unsaved')).toHaveCount(0)
})

test('rename, duplicate and delete in the library; a delete can be undone', async ({ page }) => {
  await twoCircuits(page)
  await openLibrary(page)

  await dialog(page).getByRole('button', { name: 'Rename Untitled 1' }).click()
  await dialog(page).getByLabel('New name for Untitled 1').fill('Switch only')
  await dialog(page).getByLabel('New name for Untitled 1').press('Enter')
  await expect(row(page, 'Switch only')).toBeVisible()
  await expect.poll(() => names(page)).toEqual(['Electronic dice (copy)', 'Switch only'])

  await dialog(page).getByRole('button', { name: 'Duplicate Switch only' }).click()
  await expect(row(page, 'Switch only copy')).toBeVisible()
  expect(await records(page)).toHaveLength(3)

  await dialog(page).getByRole('button', { name: 'Delete Switch only copy' }).click()
  await expect(row(page, 'Switch only copy')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Deleted “Switch only copy”')
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(row(page, 'Switch only copy')).toBeVisible()
  expect(await records(page)).toHaveLength(3)

  // Deleting the circuit that is open puts a blank one in its place; Undo brings it back and opens it.
  await dialog(page).getByRole('button', { name: 'Delete Electronic dice (copy)' }).click()
  await expect(row(page, 'Electronic dice (copy)')).toHaveCount(0)
  await expect(page.locator('.comp')).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(row(page, 'Electronic dice (copy)')).toBeVisible()
  await expect(page.locator('.comp[data-id^="dicedisp"]')).toHaveCount(1)
})

test('state machines are in the library too', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'State machines…' }).click()
  const panel = page.getByRole('dialog', { name: /State machine/ })
  await expect(panel).toBeVisible()
  await page.waitForTimeout(700)
  expect((await records(page)).filter((r) => r.kind === 'fsm')).toEqual([]) // the starting example, not edited

  await panel.getByLabel('Machine name').fill('My detector')
  await expect.poll(async () => (await records(page)).filter((r) => r.kind === 'fsm').map((r) => r.name)).toEqual(['My detector'])

  // Another machine takes the editor; the first is still in My circuits, and opens again.
  await panel.getByLabel('Start from').selectOption({ label: 'Vending machine' })
  await expect(panel.getByLabel('Machine name')).toHaveValue('Vending machine')
  await panel.getByRole('button', { name: 'Close' }).first().click()
  await openLibrary(page)
  await expect(row(page, 'My detector')).toContainText('State machine')
  await dialog(page).getByLabel('Show').selectOption('circuit')
  await expect(row(page, 'My detector')).toHaveCount(0)
  await dialog(page).getByLabel('Show').selectOption('fsm')
  await row(page, 'My detector').locator('.library-open').click()
  await expect(page.getByRole('dialog', { name: /State machine/ }).getByLabel('Machine name')).toHaveValue('My detector')
})

test('the state machine of an earlier version is brought in', async ({ page }) => {
  await fresh(page)
  const old = JSON.stringify({
    format: 'sklopko-fsm',
    version: 1,
    fsm: {
      name: 'Old machine',
      type: 'moore',
      inputs: ['X'],
      outputs: ['Z'],
      reset: 'A',
      states: [{ id: 'A', name: 'A', outputs: [0], x: 100, y: 100 }],
      transitions: [],
    },
    encoding: 'binary',
    custom: {},
  })
  await page.evaluate((s) => localStorage.setItem('sklopko.fsm.v1', s), old)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'State machines…' }).click()
  await expect(page.getByRole('dialog', { name: /State machine/ }).getByLabel('Machine name')).toHaveValue('Old machine')
  await expect.poll(async () => (await records(page)).filter((r) => r.kind === 'fsm').map((r) => r.name)).toEqual(['Old machine'])
})

test('a backup holds everything, and importing adds it again without overwriting', async ({ page }) => {
  await twoCircuits(page)
  await openLibrary(page)
  const download = page.waitForEvent('download')
  await dialog(page).getByRole('button', { name: 'Download all' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('sklopko-library.json')
  const path = (await file.path())!
  const backup = JSON.parse(readFileSync(path, 'utf8')) as { app: string; docs: { name: string }[] }
  expect(backup.app).toBe('sklopko-library')
  expect(backup.docs.map((d) => d.name).sort()).toEqual(['Electronic dice (copy)', 'Untitled 1'])

  const chooser = page.waitForEvent('filechooser')
  await dialog(page).getByRole('button', { name: 'Import…' }).click()
  await (await chooser).setFiles(path)
  await expect(page.locator('.toast')).toContainText('Added 2 documents')
  await expect(dialog(page).locator('.library-row')).toHaveCount(4)
  expect(await records(page)).toHaveLength(4)

  // Something else is turned away with a reason, and nothing is added.
  const bad = page.waitForEvent('filechooser')
  await dialog(page).getByRole('button', { name: 'Import…' }).click()
  await (await bad).setFiles({ name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await expect(page.locator('.toast')).toContainText('not a Sklopko library file')
  await expect(dialog(page).locator('.library-row')).toHaveCount(4)
})

test('without a usable database, My circuits says nothing will be kept', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined })
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  await openLibrary(page)
  await expect(dialog(page)).toContainText('not keeping your circuits')
})

test('My circuits shows a thumbnail of each circuit', async ({ page }) => {
  await twoCircuits(page)
  await openLibrary(page)
  for (const name of ['Untitled 1', 'Electronic dice (copy)']) {
    const thumb = row(page, name).locator('img.library-thumb')
    await expect(thumb).toBeVisible()
    // The picture decoded: an SVG that failed to parse would have no size.
    expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  }
})

test('an example opens from a ready file, with its thumbnail beside it', async ({ page, request }) => {
  const asked: string[] = []
  page.on('request', (r) => asked.push(new URL(r.url()).pathname))
  await page.goto('/computer', { waitUntil: 'networkidle' })
  expect(asked).toContain('/examples/computer.json')
  expect(await page.locator('.comp').count()).toBeGreaterThan(100)
  expect((await request.get('/examples/computer.svg')).headers()['content-type']).toContain('image/svg+xml')
  expect((await request.get('/examples/nonesuch.json')).headers()['content-type']).toContain('text/html') // the page, not a file

  // Another example from the menu comes the same way.
  await page.selectOption('select[aria-label="Load an example"]', 'dice')
  await expect.poll(() => asked).toContain('/examples/dice.json')
  await expect(page.getByRole('button', { name: 'Circuit name: Electronic dice (copy)' })).toHaveCount(0) // unedited: no copy yet
  await expect(page).toHaveURL(/\/dice$/)
})
