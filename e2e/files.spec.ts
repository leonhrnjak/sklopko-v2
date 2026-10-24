import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { chooseFile } from './helpers'

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
  await chooseFile(page, 'Embed code')
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
    await chooseFile(page, value)
    return download
  }
  const svgFile = await save('SVG, whole circuit')
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
  const viewFile = await save('SVG, what is on screen')
  const [, , wView, hView] = viewBox(readFileSync((await viewFile.path())!, 'utf8'))
  expect(wView * hView).toBeLessThan(wAll * hAll)

  const png = await save('PNG, whole circuit')
  expect(png.suggestedFilename()).toBe('circuit.png')
  const bytes = readFileSync((await png.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(bytes.length).toBeGreaterThan(2000)
})
