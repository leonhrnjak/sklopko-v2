import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fresh, freshEmpty, place, wire, clickComp, ledOn, pickByLabel, toggleTool, clickLabelled, chooseExample } from './helpers'

test('examples load and the welcome counter ticks', async ({ page }) => {
  await fresh(page)
  await expect(page.locator('.version')).toHaveText(/^v\d+\.\d+\.\d+$/)
  const seg = page.locator('.comp polygon.seg.on')
  // The decade counter runs at 2 Hz: the lit segments change within a second or two.
  const first = await seg.count()
  await expect.poll(async () => seg.count(), { timeout: 4000 }).not.toBe(first)
  for (const ex of ['gates', 'sr-latch', 'd-latch', 'shift-register', 'ripple-counter', 'adder', 'mux', 'oscillator', 'intersection', 'dice', 'clock']) {
    await chooseExample(page, ex)
    await expect(page.locator('.comp').first()).toBeVisible()
  }
})

test('4-bit input cycles on click and the push button resets the counter while held', async ({ page }) => {
  await fresh(page)
  await chooseExample(page, 'adder')
  const display = page.locator('.comp[data-id^="hexdisp"] polygon.seg.on')
  await expect(display).toHaveCount(5) // 5 + 9 = E
  await clickComp(page, 'hexin1')
  await expect(display).toHaveCount(4) // 6 + 9 = F

  await chooseExample(page, 'counter')
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
  await page.getByLabel('Frequency').selectOption('16')
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
  await toggleTool(page, 'waves-toggle')
  await expect(page.getByTestId('waves')).toHaveCount(0)
  await toggleTool(page, 'waves-toggle')
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
  await expect(current).toHaveText('OUT NUMBER')
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

test('Step-back history can be switched off: Back is disabled and says why, undo and a reload keep to it', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  const back = page.getByRole('button', { name: '◀ Back' })
  const step = async (n: number) => {
    for (let i = 0; i < n; i++) await page.getByRole('button', { name: 'Clock step' }).click()
  }
  await step(3)
  await expect(back).toBeEnabled()

  await toggleTool(page, 'history-toggle')
  await expect(back).toBeDisabled()
  await expect(back).toHaveAttribute('title', /switched off.*Step-back history/)
  await page.getByRole('button', { name: 'Tools ▾' }).click()
  await expect(page.getByTestId('history-toggle')).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
  await step(2) // the circuit still runs, there is just nothing to go back to
  await expect(back).toBeDisabled()

  // Switching it off was one step of undo and redo; the history begins again at the next edge.
  await page.getByRole('button', { name: 'Undo' }).click()
  await step(3)
  await expect(back).toBeEnabled()
  await expect(back).toHaveAttribute('title', /previous clock edge/)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(back).toBeDisabled()

  // The setting is part of the circuit: a reload (after the autosave) brings it back off.
  await page.waitForTimeout(900)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await step(3)
  await expect(back).toBeDisabled()
  await toggleTool(page, 'history-toggle')
  await step(3)
  await expect(back).toBeEnabled()
})

test('a CPU with a fast clock says how fast it really runs', async ({ page }) => {
  await page.goto('/6502-keypad', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Clock \\(Φ2\\)')
  await page.getByLabel('Frequency').selectOption({ label: '1 MHz' })
  await pickByLabel(page, 'CPU')
  const rate = page.getByTestId('cpu-rate')
  await expect(rate).toContainText('cycles a second', { timeout: 15000 })
  await expect(rate).toContainText('of a 1 MHz 6502')
  // (a number of the page’s own making: it must be less than the million that was asked for)
  const text = (await rate.textContent())!
  const cycles = Number(/Running at ([\d,]+) cycles/.exec(text)![1].replace(/,/g, ''))
  expect(cycles).toBeGreaterThan(500)
  expect(cycles).toBeLessThan(1_000_000)
})

test('the footer names the fastest clock and what it reaches, and says when the page cannot keep up', async ({ page }) => {
  // The welcome example ticks twice a second: the page keeps up, so asked and actual agree (and the speed scales both).
  await page.goto('/', { waitUntil: 'networkidle' })
  const clock = page.getByTestId('clock-rate')
  await expect(page.getByTestId('run-state')).toHaveText('Running')
  await expect(clock).toHaveText('Clock 2 Hz · actual 2 Hz', { timeout: 5000 })
  await expect(page.getByTestId('run-time')).toContainText('t = ') // the simulated time
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await expect(clock).toContainText('Clock 8 Hz')
  await page.getByTestId('run').click() // paused: the asked rate stays, nothing is measured
  await expect(page.getByTestId('run-state')).toHaveText('Paused')
  await expect(clock).toHaveText('Clock 8 Hz')

  // A 1 MHz clock on a CPU is more than the page can simulate.
  await page.goto('/6502-keypad', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Clock \\(Φ2\\)')
  await page.getByLabel('Frequency').selectOption({ label: '1 MHz' })
  await expect(clock).toContainText(/Clock 1 MHz · actual [\d.]+ [kM]?Hz \(\d+%\)/, { timeout: 15000 })
})

/** Select a wire by clicking the middle of its first segment (the thin hit areas of a wire are not "visible" to a plain click). */
async function selectWire(page: import('@playwright/test').Page, n: number) {
  const b = (await page.locator('.wire-group').nth(n).locator('.wire-hit').first().boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

test('hold a wire at 0 or 1 to see a stuck-at fault, and let it go', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 120, 150)
  const gate = await place(page, 'not', 340, 150)
  const led = await place(page, 'led', 560, 150)
  await wire(page, [sw, 'Q'], [gate, 'A'])
  await wire(page, [gate, 'Y'], [led, 'A'])
  await expect.poll(() => ledOn(page, led)).toBe(true) // the switch is off, so NOT gives 1

  // Select the wire after the gate (the second one) and hold it at 0.
  await selectWire(page, 1)
  await page.getByTestId('force-0').click()
  await expect.poll(() => ledOn(page, led)).toBe(false)
  await expect(page.locator('.wire-group.forced')).toHaveCount(1)
  await expect(page.locator('.wire-force-mark')).toHaveText('⚡0')
  // The switch no longer matters on that side.
  await clickComp(page, sw)
  await expect.poll(() => ledOn(page, led)).toBe(false)
  await page.getByTestId('run').click() // paused: it is still held
  await expect(page.getByTestId('force-badge')).toContainText('1 held')

  // Hold it at 1, then let it go: the gate says what it says (the switch is on, so NOT gives 0).
  await selectWire(page, 1)
  await page.getByTestId('force-1').click()
  await expect.poll(() => ledOn(page, led)).toBe(true)
  await page.getByTestId('force-release').click()
  await expect.poll(() => ledOn(page, led)).toBe(false)
  await expect(page.locator('.wire-group.forced')).toHaveCount(0)
  await expect(page.getByTestId('force-badge')).toHaveCount(0)

  // Release all, from the badge.
  await page.getByTestId('force-1').click()
  await expect(page.getByTestId('force-badge')).toBeVisible()
  await page.getByTestId('force-badge').getByRole('button', { name: 'Release all' }).click()
  await expect(page.getByTestId('force-badge')).toHaveCount(0)
})

test('Back while running pauses the simulation', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('button', { name: '◀ Back' })).toBeEnabled({ timeout: 5000 })
  await page.getByRole('button', { name: '◀ Back' }).click()
  await expect(page.getByTestId('run')).toContainText('Run') // it is paused now
})

test('breakpoint: the computer pauses by itself when it reaches HALT', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await expect(page.getByTestId('run')).toContainText('Run', { timeout: 30000 }) // the label of the button while paused
  await expect(page.locator('.toast')).toContainText('Paused at breakpoint “Pause at HALT”.')
  const halted = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Halted$/ }) }).locator('.led-fill.on')
  await expect(halted).toHaveCount(1)
  // The stop sign shows that its condition holds, and Run carries on without stopping again.
  await expect(page.locator('.break-body.met')).toHaveCount(1)
  await page.getByTestId('run').click()
  await page.waitForTimeout(1200)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('breakpoint: place one, wire it to a counter, and Run stops where it says', async ({ page }) => {
  await freshEmpty(page)
  const clk = await place(page, 'clock', 120, 150)
  const cnt = await place(page, 'counter', 320, 150)
  const bp = await place(page, 'breakpoint', 560, 150)
  await expect(page.getByTestId('breakpoint-count')).toHaveText('Breakpoints: 1') // counted in the footer
  await wire(page, [clk, 'Q'], [cnt, 'CLK'])
  await wire(page, [cnt, 'A'], [bp, 'A'])
  await expect(page.locator('.wire-group')).toHaveCount(2)
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await expect(page.locator('.toast')).toContainText('Paused at breakpoint “Breakpoint”.', { timeout: 15000 })
  await expect(page.getByTestId('run')).toContainText('Run')
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
  expect(text).toContain('$var wire 8 " PC $end')
  expect(text).toContain('$var wire 8 # ACC $end')
  expect(text).toContain('$enddefinitions $end')
  expect(text).toMatch(/\nb\d{8} "\n/) // the 8-bit PC changed at least once

  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  const png = await pngDownload
  expect(png.suggestedFilename()).toBe('waveforms.png')
  const bytes = readFileSync((await png.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]) // the PNG signature
})

test('timing: the slowest path, a changed delay, and the path marked on the circuit', async ({ page }) => {
  await freshEmpty(page)
  const sw = await place(page, 'switch', 100, 200)
  const n1 = await place(page, 'not', 250, 200)
  const n2 = await place(page, 'not', 400, 200)
  const led = await place(page, 'led', 560, 200)
  await wire(page, [sw, 'Q'], [n1, 'A'])
  await wire(page, [n1, 'Y'], [n2, 'A'])
  await wire(page, [n2, 'Y'], [led, 'A'])

  await toggleTool(page, 'timing-toggle')
  const timing = page.getByTestId('timing')
  await expect(timing.getByTestId('timing-delay')).toHaveText('2 gate delays')
  await expect(timing.getByTestId('timing-fmax')).toContainText('20 ns at 10 ns each') // 2 × 10 ns
  await expect(page.getByRole('list', { name: 'The slowest path' }).locator('li')).toHaveCount(4) // switch, two inverters, LED

  // A slower inverter makes the path longer.
  await clickComp(page, n1)
  await page.getByLabel('Delay (gate delays)').fill('5')
  await expect(timing.getByTestId('timing-delay')).toHaveText('6 gate delays')

  // The path is marked on the circuit when asked.
  await expect(page.locator('.wire-trace.path')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show path' }).click()
  await expect(page.locator('.wire-trace.path')).toHaveCount(3)
  await page.getByLabel('Nanoseconds per gate delay').fill('100')
  await expect(timing.getByTestId('timing-fmax')).toContainText('600 ns at 100 ns each')

  // Back to the waveforms: the marks go away.
  await page.getByRole('tab', { name: 'Waveforms' }).click()
  await expect(page.locator('.wire-trace.path')).toHaveCount(0)
})


test('glitches: the hazard example dips for a moment, it is marked on the circuit, and the fixed copy holds', async ({ page }) => {
  await page.goto('/hazard', { waitUntil: 'networkidle' })
  await toggleTool(page, 'timing-toggle')
  await expect(page.getByTestId('timing')).toBeVisible() // the panel loads on demand, and records only once it is there
  await expect(page.getByTestId('tick-info')).toHaveCount(0) // nothing has changed yet

  await clickLabelled(page, 'A') // A falls
  await expect(page.getByTestId('tick-info')).toContainText('a change of an input')
  await expect(page.getByTestId('glitch-count')).toHaveText('1 signal glitched.')
  await expect(page.getByRole('list', { name: 'Glitches' })).toContainText('static-1')
  await expect(page.getByTestId('tick-canvas')).toBeVisible()
  await expect(page.locator('.wire-trace.glitch').first()).toBeVisible()
  // The diagram is drawn at the width it is shown at: not drawn narrow and stretched by CSS.
  const sizes = await page.getByTestId('tick-canvas').evaluate((c: HTMLCanvasElement) => ({ drawn: c.width / (window.devicePixelRatio || 1), shown: c.getBoundingClientRect().width, wrap: c.parentElement!.clientWidth }))
  expect(Math.abs(sizes.drawn - sizes.shown)).toBeLessThan(2)
  expect(Math.abs(sizes.shown - sizes.wrap)).toBeLessThan(2)

  await clickLabelled(page, 'A') // A rises again: no glitch this way round
  await expect(page.getByTestId('glitch-count')).toHaveText('No signal glitched.')
  await expect(page.locator('.wire-trace.glitch')).toHaveCount(0)

  // Leaving the timing view stops recording and takes the marks away.
  await clickLabelled(page, 'A')
  await expect(page.locator('.wire-trace.glitch').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Waveforms' }).click()
  await expect(page.locator('.wire-trace.glitch')).toHaveCount(0)
})

test('glitches: in the ripple-carry adder three sum bits flicker, one after another, and the slowest path is the carry chain', async ({ page }) => {
  await page.goto('/ripple', { waitUntil: 'networkidle' })
  await toggleTool(page, 'timing-toggle')
  // The timing panel covers the lower half of the canvas, and the switches are down there: scroll them into the part that is left.
  await page.getByTestId('canvas').hover()
  await page.mouse.wheel(0, 150)
  await expect(page.getByTestId('timing-delay')).toHaveText('24 gate delays')
  await clickLabelled(page, 'A') // 5 -> 6
  // Three sum bits and two of the carries between the adders.
  await expect(page.getByTestId('glitch-count')).toHaveText('5 signals glitched.')
  await expect(page.getByTestId('tick-info')).toContainText('25 gate delays')
  await expect(page.getByRole('list', { name: 'Glitches' }).locator('li')).toHaveCount(5)
  await page.getByLabel('Glitches only').check()
  await expect(page.getByTestId('tick-canvas')).toBeVisible()
})

// ---- State machine editor ----
