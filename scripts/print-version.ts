import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { appVersion } from './version.ts'

// Prints the build's shown version (`0.5.3`), for the API's deploy: `wrangler deploy --var APP_VERSION:$(node scripts/print-version.ts)`.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
console.log(appVersion(pkg.version, (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()))
