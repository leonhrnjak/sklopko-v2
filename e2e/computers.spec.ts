import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { freshEmpty, place, clickComp, pickByLabel, chooseTool } from './helpers'

test('ROM: contents are edited as hex text in the inspector and shown in the table', async ({ page }) => {
  await freshEmpty(page)
  const rom = await place(page, 'rom', 300, 200)
  const cell = (n: number) => page.locator(`.comp[data-id="${rom}"] .mem-cell`).nth(n)
  await expect(cell(3)).toHaveText('3')

  const box = page.getByLabel('Contents (hex words)')
  await box.fill('A B xyz')
  await expect(page.getByText('Only hexadecimal digits')).toBeVisible()
  await page.getByLabel('Label').click() // blur: invalid text is not applied
  await expect(cell(0)).toHaveText('0')

  await box.fill('A B C')
  await page.getByLabel('Label').click()
  await expect(cell(0)).toHaveText('A')
  await expect(cell(2)).toHaveText('C')
  await expect(cell(3)).toHaveText('0')
})

test('control ROM: the listing names each row and what it switches on, and follows the instruction being read', async ({ page }) => {
  await page.goto('/beginner', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'Control ROM')
  const listing = page.getByLabel('Listing')
  const row = (name: string) => listing.getByRole('row').filter({ has: page.locator('.text', { hasText: new RegExp(`^${name}$`) }) })
  await expect(row('ADD')).toContainText('LOAD_ACC, ACC_SRC=ADDER, SAVE_CARRY')
  await expect(row('SUB')).toContainText('LOAD_ACC, ACC_SRC=ADDER, SUBTRACT, SAVE_CARRY')
  await expect(row('HALT')).toContainText('HALT')
  // The row being read is the opcode of the instruction at the PC: the program starts with LDI.
  await expect(listing.locator('.row-listing.current .text')).toHaveText('LDI')
  await page.getByRole('button', { name: 'Clock step' }).click()
  await page.getByRole('button', { name: 'Clock step' }).click()
  await expect(listing.locator('.row-listing.current .text')).toHaveText('STA')
})

test('control ROM: a row is edited by its signals, and the hex words follow', async ({ page }) => {
  await page.goto('/beginner', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await pickByLabel(page, 'Control ROM')
  const listing = page.getByLabel('Listing')
  await page.getByLabel('Contents are').selectOption('none') // the hex words, to see what the editor writes
  const hex = page.getByLabel('Contents (hex words)')
  await expect(hex).toHaveValue(/^01 05 08 20 83 93 00 40/)

  // Open the SUB row: its signals are boxes to tick and lists to choose from.
  await listing.getByRole('row', { name: 'Row SUB' }).click()
  const editor = page.getByRole('group', { name: 'Signals of row SUB' })
  await expect(editor.getByRole('checkbox', { name: 'SUBTRACT' })).toBeChecked()
  await expect(editor.getByRole('combobox', { name: 'ACC_SRC' })).toHaveValue('1')
  await editor.getByRole('checkbox', { name: 'SUBTRACT' }).uncheck()
  await expect(listing.getByRole('row', { name: 'Row SUB' })).toContainText('LOAD_ACC, ACC_SRC=ADDER, SAVE_CARRY')
  await expect(hex).toHaveValue(/^01 05 08 20 83 83 00 40/)
  await editor.getByRole('combobox', { name: 'ACC_SRC' }).selectOption({ label: 'RAM (2)' })
  await expect(hex).toHaveValue(/^01 05 08 20 83 85 00 40/)

  // Only one row is open at a time; Clear row empties it; one undo step per change.
  await listing.getByRole('row', { name: 'Row JMP' }).click()
  await expect(page.getByRole('group', { name: /^Signals of row/ })).toHaveCount(1)
  await page.getByRole('group', { name: 'Signals of row JMP' }).getByRole('button', { name: 'Clear row' }).click()
  await expect(hex).toHaveValue(/^01 05 08 00 83 85/)
  await expect(listing.getByRole('row', { name: 'Row JMP' })).toContainText('nothing')
  // Done closes the editor, and so does Escape inside it (the part stays selected).
  await page.getByRole('group', { name: 'Signals of row JMP' }).getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('group', { name: /^Signals of row/ })).toHaveCount(0)
  await listing.getByRole('row', { name: 'Row ADD' }).press('Enter')
  await page.getByRole('group', { name: 'Signals of row ADD' }).getByRole('checkbox', { name: 'SAVE_CARRY' }).focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: /^Signals of row/ })).toHaveCount(0)
  await expect(page.locator('.inspector h2')).toHaveText('ROM')
})

test('control ROM: written as text, one row per line, with errors shown and nothing applied until the text is right', async ({ page }) => {
  await page.goto('/beginner', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await pickByLabel(page, 'Control ROM')
  await expect(page.getByLabel('Contents are')).toHaveValue('signals')
  const text = page.getByLabel('Control signals', { exact: true })
  await expect(text).toHaveValue(/ADD: {2}LOAD_ACC ACC_SRC=ADDER SAVE_CARRY/)
  await expect(text).toHaveValue(/^LDI: {2}LOAD_ACC ACC_SRC=NUM\nLDA:/)

  // A mistake is reported with its line, and the ROM keeps its words.
  await text.fill('LDI: LOAD_ACC ACC_SRC=NUM\nADD: LOAD_ACC ACC_SRC=NOWHERE')
  await expect(page.getByLabel('Errors')).toContainText('Line 2')
  await expect(page.getByLabel('Errors')).toContainText('not a value of ACC_SRC')
  await page.getByLabel('Label').click()

  // Fixed, it applies when you click away: rows that are not listed become 0.
  await text.fill('LDI: LOAD_ACC ACC_SRC=NUM\nADD: LOAD_ACC ACC_SRC=RAM SAVE_CARRY')
  await page.getByLabel('Label').click()
  await expect(page.getByRole('row', { name: 'Row ADD' })).toContainText('LOAD_ACC, ACC_SRC=RAM, SAVE_CARRY')
  await expect(page.getByRole('row', { name: 'Row SUB' })).toContainText('nothing')
  await page.getByLabel('Contents are').selectOption('none')
  await expect(page.getByLabel('Contents (hex words)')).toHaveValue(/^01 00 00 00 85 00 00 00/)
})

test('a plain ROM can be made a ready-made control ROM: its size, words, names, and pins named after the signals', async ({ page }) => {
  await freshEmpty(page)
  const rom = await place(page, 'rom', 300, 200)
  await page.getByText('Name the bits (for a control ROM)').click()
  await page.getByLabel('Ready-made control ROM').selectOption({ label: 'Beginner computer control ROM (8 bits, 16 rows)' })
  await expect(page.getByLabel('Address bits')).toHaveValue('4')
  await expect(page.getByLabel('Data bits')).toHaveValue('8')
  await expect(page.getByLabel('Contents are')).toHaveValue('signals')
  await expect(page.getByLabel('Listing').getByRole('row').nth(4)).toContainText('ADD')
  await expect(page.getByLabel('Listing').getByRole('row').nth(4)).toContainText('LOAD_ACC, ACC_SRC=ADDER, SAVE_CARRY')
  // The output pins on the canvas carry the names of the signals.
  const pins = page.locator(`.comp[data-id="${rom}"]`)
  await expect(pins).toContainText('WRITE_RAM')
  await expect(pins).toContainText('SAVE_CARRY')
  // Names that do not parse are reported, with the line.
  await page.getByLabel('Signals', { exact: true }).fill('LOAD\n1BAD\n')
  await page.getByLabel('Row names').click()
  await expect(page.getByLabel('Signals: errors')).toContainText('Line 2')
})

test('control ROM: a list in the row editor shows what was chosen, change after change', async ({ page }) => {
  await page.goto('/beginner', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Control ROM') // the simulation is running
  await page.getByLabel('Contents are').selectOption('none')
  const hex = page.getByLabel('Contents (hex words)')
  await page.getByRole('row', { name: 'Row ADD' }).click()
  const src = page.getByRole('group', { name: 'Signals of row ADD' }).getByRole('combobox', { name: 'ACC_SRC' })
  // ADD is 83 (LOAD_ACC, ACC_SRC=ADDER, SAVE_CARRY); each choice sets bits 1–2, and the list shows exactly it.
  for (const [value, word] of [['2', '85'], ['0', '81'], ['2', '85'], ['1', '83'], ['3', '87'], ['2', '85']]) {
    await src.selectOption(value)
    await expect(src).toHaveValue(value)
    await expect(hex).toHaveValue(new RegExp(`^01 05 08 20 ${word} 93 `))
  }
})

test('calculator example: changing the operation changes the ALU', async ({ page }) => {
  await page.goto('/calculator', { waitUntil: 'networkidle' })
  const aluTitle = page.locator('.comp .title', { hasText: /^ADD$/ })
  await expect(aluTitle).toHaveCount(1)
  // Click the "Operation" input once: it counts up from 0 (ADD) to 1 (SUB).
  const op = page.locator('.comp', { has: page.locator('.comp-label', { hasText: 'Operation 0–7' }) })
  const box = (await op.locator('> g').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.comp .title', { hasText: /^SUB$/ })).toHaveCount(1)
})

test('8-bit computer example: runs its program to the HALT instruction', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  const halted = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Halted$/ }) }).locator('.led-fill.on')
  await expect(halted).toHaveCount(0)
  // 122 clock cycles at 4 Hz × 4 speed.
  await expect(halted).toHaveCount(1, { timeout: 25000 })
  // The waveform panel showed up with the example's probes.
  await expect(page.getByTestId('waves')).toBeVisible()
})

test('program editor: errors show as you type, the program applies on blur, and the listing follows the PC', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'Program')
  const source = page.getByLabel('Program source')
  await expect(source).toHaveValue(/loop:\s+LDA 1/)
  await expect(page.locator('.inspector')).toContainText('15 of 256 instructions.')

  // The listing marks the instruction being read, and follows the PC.
  const step = async () => page.getByRole('button', { name: 'Clock step' }).click() // one clock edge: the PC moves on every other click
  await expect(page.locator('.row-listing.current .text')).toHaveText('LDI 0')
  await step()
  await expect(page.locator('.row-listing.current .text')).toHaveText('STA 0')
  await step()
  await step()
  await expect(page.locator('.row-listing.current .text')).toHaveText('OUT NUMBER')
  await step()
  await step()
  await expect(page.locator('.row-listing.current .text')).toHaveText('LDI 1')

  // Mistakes are reported by line while typing, and nothing is applied.
  await source.fill('LDI 5\nFOO 1\nSTA 99')
  await expect(page.getByLabel('Errors')).toContainText('Line 2: Unknown instruction “FOO”.')
  await expect(page.getByLabel('Errors')).toContainText('Line 3: STA: the address 99 is out of range')
  await expect(page.getByLabel('Errors')).toContainText('keeps running the last program')
  await page.locator('.inspector h2').click() // click away: the text is kept, but the circuit still runs the old program
  await expect(page.locator('.row-listing .text').first()).toHaveText('LDI 0')
  await expect(page.locator('.row-listing .text').nth(14)).toHaveText('HALT')

  // A good program is applied when you click away.
  await source.fill('LDI 7\nSTA 1\nHALT')
  await expect(page.locator('.inspector')).toContainText('3 of 256 instructions. Applies when you click outside')
  await page.locator('.inspector h2').click()
  await expect(page.locator('.row-listing .text').nth(0)).toHaveText('LDI 7')
  await expect(page.locator('.row-listing .word').nth(0)).toHaveText('0700')
  await expect(page.locator('.row-listing .text').nth(2)).toHaveText('HALT')
  await expect(page.locator('.inspector')).toContainText('3 of 256 instructions.')
})

test('program files: save the source, open another program', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await pickByLabel(page, 'Program')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save…' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('program.asm')
  const saved = readFileSync((await file.path())!, 'utf8')
  expect(saved).toContain('Fibonacci')
  expect(saved).toContain('loop:')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open…' }).click()
  await (await chooser).setFiles({ name: 'seven.asm', mimeType: 'text/plain', buffer: Buffer.from('LDI 7\nSTA 15\nHALT\n') })
  await expect(page.locator('.row-listing .text').nth(1)).toHaveText('STA 15')
  await expect(page.getByLabel('Program source')).toHaveValue('LDI 7\nSTA 15\nHALT\n')
  await expect(page.locator('.toast')).toContainText('Opened seven.asm.')
})

test('RAM editor: change words while paused, Escape cancels, Reset clears', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Data RAM')
  const word = (i: number) => page.locator('.ram-word').nth(i)
  // Running: the words are shown but locked.
  await expect(word(3).locator('.val')).toBeDisabled()
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(word(3).locator('.val')).toBeEnabled()

  await word(3).locator('.val').click()
  await page.keyboard.type('a5')
  await page.keyboard.press('Enter')
  await expect(word(3).locator('.val')).toHaveText('A5')
  // Escape leaves the word alone.
  await word(3).locator('.val').click()
  await page.keyboard.type('ff')
  await page.keyboard.press('Escape')
  await expect(word(3).locator('.val')).toHaveText('A5')
  // Not hex: ignored.
  await word(4).locator('.val').click()
  await page.keyboard.type('zz')
  await page.keyboard.press('Enter')
  await expect(word(4).locator('.val')).toHaveText('00')

  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(word(3).locator('.val')).toHaveText('00')
  await word(3).locator('.val').click()
  await page.keyboard.type('7')
  await page.keyboard.press('Enter')
  await expect(word(3).locator('.val')).toHaveText('07')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(word(3).locator('.val')).toHaveText('00')
})

test('RAM editor: words written by the running program show up in the grid', async ({ page }) => {
  await page.goto('/computer', { waitUntil: 'networkidle' })
  await page.selectOption('select[aria-label="Simulation speed"]', '4')
  await pickByLabel(page, 'Data RAM')
  // Fibonacci keeps the numbers in the first three words; the last sum written is 121, the carry's wrapped result.
  await expect(page.locator('.ram-word').nth(2).locator('.val')).toHaveText('79', { timeout: 25000 })
  await expect(page.locator('.ram-word').nth(0).locator('.val')).toHaveText('E9')
})

test('a ROM can switch from hex words to a program, keeping what it held', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'rom', 300, 200)
  await page.getByLabel('Data bits').selectOption('8')
  await page.locator('.field', { hasText: 'Contents (hex words)' }).locator('textarea').fill('00 30 70')
  await page.locator('.inspector h2').click()
  // Choosing a program turns the ROM into 16 bits and starts from the words it holds (here: nothing sensible at 16 bits).
  await page.getByLabel('Contents are').selectOption('skasm')
  await expect(page.getByLabel('Data bits')).toHaveValue('16')
  await expect(page.getByLabel('Program source')).toBeVisible()
  await page.getByLabel('Program source').fill('LDI 1\nHALT')
  await page.locator('.inspector h2').click()
  await expect(page.locator('.row-listing .text').nth(0)).toHaveText('LDI 1')
  await expect(page.locator('.row-listing .text').nth(1)).toHaveText('HALT')
  // And back to hex words: the words stay.
  await page.getByLabel('Contents are').selectOption('none')
  await expect(page.locator('.field', { hasText: 'Contents (hex words)' }).locator('textarea')).toHaveValue(/0100 0070/)
})

test('computers: the calculator takes its sums from the keypad and shows them on the display', async ({ page }) => {
  await page.goto('/computer-calc', { waitUntil: 'networkidle' })
  // The keys of the calculator keypad send 0-9 for the digits, 10-13 for + - × ÷, 14 for = and 15 for C.
  const key = async (code: number) => {
    const k = page.locator(`.comp[data-id^="keypad"] [data-key="${code}"]`).first()
    const b = (await k.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.waitForTimeout(700) // the program reads the key and shows it
  }
  for (const k of [2, 3, 10, 1, 0, 14]) await key(k) // 23 + 10 =
  await expect(page.locator('.comp[data-id^="console"] .console-text').first()).toContainText('23+10=33', { timeout: 15000 })
  const console_ = page.locator('.comp[data-id^="console"]')
  const box = (await console_.locator('> g').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6)
  await expect(page.getByLabel('Console text')).toHaveText(/^23\+10=33\s*$/)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByLabel('Console text')).toHaveText(/^\s*$/)
})

test('computers: the LCD example draws a ball, and the sound example sounds', async ({ page }) => {
  await page.goto('/computer-lcd', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp[data-id^="framebuffer"] rect[fill="#facc15"]').first()).toBeVisible({ timeout: 15000 })
  // The devices of an example are the ones it uses: no keypad and no speaker here.
  await expect(page.locator('.comp[data-id^="keypad"]')).toHaveCount(0)
  await expect(page.locator('.comp[data-id^="speaker"]')).toHaveCount(0)

  await page.goto('/computer-sound', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp[data-id^="speaker"] .speaker-wave.on')).toHaveCount(1, { timeout: 15000 })
  await expect(page.locator('.comp[data-id^="keypad"]')).toHaveCount(0)
  await expect(page.locator('.comp[data-id^="framebuffer"]')).toHaveCount(0)
})

test('devices: a lookup table is edited cell by cell, and a speaker is muted with a click', async ({ page }) => {
  await freshEmpty(page)
  const lut = await place(page, 'lut', 300, 200)
  await expect(page.getByRole('table', { name: 'Lookup table' }).locator('tbody tr')).toHaveCount(8)
  // Majority of three to begin with: rows 3, 5, 6, 7 are 1.
  const values = () => page.getByRole('table', { name: 'Lookup table' }).locator('td.out').allTextContents()
  expect(await values()).toEqual(['0', '0', '0', '1', '0', '1', '1', '1'])
  await page.getByRole('button', { name: 'Row 0, Y' }).click()
  await page.getByRole('button', { name: 'Row 7, Y' }).click()
  expect(await values()).toEqual(['1', '0', '0', '1', '0', '1', '1', '0'])
  await page.getByRole('button', { name: 'All 0' }).click()
  expect(await values()).toEqual(Array(8).fill('0'))
  await page.getByLabel('Inputs').selectOption('4')
  await expect(page.getByRole('table', { name: 'Lookup table' }).locator('tbody tr')).toHaveCount(16)
  expect(lut).toBeTruthy()

  const speaker = await place(page, 'speaker', 600, 300)
  await expect(page.locator(`.comp[data-id="${speaker}"] .speaker-muted`)).toHaveCount(0)
  await clickComp(page, speaker)
  await expect(page.locator(`.comp[data-id="${speaker}"] .speaker-muted`)).toHaveCount(1)
  await clickComp(page, speaker)
  await expect(page.locator(`.comp[data-id="${speaker}"] .speaker-muted`)).toHaveCount(0)
})

test('devices: RAM and ROM can have 8 address bits', async ({ page }) => {
  await freshEmpty(page)
  const ram = await place(page, 'ram', 300, 200)
  await page.getByLabel('Address bits').selectOption('8')
  // A part placed now has bus ports: the 8 address bits are one pin, A, until bus ports are switched off.
  await expect(page.locator(`circle.pin[data-comp="${ram}"][data-pin="A"]`)).toHaveCount(1)
  await page.getByLabel('Bus ports').uncheck()
  await expect(page.locator(`circle.pin[data-comp="${ram}"][data-pin="A7"]`)).toHaveCount(1)
  await expect(page.locator(`.comp[data-id="${ram}"]`)).toContainText('RAM 256×4')
  await expect(page.locator('.ram-word')).toHaveCount(256)
})

test('devices: a RAM of 2048 words and a ROM of 4096 are read a page of 256 at a time', async ({ page }) => {
  await freshEmpty(page)
  const ram = await place(page, 'ram', 300, 200)
  await page.getByLabel('Address bits').selectOption('11')
  await expect(page.locator(`.comp[data-id="${ram}"]`)).toContainText('RAM 2048×4')
  await expect(page.locator('.ram-word')).toHaveCount(256)
  await expect(page.getByLabel('Page of the memory').locator('option')).toHaveCount(9) // "the one being read" and 8 pages
  await page.getByLabel('Page of the memory').selectOption('3')
  await expect(page.locator('.ram-word').first().locator('.addr')).toHaveText('300')
  await expect(page.locator('.ram-word').last().locator('.addr')).toHaveText('3FF')

  const rom = await place(page, 'rom', 300, 500)
  await page.getByLabel('Address bits').selectOption('12')
  await expect(page.locator(`.comp[data-id="${rom}"]`)).toContainText('ROM 4096×4')
  await expect(page.getByLabel('Page of the memory').locator('option')).toHaveCount(17)
  await page.getByLabel('Page of the memory').selectOption('15')
  await expect(page.getByRole('table', { name: 'Listing' }).locator('.row-listing').first().locator('.addr')).toHaveText('F00')
  await expect(page.getByRole('table', { name: 'Listing' }).locator('.row-listing')).toHaveCount(256)
})

test('devices: a RAM of 16384 words has 64 pages, listed in four groups of 4 KB', async ({ page }) => {
  await freshEmpty(page)
  const ram = await place(page, 'ram', 300, 200)
  await page.getByLabel('Address bits').selectOption('14')
  await expect(page.locator(`.comp[data-id="${ram}"]`)).toContainText('RAM 16384×4')
  const pages = page.getByLabel('Page of the memory')
  await expect(pages.locator('option')).toHaveCount(65) // "the one being read" and 64 pages
  await expect(pages.locator('optgroup')).toHaveCount(4)
  await pages.selectOption('63')
  await expect(page.locator('.ram-word').first().locator('.addr')).toHaveText('3F00')
  await expect(page.locator('.ram-word').last().locator('.addr')).toHaveText('3FFF')
  // The ROM goes up to 14 bits too.
  await place(page, 'rom', 300, 500)
  await page.getByLabel('Address bits').selectOption('14')
  await expect(pages.locator('option')).toHaveCount(65)
})

test('the SKASM reference opens from the toolbar and from a program ROM, and has the instructions, ports and examples', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'SKASM')
  const dialog = page.getByRole('dialog', { name: 'SKASM language reference' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('the assembly language of every Sklopko computer')).toBeVisible()

  await dialog.getByRole('tab', { name: 'Instruction format' }).click()
  await expect(dialog.getByTestId('fmt-hex')).toHaveText('0300') // LDI 3
  await expect(dialog.getByTestId('fmt-word')).toContainText('D8–D15 constant = 3')
  const instruction = dialog.getByLabel('An instruction to break down')
  await instruction.fill('OUT CHAR')
  await expect(dialog.getByTestId('fmt-hex')).toHaveText('00F1')
  await expect(dialog.getByTestId('fmt-word')).toContainText('sub-opcode')
  await instruction.fill('JMP 0xA5')
  await expect(dialog.getByTestId('fmt-word')).toContainText('jump target, high half')
  await instruction.fill('FOO 1')
  await expect(dialog).toContainText('Unknown instruction')
  await expect(dialog.getByTestId('fmt-word')).toHaveCount(0)

  await dialog.getByRole('tab', { name: 'Instructions' }).click()
  await expect(dialog.locator('#op-LDI')).toBeVisible()
  await expect(dialog.locator('#op-JNZ')).toContainText('jump to t if the zero flag is 0')
  await expect(dialog.locator('#op-OUT')).toContainText('send ACC to port p')

  await dialog.getByRole('tab', { name: 'Ports' }).click()
  await expect(dialog.getByRole('cell', { name: 'PIXEL_ON', exact: true })).toBeVisible()

  await dialog.getByRole('tab', { name: 'Examples' }).click()
  await expect(dialog.locator('#example-add pre')).toContainText('ADD 0')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // From a ROM that holds a program.
  await place(page, 'rom', 300, 200)
  await page.getByLabel('Contents are').selectOption('skasm')
  await page.getByRole('button', { name: 'SKASM reference…' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)

  // And from the help panel, when nothing is selected.
  await page.getByTestId('canvas').click({ position: { x: 60, y: 420 } })
  await page.getByRole('button', { name: 'Open the SKASM reference' }).click()
  await expect(dialog).toBeVisible()
})

test('a program with .byte lines gives the ROM a table, which the inspector shows', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'rom', 300, 200)
  await page.getByLabel('Contents are').selectOption('skasm')
  await page.getByLabel('Program source').fill('LDXI 1\nLDT\nHALT\n.byte 1, 2, 255')
  await page.getByLabel('Program source').blur()
  await expect(page.getByLabel('Table contents', { exact: true })).toContainText('00: 01 02 FF')
})

test('the beginner computer runs its program: the listing follows the PC, and it adds 3 + 4 and halts', async ({ page }) => {
  await page.goto('/beginner', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  const halted = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Halted$/ }) }).locator('.led-fill.on')
  await expect(halted).toHaveCount(0)

  await pickByLabel(page, 'Program ROM')
  await expect(page.getByLabel('Program source')).toHaveValue(/ADD 0/)
  await expect(page.locator('.row-listing .text').nth(3)).toHaveText('ADD 0')
  await expect(page.locator('.row-listing.current .text')).toHaveText('LDI 3') // the PC is at 0

  // Two clock steps are one cycle (rising edge, falling edge). Three instructions in, the PC is at the ADD.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Clock step' }).click()
  await expect(page.locator('.row-listing.current .text')).toHaveText('ADD 0')

  // Run on to the end: it halts on HALT.
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Clock step' }).click()
  await expect(page.locator('.row-listing.current .text')).toHaveText('HALT')
  await expect(halted).toHaveCount(1)
})

test('the 6502 board: the CPU shows its registers, steps one instruction at a time, and the LEDs follow the program', async ({ page }) => {
  await page.goto('/6502', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'CPU')
  const regs = page.getByRole('group', { name: 'CPU registers' })
  await expect(regs).toBeVisible()
  await expect(regs).toContainText('PC')
  const doing = page.getByTestId('cpu-doing')
  await expect(doing).toContainText('Reset sequence')

  // The reset sequence takes 7 cycles; the first instruction (LDA #$01) is fetched from $F000.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Step one instruction' }).click()
  // Three steps: the reset sequence, LDA #$01, STA $4000. The accumulator holds 1 and the PC is on the ASL at $F005.
  await expect(regs.locator('.ram-word', { hasText: 'A' }).first().locator('.cpu-val')).toHaveText('01')
  await expect(regs.locator('.ram-word', { hasText: 'PC' }).locator('.cpu-val')).toHaveText('F005')
  await expect(doing).toContainText('Fetching the next instruction from $F005')
  await page.getByRole('button', { name: 'Step one cycle' }).click()
  await expect(doing).toContainText('ASL A')
})

test('the 6502 built from parts: it resets itself, and after seven cycles of reset and a few instructions the accumulator holds 3', async ({ page }) => {
  await page.goto('/6502-parts', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  const show = (label: string) => page.locator('.comp', { has: page.locator('.comp-label', { hasText: new RegExp(`^${label}$`) }) }).locator('text.bus-readout')
  await expect(show('A')).toHaveText('00')
  // Reset takes 7 cycles, then LDA #0, CLC and ADC #3 take 2 cycles each: 13 cycles, two clock edges each.
  for (let i = 0; i < 26; i++) await page.getByRole('button', { name: 'Clock step' }).click()
  await expect(show('A')).toHaveText('03')
  await expect(show('PCH')).toHaveText('F0')
  await expect(show('PCL')).toHaveText('05') // the next opcode, STA, is at $F005
})

test('the guide to the 6502 from parts: the blocks, an instruction cycle by cycle, and a block shown in the real circuit', async ({ page }) => {
  await page.goto('/6502-parts', { waitUntil: 'networkidle' })
  // The example starts running, and the dev server's React needs most of a slow machine's main thread to draw the circuit each frame:
  // the guide's window then waits to be drawn for ever. Pausing first makes the test about the guide, not about how fast the machine is.
  await page.getByRole('button', { name: /Pause/ }).click()
  await page.getByRole('button', { name: 'How this CPU works' }).click() // a button on the example itself, and also in the Tools menu
  const guide = page.getByRole('dialog', { name: 'The 6502 from parts' })
  await guide.getByRole('button', { name: 'Registers' }).click()
  await expect(guide.getByRole('heading', { name: 'Registers' })).toBeVisible()
  await expect(guide).toContainText('parts in this section') // from the circuit that is open: its parts and the notes above the section
  await expect(guide.locator('svg.snap.zoom')).toBeVisible()
  // The picture stays in view while the part names under the text are scrolled to, so a part you point at can be seen.
  await guide.locator('.arch-chip').last().scrollIntoViewIfNeeded()
  await expect(guide.locator('svg.snap.zoom')).toBeInViewport({ ratio: 0.9 })
  await guide.getByRole('tab', { name: 'One instruction' }).click()
  await expect(guide.getByText('Reads the opcode at PC into IR.')).toBeVisible()
  await guide.getByRole('tab', { name: 'The machine' }).click()
  await guide.getByRole('button', { name: 'ALU and flags' }).click()
  const view = () => page.locator('svg.canvas g[transform*="scale("]').first().getAttribute('transform')
  const before = await view()
  await guide.getByRole('button', { name: 'Show in the circuit' }).click()
  await expect(guide).toBeHidden()
  await expect.poll(view).not.toBe(before)
})

test('the guide button is only on the 6502 from parts', async ({ page }) => {
  await page.goto('/6502', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: 'How this CPU works' })).toHaveCount(0)
})

test('the 6502 from parts takes an interrupt: pressing NMI adds one to the count the LEDs show', async ({ page }) => {
  await page.goto('/6502-parts-irq', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Hide' }).click()
  const leds = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^LEDs$/ }) }).locator('rect.seg')
  const lit = async () => (await leds.evaluateAll((els) => els.map((e) => e.classList.contains('on')))).map(Number).join('')
  await expect.poll(lit, { timeout: 60000 }).toBe('00000000') // the program runs: nothing counted yet
  const button = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^NMI button/ }) }).locator('> g').first()
  const box = (await button.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(400) // a few clock cycles: NMI is seen going low
  await page.mouse.up()
  // The NMI count is the top four bits of the LEDs: one press is 1, bit 4.
  await expect.poll(lit, { timeout: 60000 }).toBe('00001000')
})

test('a 6502 example with a device: hello prints on the console', async ({ page }) => {
  await page.goto('/6502-hello', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Console \\$4001: prints what is written')
  // The program runs by itself and prints one character at a time.
  await expect(page.locator('.inspector')).toContainText('Hello from a 6502!', { timeout: 20000 })
})

test('the 6502 ROM holds a program in assembly: a listing of its bytes, errors by line, and the reference', async ({ page }) => {
  await page.goto('/6502', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'ROM \\$F000–\\$FFFF')
  await expect(page.getByLabel('Contents are')).toHaveValue('6502')
  const source = page.getByLabel('Program source')
  await expect(source).toHaveValue(/start:\s+LDA #\$01/)
  await expect(page.locator('.inspector')).toContainText('13 of 4096 bytes.')

  // The listing: address, bytes, instruction and source line, and the vector as data.
  const rows = page.locator('.row-listing.code6502')
  await expect(rows.first()).toContainText('F000')
  await expect(rows.first()).toContainText('A9 01')
  await expect(rows.first().locator('.text')).toHaveText('LDA #$01')
  await expect(rows.nth(1).locator('.text')).toHaveText('STA $4000')
  await expect(rows.nth(3).locator('.text')).toHaveText('BNE $F002')

  // A mistake is named with its line, and the ROM keeps its last good program.
  await source.fill('.org $F000\nstart: LDA #$01\nSTA #3\nJMP start')
  await expect(page.getByLabel('Errors')).toContainText("Line 3: STA can't be written with a constant")
  await source.fill('.org $F000\nstart: LDA #$05\nSTA $4000\nJMP start\n.org $FFFC\n.word start')
  await page.locator('.inspector h2').click() // click away: the program is applied
  await expect(rows.first().locator('.text')).toHaveText('LDA #$05')
  await expect(rows.first()).toContainText('A9 05')

  // The reference, from the ROM and from the Tools menu.
  await page.getByRole('button', { name: '6502 reference…' }).click()
  const dialog = page.getByRole('dialog', { name: '6502 assembly reference' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Instructions' }).click()
  await expect(dialog.locator('#op-LDA')).toContainText('A = memory')
  await expect(dialog.locator('#op-LDA')).toContainText('LDA (n),Y')
  await dialog.getByRole('tab', { name: 'Addressing modes' }).click()
  await expect(dialog.getByRole('cell', { name: '(n),Y', exact: true })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Opcode map' }).click()
  await expect(dialog.getByRole('cell', { name: 'BRK', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await chooseTool(page, '6502')
  await expect(dialog).toBeVisible()
})

test('a timer interrupt wakes the 65C02 from WAI: the console fills with stars, one for each tick', async ({ page }) => {
  await page.goto('/65c02-timer', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Console \\$4001: prints what is written')
  await expect(page.locator('.inspector')).toContainText('***', { timeout: 20000 })
})

test('the 65C02 example: its ROM holds a 65C02 program, and the reference opens on the 65C02', async ({ page }) => {
  await page.goto('/65c02', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Reset' }).click()
  await pickByLabel(page, 'ROM \\$F000–\\$FFFF')
  await expect(page.getByLabel('Contents are')).toHaveValue('65c02')
  await expect(page.getByLabel('Program source')).toHaveValue(/SMB0 bits/)
  await expect(page.locator('.row-listing.code6502').first().locator('.text')).toHaveText('LDX #$FF')
  // The new instructions are in the listing, and a typo in them is named.
  await expect(page.locator('.row-listing.code6502 .text', { hasText: 'STZ $00' })).toHaveCount(1)
  await page.getByLabel('Program source').fill('.org $F000\nSTZ #1')
  await expect(page.getByLabel('Errors')).toContainText("STZ can't be written with a constant")

  await page.getByRole('button', { name: '65C02 reference…' }).click()
  const dialog = page.getByRole('dialog', { name: '6502 assembly reference' })
  await expect(dialog.getByRole('button', { name: 'WDC 65C02' })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('tab', { name: 'Instructions' }).click()
  await expect(dialog.locator('#op-BRA')).toContainText('branch always')
  await expect(dialog.locator('#op-STZ')).toContainText('STZ n')
  await dialog.getByRole('button', { name: 'MOS 6502' }).click()
  await expect(dialog.locator('#op-BRA')).toHaveCount(0)
})

test('gamepad: the arrow keys press its buttons, and the paddle moves', async ({ page }) => {
  await page.goto('/computer-pong', { waitUntil: 'networkidle' })
  const down = page.locator('g.key.down')
  await expect(down).toHaveCount(0)
  await page.keyboard.down('ArrowUp')
  await expect(down).toHaveCount(1)
  await page.keyboard.down('z')
  await expect(down).toHaveCount(2)
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up('z')
  await expect(down).toHaveCount(0)
})

test('a lookup table is filled from an expression, with the error shown when the expression does not fit', async ({ page }) => {
  await freshEmpty(page)
  await place(page, 'lut', 300, 200)
  const cell = (row: number, out = 'Y') => page.getByRole('button', { name: `Row ${row}, ${out}` })
  const expr = page.getByLabel('Expression for the table')
  await expr.fill('A·B')
  await page.getByRole('button', { name: 'Fill the table' }).click()
  // Three inputs, A the most significant: A and B are both 1 in rows 6 and 7.
  for (const row of [0, 1, 2, 3, 4, 5]) await expect(cell(row)).toHaveText('0')
  for (const row of [6, 7]) await expect(cell(row)).toHaveText('1')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await expr.fill('A·Q')
  await page.getByRole('button', { name: 'Fill the table' }).click()
  await expect(page.getByRole('alert')).toContainText('Q is not an input of this table, which has A, B, C.')
  await expect(cell(6)).toHaveText('1') // untouched
  await expr.fill('A ·')
  await page.getByRole('button', { name: 'Fill the table' }).click()
  await expect(page.getByRole('alert')).toContainText('line 1')

  // Two outputs: one line each.
  await page.getByLabel('Outputs').selectOption('2')
  await page.getByLabel('Expression for the table').fill('Y0 = A ⊕ B\nY1 = ¬C')
  await page.getByRole('button', { name: 'Fill the table' }).click()
  await expect(cell(0, 'Y0')).toHaveText('0')
  await expect(cell(2, 'Y0')).toHaveText('1')
  await expect(cell(0, 'Y1')).toHaveText('1')
  await expect(cell(1, 'Y1')).toHaveText('0')
  // One undo step (it also deselects the part).
  await page.keyboard.press('Control+z')
  await page.locator('.comp > g').first().click()
  await expect(cell(0, 'Y1')).toHaveText('0')
  await expect(cell(0, 'Y0')).toHaveText('0')
  await expect(cell(2, 'Y0')).toHaveText('0')
})

test('the terminal: click its screen and type, and the text waits in the keyboard buffer until a program switches the receiver on', async ({ page }) => {
  await freshEmpty(page)
  const term = await place(page, 'acia6551', 420, 300)
  const keyboard = page.locator(`textarea[data-terminal-input="${term}"]`)
  const waiting = (text: string) => expect(page.getByText(text, { exact: true })).toBeVisible()
  await waiting('Nothing is waiting on the keyboard.')
  await expect(page.getByLabel('Registers of the terminal chip')).toContainText('receiver off (typing waits)')

  // A click on the part gives it the keyboard; Delete and Backspace are typed, they do not delete the part.
  await clickComp(page, term)
  await expect(keyboard).toBeFocused()
  await page.keyboard.type('print 1')
  await waiting('7 characters waiting on the keyboard.')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  await waiting('10 characters waiting on the keyboard.')
  await expect(page.locator(`.comp[data-id="${term}"]`)).toHaveCount(1)

  // Control+C is the break: it throws away what was waiting and is the only thing left.
  await page.keyboard.press('Control+c')
  await waiting('1 character waiting on the keyboard.')

  // Pasting through the box in the inspector goes through the same buffer: Enter for a line break, capitals by default.
  await page.getByRole('button', { name: 'Type text…' }).click()
  await page.getByLabel('Text to type').fill('a\nb')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await waiting('4 characters waiting on the keyboard.')
  await page.getByRole('button', { name: 'Break', exact: true }).click()
  await waiting('1 character waiting on the keyboard.')

  // Tab leaves the terminal.
  await clickComp(page, term)
  await expect(keyboard).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(keyboard).not.toBeFocused()
})

for (const [path, what] of [
  ['/6502-echo', 'polling the status register'],
  ['/6502-echo-irq', 'by interrupt'],
] as const) {
  test(`the terminal board, ${what}: the program prints HELLO and sends every key back`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' })
    await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
    const screen = page.getByLabel('Screen text')
    await expect(screen).toContainText('HELLO', { timeout: 20000 })
    // Picking the part gave it the keyboard: type, and the 6502 sends it back (as capitals) with its Enter as a new line.
    await page.keyboard.type('hi there')
    await page.keyboard.press('Enter')
    await expect(screen).toHaveText(/HELLO\s+HI THERE\s*$/, { timeout: 20000 })
    await expect(page.getByLabel('Registers of the terminal chip')).toContainText('receiver on')
  })
}

test('the BASIC computer: it starts by itself, and a program typed on its terminal runs', async ({ page }) => {
  await page.goto('/6502-basic', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  const screen = page.getByLabel('Screen text')
  await expect(screen).toContainText('SKLOPKO BASIC', { timeout: 60000 })
  await expect(screen).toContainText('OK', { timeout: 60000 })
  await page.keyboard.type('10 print "hello"')
  await page.keyboard.press('Enter')
  await page.keyboard.type('run')
  await page.keyboard.press('Enter')
  await expect(screen).toHaveText(/HELLO\s+OK\s*$/, { timeout: 60000 })
})

test('the BASIC computer with the 6502 built from parts: it boots to OK and runs what is typed on its terminal', async ({ page }) => {
  await page.goto('/6502-parts-basic', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Hide' }).click() // the board is far to the right of the CPU, under the help panel
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  const screen = page.getByLabel('Screen text')
  await expect(screen).toContainText('SKLOPKO BASIC', { timeout: 90000 })
  await expect(screen).toContainText('OK', { timeout: 90000 })
  await page.keyboard.type('print 2+2')
  await page.keyboard.press('Enter')
  await expect(screen).toHaveText(/PRINT 2\+2\s+4\s+OK\s*$/, { timeout: 90000 })
})

test('the 6502 from parts runs on the Rust engine', async ({ page }) => {
  await page.goto('/6502-parts-basic', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Hide' }).click()
  await expect(page.getByTestId('engine')).toHaveText('fast engine (Rust)', { timeout: 30000 })
  const screen = page.getByLabel('Screen text')
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  await expect(screen).toContainText('OK', { timeout: 90000 })
})

test('the BASIC reference: statements, functions and the programs to type in, from the Tools menu', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'BASIC')
  const dialog = page.getByRole('dialog', { name: 'BASIC reference' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Microsoft BASIC')
  await expect(dialog).toContainText('Syntax error')
  await dialog.getByRole('tab', { name: 'Statements' }).click()
  await expect(dialog.locator('[id="basic-PRINT"]')).toContainText('print zone')
  await expect(dialog.locator('[id="basic-FOR"]')).toContainText('always runs once')
  await dialog.getByRole('tab', { name: 'Functions and operators' }).click()
  await expect(dialog.locator('[id="basic-SQR"]')).toContainText('1.41421356')
  await dialog.getByRole('tab', { name: 'Programs to type in' }).click()
  await expect(dialog.locator('[data-program]')).toHaveCount(5)
  await expect(dialog.getByRole('button', { name: 'Type it in' })).toHaveCount(0) // no terminal in this circuit
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('the BASIC computer: a program to type in is typed on the terminal and runs', async ({ page }) => {
  await page.goto('/6502-basic', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  const screen = page.getByLabel('Screen text')
  await expect(screen).toContainText('OK', { timeout: 60000 })
  await page.getByText('Programs to type in', { exact: true }).click()
  await page.locator('[data-program="table"]').getByRole('button', { name: 'Type it in' }).click()
  await expect(screen).toContainText(/\n {4}1 {3}2 {3}3 {3}4 {3}5 {3}6 {3}7 {3}8 {3}9\n/, { timeout: 60000 })
})

test('the BASIC computer: the board’s Reset button restarts it on a blank screen, and so does the toolbar’s', async ({ page }) => {
  await page.goto('/6502-basic', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  const screen = page.getByLabel('Screen text')
  await expect(screen).toContainText('OK', { timeout: 60000 })
  await page.keyboard.type('print 3+3')
  await page.keyboard.press('Enter')
  await expect(screen).toContainText('PRINT 3+3', { timeout: 60000 })
  await expect(screen).toHaveText(/ 6\s+OK\s*$/, { timeout: 60000 })
  // Hold the board's own Reset button: the screen empties, and BASIC starts again with nothing of the old text above its banner.
  const button = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Reset$/ }) }).locator('> g').first()
  const b = (await button.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(500)
  await page.mouse.up()
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  await expect(screen).toHaveText(/^\s*15615 BYTES FREE\s+SKLOPKO BASIC V1.1\s+COPYRIGHT 1978 MICROSOFT\s+OK\s*$/, { timeout: 60000 })
  // The toolbar's Reset switches the whole circuit off and on again: the same.
  await page.keyboard.type('print 4+4')
  await page.keyboard.press('Enter')
  await expect(screen).toHaveText(/ 8\s+OK\s*$/, { timeout: 60000 })
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(screen).toHaveText(/^\s*15615 BYTES FREE\s+SKLOPKO BASIC V1.1\s+COPYRIGHT 1978 MICROSOFT\s+OK\s*$/, { timeout: 60000 })
})

test('the SKASM reference has a Control signals tab: each signal of the ROMs, and what each instruction switches on', async ({ page }) => {
  await freshEmpty(page)
  await chooseTool(page, 'SKASM')
  const dialog = page.getByRole('dialog', { name: 'SKASM language reference' })
  await dialog.getByRole('tab', { name: 'Control signals' }).click()
  await expect(dialog).toContainText('Control ROM 1 of the SKASM computers (16 bits)')
  await expect(dialog.getByRole('row', { name: /^SRC D1–D3/ })).toContainText('TABLE the lookup ROM')
  await expect(dialog.getByRole('row', { name: /^CALL D0/ })).toContainText('return stack')
  // Generated from the ROMs' own words: LDI loads the accumulator from the constant, SBC subtracts with the carry.
  const by = dialog.getByTestId('signals-by-instruction')
  await expect(by.getByRole('row', { name: /^LDI/ })).toContainText('LOAD_ACC SRC=CONST')
  await expect(by.getByRole('row', { name: /^SBC/ })).toContainText('LOAD_ACC SRC=ALU SAVE_FLAGS SUBTRACT CARRY_IN')
  await expect(by.getByRole('row', { name: /^CALL/ })).toContainText('CALL')
  await expect(dialog).toContainText('The Beginner computer’s control ROM (8 bits, 16 rows)')
})

test('the VIA example: its registers show the program’s setup, and the timer interrupt counts on port B', async ({ page }) => {
  await page.goto('/6502-via', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'VIA \\(6522\\) \\$6000–\\$600F')
  const regs = page.getByLabel('Registers of the VIA')
  await expect(regs).toContainText('timer 1 free-running', { timeout: 20000 })
  await expect(regs).toContainText('PB7 follows timer 1')
  await expect(regs).toContainText('11111111 direction')
  // Once a second the timer interrupts the CPU, whose routine adds one to port B.
  await expect(regs.getByRole('row', { name: /^Port B/ })).toContainText(/\$0[1-9A-F] out/, { timeout: 20000 })
})

test('the LCD: placed on its own it is off and blank; its inspector says what state it is in', async ({ page }) => {
  await freshEmpty(page)
  const lcd = await place(page, 'hd44780', 420, 300)
  await clickComp(page, lcd)
  await expect(page.getByLabel('Text on the LCD')).toContainText('(display off)')
  const state = page.getByLabel('State of the LCD')
  await expect(state).toContainText('8-bit, 1 line')
  await expect(state).toContainText('off, cursor off, blink off')
  await expect(page.locator(`.comp[data-id="${lcd}"]`)).toContainText('LCD 16×2 (display off)')
  await page.getByText('Custom characters (CGRAM)').click()
  await expect(page.getByLabel('Custom character 7')).toBeVisible()
})

test('the LCD example: the 6502 sets the display up and writes Hello, world! through the VIA', async ({ page }) => {
  await page.goto('/6502-lcd', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'LCD 16×2 on port B')
  await expect(page.getByLabel('Text on the LCD')).toContainText('Hello, world!', { timeout: 30000 })
  const state = page.getByLabel('State of the LCD')
  await expect(state).toContainText('8-bit, 2 lines')
  await expect(state).toContainText('on, cursor on, blink off')
  await expect(state.getByRole('row', { name: /^Ignored/ })).toContainText('nothing') // nothing was written while it was busy
})

test('the BASIC computer with the LCD: a program to type in POKEs two lines onto the display', async ({ page }) => {
  test.setTimeout(180_000) // the program is typed in and run at BASIC speed: slow on a busy machine
  await page.goto('/6502-basic-lcd', { waitUntil: 'networkidle' })
  await pickByLabel(page, 'Terminal \\(6551\\) \\$5000–\\$5003')
  await expect(page.getByLabel('Screen text')).toContainText('OK', { timeout: 60000 })
  await page.getByText('Programs to type in', { exact: true }).click()
  await page.locator('[data-program="lcd"]').getByRole('button', { name: 'Type it in' }).click()
  await expect(page.getByLabel('Screen text')).toContainText(/RUN\s+OK/, { timeout: 120000 })
  await pickByLabel(page, 'LCD 16×2 on port B')
  const text = page.getByLabel('Text on the LCD')
  await expect(text).toContainText('HELLO FROM BASIC')
  await expect(text).toContainText('ON A 6502')
})

test('the video example: the 6502 draws a colour test card through the video chip', async ({ page }) => {
  await page.goto('/6502-video', { waitUntil: 'networkidle' })
  const canvas = page.getByTestId('canvas').locator('canvas.video-canvas')
  await expect(canvas).toBeVisible()
  const pixel = (x: number, y: number) =>
    canvas.evaluate((c: HTMLCanvasElement, [px, py]) => Array.from(c.getContext('2d')!.getImageData(px, py, 1, 1).data), [x, y])
  // the last column's bars are colour 15, white; the first column's are colour 0, black
  await expect.poll(() => pixel(159, 0), { timeout: 30000 }).toEqual([255, 255, 255, 255])
  expect(await pixel(0, 0)).toEqual([0, 0, 0, 255])
  // column 55 has colour 5 (0x7a2e1f)
  expect(await pixel(55, 40)).toEqual([0x7a, 0x2e, 0x1f, 255])
})
