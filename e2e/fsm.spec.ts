import { expect, test, type Page } from '@playwright/test'
import { fresh, freshEmpty, chooseTool, clickLabelled } from './helpers'

const fsmPanel = (page: Page) => page.getByRole('dialog', { name: 'State machines' })

async function openFsm(page: Page) {
  await chooseTool(page, 'State machines…')
  await expect(fsmPanel(page)).toBeVisible()
}

/** The centre of a state in the diagram, in page coordinates. */
async function stateCentre(page: Page, name: string) {
  const b = (await page.getByRole('button', { name: new RegExp(`^State ${name}( \\(reset state\\))?$`) }).locator('circle').boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }
}

test('state machines: build the 1011 detector in the diagram, check it, generate it and feed it bits', async ({ page }) => {
  await freshEmpty(page)
  await openFsm(page)
  const panel = fsmPanel(page)
  await panel.getByLabel('Start from').selectOption('blank')
  await expect(panel.getByTestId('fsm-nothing-selected')).toBeVisible()

  // Inputs, outputs, type: names are taken when you leave the box.
  await panel.getByLabel('Input 1 name').fill('X')
  await panel.getByLabel('Input 1 name').press('Enter')
  await panel.getByLabel('Output 1 name').fill('Z')
  await panel.getByLabel('Output 1 name').press('Enter')
  await panel.getByRole('radio', { name: /Mealy/ }).click()
  await panel.getByLabel('Machine name').fill('Detect 1011')

  // States: double-click empty space; the new state is selected, with its name box focused. The blank machine has S0 already.
  await panel.getByRole('button', { name: 'State S0' }).click()
  await panel.getByLabel('State name').fill('Start')
  const svg = (await panel.getByTestId('fsm-diagram').boundingBox())!
  const at = (fx: number, fy: number) => ({ x: svg.x + svg.width * fx, y: svg.y + svg.height * fy })
  const spots: [string, number, number][] = [['One', 0.5, 0.2], ['OneZero', 0.8, 0.5], ['OneZeroOne', 0.5, 0.8]]
  for (const [name, fx, fy] of spots) {
    const p = at(fx, fy)
    await page.mouse.dblclick(p.x, p.y)
    await expect(panel.getByLabel('State name')).toBeFocused()
    await panel.getByLabel('State name').fill(name)
  }
  await expect(panel.getByRole('button', { name: 'State OneZeroOne' })).toBeVisible()

  // Transitions: the + Transition tool, source then target; the guard box is focused for typing.
  const join = async (from: string, to: string, guard: string, outputs: string[] = []) => {
    await panel.getByRole('button', { name: '+ Transition' }).click()
    await panel.getByRole('button', { name: new RegExp(`^State ${from}( \\(reset state\\))?$`) }).click()
    await panel.getByRole('button', { name: new RegExp(`^State ${to}( \\(reset state\\))?$`) }).click()
    await panel.getByLabel('Guard').fill(guard)
    for (const o of outputs) await panel.getByRole('checkbox', { name: o }).check()
  }
  await join('Start', 'One', 'X')
  await join('Start', 'Start', '!X')
  await join('One', 'One', 'X')
  await join('One', 'OneZero', '!X')
  await join('OneZero', 'OneZeroOne', 'X')
  await join('OneZero', 'Start', '!X')
  await join('OneZeroOne', 'One', 'X', ['Z'])
  await join('OneZeroOne', 'OneZero', '!X')
  await expect(panel.locator('.fsm-arrow')).toHaveCount(8)
  await expect(panel.getByText('No problems found.')).toBeVisible()
  await expect(panel.getByTestId('fsm-counts')).toContainText('flip-flops')

  await panel.getByRole('button', { name: 'Generate circuit' }).click()
  await expect(fsmPanel(page)).toHaveCount(0)
  // Reset is held on at first: turn it off, pause the free-running clock and step by hand.
  await page.getByRole('button', { name: /Pause/ }).click()
  await clickLabelled(page, 'Reset')
  const led = page.locator('.comp', { has: page.locator('.comp-label', { hasText: /^Z$/ }) }).locator('.led-fill.on')
  const clockStep = async () => {
    await page.getByRole('button', { name: 'Clock step' }).click()
    await page.getByRole('button', { name: 'Clock step' }).click()
  }
  // A change to a switch spreads through the gates one gate delay at a time while paused: give it a few.
  const x = async (want: 0 | 1, now: { v: number }) => {
    if (now.v !== want) await clickLabelled(page, 'X')
    now.v = want
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Step', exact: true }).click()
  }
  const now = { v: 0 }
  await expect(led).toHaveCount(0)
  for (const bit of [1, 0, 1]) {
    await x(bit as 0 | 1, now)
    await clockStep()
  }
  await expect(led).toHaveCount(1) // the machine has seen 1 0 1 and X is 1: that is 1011
  await x(0, now)
  await expect(led).toHaveCount(0)
})

test('state machines: drag moves a state; dragging from the rim joins two; Delete removes; undo brings it back', async ({ page }) => {
  await fresh(page)
  await openFsm(page)
  const panel = fsmPanel(page)
  await panel.getByLabel('Start from').selectOption({ label: 'Traffic light' })
  await expect(panel.locator('.fsm-arrow')).toHaveCount(3)

  // Move Green to the right.
  const before = await stateCentre(page, 'Green')
  await page.mouse.move(before.x, before.y)
  await page.mouse.down()
  await page.mouse.move(before.x + 90, before.y + 20, { steps: 6 })
  await page.mouse.up()
  const after = await stateCentre(page, 'Green')
  expect(after.x).toBeGreaterThan(before.x + 60)

  // From Red's rim to Yellow: a new transition, selected, with its guard box focused.
  const red = await stateCentre(page, 'Red')
  const yellow = await stateCentre(page, 'Yellow')
  await page.mouse.move(red.x + red.r - 3, red.y)
  await page.mouse.down()
  await page.mouse.move(yellow.x, yellow.y, { steps: 8 })
  await page.mouse.up()
  await expect(panel.locator('.fsm-arrow')).toHaveCount(4)
  await expect(panel.getByRole('region', { name: 'Transition' })).toBeVisible()
  await expect(panel.getByLabel('From state')).toHaveValue('Red')
  await expect(panel.getByLabel('To state')).toHaveValue('Yellow')

  // Keyboard: a state can be moved with the arrow keys and deleted with Delete (its transitions go too).
  await panel.getByRole('button', { name: 'State Yellow' }).focus()
  await page.keyboard.press('ArrowRight')
  const nudged = await stateCentre(page, 'Yellow')
  expect(nudged.x).toBeGreaterThan(yellow.x + 3)
  await page.keyboard.press('Delete')
  await expect(panel.getByRole('button', { name: 'State Yellow' })).toHaveCount(0)
  await expect(panel.locator('.fsm-arrow')).toHaveCount(1) // only Red → Green is left
  await panel.getByRole('button', { name: 'Undo' }).click()
  await expect(panel.getByRole('button', { name: 'State Yellow' })).toBeVisible()
  await expect(panel.locator('.fsm-arrow')).toHaveCount(4)
})

test('state machines: the checks name what is wrong, and clicking one selects it', async ({ page }) => {
  await fresh(page)
  await openFsm(page)
  const panel = fsmPanel(page)
  await panel.getByRole('tab', { name: 'Table' }).click()
  await panel.getByLabel('Condition of the transition Start to One').fill('X &')
  const checks = panel.getByRole('complementary', { name: 'State machine settings' }).getByRole('list', { name: 'Problems' })
  await expect(checks).toContainText('The guard of “Start” → “One” does not make sense')
  await expect(panel.getByRole('button', { name: 'Generate circuit' })).toBeDisabled()
  await panel.getByLabel('Condition of the transition Start to One').fill('X')
  await expect(panel.getByText('No problems found.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Generate circuit' })).toBeEnabled()

  // An overlap is an error; its message selects the state in the diagram.
  await panel.getByLabel('Condition of the transition Start to Start').fill('X | !X')
  await expect(checks).toContainText('Two transitions of state “Start” can both fire')
  await checks.getByRole('button').first().click()
  await panel.getByRole('tab', { name: 'Diagram' }).click()
  await expect(panel.getByRole('region', { name: 'State Start' })).toBeVisible()
})

test('state machines: the machine is kept, and can be saved to a file and opened again', async ({ page }) => {
  await fresh(page)
  await openFsm(page)
  let panel = fsmPanel(page)
  await panel.getByLabel('Machine name').fill('My detector')
  await panel.getByLabel('Encoding').selectOption('gray')
  await page.waitForTimeout(700) // the autosave delay
  await page.reload({ waitUntil: 'networkidle' })
  await openFsm(page)
  panel = fsmPanel(page)
  await expect(panel.getByLabel('Machine name')).toHaveValue('My detector')
  await expect(panel.getByLabel('Encoding')).toHaveValue('gray')

  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Save file' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('My-detector.fsm.json')
  const path = await file.path()

  await panel.getByLabel('Start from').selectOption({ label: 'Vending machine' })
  await expect(panel.getByLabel('Machine name')).toHaveValue('Vending machine')
  const chooser = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: 'Open file…' }).click()
  await (await chooser).setFiles(path)
  await expect(panel.getByLabel('Machine name')).toHaveValue('My detector')
  await expect(panel.getByRole('button', { name: 'State OneZeroOne' })).toBeVisible()

  // Something that is not a machine is refused with a reason, and nothing changes.
  const bad = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: 'Open file…' }).click()
  await (await bad).setFiles({ name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await expect(panel.getByText('This is not a state machine file')).toBeVisible()
  await expect(panel.getByLabel('Machine name')).toHaveValue('My detector')
})

test('state machines: the circuit examples open and run', async ({ page }) => {
  await page.goto('/fsm-traffic', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp .comp-label', { hasText: /^Red$/ })).toBeVisible()
  await expect(page.locator('.comp .comp-label', { hasText: /^Reset$/ })).toBeVisible()
  await page.goto('/fsm-detector', { waitUntil: 'networkidle' })
  await expect(page.locator('.comp .comp-label', { hasText: /^X$/ })).toBeVisible()
})
