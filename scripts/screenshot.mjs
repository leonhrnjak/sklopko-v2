// Takes screenshots of the running app for a pull request description.
//   node scripts/screenshot.mjs <page> <out.png> [<page> <out.png> ...] [--size 1400x800] [--wait 1500] [--base http://localhost:5199]
// <page> is a path like /ic-adder (an example's short link) or / . Start the app first (`npx vite --port 5199`) and, if Playwright
// wants a browser it does not have, point it at one: PW_CHROMIUM=/opt/pw-browsers/chromium. For anything that needs clicking first,
// write a throw-away Playwright script that calls page.screenshot().
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const [, value] = args.splice(i, 2)
  return value
}
const [width, height] = option('size', '1400x800').split('x').map(Number)
const wait = Number(option('wait', 1500))
const base = option('base', 'http://localhost:5199')
if (!args.length || args.length % 2) {
  console.error('usage: node scripts/screenshot.mjs <page> <out.png> [<page> <out.png> ...] [--size 1400x800] [--wait 1500] [--base url]')
  process.exit(1)
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
for (let i = 0; i < args.length; i += 2) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage()
  await page.goto(base + args[i], { waitUntil: 'networkidle' })
  await page.waitForTimeout(wait)
  await page.screenshot({ path: args[i + 1] })
  console.log(`${args[i]} -> ${args[i + 1]}`)
}
await browser.close()
