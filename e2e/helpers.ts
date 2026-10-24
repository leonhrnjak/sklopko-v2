import { type Page } from '@playwright/test'
import { clearStorage } from './storage'

export async function fresh(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await clearStorage(page)
  await page.reload({ waitUntil: 'networkidle' })
}

export async function freshEmpty(page: Page) {
  await fresh(page)
  await chooseFile(page, 'New')
}

/** Drag a part from the palette and drop it at canvas-relative coordinates; returns its id. */
export async function place(page: Page, type: string, x: number, y: number): Promise<string> {
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

export async function pinCenter(page: Page, comp: string, pin: string) {
  const b = (await page.locator(`circle.pin[data-comp="${comp}"][data-pin="${pin}"]`).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

export async function wire(page: Page, from: [string, string], to: [string, string]) {
  const a = await pinCenter(page, ...from)
  const b = await pinCenter(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
}

export async function clickComp(page: Page, id: string) {
  const b = (await page.locator(`.comp[data-id="${id}"] > g`).boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

export const ledOn = (page: Page, id: string) => page.locator(`.comp[data-id="${id}"] .led-fill.on`).count().then((n) => n === 1)

/** Select a part by the label shown above it. */
export async function pickByLabel(page: Page, label: string) {
  const g = page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).locator('> g').first()
  const b = (await g.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

/** Open a toolbar menu ("Tools" or "File") and click one of its entries by name. */
async function chooseFromMenu(page: Page, menu: 'Tools' | 'File', item: string) {
  await page.getByRole('button', { name: `${menu} ▾` }).click()
  await page.getByRole('menu', { name: menu }).getByRole('menuitem', { name: item, exact: true }).click()
}

export const chooseTool = (page: Page, item: string) => chooseFromMenu(page, 'Tools', item)
export const chooseFile = (page: Page, item: string) => chooseFromMenu(page, 'File', item)

/** Switch a checkbox entry of the Tools menu (Waveforms, Timing), found by its test id. */
export async function toggleTool(page: Page, testid: 'waves-toggle' | 'timing-toggle') {
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await page.getByTestId(testid).click()
}

/** The cells of a truth table in the Logic panel, row by row (outputs only, or all columns). */
export const tableRows = async (page: Page, label: string) =>
  page.getByRole('table', { name: label }).locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent?.trim() ?? '')))

/** Click a part by the label shown above it (a switch or an input toggles; this operates, it does not select). */
export async function clickLabelled(page: Page, label: string) {
  const g = page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).locator('> g').first()
  const b = (await g.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

/** Open an example from the gallery behind the Examples button. */
export async function chooseExample(page: Page, id: string) {
  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByTestId(`example-${id}`).click()
}
